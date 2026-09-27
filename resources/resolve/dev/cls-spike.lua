--[[
KathaCut Resolve Character Level Styling (CLS) spike (brief 15).

Emphasis, and active-word highlight / word pop in full-line display, need Text+ **Character Level
Styling**: styling a character range inside one Text+ clip. Nobody knows how Resolve stores that — the
two earlier attempts (spike 1's T11, spike 2's E10, see docs/decisions/0008-resolve-textplus.md and
0009-resolve-edit-roundtrip.md) both returned no data, because the hand-styled clip they depended on was
never prepared.

This spike produces data **even if the user skips the hand prep** (R0-R2, W1-W4 all run against a
freshly created scratch clip). If a hand-styled clip exists on the timeline that was open when the
script started (R1, optional but strongly recommended — see SPIKE4.md), it's dumped too, so a findings
session (brief 16) can cross-check the guesses this script makes against Resolve's own ground truth.

Safe by construction: it only reads the timeline that was current when it started (R1), and only
creates/edits its OWN new timeline ("KathaCut CLS spike <time>") and its own Text+ clips there. It never
deletes, renames or edits anything that existed before it ran.

This is a Resolve MENU SCRIPT, not a file loaded by one: `Resolve()` and `bmd` are its own globals here
(see docs/plans/resolve-textplus/README.md, "Launcher vs. bridge", and ADR 0008's launcher-globals
addendum). Never `dofile` this from another script expecting those globals to carry over.

Run from Resolve: Workspace -> Scripts -> cls-spike. See SPIKE4.md for setup.
Lua 5.1 / LuaJIT, single file, no `require`s.
]]

-- ---------------------------------------------------------------------------
-- Report plumbing (same shape as edit-spike.lua / compound-spike.lua)
-- ---------------------------------------------------------------------------

local lines = {}

local function log(line)
  print(line)
  lines[#lines + 1] = line
end

local function record(status, id, detail)
  log(string.format("%s %s %s", status, id, detail or ""))
end

local function serialize(value, depth, seen)
  depth = depth or 2
  seen = seen or {}
  local t = type(value)
  if t == "table" then
    if seen[value] then
      return "<cycle>"
    end
    if depth <= 0 then
      return "<table, depth limit>"
    end
    seen[value] = true
    local parts = {}
    for k, v in pairs(value) do
      parts[#parts + 1] = string.format("%s=%s", tostring(k), serialize(v, depth - 1, seen))
    end
    seen[value] = nil
    return "{" .. table.concat(parts, ", ") .. "}"
  elseif t == "string" then
    return string.format("%q", value)
  else
    return tostring(value)
  end
end

local function test(id, fn)
  local ok, err = pcall(fn)
  if not ok then
    record("FAIL", id, "uncaught error: " .. tostring(err))
  end
end

-- Calls obj:methodName(...) via pcall. Returns (true, result) on success, or (false, "missing") if the
-- method doesn't exist or the call itself errors — the spike can't distinguish those two cases from the
-- outside, so both are logged as "missing" per the brief.
local function tryCall(obj, methodName, ...)
  local ok, result = pcall(function(...) return obj[methodName](obj, ...) end, ...)
  if not ok then
    return false, "missing"
  end
  return true, result
end

-- ---------------------------------------------------------------------------
-- Paths
-- ---------------------------------------------------------------------------

local pathSep = package.config:sub(1, 1)

local function getTempDir()
  local t = os.getenv("TEMP") or os.getenv("TMPDIR") or os.getenv("TMP")
  if t and t ~= "" then
    return t
  end
  return "/tmp"
end

local tempDir = getTempDir()

local function joinPath(dir, name)
  if dir:sub(-1) == pathSep then
    return dir .. name
  end
  return dir .. pathSep .. name
end

local reportPath = joinPath(tempDir, "kathacut-cls-spike.txt")

local function fileSize(path)
  local f = io.open(path, "rb")
  if not f then
    return nil
  end
  local size = f:seek("end")
  f:close()
  return size
end

-- Writes `<name>.tmp` then renames it over the target (same pattern bridge.lua uses for the mailbox).
local function writeTextFile(path, content)
  local tmpPath = path .. ".tmp"
  local f = io.open(tmpPath, "w")
  if not f then
    return false
  end
  f:write(content)
  f:close()
  os.remove(path)
  return os.rename(tmpPath, path) and true or false
end

-- ---------------------------------------------------------------------------
-- Small helpers shared with edit-spike.lua / bridge.lua
-- ---------------------------------------------------------------------------

local RATIONAL_FRAME_RATES = {
  ["23.976"] = { 24000, 1001 },
  ["29.97"] = { 30000, 1001 },
  ["47.952"] = { 48000, 1001 },
  ["59.94"] = { 60000, 1001 },
  ["119.88"] = { 120000, 1001 },
}

local function rationalFrameRate(fpsSetting)
  local exact = RATIONAL_FRAME_RATES[tostring(fpsSetting)]
  if exact then
    return exact[1], exact[2]
  end
  return tonumber(fpsSetting) or 24, 1
end

local function isTruthySetting(v)
  return v == true or v == "1" or v == 1
end

local function framesToTimecode(frameCount, num, den, dropFrame)
  local nominal = math.floor(num / den + 0.5)
  local dropPerMinute = 0
  if dropFrame then
    if nominal == 30 then
      dropPerMinute = 2
    elseif nominal == 60 then
      dropPerMinute = 4
    end
  end
  local adjustedFrame = frameCount
  if dropPerMinute > 0 then
    local framesPer10Min = nominal * 600 - dropPerMinute * 9
    local framesPerMin = nominal * 60 - dropPerMinute
    local d = math.floor(frameCount / framesPer10Min)
    local m = frameCount % framesPer10Min
    local extra
    if m > dropPerMinute then
      extra = dropPerMinute * 9 * d + dropPerMinute * math.floor((m - dropPerMinute) / framesPerMin)
    else
      extra = dropPerMinute * 9 * d
    end
    adjustedFrame = frameCount + extra
  end
  local totalSeconds = math.floor(adjustedFrame / nominal)
  local frames = adjustedFrame - totalSeconds * nominal
  local hours = math.floor(totalSeconds / 3600)
  local minutes = math.floor((totalSeconds % 3600) / 60)
  local seconds = totalSeconds % 60
  local frameSep = dropPerMinute > 0 and ";" or ":"
  return string.format("%02d:%02d:%02d%s%02d", hours, minutes, seconds, frameSep, frames)
end

-- UTF-8 codepoint count (Lua 5.1 has no utf8 library). Counts leading bytes only.
local function utf8Length(s)
  local count = 0
  local i = 1
  local len = #s
  while i <= len do
    local b = s:byte(i)
    if b < 0x80 then
      i = i + 1
    elseif b >= 0xF0 then
      i = i + 4
    elseif b >= 0xE0 then
      i = i + 3
    elseif b >= 0xC0 then
      i = i + 2
    else
      i = i + 1
    end
    count = count + 1
  end
  return count
end

-- Number of whole codepoints in the first `byteLimit` bytes of `s`. Only meaningful when `byteLimit`
-- lands on a codepoint boundary (true for every offset this script computes, since they all come from
-- `string.find` on whole marked words).
local function codepointOffsetAtByte(s, byteLimit)
  return utf8Length(s:sub(1, byteLimit))
end

-- bridge.lua's textPlusTool: the Fusion comp + TextPlus tool on a Text+ timeline item.
local function textPlusTool(item)
  local ok, comp = pcall(function() return item:GetFusionCompByIndex(1) end)
  if not ok or not comp then
    return nil, nil
  end
  local ok2, tool = pcall(function() return comp:FindToolByID("TextPlus") end)
  if ok2 and tool then
    return comp, tool
  end
  local ok3, toolList = pcall(function() return comp:GetToolList(false) end)
  if ok3 and toolList then
    for _, candidate in pairs(toolList) do
      local ok4, attrs = pcall(function() return candidate:GetAttrs() end)
      if ok4 and attrs and attrs.TOOLS_RegID == "TextPlus" then
        return comp, candidate
      end
    end
  end
  return comp, nil
end

-- Finds a modifier tool on `comp` whose registered ID looks like a Character Level Styling modifier
-- (the old E10 spike's heuristic, generalized): "StyledTextCLS" is the name given in the Background
-- section of brief 15, but that's unconfirmed, so this matches any regId containing "CLS" or "Styled"
-- other than the TextPlus tool itself.
local function findModifierTool(comp)
  local ok, toolList = pcall(function() return comp:GetToolList(false) end)
  if not ok or not toolList then
    return nil, nil
  end
  for _, t in pairs(toolList) do
    local aok, attrs = pcall(function() return t:GetAttrs() end)
    local regId = aok and attrs and attrs.TOOLS_RegID
    if regId and regId ~= "TextPlus" and (tostring(regId):find("CLS") or tostring(regId):find("Styled")) then
      return t, tostring(regId)
    end
  end
  return nil, nil
end

local function deepCopy(value, seen)
  seen = seen or {}
  if type(value) ~= "table" then
    return value
  end
  if seen[value] then
    return seen[value]
  end
  local copy = {}
  seen[value] = copy
  for k, v in pairs(value) do
    copy[deepCopy(k, seen)] = deepCopy(v, seen)
  end
  return copy
end

-- Recursively searches `t` for the first (sub)table that itself has a `key` field, e.g. a table shaped
-- like `{ CharacterLevelStyling = {...}, ... }`. Used on R0's full `CopySettings()` dump, whose actual
-- shape this spike doesn't know ahead of time — that's what R0 finds out.
local function findNodeWithKey(t, key, depth, seen)
  seen = seen or {}
  if type(t) ~= "table" or depth > 8 or seen[t] then
    return nil
  end
  seen[t] = true
  if t[key] ~= nil then
    return t
  end
  for _, v in pairs(t) do
    local found = findNodeWithKey(v, key, depth + 1, seen)
    if found then
      return found
    end
  end
  return nil
end

-- Dumps every input on a modifier tool: id, and current value at `depth`.
local function dumpModifierInputs(t, depth)
  local parts = {}
  local ok, inputList = pcall(function() return t:GetInputList() end)
  if ok and inputList then
    for _, input in pairs(inputList) do
      local iok, iattrs = pcall(function() return input:GetAttrs() end)
      local id = iok and iattrs and iattrs.INPS_ID
      if id then
        local vok, v = pcall(function() return t:GetInput(id) end)
        parts[#parts + 1] = string.format("%s=%s", tostring(id), vok and serialize(v, depth) or "<error>")
      end
    end
  end
  return "{" .. table.concat(parts, ", ") .. "}"
end

-- Tries each connection method the brief lists, in order, and stops at the first that doesn't error.
local function tryConnect(tool, mod)
  local attempts = {}

  local ok1, err1 = pcall(function() tool.StyledText:ConnectTo(mod.StyledText) end)
  attempts[#attempts + 1] = string.format("tool.StyledText:ConnectTo(mod.StyledText) ok=%s err=%s", tostring(ok1), tostring(err1))
  if ok1 then return "ConnectTo", attempts end

  local ok2, err2 = pcall(function() tool:ConnectInput("StyledText", mod) end)
  attempts[#attempts + 1] = string.format("tool:ConnectInput('StyledText', mod) ok=%s err=%s", tostring(ok2), tostring(err2))
  if ok2 then return "ConnectInput", attempts end

  local ok3, err3 = pcall(function() mod.Text = tool:GetInput("StyledText") end)
  attempts[#attempts + 1] = string.format("mod.Text = <text> ok=%s err=%s", tostring(ok3), tostring(err3))
  if ok3 then return "ModText", attempts end

  return nil, attempts
end

-- ---------------------------------------------------------------------------
-- Test string and marked words (brief 15's "R2 (unit)")
--
-- Grapheme offsets are HARD-CODED, computed by this session with `graphemes()` from
-- src/core/captionText.ts (an `Intl.Segmenter('und', { granularity: 'grapheme' })`, the same segmenter
-- KathaCut's own code uses). Lua 5.1 has no Unicode-aware grapheme segmentation, so this script can't
-- compute them itself — the findings session (16) compares these against R1's real start/end values.
-- ---------------------------------------------------------------------------

local TEST_STRING = "പ്രൈം മിനിസ്റ്റർ Sam ആൾട്ട്മാൻ\nവിളിച്ചിട്ട് പറഞ്ഞത്"

local MARKED_WORDS = {
  { text = "Sam", grapheme = { 7, 10 } },
  { text = "ആൾട്ട്മാൻ", grapheme = { 11, 15 } },
  { text = "പറഞ്ഞത്", grapheme = { 21, 25 } },
}

-- UTF-8 byte [start, end) for each marked word, matched strictly in order (like wordRanges in
-- src/resolve/charUnits.ts). Computed once at load time — pure string math, no Resolve objects needed.
local function computeWordByteRanges()
  local ranges = {}
  local cursor = 1
  for _, word in ipairs(MARKED_WORDS) do
    local s, e = TEST_STRING:find(word.text, cursor, true)
    if s then
      ranges[word.text] = { s - 1, e }
      cursor = e + 1
    end
  end
  return ranges
end

local WORD_BYTE_RANGES = computeWordByteRanges()

-- ---------------------------------------------------------------------------
-- CLS value construction. The array shape (`{ { <propId>, <start>, <end>, Value = <v> }, ... }`) is from
-- the brief's Background section (unverified); the counting UNIT for start/end is this script's biggest
-- guess. It uses UTF-8 BYTE offsets (Lua's own native string indexing, and a common convention in
-- C/C++-based tools) as its one operative guess for every value it actually WRITES below. R2 logs the
-- alternate (UTF-16 / codepoint / grapheme) values for the same ranges so the findings session can retry
-- with a different unit if a still shows the wrong characters styled.
-- ---------------------------------------------------------------------------

local colorPropIds -- { redId, greenId, blueId, alphaId }, filled by computePropIdGuesses()
local sizePropId

-- First `count` array-shaped entries out of a CLS value that may be `{ Array = {...}, ... }` or a bare array.
local function firstArrayEntries(clsValue, count)
  local out = {}
  if type(clsValue) == "table" then
    local arr = clsValue.Array or clsValue
    if type(arr) == "table" then
      for _, entry in pairs(arr) do
        if #out >= count then break end
        if type(entry) == "table" then out[#out + 1] = entry end
      end
    end
  end
  return out
end

local function guessPropId(sampleEntries, index, fallback)
  local entry = sampleEntries[index]
  if entry and entry[1] ~= nil then
    return entry[1]
  end
  return fallback
end

-- Computed after R0 and R1 both ran, so it can prefer R1's real hand-styled values over R0's guesses.
local function computePropIdGuesses(r0ClsDefault, r1ClsSamples)
  local sample = {}
  local source = "fallback-guess"
  if #r1ClsSamples > 0 then
    sample = firstArrayEntries(r1ClsSamples[1], 5)
    if #sample > 0 then source = "R1" end
  end
  if #sample == 0 then
    sample = firstArrayEntries(r0ClsDefault, 5)
    if #sample > 0 then source = "R0" end
  end
  colorPropIds = {
    guessPropId(sample, 1, "Red1"), guessPropId(sample, 2, "Green1"),
    guessPropId(sample, 3, "Blue1"), guessPropId(sample, 4, "Alpha1"),
  }
  sizePropId = guessPropId(sample, 5, "Size")
  record("INFO", "W1-propid-guess", string.format(
    "source=%s colorPropIds={%s, %s, %s, %s} sizePropId=%s (unconfirmed — see ADR 0011 findings)",
    source, tostring(colorPropIds[1]), tostring(colorPropIds[2]), tostring(colorPropIds[3]),
    tostring(colorPropIds[4]), tostring(sizePropId)))
end

local function clsEntry(propId, startU, endU, value)
  return { propId, startU, endU, Value = value }
end

-- `colorRange`/`sizeRange` are `{ startByte, endByte }` or nil to omit that style. Red at full alpha for
-- color; 150% (a 1.5 multiplier on the plain `Size` input) for size.
local function buildClsValue(colorRange, sizeRange)
  local entries = {}
  if colorRange then
    local values = { 1, 0, 0, 1 }
    for i, propId in ipairs(colorPropIds) do
      entries[#entries + 1] = clsEntry(propId, colorRange[1], colorRange[2], values[i])
    end
  end
  if sizeRange then
    entries[#entries + 1] = clsEntry(sizePropId, sizeRange[1], sizeRange[2], 1.5)
  end
  return { Array = entries, Value = "" }
end

-- ---------------------------------------------------------------------------
-- Entry points
-- ---------------------------------------------------------------------------

local resolve = Resolve()
local pm = resolve:GetProjectManager()
local project = pm:GetCurrentProject()
local mediaPool = project:GetMediaPool()

local originalTimeline
local timeline -- the scratch timeline this script creates and owns

local r0Item, comp0, tool0, mod0
local r0SettingsTable
local r0ClsDefault
local r1ClsSamples = {}
local w1Item
local editPagePrompted = false

local function ensureEditPage()
  if not editPagePrompted then
    editPagePrompted = true
    log("Switch to the Edit page now (needed for every still export below).")
    bmd.wait(8)
  end
end

local function exportStillAtFrame(frame, path)
  local num, den = rationalFrameRate(timeline:GetSetting("timelineFrameRate"))
  local dropFrame = isTruthySetting(timeline:GetSetting("timelineDropFrameTimecode"))
  local tc = framesToTimecode(frame, num, den, dropFrame)
  timeline:SetCurrentTimecode(tc)
  local ok = pcall(function() return project:ExportCurrentFrameAsStill(path) end)
  return ok, tc
end

local function exportStillMid(item, path)
  local mid = math.floor((item:GetStart() + item:GetEnd()) / 2)
  return exportStillAtFrame(mid, path)
end

local function advancePlayheadPast(item)
  local num, den = rationalFrameRate(timeline:GetSetting("timelineFrameRate"))
  local dropFrame = isTruthySetting(timeline:GetSetting("timelineDropFrameTimecode"))
  pcall(function() timeline:SetCurrentTimecode(framesToTimecode(item:GetEnd() + 1, num, den, dropFrame)) end)
end

-- ---------------------------------------------------------------------------
-- S0: product and version.
-- ---------------------------------------------------------------------------

local function runS0()
  test("S0", function()
    local nameOk, name = tryCall(resolve, "GetProductName")
    local verOk, ver = tryCall(resolve, "GetVersionString")
    record("INFO", "S0", string.format("product=%s version=%s",
      nameOk and tostring(name) or "missing", verOk and tostring(ver) or "missing"))
  end)
end

-- ---------------------------------------------------------------------------
-- R0: no hand prep needed. A fresh Text+ clip on our own scratch timeline.
-- ---------------------------------------------------------------------------

local function runR0()
  test("R0-setup", function()
    local insOk, item = pcall(function() return timeline:InsertFusionTitleIntoTimeline("Text+") end)
    if not insOk or not item then
      error("InsertFusionTitleIntoTimeline('Text+') failed: " .. tostring(item))
    end
    r0Item = item
    comp0, tool0 = textPlusTool(item)
    if not comp0 or not tool0 then
      error("no Text+ tool found on the newly inserted clip")
    end
    local fontOk = pcall(function() tool0:SetInput("Font", "Anek Malayalam") end)
    local textOk = pcall(function() tool0:SetInput("StyledText", TEST_STRING) end)
    record("PASS", "R0-setup", string.format("fontSetOk=%s textSetOk=%s", tostring(fontOk), tostring(textOk)))
    -- Advance the playhead past this clip now, so every later InsertFusionTitleIntoTimeline call (W1b, W3, W4)
    -- lands after it instead of overlapping it.
    advancePlayheadPast(item)
  end)

  test("R0a", function()
    if not comp0 then
      record("INFO", "R0a", "skipped: no R0 comp")
      return
    end
    local addOk, mod = pcall(function() return comp0:AddTool("StyledTextCLS") end)
    if not addOk or not mod then
      record("INFO", "R0a", "missing: comp:AddTool('StyledTextCLS') failed or returned nil")
      return
    end
    mod0 = mod
    local listOk, inputList = pcall(function() return mod:GetInputList() end)
    if not listOk or not inputList then
      record("INFO", "R0a", "AddTool succeeded, but GetInputList() is missing")
      return
    end
    local parts = {}
    for _, input in pairs(inputList) do
      local iok, iattrs = pcall(function() return input:GetAttrs() end)
      if iok and iattrs then
        local id = iattrs.INPS_ID
        local dtype = iattrs.INPIDT_DataType
        local defOk, defVal = pcall(function() return mod:GetInput(id) end)
        parts[#parts + 1] = string.format("id=%s dataType=%s default=%s",
          tostring(id), tostring(dtype), defOk and serialize(defVal, 4) or "<error>")
      end
    end
    record("PASS", "R0a", "inputs=[" .. table.concat(parts, "; ") .. "]")
    local defOk, defVal = pcall(function() return mod:GetInput("CharacterLevelStyling") end)
    if defOk then
      r0ClsDefault = defVal
      record("INFO", "R0a-cls-default", serialize(defVal, 8))
    end
  end)

  test("R0b", function()
    if not comp0 or not tool0 or not mod0 then
      record("INFO", "R0b", "skipped: no comp/tool/modifier from R0a")
      return
    end
    local via, attempts = tryConnect(tool0, mod0)
    record(via and "PASS" or "FAIL", "R0b", table.concat(attempts, " | "))
    local connOk, connected = pcall(function() return tool0.StyledText:GetConnectedOutput() end)
    record("INFO", "R0b-connected-output", connOk and tostring(connected) or "<error>")
  end)

  test("R0c", function()
    if not comp0 then
      record("INFO", "R0c", "skipped: no R0 comp")
      return
    end
    local copyOk, settings = pcall(function() return comp0:CopySettings() end)
    if not copyOk or not settings then
      record("INFO", "R0c", "missing: comp:CopySettings() failed")
      return
    end
    r0SettingsTable = settings
    record("INFO", "R0c-dump", serialize(settings, 8))
    local writeOk, text = pcall(function() return bmd.writestring(settings) end)
    if writeOk and text then
      writeTextFile(joinPath(tempDir, "kathacut-cls-R0.setting"), text)
      record("PASS", "R0c", "wrote kathacut-cls-R0.setting")
    else
      record("INFO", "R0c", "missing: bmd.writestring(settings) failed")
    end
  end)
end

-- ---------------------------------------------------------------------------
-- R1: optional. Scans the ORIGINAL timeline (never the scratch one) for a hand-styled Text+ clip.
-- ---------------------------------------------------------------------------

local function runR1()
  test("R1", function()
    if not originalTimeline then
      record("INFO", "R1", "skipped: no timeline was open when the script started")
      return
    end
    local found = 0
    local videoCount = originalTimeline:GetTrackCount("video") or 0
    for t = 1, videoCount do
      if found >= 5 then break end
      local items = originalTimeline:GetItemListInTrack("video", t) or {}
      for _, item in pairs(items) do
        if found >= 5 then break end
        if type(item) ~= "number" then
          local comp, tool = textPlusTool(item)
          if tool then
            local connOk, connected = pcall(function() return tool.StyledText:GetConnectedOutput() end)
            if connOk and connected then
              found = found + 1
              local modTool, regId = findModifierTool(comp)
              local textOk, text = pcall(function() return tool:GetInput("StyledText") end)
              record("PASS", "R1-" .. found, string.format(
                "track=%d clip=%s modifierRegId=%s modifierInputs=%s styledText=%s",
                t, tostring(item:GetName()), tostring(regId),
                modTool and dumpModifierInputs(modTool, 8) or "<no modifier tool found>",
                textOk and serialize(text, 1) or "<error>"))

              if modTool then
                local clsOk, clsVal = pcall(function() return modTool:GetInput("CharacterLevelStyling") end)
                if clsOk then
                  r1ClsSamples[#r1ClsSamples + 1] = clsVal
                end
              end

              local copyOk, settings = pcall(function() return comp:CopySettings() end)
              if copyOk then
                local dumpOk, text2 = pcall(function() return bmd.writestring(settings) end)
                if dumpOk and text2 then
                  writeTextFile(joinPath(tempDir, "kathacut-cls-R1-" .. found .. ".setting"), text2)
                end
              end
            end
          end
        end
      end
    end
    if found == 0 then
      record("INFO", "R1", "skipped: no clip on the original timeline has a connected StyledText input " ..
        "(hand prep wasn't done — see SPIKE4.md; this is fine, R0/R2/W1-W4 don't need it)")
    else
      record("PASS", "R1", string.format("found=%d hand-styled clip(s), dumped up to 5", found))
    end
  end)
end

-- ---------------------------------------------------------------------------
-- R2: unit. UTF-16/codepoint/UTF-8-byte are computed here; grapheme is hard-coded (see MARKED_WORDS).
-- ---------------------------------------------------------------------------

local function runR2()
  test("R2", function()
    local totalBytes = #TEST_STRING
    local totalCodepoints = utf8Length(TEST_STRING)
    record("INFO", "R2-totals", string.format(
      "utf8Bytes=%d codepoints=%d utf16=%d (Malayalam is all in the BMP here, so utf16==codepoints)",
      totalBytes, totalCodepoints, totalCodepoints))

    for _, word in ipairs(MARKED_WORDS) do
      local range = WORD_BYTE_RANGES[word.text]
      if not range then
        record("FAIL", "R2-" .. word.text, "not found in TEST_STRING")
      else
        local startCp = codepointOffsetAtByte(TEST_STRING, range[1])
        local endCp = codepointOffsetAtByte(TEST_STRING, range[2])
        record("INFO", "R2-" .. word.text, string.format(
          "utf16=[%d,%d) codepoint=[%d,%d) utf8byte=[%d,%d) grapheme=[%d,%d) (grapheme is hard-coded, " ..
          "computed with graphemes() from src/core/captionText.ts — compare against R1's real values)",
          startCp, endCp, startCp, endCp, range[1], range[2], word.grapheme[1], word.grapheme[2]))
      end
    end
  end)
end

-- ---------------------------------------------------------------------------
-- W1: write. Method (a) edits R0's own CopySettings() dump and pastes it back onto R0's own comp.
-- Method (b) is a fresh second scratch clip, its own modifier, written with mod:SetInput(...).
-- ---------------------------------------------------------------------------

local function runW1a()
  test("W1a", function()
    if not comp0 or not r0SettingsTable then
      record("INFO", "W1a", "skipped: no R0 comp or CopySettings() table (see R0c)")
      return
    end
    local edited = deepCopy(r0SettingsTable)
    local node = findNodeWithKey(edited, "CharacterLevelStyling", 0)
    if not node then
      record("INFO", "W1a", "skipped: no 'CharacterLevelStyling' key anywhere in R0's CopySettings() dump")
      return
    end
    node.CharacterLevelStyling = buildClsValue(WORD_BYTE_RANGES["ആൾട്ട്മാൻ"], WORD_BYTE_RANGES["Sam"])

    local ok, err = pcall(function() return comp0:Paste(edited) end)
    record(ok and "PASS" or "FAIL", "W1a-paste", string.format("ok=%s result=%s", tostring(ok), serialize(err, 1)))

    local modNow, regId = findModifierTool(comp0)
    local readOk, readVal = false, nil
    if modNow then
      readOk, readVal = pcall(function() return modNow:GetInput("CharacterLevelStyling") end)
    end
    record("INFO", "W1a-readback", string.format("modifierRegId=%s value=%s",
      tostring(regId), readOk and serialize(readVal, 8) or "<error or no modifier found>"))

    ensureEditPage()
    local stillPath = joinPath(tempDir, "kathacut-cls-W1a.png")
    local exportOk, tc = exportStillMid(r0Item, stillPath)
    record("INFO", "W1a-still", string.format("path=%s timecode=%s exportOk=%s", stillPath, tostring(tc), tostring(exportOk)))
  end)
end

local function runW1b()
  test("W1b", function()
    local insOk, item = pcall(function() return timeline:InsertFusionTitleIntoTimeline("Text+") end)
    if not insOk or not item then
      record("INFO", "W1b", "skipped: InsertFusionTitleIntoTimeline failed for the second scratch clip")
      return
    end
    w1Item = item
    local comp1, tool1 = textPlusTool(item)
    if not comp1 or not tool1 then
      record("INFO", "W1b", "skipped: no Text+ tool on the new clip")
      advancePlayheadPast(item)
      return
    end
    pcall(function() tool1:SetInput("Font", "Anek Malayalam") end)
    pcall(function() tool1:SetInput("StyledText", TEST_STRING) end)

    local addOk, mod1 = pcall(function() return comp1:AddTool("StyledTextCLS") end)
    if not addOk or not mod1 then
      record("INFO", "W1b", "skipped: comp:AddTool('StyledTextCLS') is missing on this clip's comp")
      advancePlayheadPast(item)
      return
    end
    local via, attempts = tryConnect(tool1, mod1)
    record(via and "PASS" or "FAIL", "W1b-connect", table.concat(attempts, " | "))

    local setOk, setErr = pcall(function()
      mod1:SetInput("CharacterLevelStyling", buildClsValue(WORD_BYTE_RANGES["ആൾട്ട്മാൻ"], WORD_BYTE_RANGES["Sam"]))
    end)
    record(setOk and "PASS" or "FAIL", "W1b-setinput", string.format("ok=%s err=%s", tostring(setOk), tostring(setErr)))

    local readOk, readVal = pcall(function() return mod1:GetInput("CharacterLevelStyling") end)
    record("INFO", "W1b-readback", readOk and serialize(readVal, 8) or "<error>")

    ensureEditPage()
    local stillPath = joinPath(tempDir, "kathacut-cls-W1b.png")
    local exportOk, tc = exportStillMid(item, stillPath)
    record("INFO", "W1b-still", string.format("path=%s timecode=%s exportOk=%s", stillPath, tostring(tc), tostring(exportOk)))

    advancePlayheadPast(item)
  end)
end

-- ---------------------------------------------------------------------------
-- W2: clear. Operates on the W1b clip (the SetInput one).
-- ---------------------------------------------------------------------------

local function runW2()
  test("W2", function()
    if not w1Item then
      record("INFO", "W2", "skipped: no W1b clip")
      return
    end
    local comp1, tool1 = textPlusTool(w1Item)
    if not tool1 then
      record("INFO", "W2", "skipped: no Text+ tool on the W1b clip")
      return
    end

    local plainOk, plainErr = pcall(function() tool1:SetInput("StyledText", TEST_STRING) end)
    record(plainOk and "PASS" or "FAIL", "W2-disconnect-via-plain-value", string.format("ok=%s err=%s", tostring(plainOk), tostring(plainErr)))

    local modTool = select(1, findModifierTool(comp1))
    local emptyOk, emptyErr = false, "no modifier tool found"
    if modTool then
      emptyOk, emptyErr = pcall(function() modTool:SetInput("CharacterLevelStyling", { Array = {}, Value = "" }) end)
    end
    record(emptyOk and "PASS" or "FAIL", "W2-empty-array", string.format("ok=%s err=%s", tostring(emptyOk), tostring(emptyErr)))

    local connOk, connected = pcall(function() return tool1.StyledText:GetConnectedOutput() end)
    local textOk, text = pcall(function() return tool1:GetInput("StyledText") end)
    record("INFO", "W2-readback", string.format("stillConnected=%s styledText=%s",
      connOk and tostring(connected ~= nil) or "<error>", textOk and serialize(text, 1) or "<error>"))

    ensureEditPage()
    local stillPath = joinPath(tempDir, "kathacut-cls-W2.png")
    local exportOk, tc = exportStillMid(w1Item, stillPath)
    record("INFO", "W2-still", string.format(
      "path=%s timecode=%s exportOk=%s note=confirm by eye that the text still reads correctly",
      stillPath, tostring(tc), tostring(exportOk)))
  end)
end

-- ---------------------------------------------------------------------------
-- W3: keyframe. A third scratch clip; style A (word 1 red) at frame 0, style B (word 2 red) at frame 10.
-- ---------------------------------------------------------------------------

local function runW3()
  test("W3", function()
    local insOk, item = pcall(function() return timeline:InsertFusionTitleIntoTimeline("Text+") end)
    if not insOk or not item then
      record("INFO", "W3", "skipped: InsertFusionTitleIntoTimeline failed for the third scratch clip")
      return
    end
    local comp3, tool3 = textPlusTool(item)
    if not comp3 or not tool3 then
      record("INFO", "W3", "skipped: no Text+ tool on the new clip")
      advancePlayheadPast(item)
      return
    end
    pcall(function() tool3:SetInput("Font", "Anek Malayalam") end)
    pcall(function() tool3:SetInput("StyledText", TEST_STRING) end)

    local addOk, mod3 = pcall(function() return comp3:AddTool("StyledTextCLS") end)
    if not addOk or not mod3 then
      record("INFO", "W3", "skipped: comp:AddTool('StyledTextCLS') is missing")
      advancePlayheadPast(item)
      return
    end
    local via, attempts = tryConnect(tool3, mod3)
    record(via and "PASS" or "FAIL", "W3-connect", table.concat(attempts, " | "))

    local styleA = buildClsValue(WORD_BYTE_RANGES["Sam"], nil) -- word 1 red
    local styleB = buildClsValue(WORD_BYTE_RANGES["ആൾട്ട്മാൻ"], nil) -- word 2 red

    local setOk, setErr = pcall(function()
      comp3:Lock()
      mod3.CharacterLevelStyling = comp3:BezierSpline()
      mod3.CharacterLevelStyling[0] = styleA
      mod3.CharacterLevelStyling[10] = styleB
      comp3:Unlock()
    end)
    if not setOk then
      pcall(function() comp3:Unlock() end)
    end
    record(setOk and "PASS" or "FAIL", "W3-keyframe", string.format("splineType=BezierSpline ok=%s err=%s", tostring(setOk), tostring(setErr)))

    ensureEditPage()
    local startF = item:GetStart()
    local path5 = joinPath(tempDir, "kathacut-cls-W3-frame5.png")
    local path15 = joinPath(tempDir, "kathacut-cls-W3-frame15.png")
    local ok5, tc5 = exportStillAtFrame(startF + 5, path5)
    local ok15, tc15 = exportStillAtFrame(startF + 15, path15)
    record("INFO", "W3-stills", string.format(
      "frame5(path=%s tc=%s exportOk=%s) frame15(path=%s tc=%s exportOk=%s)",
      path5, tostring(tc5), tostring(ok5), path15, tostring(tc15), tostring(ok15)))

    local size5, size15 = fileSize(path5), fileSize(path15)
    record("INFO", "W3-coarse-diff", string.format(
      "fileSizeFrame5=%s fileSizeFrame15=%s sizesDiffer=%s " ..
      "note=a coarse signal only; confirm by eye whether word 1 or word 2 is red in each still",
      tostring(size5), tostring(size15), tostring(size5 ~= size15)))

    advancePlayheadPast(item)
  end)
end

-- ---------------------------------------------------------------------------
-- W4: timing. Applies the W1b method (AddTool + connect + SetInput) to 50 fresh scratch clips.
-- ---------------------------------------------------------------------------

local function runW4()
  test("W4", function()
    local placed = 0
    local t0 = os.clock()
    for _ = 1, 50 do
      local insOk, item = pcall(function() return timeline:InsertFusionTitleIntoTimeline("Text+") end)
      if insOk and item then
        placed = placed + 1
        local comp4, tool4 = textPlusTool(item)
        if comp4 and tool4 then
          pcall(function() tool4:SetInput("StyledText", TEST_STRING) end)
          local addOk, mod4 = pcall(function() return comp4:AddTool("StyledTextCLS") end)
          if addOk and mod4 then
            tryConnect(tool4, mod4)
            pcall(function() mod4:SetInput("CharacterLevelStyling", buildClsValue(WORD_BYTE_RANGES["ആൾട്ട്മാൻ"], WORD_BYTE_RANGES["Sam"])) end)
          end
        end
        advancePlayheadPast(item)
      end
    end
    local elapsed = os.clock() - t0
    record("PASS", "W4", string.format(
      "appended=%d cpuSeconds=%.3f (per clip: InsertFusionTitleIntoTimeline + AddTool + connect + SetInput, method b)",
      placed, elapsed))
  end)
end

-- ---------------------------------------------------------------------------
-- Main
-- ---------------------------------------------------------------------------

local function main()
  originalTimeline = project:GetCurrentTimeline()
  record("INFO", "SETUP", "current timeline at start: " ..
    tostring(originalTimeline and originalTimeline:GetName() or "none"))

  runS0()

  local name = "KathaCut CLS spike " .. tostring(os.time())
  timeline = mediaPool:CreateEmptyTimeline(name)
  if not timeline then
    error("CreateEmptyTimeline returned nil")
  end
  project:SetCurrentTimeline(timeline)
  record("INFO", "SETUP", "created scratch timeline: " .. name)

  runR0()
  runR1()
  runR2()
  computePropIdGuesses(r0ClsDefault, r1ClsSamples)
  runW1a()
  runW1b()
  runW2()
  runW3()
  runW4()

  log("DONE")
  log("output folder=" .. tempDir)
end

local function writeReport()
  local tmpPath = reportPath .. ".tmp"
  local f = io.open(tmpPath, "w")
  if not f then
    print("ERROR: could not open " .. tmpPath .. " for writing")
    return
  end
  f:write(table.concat(lines, "\n"))
  f:write("\n")
  f:close()
  local ok = os.rename(tmpPath, reportPath)
  if not ok then
    os.remove(reportPath)
    ok = os.rename(tmpPath, reportPath)
  end
  if not ok then
    print("ERROR: could not rename " .. tmpPath .. " to " .. reportPath)
  end
end

local ok, err = pcall(main)
if not ok then
  record("FAIL", "FATAL", tostring(err))
end

-- Cleanup: leave everything created in place; restore whatever timeline was current before.
test("CLEANUP", function()
  if originalTimeline then
    local restoreOk = project:SetCurrentTimeline(originalTimeline)
    record("INFO", "CLEANUP", "restored original timeline: " .. tostring(restoreOk))
  else
    record("INFO", "CLEANUP", "no original timeline to restore")
  end
end)

log("Done, report at " .. reportPath)
writeReport()
