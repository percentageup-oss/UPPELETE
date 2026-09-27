--[[
KathaCut Resolve edit spike (brief 09).

Second spike script: reads a real, cut timeline's items back to their source files (E1-E3), then
exercises timeline building (E4-E6) and the Text+ open items from ADR 0008 (E7-E11) — bulk placement
speed, size/position/justification calibration, write-on keyframes, Character Level Styling and tag
persistence across a project reopen.

Safe by construction: it only reads the timeline that was current when it started, and only creates and
modifies its OWN new timeline ("KathaCut edit spike <time>"), its own media pool bin ("KathaCut Media")
and its own Text+ clips. It never deletes, renames or edits anything that existed before it ran.

This is a Resolve MENU SCRIPT, not a file loaded by one: `Resolve()`, `bmd` and `fu` are its own globals
here (see docs/plans/resolve-textplus/README.md, "Launcher vs. bridge", and ADR 0008's launcher-globals
addendum). Never `dofile` this from another script expecting those globals to carry over.

Run from Resolve: Workspace -> Scripts -> edit-spike. See SPIKE2.md for setup.
Lua 5.1 / LuaJIT, single file, no `require`s.
]]

local MODE = "run" -- "run" (default) or "check" (only re-reads the E11 persisted tag; set after a save/close/reopen)

-- ---------------------------------------------------------------------------
-- Report plumbing (same shape as spike.lua)
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

local reportPath = joinPath(tempDir, "kathacut-edit-spike.txt")

-- ---------------------------------------------------------------------------
-- Small helpers shared with spike.lua / bridge.lua
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

-- Recursively looks for a folder with the given name (bridge.lua's findFolderNamed).
local function findFolderNamed(folder, name, depth)
  if depth > 4 then
    return nil
  end
  local subs = folder:GetSubFolderList() or {}
  for _, sub in pairs(subs) do
    if sub:GetName() == name then
      return sub
    end
  end
  for _, sub in pairs(subs) do
    local found = findFolderNamed(sub, name, depth + 1)
    if found then
      return found
    end
  end
  return nil
end

-- Recursively looks for a bin named "KathaCut" containing a Text+ clip (spike.lua's findTemplateClip).
local function findTemplateClip(folder, path)
  path = path or folder:GetName()
  if folder:GetName() == "KathaCut" then
    local clips = folder:GetClipList() or {}
    for _, clip in ipairs(clips) do
      local ok, clipType = pcall(function() return clip:GetClipProperty("Type") end)
      local name = clip:GetName()
      if (ok and clipType and tostring(clipType):find("Fusion"))
        or (name and tostring(name):find("Text")) then
        return clip, path
      end
    end
    if #clips == 1 then
      return clips[1], path
    end
  end
  local subfolders = folder:GetSubFolderList() or {}
  for _, sub in ipairs(subfolders) do
    local found, foundPath = findTemplateClip(sub, path .. "/" .. sub:GetName())
    if found then
      return found, foundPath
    end
  end
  return nil, nil
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

-- ---------------------------------------------------------------------------
-- Entry points
-- ---------------------------------------------------------------------------

local resolve = Resolve()
local pm = resolve:GetProjectManager()
local project = pm:GetCurrentProject()
local mediaPool = project:GetMediaPool()

local originalTimeline
local editTimeline
local templateClip
local importedItem
local e7FirstItem

-- ---------------------------------------------------------------------------
-- E1 / E2: read the current timeline's items and guess their kind.
-- ---------------------------------------------------------------------------

local itemCount = 0
local firstFilePath, firstFileItem, firstFileMpItem

local function describeItem(trackType, trackIndex, indexInTrack, item)
  itemCount = itemCount + 1

  local nameOk, name = tryCall(item, "GetName")
  local startOk, startF = tryCall(item, "GetStart")
  local endOk, endF = tryCall(item, "GetEnd")
  local durOk, durF = tryCall(item, "GetDuration")
  local leftOk, leftOff = tryCall(item, "GetLeftOffset")
  local rightOk, rightOff = tryCall(item, "GetRightOffset")
  local ssfOk, ssf = tryCall(item, "GetSourceStartFrame")
  local sefOk, sef = tryCall(item, "GetSourceEndFrame")
  local sstOk, sst = tryCall(item, "GetSourceStartTime")
  local fccOk, fcc = tryCall(item, "GetFusionCompCount")
  local colorOk, color = tryCall(item, "GetClipColor")

  local mpOk, mpItem = tryCall(item, "GetMediaPoolItem")
  local filePath, fps, startTC, frames, clipType, videoCodec, resolution, clipDuration =
    "missing", "missing", "missing", "missing", "missing", "missing", "missing", "missing"
  if mpOk and mpItem then
    local function prop(key)
      local ok, v = pcall(function() return mpItem:GetClipProperty(key) end)
      return ok and tostring(v) or "error"
    end
    filePath = prop("File Path")
    fps = prop("FPS")
    startTC = prop("Start TC")
    frames = prop("Frames")
    clipType = prop("Type")
    videoCodec = prop("Video Codec")
    resolution = prop("Resolution")
    clipDuration = prop("Duration")
  end

  local propsOk, props = tryCall(item, "GetProperty")
  local matchedParts = {}
  if propsOk and type(props) == "table" then
    for k, v in pairs(props) do
      local kl = tostring(k):lower()
      if kl:find("speed") or kl:find("retime") or kl:find("zoom") then
        matchedParts[#matchedParts + 1] = string.format("%s=%s", tostring(k), serialize(v, 1))
      end
    end
  end

  record("INFO", "E1", string.format(
    "track=%s:%d item=%d name=%s start=%s end=%s duration=%s leftOffset=%s rightOffset=%s " ..
    "sourceStartFrame=%s sourceEndFrame=%s sourceStartTime=%s mediaPoolItemNil=%s " ..
    "filePath=%s fps=%s startTC=%s frames=%s type=%s videoCodec=%s resolution=%s clipDuration=%s " ..
    "fusionCompCount=%s clipColor=%s speedRetimeZoomProps=%s",
    trackType, trackIndex, indexInTrack,
    nameOk and tostring(name) or "missing",
    startOk and tostring(startF) or "missing", endOk and tostring(endF) or "missing",
    durOk and tostring(durF) or "missing", leftOk and tostring(leftOff) or "missing",
    rightOk and tostring(rightOff) or "missing",
    ssfOk and tostring(ssf) or "missing", sefOk and tostring(sef) or "missing",
    sstOk and tostring(sst) or "missing",
    tostring(not (mpOk and mpItem ~= nil)),
    filePath, fps, startTC, frames, clipType, videoCodec, resolution, clipDuration,
    fccOk and tostring(fcc) or "missing", colorOk and tostring(color) or "missing",
    "{" .. table.concat(matchedParts, ", ") .. "}"))

  if itemCount == 1 and propsOk and type(props) == "table" then
    record("INFO", "E1-property-dump-first-item", serialize(props, 2))
  end

  -- E2: classify. All rules below are guesses for the findings session (ADR 0009) to correct.
  local clipTypeLower = tostring(clipType):lower()
  local isRetimed = false
  for _, part in ipairs(matchedParts) do
    local partLower = part:lower()
    if partLower:find("speed") and not (partLower:find("=1,") or partLower:find("=1}") or partLower:find("=1.0")) then
      isRetimed = true
    end
  end
  local hasFusion = fccOk and tonumber(fcc) ~= nil and tonumber(fcc) > 0
  local hasFile = filePath ~= "missing" and filePath ~= "" and filePath ~= "nil"
  local kind
  if clipTypeLower:find("compound") then
    kind = "compound"
  elseif clipTypeLower:find("multicam") then
    kind = "multicam"
  elseif isRetimed then
    kind = "retimed"
  elseif not hasFile then
    kind = hasFusion and "title/generator" or "unknown-no-file"
  elseif hasFusion then
    kind = "fusion-clip"
  else
    kind = "plain-file"
  end
  record("INFO", "E2", string.format(
    "track=%s:%d item=%d guessedKind=%s rawType=%s hasFile=%s hasFusion=%s speedRetimeZoomProps=%s",
    trackType, trackIndex, indexInTrack, kind, tostring(clipType), tostring(hasFile), tostring(hasFusion),
    "{" .. table.concat(matchedParts, ", ") .. "}"))

  if hasFile and not firstFilePath then
    firstFilePath = filePath
    firstFileItem = item
    firstFileMpItem = mpItem
  end
end

local function main()
  originalTimeline = project:GetCurrentTimeline()
  record("INFO", "SETUP", "current timeline at start: " ..
    tostring(originalTimeline and originalTimeline:GetName() or "none"))

  if MODE == "check" then
    test("E11-check", function()
      local countOk, count = tryCall(project, "GetTimelineCount")
      if not countOk then
        record("INFO", "E11-check", "skipped: GetTimelineCount is missing")
        return
      end
      local found = 0
      for i = 1, count do
        local ok, tl = pcall(function() return project:GetTimelineByIndex(i) end)
        if ok and tl and tostring(tl:GetName()):find("KathaCut edit spike") then
          local videoCount = tl:GetTrackCount("video") or 0
          for v = 1, videoCount do
            for _, item in pairs(tl:GetItemListInTrack("video", v) or {}) do
              local compOk, comp2 = pcall(function() return item:GetFusionCompByIndex(1) end)
              if compOk and comp2 then
                local getOk, val = pcall(function() return comp2:GetData("KathaCut.key") end)
                if getOk and val == "persist-test" then
                  found = found + 1
                  record("PASS", "E11-check", string.format(
                    "timeline=%s clipUid=%s value=%s", tl:GetName(), tostring(item:GetUniqueId()), tostring(val)))
                end
              end
            end
          end
        end
      end
      if found == 0 then
        record("INFO", "E11-check", "no persisted KathaCut.key tag found across any 'KathaCut edit spike' timeline")
      end
    end)
    log("DONE (check mode), report at " .. reportPath)
    return
  end

  -- E1 / E2
  test("E1-E2", function()
    if not originalTimeline then
      record("INFO", "E1", "skipped: no timeline was open when the script started (see SPIKE2.md Prepare step)")
      return
    end
    local videoCount = originalTimeline:GetTrackCount("video") or 0
    for t = 1, videoCount do
      if itemCount < 200 then
        local items = originalTimeline:GetItemListInTrack("video", t) or {}
        for i, item in ipairs(items) do
          if itemCount >= 200 then break end
          describeItem("video", t, i, item)
        end
      end
    end
    local audioCount = originalTimeline:GetTrackCount("audio") or 0
    for t = 1, audioCount do
      if itemCount < 200 then
        local items = originalTimeline:GetItemListInTrack("audio", t) or {}
        for i, item in ipairs(items) do
          if itemCount >= 200 then break end
          describeItem("audio", t, i, item)
        end
      end
    end
    record("PASS", "E1-E2", string.format(
      "described %d items across %d video and %d audio tracks", itemCount, videoCount, audioCount))
  end)

  -- E3: source frame origin
  test("E3", function()
    if not firstFileItem then
      record("INFO", "E3", "skipped: no file-backed item found in E1")
      return
    end
    local ssfOk, ssf = tryCall(firstFileItem, "GetSourceStartFrame")
    local fpsOk, fpsVal = pcall(function() return firstFileMpItem:GetClipProperty("FPS") end)
    local tcOk, startTC = pcall(function() return firstFileMpItem:GetClipProperty("Start TC") end)
    local computedFrames = "n/a"
    if tcOk and fpsOk and startTC and fpsVal then
      local nominal = math.floor((tonumber(fpsVal) or 0) + 0.5)
      local h, m, s, f = tostring(startTC):match("(%d+):(%d+):(%d+)[:;](%d+)")
      if h and nominal > 0 then
        computedFrames = tostring(((tonumber(h) * 3600 + tonumber(m) * 60 + tonumber(s)) * nominal) + tonumber(f))
      end
    end
    record("INFO", "E3", string.format(
      "sourceStartFrame=%s startTC=%s fps=%s framesFromStartTC(non-drop-approx)=%s " ..
      "note=if sourceStartFrame matches framesFromStartTC, source frames count from the file's Start TC; " ..
      "if sourceStartFrame is near 0 instead, source frames count from the file's first frame",
      ssfOk and tostring(ssf) or "missing", tcOk and tostring(startTC) or "error",
      fpsOk and tostring(fpsVal) or "error", computedFrames))
  end)

  -- E4: create a timeline with explicit frame rate and resolution.
  test("E4", function()
    local name = "KathaCut edit spike " .. tostring(os.time())
    editTimeline = mediaPool:CreateEmptyTimeline(name)
    if not editTimeline then
      error("CreateEmptyTimeline returned nil")
    end
    project:SetCurrentTimeline(editTimeline)

    local okCustom, retCustom = tryCall(editTimeline, "SetSetting", "useCustomSettings", "1")
    local okFps, retFps = tryCall(editTimeline, "SetSetting", "timelineFrameRate", "25")
    local okW, retW = tryCall(editTimeline, "SetSetting", "timelineResolutionWidth", "1280")
    local okH, retH = tryCall(editTimeline, "SetSetting", "timelineResolutionHeight", "720")
    local readFps = editTimeline:GetSetting("timelineFrameRate")
    local readW = project:GetSetting("timelineResolutionWidth")
    local readH = project:GetSetting("timelineResolutionHeight")

    record("PASS", "E4", string.format(
      "name=%s useCustomSettings(ok=%s ret=%s) frameRate(ok=%s ret=%s read=%s) " ..
      "width(ok=%s ret=%s read=%s) height(ok=%s ret=%s read=%s)",
      name, tostring(okCustom), serialize(retCustom, 1), tostring(okFps), serialize(retFps, 1), tostring(readFps),
      tostring(okW), serialize(retW, 1), tostring(readW), tostring(okH), serialize(retH, 1), tostring(readH)))
  end)

  -- E5: import media, twice, and find an existing item by File Path.
  test("E5", function()
    if not firstFilePath then
      record("INFO", "E5", "skipped: no file path found in E1")
      return
    end
    local root = mediaPool:GetRootFolder()
    local bin = findFolderNamed(root, "KathaCut Media", 0)
    if not bin then
      local previousForCreate = mediaPool:GetCurrentFolder()
      mediaPool:SetCurrentFolder(root)
      bin = mediaPool:AddSubFolder(root, "KathaCut Media")
      if previousForCreate then
        mediaPool:SetCurrentFolder(previousForCreate)
      end
    end
    if not bin then
      error("could not find or create the 'KathaCut Media' bin")
    end

    local previous = mediaPool:GetCurrentFolder()
    mediaPool:SetCurrentFolder(bin)

    local items1 = mediaPool:ImportMedia({ firstFilePath })
    local paths1 = {}
    for _, it in ipairs(items1 or {}) do
      paths1[#paths1 + 1] = tostring(it:GetClipProperty("File Path"))
    end
    record("INFO", "E5-import1", string.format(
      "count=%d paths=%s", items1 and #items1 or 0, table.concat(paths1, "|")))

    local items2 = mediaPool:ImportMedia({ firstFilePath })
    record("INFO", "E5-import2", string.format(
      "count=%d sameCountAsFirstImport=%s duplicateMade=%s",
      items2 and #items2 or 0,
      tostring(items1 ~= nil and items2 ~= nil and #items1 == #items2),
      tostring(#(bin:GetClipList() or {}) > (#(items1 or {})))))

    local found
    for _, clip in ipairs(bin:GetClipList() or {}) do
      local ok, fp = pcall(function() return clip:GetClipProperty("File Path") end)
      if ok and fp == firstFilePath then
        found = clip
        break
      end
    end
    record("INFO", "E5-find-existing", string.format(
      "method=search bin:GetClipList() for a clip whose 'File Path' equals the imported path; found=%s",
      tostring(found ~= nil)))

    if previous then
      mediaPool:SetCurrentFolder(previous)
    end

    importedItem = (items1 and items1[1]) or found
    if not importedItem then
      error("no imported media item available for E6")
    end
  end)

  -- E6: place two source ranges of the same item and read them back.
  test("E6", function()
    if not editTimeline then
      record("INFO", "E6", "skipped: no E4 timeline")
      return
    end
    if not importedItem then
      record("INFO", "E6", "skipped: no E5 media item")
      return
    end
    local startFrame = editTimeline:GetStartFrame()
    local clipInfos = {
      { mediaPoolItem = importedItem, startFrame = 10, endFrame = 59, recordFrame = startFrame, trackIndex = 1, mediaType = 1 },
      { mediaPoolItem = importedItem, startFrame = 100, endFrame = 149, recordFrame = startFrame + 50, trackIndex = 1, mediaType = 1 },
    }
    local placed = mediaPool:AppendToTimeline(clipInfos)
    if not placed then
      error("AppendToTimeline returned nil")
    end

    local parts = {}
    for i, item in ipairs(placed) do
      local okSSF, ssf = tryCall(item, "GetSourceStartFrame")
      local okSEF, sef = tryCall(item, "GetSourceEndFrame")
      parts[#parts + 1] = string.format(
        "item%d start=%s end=%s(inclusive-check: end-start+1=%s vs requested 50 frames) sourceStart=%s sourceEnd=%s",
        i, tostring(item:GetStart()), tostring(item:GetEnd()),
        tostring(item:GetEnd() - item:GetStart() + 1),
        okSSF and tostring(ssf) or "missing", okSEF and tostring(sef) or "missing")
    end
    record("PASS", "E6-video", string.format(
      "placedCount=%d requestedRecordFrames=%d,%d requestedTrackIndex=1 %s",
      #placed, startFrame, startFrame + 50, table.concat(parts, " | ")))

    local audioParts = {}
    local audioCount = editTimeline:GetTrackCount("audio") or 0
    for a = 1, audioCount do
      for i, item in ipairs(editTimeline:GetItemListInTrack("audio", a) or {}) do
        audioParts[#audioParts + 1] = string.format(
          "audio:%d item%d start=%s end=%s", a, i, tostring(item:GetStart()), tostring(item:GetEnd()))
      end
    end
    record("INFO", "E6-audio", table.concat(audioParts, " | "))

    local fpsOk, sourceFps = pcall(function() return importedItem:GetClipProperty("FPS") end)
    record("INFO", "E6-source-fps", string.format(
      "sourceFps=%s timelineFps=25 note=compare the source start/end frames above against requested " ..
      "startFrame=10/100 endFrame=59/149 to see whether AppendToTimeline's startFrame/endFrame are in the " ..
      "source's own fps or the timeline's",
      fpsOk and tostring(sourceFps) or "error"))
  end)

  -- E7: bulk Text+ append + bulk style, timed.
  test("E7", function()
    if not editTimeline then
      record("INFO", "E7", "skipped: no E4 timeline")
      return
    end
    local root = mediaPool:GetRootFolder()
    templateClip = select(1, findTemplateClip(root))
    if not templateClip then
      record("INFO", "E7", "skipped: no KathaCut Text+ template found (see SPIKE2.md, or docs/decisions/0008-resolve-textplus.md)")
      return
    end
    project:SetCurrentTimeline(editTimeline)
    if not editTimeline:AddTrack("video") then
      error("could not add a new video track")
    end
    local trackIndex = editTimeline:GetTrackCount("video")
    editTimeline:SetTrackName("video", trackIndex, "KathaCut E7")

    local duration = 24
    local cursor = editTimeline:GetStartFrame()
    local clipInfos = {}
    for i = 1, 20 do
      clipInfos[i] = {
        mediaPoolItem = templateClip, startFrame = 0, endFrame = duration - 1,
        recordFrame = cursor, trackIndex = trackIndex, mediaType = 1,
      }
      cursor = cursor + duration + 2
    end

    local t0c, t0t = os.clock(), os.time()
    local placed = mediaPool:AppendToTimeline(clipInfos)
    local placeClockElapsed, placeTimeElapsed = os.clock() - t0c, os.time() - t0t
    if not placed then
      error("bulk AppendToTimeline returned nil")
    end

    local t1c, t1t = os.clock(), os.time()
    local styled = 0
    for i, item in ipairs(placed) do
      local ok1, comp2 = pcall(function() return item:GetFusionCompByIndex(1) end)
      if ok1 and comp2 then
        local ok2, tool2 = pcall(function() return comp2:FindToolByID("TextPlus") end)
        if ok2 and tool2 then
          local ok3 = pcall(function()
            tool2:SetInput("StyledText", "Edit spike " .. tostring(i))
            tool2:SetInput("Size", 0.08)
            tool2:SetInput("Center", { 0.5, 0.3 })
          end)
          if ok3 then
            styled = styled + 1
          end
          if i == 1 then
            e7FirstItem = item
          end
        end
      end
    end
    local styleClockElapsed, styleTimeElapsed = os.clock() - t1c, os.time() - t1t

    record("PASS", "E7", string.format(
      "trackIndex=%d appended=%d placeClockSeconds=%.3f placeWallSeconds=%d; " ..
      "styled=%d styleClockSeconds=%.3f styleWallSeconds=%d",
      trackIndex, #placed, placeClockElapsed, placeTimeElapsed, styled, styleClockElapsed, styleTimeElapsed))
  end)

  -- E8: size / position / justification calibration stills.
  test("E8", function()
    if not e7FirstItem then
      record("INFO", "E8", "skipped: no clip from E7")
      return
    end
    local comp2, tool2 = textPlusTool(e7FirstItem)
    if not tool2 then
      record("INFO", "E8", "skipped: no Text+ tool on the E7 clip")
      return
    end

    pcall(function() tool2:SetInput("StyledText", "H മലയാളം") end)
    pcall(function() tool2:SetInput("Size", 0.08) end)
    pcall(function() tool2:SetInput("Center", { 0.5, 0.2 }) end)
    pcall(function() tool2:SetInput("HorizontalJustificationNew", 0) end)

    local num, den = rationalFrameRate(editTimeline:GetSetting("timelineFrameRate"))
    local dropFrame = isTruthySetting(editTimeline:GetSetting("timelineDropFrameTimecode"))
    local tc = framesToTimecode(e7FirstItem:GetStart(), num, den, dropFrame)
    editTimeline:SetCurrentTimecode(tc)

    log("Switch to the Edit page now.")
    bmd.wait(8)

    for _, justification in ipairs({ 0, 1, 2 }) do
      pcall(function() tool2:SetInput("HorizontalJustificationNew", justification) end)
      local stillPath = joinPath(tempDir, "kathacut-edit-spike-still-j" .. justification .. ".png")
      local ok, result = pcall(function() return project:ExportCurrentFrameAsStill(stillPath) end)
      record("INFO", "E8-justification-" .. justification, string.format(
        "path=%s fps=%s/%s dropFrame=%s timecode=%s exportOk=%s result=%s",
        stillPath, tostring(num), tostring(den), tostring(dropFrame), tc, tostring(ok), serialize(result, 1)))
    end
  end)

  -- E9: write-on keyframes, using the ADR-confirmed `End` input id (not `WriteOnEnd`).
  test("E9", function()
    if not e7FirstItem then
      record("INFO", "E9", "skipped: no clip from E7")
      return
    end
    local comp2, tool2 = textPlusTool(e7FirstItem)
    if not comp2 or not tool2 then
      record("INFO", "E9", "skipped: no comp/tool on the E7 clip")
      return
    end
    local okSet, errSet = pcall(function()
      comp2:Lock()
      tool2.End = comp2:BezierSpline()
      tool2.End[0] = 0
      tool2.End[24] = 1
      comp2:Unlock()
    end)
    if not okSet then
      pcall(function() comp2:Unlock() end)
    end
    local okRead, val = pcall(function() return tool2:GetInput("End", 12) end)
    record(okSet and "PASS" or "FAIL", "E9", string.format(
      "setOk=%s setErr=%s readback@frame12=%s",
      tostring(okSet), tostring(errSet), okRead and serialize(val, 1) or "<error>"))
  end)

  -- E10: Character Level Styling, read from a hand-styled clip on the original timeline's video track 2.
  test("E10", function()
    if not originalTimeline then
      record("INFO", "E10", "skipped: no original timeline")
      return
    end
    local trackCount = originalTimeline:GetTrackCount("video") or 0
    if trackCount < 2 then
      record("INFO", "E10", "skipped: the original timeline has no video track 2 (see SPIKE2.md Prepare step)")
      return
    end
    local target
    for _, item in pairs(originalTimeline:GetItemListInTrack("video", 2) or {}) do
      local nameOk, name = pcall(function() return item:GetName() end)
      local comp2, tool2 = textPlusTool(item)
      local textOk, text = false, nil
      if tool2 then
        textOk, text = pcall(function() return tool2:GetInput("StyledText") end)
      end
      if (nameOk and tostring(name):find("CLS")) or (textOk and type(text) == "string" and text:find("CLS")) then
        target = item
        break
      end
    end
    if not target then
      record("INFO", "E10", "skipped: no video-track-2 clip with 'CLS' in its name or text (see SPIKE2.md Prepare step)")
      return
    end

    local comp2, tool2 = textPlusTool(target)
    local clsOk, clsVal = false, nil
    if tool2 then
      clsOk, clsVal = pcall(function() return tool2:GetInput("StyledTextCLS") end)
    end
    local dumped = clsOk and serialize(clsVal, 4) or "<error or missing>"

    local modifierParts = {}
    if comp2 then
      for _, t in pairs(comp2:GetToolList(false) or {}) do
        local attrs = t:GetAttrs()
        local regId = attrs and attrs.TOOLS_RegID
        if regId and (tostring(regId):find("CLS") or tostring(regId):find("Styled")) then
          for _, input in pairs(t:GetInputList() or {}) do
            local iattrs = input:GetAttrs()
            local id = iattrs and iattrs.INPS_ID
            local ok, v = pcall(function() return t:GetInput(id) end)
            modifierParts[#modifierParts + 1] = string.format(
              "%s.%s=%s", tostring(regId), tostring(id), ok and serialize(v, 4) or "<error>")
          end
        end
      end
    end

    local styledText = ""
    if tool2 then
      local ok, text = pcall(function() return tool2:GetInput("StyledText") end)
      if ok and type(text) == "string" then
        styledText = text
      end
    end

    record("PASS", "E10", string.format(
      "clip=%s StyledTextCLS=%s modifiers={%s} styledTextByteLen=%d styledTextUtf8CodepointLen=%d " ..
      "note=compare any character offsets in StyledTextCLS/modifiers above against these two lengths to " ..
      "find whether the offsets count UTF-8 bytes, code points, or graphemes (byteLen==codepointLen only for pure ASCII)",
      tostring(target:GetName()), dumped, table.concat(modifierParts, " | "),
      #styledText, utf8Length(styledText)))
  end)

  -- E11: tag one E7 clip; a later "check" run confirms the tag survives a save/close/reopen.
  test("E11", function()
    if not e7FirstItem then
      record("INFO", "E11", "skipped: no E7 clip to tag")
      return
    end
    local comp2 = select(2, pcall(function() return e7FirstItem:GetFusionCompByIndex(1) end))
    if not comp2 then
      record("INFO", "E11", "skipped: no Fusion comp on the E7 clip")
      return
    end
    local setOk, setErr = pcall(function() comp2:SetData("KathaCut.key", "persist-test") end)
    record("INFO", "E11", string.format(
      "tagged clipUid=%s with KathaCut.key=persist-test setOk=%s setErr=%s; " ..
      "now save the project, close it, reopen it, set MODE=\"check\" at the top of this script and run again",
      tostring(e7FirstItem:GetUniqueId()), tostring(setOk), tostring(setErr)))
  end)

  -- Cleanup: leave everything created in place; restore whatever timeline was current before.
  test("CLEANUP", function()
    if originalTimeline then
      local ok = project:SetCurrentTimeline(originalTimeline)
      record("INFO", "CLEANUP", "restored original timeline: " .. tostring(ok))
    else
      record("INFO", "CLEANUP", "no original timeline to restore")
    end
  end)
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
log("Done, report at " .. reportPath)
writeReport()
