--[[
KathaCut Resolve Character Level Styling (CLS) WRITE spike (brief 19).

ADR 0011 (docs/decisions/0011-resolve-character-level-styling.md) confirmed the CLS data shape, the
property ids for colour/size/underline/style, and the counting unit (0-based code points, end inclusive)
from a hand-styled clip. But every write brief 15 tried (cls-spike.lua's W1a/W1b) used the OLD guessed
ids/shape/unit (Red1/Size names, UTF-8 byte offsets, a plain Lua table), so none of them actually tested
whether a script can write CLS at all: the stills never changed.

This spike writes CLS using ADR 0011's confirmed shape, ids and unit, and tries the three untried methods
in order:
  1. comp:Paste() of a parsed StyledTextCLS tool block
  2. mod:LoadSettings(...) with a parsed tool-settings table
  3. mod:SetInput("CharacterLevelStyling", parsedValue) with a parsed StyledText{...} value
All three build the value FROM A .setting STRING via bmd.readstring, not a plain Lua table (ADR 0011,
"Write method: not confirmed").

Verification note (ADR 0011): GetInput("CharacterLevelStyling") returns "" even when styling IS present.
This script therefore never uses GetInput to check its own work — only comp:CopySettings() dumps (which
the user reads) and exported stills (which the user looks at).

Safe by construction: it only creates/edits its OWN new timeline ("KathaCut CLS write spike <time>") and
its own Text+ clips there. It never touches anything that existed before it ran.

This is a Resolve MENU SCRIPT, not a file loaded by one: Resolve() and bmd are its own globals here (see
docs/plans/resolve-textplus/README.md, "Launcher vs. bridge"). Never dofile this from another script.

Run from Resolve: Workspace -> Scripts -> cls-write-spike. See SPIKE5.md for setup.
Lua 5.1 / LuaJIT, single file, no requires.
]]

-- ---------------------------------------------------------------------------
-- Report plumbing (same shape as cls-spike.lua)
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

local reportPath = joinPath(tempDir, "kathacut-cls-write-spike.txt")

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
-- Small helpers shared with cls-spike.lua
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

-- Same heuristic as cls-spike.lua: matches a modifier tool whose registered id contains "CLS" or "Styled".
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

-- Safely walks a chain of table keys, returning nil instead of erroring if any step isn't a table.
local function safeIndex(t, ...)
  local cur = t
  for _, k in ipairs({ ... }) do
    if type(cur) ~= "table" then
      return nil
    end
    cur = cur[k]
  end
  return cur
end

-- A hint only (ADR 0011: GetInput can't be trusted; the user's read of the dump and the still are what
-- actually confirm a write). True if the dump text contains one of ADR 0011's confirmed ids attached to a
-- non-empty Array.
local function dumpLooksStyled(dumpText)
  if not dumpText then
    return false
  end
  if dumpText:find("Array%s*=%s*{}") then
    return false
  end
  return dumpText:find("2401") ~= nil or dumpText:find("109,") ~= nil
end

-- ---------------------------------------------------------------------------
-- Test string and marked words, same as cls-spike.lua, but ranges below are converted to ADR 0011's
-- CONFIRMED unit: 0-based code points, end INCLUSIVE (cls-spike.lua used UTF-8 byte, end-exclusive
-- ranges, which is why none of its writes rendered anything).
-- ---------------------------------------------------------------------------

local TEST_STRING = "പ്രൈം മിനിസ്റ്റർ Sam ആൾട്ട്മാൻ വിളിച്ചിട്ട് പറഞ്ഞത്"

local MARKED_WORDS = { "Sam", "ആൾട്ട്മാൻ", "പറഞ്ഞത്" }

-- `{ startByte, endByte }` (end-exclusive) per marked word, matched strictly in order.
local function computeWordByteRanges()
  local ranges = {}
  local cursor = 1
  for _, word in ipairs(MARKED_WORDS) do
    local s, e = TEST_STRING:find(word, cursor, true)
    if s then
      ranges[word] = { s - 1, e }
      cursor = e + 1
    end
  end
  return ranges
end

local WORD_BYTE_RANGES = computeWordByteRanges()

-- ADR 0011's unit: 0-based code points, end INCLUSIVE. `{ startCp, endCpInclusive }`.
local function codepointRange(word)
  local byteRange = WORD_BYTE_RANGES[word]
  if not byteRange then
    return nil
  end
  local startCp = codepointOffsetAtByte(TEST_STRING, byteRange[1])
  local endCpExclusive = codepointOffsetAtByte(TEST_STRING, byteRange[2])
  return { startCp, endCpExclusive - 1 }
end

local COLOR_WORD = "ആൾട്ട്മാൻ" -- red, ids 2401-2403
local SIZE_WORD = "Sam"          -- absolute size 0.08, id 102 (ADR 0011's sample base was 0.0412; this is a guess if the base size differs)

-- ---------------------------------------------------------------------------
-- Snippet construction: a `.setting`-shaped string, the exact form
-- docs/decisions/evidence/resolve-cls-spike-2026-09-28-R1-1.setting dumped, parsed with bmd.readstring so
-- it carries the real StyledText/Input/ordered() constructors (ADR 0011: a plain Lua table doesn't work).
-- ---------------------------------------------------------------------------

local SNIPPET_TEMPLATE = [[{
	Tools = ordered() {
		CharacterLevelStyling1 = StyledTextCLS {
			Inputs = {
				CharacterLevelStyling = Input {
					Value = StyledText {
						Array = {
							{ 2401, %d, %d, Value = 1 },
							{ 2402, %d, %d },
							{ 2403, %d, %d },
							{ 102, %d, %d, Value = 0.08 }
						},
						Value = ""
					}
				},
				Text = Input { Value = "%s" },
				TransformRotation = Input { Value = 1 },
				Softness = Input { Value = 1 }
			},
			CtrlWZoom = false
		}
	}
}]]

-- Two single-range variants for the W3 keyframe retry: A colors SIZE_WORD's range red, B colors
-- COLOR_WORD's range red, so the two keyframes are visibly different if keyframing works.
local KEYFRAME_VALUE_TEMPLATE = [[StyledText {
	Array = {
		{ 2401, %d, %d, Value = 1 },
		{ 2402, %d, %d },
		{ 2403, %d, %d }
	},
	Value = ""
}]]

local function buildSnippetText()
  local colorRange = codepointRange(COLOR_WORD)
  local sizeRange = codepointRange(SIZE_WORD)
  if not colorRange or not sizeRange then
    return nil, "marked word not found in TEST_STRING"
  end
  return string.format(SNIPPET_TEMPLATE,
    colorRange[1], colorRange[2], colorRange[1], colorRange[2], colorRange[1], colorRange[2],
    sizeRange[1], sizeRange[2], TEST_STRING), nil
end

local function buildKeyframeSnippet(word)
  local range = codepointRange(word)
  if not range then
    return nil
  end
  return string.format(KEYFRAME_VALUE_TEMPLATE, range[1], range[2], range[1], range[2], range[1], range[2])
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

local parsed
local workingMethod -- "A" | "B" | "C" | nil, the first attempt whose dump looked styled
local workingClsItem -- the timeline item whose modifier is connected and (maybe) styled, for W2
local workingModTool

local function ensureEditPage()
  log("Switch to the Edit page now (needed for every still export below).")
  bmd.wait(8)
end

local editPagePromptedOnce = false
local function ensureEditPageOnce()
  if not editPagePromptedOnce then
    editPagePromptedOnce = true
    ensureEditPage()
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

local function newScratchClip()
  local insOk, item = pcall(function() return timeline:InsertFusionTitleIntoTimeline("Text+") end)
  if not insOk or not item then
    return nil, nil, nil
  end
  local comp, tool = textPlusTool(item)
  if comp and tool then
    pcall(function() tool:SetInput("Font", "Anek Malayalam") end)
    pcall(function() tool:SetInput("StyledText", TEST_STRING) end)
  end
  return item, comp, tool
end

local function dumpAndExport(comp, item, settingName, pngName)
  local dumpOk, settings = pcall(function() return comp:CopySettings() end)
  local dumpText
  if dumpOk and settings then
    local writeOk, text = pcall(function() return bmd.writestring(settings) end)
    if writeOk and text then
      dumpText = text
      writeTextFile(joinPath(tempDir, settingName), text)
    end
  end
  ensureEditPageOnce()
  local stillPath = joinPath(tempDir, pngName)
  local exportOk, tc = exportStillMid(item, stillPath)
  return dumpText, exportOk, tc
end

-- ---------------------------------------------------------------------------
-- S0
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
-- Parse the shared snippet once.
-- ---------------------------------------------------------------------------

local function runParse()
  test("PARSE", function()
    local snippetText, buildErr = buildSnippetText()
    if not snippetText then
      record("FAIL", "PARSE", "could not build snippet: " .. tostring(buildErr))
      return
    end
    record("INFO", "PARSE-snippet", snippetText)
    local hasReadstring = type(bmd) == "table" and type(bmd.readstring) == "function"
    if not hasReadstring then
      record("FAIL", "PARSE", "bmd.readstring is missing; every write method below depends on it")
      return
    end
    local ok, result = pcall(function() return bmd.readstring(snippetText) end)
    if not ok or result == nil then
      record("FAIL", "PARSE", string.format("bmd.readstring(snippet) ok=%s result=%s", tostring(ok), serialize(result, 2)))
      return
    end
    parsed = result
    record("PASS", "PARSE", "bmd.readstring parsed the snippet: " .. serialize(parsed, 6))
  end)
end

-- ---------------------------------------------------------------------------
-- Attempt 1: Paste
-- ---------------------------------------------------------------------------

local function runAttemptPaste()
  test("A-paste", function()
    if not parsed then
      record("INFO", "A-paste", "skipped: no parsed snippet (see PARSE)")
      return
    end
    local item, comp, tool = newScratchClip()
    if not item or not comp or not tool then
      record("INFO", "A-paste", "skipped: could not create scratch clip A")
      return
    end
    local pasteOk, pasteErr = pcall(function() return comp:Paste(parsed) end)
    record(pasteOk and "PASS" or "FAIL", "A-paste-call", string.format("ok=%s result=%s", tostring(pasteOk), serialize(pasteErr, 1)))

    local mod, regId = findModifierTool(comp)
    if mod then
      local via, attempts = tryConnect(tool, mod)
      record(via and "PASS" or "FAIL", "A-paste-connect", table.concat(attempts, " | "))
    else
      record("INFO", "A-paste-connect", "skipped: no modifier tool found after paste (regId search)")
    end

    local dumpText, exportOk, tc = dumpAndExport(comp, item, "kathacut-cls-write-A.setting", "kathacut-cls-write-A.png")
    local looksStyled = dumpLooksStyled(dumpText)
    record("INFO", "A-paste-result", string.format(
      "modifierRegId=%s stillExportOk=%s timecode=%s dumpLooksStyled=%s (hint only; read the .setting and look at the still)",
      tostring(regId), tostring(exportOk), tostring(tc), tostring(looksStyled)))

    if looksStyled and not workingMethod then
      workingMethod = "A"
      workingClsItem = item
      workingModTool = mod
    end
  end)
end

-- ---------------------------------------------------------------------------
-- Attempt 2: LoadSettings
-- ---------------------------------------------------------------------------

local function runAttemptLoadSettings()
  test("B-loadsettings", function()
    if not parsed then
      record("INFO", "B-loadsettings", "skipped: no parsed snippet (see PARSE)")
      return
    end
    local item, comp, tool = newScratchClip()
    if not item or not comp or not tool then
      record("INFO", "B-loadsettings", "skipped: could not create scratch clip B")
      return
    end
    local addOk, mod = pcall(function() return comp:AddTool("StyledTextCLS") end)
    if not addOk or not mod then
      record("INFO", "B-loadsettings", "skipped: comp:AddTool('StyledTextCLS') failed")
      advancePlayheadPast(item)
      return
    end
    local via, attempts = tryConnect(tool, mod)
    record(via and "PASS" or "FAIL", "B-loadsettings-connect", table.concat(attempts, " | "))

    local toolSettings = safeIndex(parsed, "Tools", "CharacterLevelStyling1")
    if not toolSettings then
      record("FAIL", "B-loadsettings", "parsed.Tools.CharacterLevelStyling1 is missing; can't call LoadSettings")
      advancePlayheadPast(item)
      return
    end
    local loadOk, loadErr = pcall(function() return mod:LoadSettings(toolSettings) end)
    record(loadOk and "PASS" or "FAIL", "B-loadsettings-call", string.format("ok=%s result=%s", tostring(loadOk), serialize(loadErr, 1)))

    local dumpText, exportOk, tc = dumpAndExport(comp, item, "kathacut-cls-write-B.setting", "kathacut-cls-write-B.png")
    local looksStyled = dumpLooksStyled(dumpText)
    record("INFO", "B-loadsettings-result", string.format(
      "stillExportOk=%s timecode=%s dumpLooksStyled=%s (hint only; read the .setting and look at the still)",
      tostring(exportOk), tostring(tc), tostring(looksStyled)))

    if looksStyled and not workingMethod then
      workingMethod = "B"
      workingClsItem = item
      workingModTool = mod
    end
  end)
end

-- ---------------------------------------------------------------------------
-- Attempt 3: SetInput
-- ---------------------------------------------------------------------------

local function runAttemptSetInput()
  test("C-setinput", function()
    if not parsed then
      record("INFO", "C-setinput", "skipped: no parsed snippet (see PARSE)")
      return
    end
    local item, comp, tool = newScratchClip()
    if not item or not comp or not tool then
      record("INFO", "C-setinput", "skipped: could not create scratch clip C")
      return
    end
    local addOk, mod = pcall(function() return comp:AddTool("StyledTextCLS") end)
    if not addOk or not mod then
      record("INFO", "C-setinput", "skipped: comp:AddTool('StyledTextCLS') failed")
      advancePlayheadPast(item)
      return
    end
    local via, attempts = tryConnect(tool, mod)
    record(via and "PASS" or "FAIL", "C-setinput-connect", table.concat(attempts, " | "))

    local clsValue = safeIndex(parsed, "Tools", "CharacterLevelStyling1", "Inputs", "CharacterLevelStyling", "Value")
    if not clsValue then
      record("FAIL", "C-setinput", "parsed...CharacterLevelStyling.Value is missing; can't call SetInput")
      advancePlayheadPast(item)
      return
    end
    local setOk, setErr = pcall(function() return mod:SetInput("CharacterLevelStyling", clsValue) end)
    record(setOk and "PASS" or "FAIL", "C-setinput-call", string.format("ok=%s result=%s", tostring(setOk), serialize(setErr, 1)))

    local dumpText, exportOk, tc = dumpAndExport(comp, item, "kathacut-cls-write-C.setting", "kathacut-cls-write-C.png")
    local looksStyled = dumpLooksStyled(dumpText)
    record("INFO", "C-setinput-result", string.format(
      "stillExportOk=%s timecode=%s dumpLooksStyled=%s (hint only; read the .setting and look at the still)",
      tostring(exportOk), tostring(tc), tostring(looksStyled)))

    if looksStyled and not workingMethod then
      workingMethod = "C"
      workingClsItem = item
      workingModTool = mod
    end
  end)
end

-- ---------------------------------------------------------------------------
-- W2 retry: clear, on whichever attempt looked styled first.
-- ---------------------------------------------------------------------------

local function runClearRetry()
  test("W2-retry", function()
    if not workingMethod or not workingClsItem then
      record("INFO", "W2-retry", "skipped: no working write method (see A/B/C above)")
      return
    end
    local comp, tool = textPlusTool(workingClsItem)
    if not tool then
      record("INFO", "W2-retry", "skipped: no Text+ tool on the working clip")
      return
    end
    local plainOk, plainErr = pcall(function() tool:SetInput("StyledText", TEST_STRING) end)
    record(plainOk and "PASS" or "FAIL", "W2-retry-disconnect", string.format(
      "method=%s ok=%s err=%s", workingMethod, tostring(plainOk), tostring(plainErr)))

    ensureEditPageOnce()
    local stillPath = joinPath(tempDir, "kathacut-cls-write-clear.png")
    local exportOk, tc = exportStillMid(workingClsItem, stillPath)
    record("INFO", "W2-retry-still", string.format(
      "path=%s timecode=%s exportOk=%s note=confirm by eye that the text still reads correctly, plain",
      stillPath, tostring(tc), tostring(exportOk)))
  end)
end

-- ---------------------------------------------------------------------------
-- W3 retry: keyframe, only if method C (SetInput) worked.
-- ---------------------------------------------------------------------------

local function runKeyframeRetry()
  test("W3-retry", function()
    if workingMethod ~= "C" then
      record("INFO", "W3-retry", "skipped: keyframing needs method C (SetInput) to have worked; got " .. tostring(workingMethod))
      return
    end
    local sizeSnippet = buildKeyframeSnippet(SIZE_WORD)
    local colorSnippet = buildKeyframeSnippet(COLOR_WORD)
    if not sizeSnippet or not colorSnippet then
      record("INFO", "W3-retry", "skipped: could not build keyframe snippets")
      return
    end
    local okA, valueA = pcall(function() return bmd.readstring(sizeSnippet) end)
    local okB, valueB = pcall(function() return bmd.readstring(colorSnippet) end)
    if not okA or not okB then
      record("FAIL", "W3-retry", string.format("bmd.readstring failed for a keyframe value: okA=%s okB=%s", tostring(okA), tostring(okB)))
      return
    end

    local item, comp, tool = newScratchClip()
    if not item or not comp or not tool then
      record("INFO", "W3-retry", "skipped: could not create scratch clip D")
      return
    end
    local addOk, mod = pcall(function() return comp:AddTool("StyledTextCLS") end)
    if not addOk or not mod then
      record("INFO", "W3-retry", "skipped: comp:AddTool('StyledTextCLS') failed")
      advancePlayheadPast(item)
      return
    end
    local via, attempts = tryConnect(tool, mod)
    record(via and "PASS" or "FAIL", "W3-retry-connect", table.concat(attempts, " | "))

    local setOk, setErr = pcall(function()
      comp:Lock()
      mod.CharacterLevelStyling = comp:BezierSpline()
      mod.CharacterLevelStyling[0] = valueA
      mod.CharacterLevelStyling[10] = valueB
      comp:Unlock()
    end)
    if not setOk then
      pcall(function() comp:Unlock() end)
    end
    record(setOk and "PASS" or "FAIL", "W3-retry-keyframe", string.format("ok=%s err=%s", tostring(setOk), tostring(setErr)))

    ensureEditPageOnce()
    local startF = item:GetStart()
    local path5 = joinPath(tempDir, "kathacut-cls-write-D-frame5.png")
    local path15 = joinPath(tempDir, "kathacut-cls-write-D-frame15.png")
    local ok5, tc5 = exportStillAtFrame(startF + 5, path5)
    local ok15, tc15 = exportStillAtFrame(startF + 15, path15)
    record("INFO", "W3-retry-stills", string.format(
      "frame5(path=%s tc=%s exportOk=%s, should show 'Sam' red) frame15(path=%s tc=%s exportOk=%s, should show 'ആൾട്ട്മാൻ' red)",
      path5, tostring(tc5), tostring(ok5), path15, tostring(tc15), tostring(ok15)))

    advancePlayheadPast(item)
  end)
end

-- ---------------------------------------------------------------------------
-- W4 retry: timing, only if a method worked.
-- ---------------------------------------------------------------------------

local function runTimingRetry()
  test("W4-retry", function()
    if not workingMethod then
      record("INFO", "W4-retry", "skipped: no working write method")
      return
    end
    local placed = 0
    local t0 = os.clock()
    for _ = 1, 50 do
      local item, comp, tool = newScratchClip()
      if item and comp and tool then
        placed = placed + 1
        local addOk, mod = pcall(function() return comp:AddTool("StyledTextCLS") end)
        if addOk and mod then
          tryConnect(tool, mod)
          if workingMethod == "C" then
            local clsValue = safeIndex(parsed, "Tools", "CharacterLevelStyling1", "Inputs", "CharacterLevelStyling", "Value")
            if clsValue then
              pcall(function() mod:SetInput("CharacterLevelStyling", clsValue) end)
            end
          elseif workingMethod == "B" then
            local toolSettings = safeIndex(parsed, "Tools", "CharacterLevelStyling1")
            if toolSettings then
              pcall(function() mod:LoadSettings(toolSettings) end)
            end
          else -- "A"
            pcall(function() comp:Paste(parsed) end)
          end
        end
        advancePlayheadPast(item)
      end
    end
    local elapsed = os.clock() - t0
    record("PASS", "W4-retry", string.format(
      "method=%s appended=%d cpuSeconds=%.3f", workingMethod, placed, elapsed))
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

  local name = "KathaCut CLS write spike " .. tostring(os.time())
  timeline = mediaPool:CreateEmptyTimeline(name)
  if not timeline then
    error("CreateEmptyTimeline returned nil")
  end
  project:SetCurrentTimeline(timeline)
  record("INFO", "SETUP", "created scratch timeline: " .. name)

  runParse()
  runAttemptPaste()
  runAttemptLoadSettings()
  runAttemptSetInput()
  record("INFO", "SUMMARY", "first method whose dump looked styled: " .. tostring(workingMethod or "none"))
  runClearRetry()
  runKeyframeRetry()
  runTimingRetry()

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
