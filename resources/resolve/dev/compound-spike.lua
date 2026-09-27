--[[
KathaCut Resolve compound clip spike (brief 13).

`planEditImport` (src/resolve/editToProject.ts) currently reports a compound clip or nested timeline
as "Compound clip or nested timeline" and skips it, because the scripting API has no call that opens
or decomposes a compound clip (its media pool item's `File Path` is empty; ADR 0009, run 2). The one
documented route to a compound's inner edit is `timeline:Export(path, type, subtype)` to OTIO or
FCPXML. This spike confirms whether that export carries the inner clips, how long it takes, and finds
the outer compound item's identifying properties so a later findings session (ADR 0010) can work out
how to match an exported compound to a C2 item here.

Read-only by construction: it only calls `GetXxx`/`Export` on the timeline that's current when it
starts. It never adds, edits or deletes a timeline item, track or media pool item.

This is a Resolve MENU SCRIPT, not a file loaded by one: `Resolve()` and `bmd` are its own globals
here (see docs/plans/resolve-textplus/README.md, "Launcher vs. bridge", and ADR 0008's launcher-globals
addendum). Never `dofile` this from another script expecting those globals to carry over.

Run from Resolve: Workspace -> Scripts -> compound-spike. See SPIKE3.md for setup.
Lua 5.1 / LuaJIT, single file, no `require`s.
]]

-- ---------------------------------------------------------------------------
-- Report plumbing (same shape as edit-spike.lua)
-- ---------------------------------------------------------------------------

local lines = {}

local function log(line)
  print(line)
  lines[#lines + 1] = line
end

local function record(status, id, detail)
  log(string.format("%s %s %s", status, id, detail or ""))
end

local function test(id, fn)
  local ok, err = pcall(fn)
  if not ok then
    record("FAIL", id, "uncaught error: " .. tostring(err))
  end
end

-- Calls obj:methodName(...) via pcall. Returns (true, result) on success, or (false, "missing") if the
-- method doesn't exist or the call itself errors — the spike can't distinguish those two cases from the
-- outside, so both are logged as "missing".
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

local reportPath = joinPath(tempDir, "kathacut-compound-spike.txt")
local otioPath = joinPath(tempDir, "kathacut-compound-spike.otio")
local fcpxmlPath = joinPath(tempDir, "kathacut-compound-spike.fcpxml")

local function fileSize(path)
  local f = io.open(path, "rb")
  if not f then
    return nil
  end
  local size = f:seek("end")
  f:close()
  return size
end

-- Dumps a flat table's key/value pairs, sorted by key, as "k=v, k2=v2". Used for C3's
-- GetClipProperty() table so the same key always lands on the same line across runs.
local function serializeSorted(tbl)
  local keys = {}
  for k in pairs(tbl) do
    keys[#keys + 1] = k
  end
  table.sort(keys, function(a, b) return tostring(a) < tostring(b) end)
  local parts = {}
  for _, k in ipairs(keys) do
    parts[#parts + 1] = string.format("%s=%s", tostring(k), tostring(tbl[k]))
  end
  return "{" .. table.concat(parts, ", ") .. "}"
end

-- ---------------------------------------------------------------------------
-- Entry points
-- ---------------------------------------------------------------------------

local resolve = Resolve()
local pm = resolve:GetProjectManager()
local project = pm:GetCurrentProject()
local timeline = project and project:GetCurrentTimeline() or nil

local itemCount = 0
local firstCompoundItem
local firstCompoundMpItem

-- ---------------------------------------------------------------------------
-- C1: export the current timeline to OTIO and FCPXML.
-- ---------------------------------------------------------------------------

local function exportFormat(name, ext, path)
  local typeValue = resolve[name]
  if typeValue == nil then
    record("INFO", "C1-" .. ext, string.format("constant=%s value=missing", name))
    return
  end
  record("INFO", "C1-" .. ext, string.format("constant=%s value=%s", name, tostring(typeValue)))

  local noneValue = resolve.EXPORT_NONE
  local t0 = os.clock()
  local ok, result
  if noneValue ~= nil then
    ok, result = pcall(function() return timeline:Export(path, typeValue, noneValue) end)
  else
    record("INFO", "C1-" .. ext, "constant=EXPORT_NONE value=missing; calling Export with two arguments instead")
    ok, result = pcall(function() return timeline:Export(path, typeValue) end)
  end
  local elapsed = os.clock() - t0
  local size = fileSize(path)
  record(ok and "PASS" or "FAIL", "C1-" .. ext, string.format(
    "exportCallOk=%s exportReturn=%s elapsedClockSeconds=%.3f fileSizeBytes=%s path=%s",
    tostring(ok), tostring(result), elapsed, size and tostring(size) or "missing-or-unreadable", path))
end

local function runC1()
  test("C1-product", function()
    local nameOk, name = tryCall(resolve, "GetProductName")
    local verOk, ver = tryCall(resolve, "GetVersionString")
    record("INFO", "C1-product", string.format("productName=%s version=%s",
      nameOk and tostring(name) or "missing", verOk and tostring(ver) or "missing"))
  end)

  if not timeline then
    record("INFO", "C1", "skipped: no current timeline")
    return
  end

  test("C1-otio", function() exportFormat("EXPORT_OTIO", "otio", otioPath) end)
  test("C1-fcpxml", function() exportFormat("EXPORT_FCPXML_1_10", "fcpxml", fcpxmlPath) end)
end

-- ---------------------------------------------------------------------------
-- C2: outer timeline items (video and audio tracks), capped at 200.
-- ---------------------------------------------------------------------------

local function describeOuterItem(trackType, trackIndex, indexInTrack, item)
  itemCount = itemCount + 1

  local nameOk, name = tryCall(item, "GetName")
  local startOk, startF = tryCall(item, "GetStart")
  local endOk, endF = tryCall(item, "GetEnd")
  local durOk, durF = tryCall(item, "GetDuration")
  local leftOk, leftOff = tryCall(item, "GetLeftOffset")
  local rightOk, rightOff = tryCall(item, "GetRightOffset")
  local ssfOk, ssf = tryCall(item, "GetSourceStartFrame")
  local sefOk, sef = tryCall(item, "GetSourceEndFrame")

  local mpOk, mpItem = tryCall(item, "GetMediaPoolItem")
  local mpType, mpPath, mpFps, mpStartTC = "missing", "missing", "missing", "missing"
  if mpOk and mpItem then
    local function prop(key)
      local ok, v = pcall(function() return mpItem:GetClipProperty(key) end)
      return ok and tostring(v) or "error"
    end
    mpType = prop("Type")
    mpPath = prop("File Path")
    mpFps = prop("FPS")
    mpStartTC = prop("Start TC")
  end

  record("INFO", "C2", string.format(
    "track=%s:%d item=%d name=%s start=%s end=%s duration=%s leftOffset=%s rightOffset=%s " ..
    "sourceStartFrame=%s sourceEndFrame=%s mpType=%s mpFilePath=%s mpFps=%s mpStartTC=%s",
    trackType, trackIndex, indexInTrack,
    nameOk and tostring(name) or "missing",
    startOk and tostring(startF) or "missing", endOk and tostring(endF) or "missing",
    durOk and tostring(durF) or "missing", leftOk and tostring(leftOff) or "missing",
    rightOk and tostring(rightOff) or "missing",
    ssfOk and tostring(ssf) or "missing", sefOk and tostring(sef) or "missing",
    mpType, mpPath, mpFps, mpStartTC))

  if not firstCompoundItem and mpOk and mpItem then
    local isCompound = tostring(mpType):find("Compound") ~= nil or mpType == "Timeline"
    if isCompound then
      firstCompoundItem = item
      firstCompoundMpItem = mpItem
    end
  end
end

local function runC2()
  test("C2-timeline-start", function()
    if not timeline then
      record("INFO", "C2-timeline-start", "skipped: no current timeline")
      return
    end
    local startFrameOk, startFrame = tryCall(timeline, "GetStartFrame")
    record("INFO", "C2-timeline-start", string.format(
      "startFrame=%s", startFrameOk and tostring(startFrame) or "missing"))
  end)

  test("C2", function()
    if not timeline then
      record("INFO", "C2", "skipped: no current timeline")
      return
    end

    local vcOk, videoCount = tryCall(timeline, "GetTrackCount", "video")
    videoCount = (vcOk and type(videoCount) == "number") and videoCount or 0
    for t = 1, videoCount do
      if itemCount < 200 then
        local itemsOk, items = tryCall(timeline, "GetItemListInTrack", "video", t)
        items = (itemsOk and items) or {}
        for i, item in ipairs(items) do
          if itemCount >= 200 then break end
          describeOuterItem("video", t, i, item)
        end
      end
    end

    local acOk, audioCount = tryCall(timeline, "GetTrackCount", "audio")
    audioCount = (acOk and type(audioCount) == "number") and audioCount or 0
    for t = 1, audioCount do
      if itemCount < 200 then
        local itemsOk, items = tryCall(timeline, "GetItemListInTrack", "audio", t)
        items = (itemsOk and items) or {}
        for i, item in ipairs(items) do
          if itemCount >= 200 then break end
          describeOuterItem("audio", t, i, item)
        end
      end
    end

    record("PASS", "C2", string.format(
      "described %d items across %d video and %d audio tracks", itemCount, videoCount, audioCount))
  end)
end

-- ---------------------------------------------------------------------------
-- C3: the first compound (or nested timeline) media pool item found in C2.
-- ---------------------------------------------------------------------------

local function runC3()
  test("C3", function()
    if not firstCompoundItem or not firstCompoundMpItem then
      record("INFO", "C3", "skipped: no compound or nested-timeline item found in C2")
      return
    end

    local propsOk, props = pcall(function() return firstCompoundMpItem:GetClipProperty() end)
    if propsOk and type(props) == "table" then
      record("INFO", "C3-clip-properties", serializeSorted(props))
    else
      record("INFO", "C3-clip-properties", "missing: GetClipProperty() did not return a table")
    end

    local uidOk, uid = tryCall(firstCompoundMpItem, "GetUniqueId")
    local midOk, mid = tryCall(firstCompoundMpItem, "GetMediaId")
    record("INFO", "C3-ids", string.format(
      "uniqueId=%s mediaId=%s",
      uidOk and tostring(uid) or "missing", midOk and tostring(mid) or "missing"))

    local nameOk, name = tryCall(firstCompoundItem, "GetName")
    local compoundName = nameOk and tostring(name) or nil

    local matches = {}
    local countOk, count = tryCall(project, "GetTimelineCount")
    if countOk and type(count) == "number" then
      for i = 1, count do
        local tlOk, tl = pcall(function() return project:GetTimelineByIndex(i) end)
        if tlOk and tl then
          local tlNameOk, tlName = tryCall(tl, "GetName")
          if tlNameOk and compoundName and tostring(tlName) == compoundName then
            local tlUidOk, tlUid = tryCall(tl, "GetUniqueId")
            matches[#matches + 1] = string.format(
              "timelineIndex=%d uniqueId=%s", i, tlUidOk and tostring(tlUid) or "missing")
          end
        end
      end
    end
    record("INFO", "C3-timeline-match", string.format(
      "compoundName=%s projectTimelineCount=%s matches=%s",
      tostring(compoundName), countOk and tostring(count) or "missing",
      #matches > 0 and table.concat(matches, " | ") or "none"))
  end)
end

local function main()
  record("INFO", "SETUP", "current timeline at start: " ..
    tostring(timeline and timeline:GetName() or "none"))

  runC1()
  runC2()
  runC3()

  log("DONE")
  log("report=" .. reportPath)
  log("otio=" .. otioPath)
  log("fcpxml=" .. fcpxmlPath)
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
writeReport()
