--[[
KathaCut Resolve spike script.

Checks every assumption the later Resolve-integration briefs rely on and writes a plain-text report.
Safe by construction: it only creates and modifies its OWN new timeline (named "KathaCut spike <time>").
It never deletes, renames or edits anything that existed before it ran, and it only renders when
RUN_RENDER (below) is set to true.

Run from Resolve: Workspace -> Scripts -> spike. See SPIKE.md for setup.
Lua 5.1 / LuaJIT, single file, no `require`s.
]]

local RUN_RENDER = false -- set true to also exercise T15 (renders a 5 s proxy clip)

-- ---------------------------------------------------------------------------
-- Report plumbing
-- ---------------------------------------------------------------------------

local lines = {}

local function log(line)
  print(line)
  lines[#lines + 1] = line
end

local function record(status, id, detail)
  log(string.format("%s %s %s", status, id, detail or ""))
end

-- Shallow-to-moderate recursive serialisation with a depth limit and a cycle guard.
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

-- Runs one test id, catching any error so one failure never stops the run.
-- The test function itself is responsible for calling record("PASS"/"INFO", id, ...);
-- an uncaught error is recorded here as FAIL.
local function test(id, fn)
  local ok, err = pcall(fn)
  if not ok then
    record("FAIL", id, "uncaught error: " .. tostring(err))
  end
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

local reportPath = joinPath(tempDir, "kathacut-resolve-spike.txt")
local stillPath = joinPath(tempDir, "kathacut-spike-still.png")

-- ---------------------------------------------------------------------------
-- Small helpers used by several tests
-- ---------------------------------------------------------------------------

-- Exact rationals for Resolve's decimal timelineFrameRate strings (docs/plans/resolve-textplus/README.md,
-- "Time mapping"). Falls back to treating the value as an integer rate.
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

local function nominalFrameRate(fpsSetting)
  local num, den = rationalFrameRate(fpsSetting)
  return math.floor(num / den + 0.5)
end

-- Resolve's boolean-ish timeline settings can come back as true/false, "1"/"0", or 1/0.
local function isTruthySetting(v)
  return v == true or v == "1" or v == 1
end

-- Frame -> timecode string, with the standard SMPTE drop-frame skip when dropFrame is set and
-- the nominal rate is 30 or 60 (i.e. an NTSC rate). Good enough to move the playhead for a spike
-- test; large offsets (Resolve's default timeline start is frame 108000 at 29.97 fps) make the
-- non-drop-frame math land outside a short clip if the project actually uses drop-frame.
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

-- Recursively looks for a bin named "KathaCut" containing a Text+ clip.
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

-- ---------------------------------------------------------------------------
-- Entry points
-- ---------------------------------------------------------------------------

local resolve = Resolve()
local pm = resolve:GetProjectManager()
local project = pm:GetCurrentProject()
local mediaPool = project:GetMediaPool()

-- Shared across tests, populated as the script goes.
local previousTimeline, hadPreviousTimeline
local spikeTimeline
local templateClip
local textClipItem
local comp, tool

local function main()
  record("INFO", "ENV", string.format(
    "product=%s version=%s _VERSION=%s jitVersion=%s pathSep=%s tempDir=%s",
    tostring(resolve:GetProductName()), tostring(resolve:GetVersionString()), tostring(_VERSION),
    tostring(jit and jit.version), pathSep, tempDir))

  -- T1: env
  test("T1", function()
    local parts = {
      "bmd=" .. type(bmd),
      "bmd.wait=" .. type(bmd and bmd.wait),
      "bmd.readdir=" .. type(bmd and bmd.readdir),
      "fu=" .. type(fu),
      "fusion=" .. type(fusion),
      "io.open=" .. type(io.open),
      "os.rename=" .. type(os.rename),
      "os.remove=" .. type(os.remove),
      "os.time=" .. type(os.time),
      "os.clock=" .. type(os.clock),
      "os.execute=" .. type(os.execute),
      "io.popen=" .. type(io.popen),
    }
    record("INFO", "T1", table.concat(parts, " "))
  end)

  -- T2: files (write, rename, read back; os.rename over an existing file)
  test("T2", function()
    local base = joinPath(tempDir, "kathacut-spike-t2")
    local pathA = base .. ".tmp"
    local pathB = base .. ".json"
    local content = '{"hello":"world"}'

    local f = assert(io.open(pathA, "w"))
    f:write(content)
    f:close()

    os.remove(pathB)
    local ok1, err1 = os.rename(pathA, pathB)
    record("INFO", "T2a-rename-to-new", string.format("ok=%s err=%s", tostring(ok1), tostring(err1)))

    local rf = io.open(pathB, "r")
    local readBack = rf and rf:read("*a") or nil
    if rf then rf:close() end
    record("INFO", "T2b-readback", string.format("matches=%s", tostring(readBack == content)))

    local f2 = assert(io.open(pathA, "w"))
    f2:write(content .. "2")
    f2:close()
    local ok2, err2 = os.rename(pathA, pathB)
    record("INFO", "T2c-rename-over-existing", string.format("ok=%s err=%s", tostring(ok2), tostring(err2)))

    if not ok2 then
      local f3 = assert(io.open(pathA, "w"))
      f3:write(content .. "3")
      f3:close()
      local okRemove, errRemove = os.remove(pathB)
      local ok3, err3 = os.rename(pathA, pathB)
      record("INFO", "T2d-fallback-remove-then-rename", string.format(
        "removeOk=%s removeErr=%s renameOk=%s renameErr=%s",
        tostring(okRemove), tostring(errRemove), tostring(ok3), tostring(err3)))
    end

    os.remove(pathA)
    os.remove(pathB)
  end)

  -- Setup: capture the previously current timeline before we create and switch to our own.
  previousTimeline = project:GetCurrentTimeline()
  hadPreviousTimeline = previousTimeline ~= nil
  record("INFO", "SETUP", "project already had a current timeline: " .. tostring(hadPreviousTimeline))

  -- T3: timeline info, read only, from the *previously current* timeline.
  test("T3", function()
    if not previousTimeline then
      record("INFO", "T3", "skipped: no previous timeline")
      return
    end
    local name = previousTimeline:GetName()
    local uid = previousTimeline:GetUniqueId()
    local startFrame = previousTimeline:GetStartFrame()
    local endFrame = previousTimeline:GetEndFrame()
    local fps = previousTimeline:GetSetting("timelineFrameRate")
    local dropFrame = previousTimeline:GetSetting("timelineDropFrameTimecode")
    local resW = project:GetSetting("timelineResolutionWidth")
    local resH = project:GetSetting("timelineResolutionHeight")
    record("INFO", "T3", string.format(
      "name=%s(%s) uid=%s(%s) startFrame=%s(%s) endFrame=%s(%s) fps=%s(%s) dropFrame=%s(%s) resW=%s(%s) resH=%s(%s)",
      tostring(name), type(name), tostring(uid), type(uid),
      tostring(startFrame), type(startFrame), tostring(endFrame), type(endFrame),
      tostring(fps), type(fps), tostring(dropFrame), type(dropFrame),
      tostring(resW), type(resW), tostring(resH), type(resH)))
  end)

  -- Setup: create our own empty timeline and make it current. Everything from here on
  -- only ever touches this timeline.
  local timelineName = "KathaCut spike " .. tostring(os.time())
  test("SETUP-CREATE", function()
    spikeTimeline = mediaPool:CreateEmptyTimeline(timelineName)
    if not spikeTimeline then
      error("CreateEmptyTimeline returned nil")
    end
    project:SetCurrentTimeline(spikeTimeline)
    record("PASS", "SETUP-CREATE", "created and switched to " .. timelineName)
  end)

  if not spikeTimeline then
    record("FAIL", "ABORT", "could not create the spike timeline; skipping all clip tests (T4-T15)")
    return
  end

  -- T4: 15 s loop, touching a file each iteration, while the user pokes at Resolve's UI.
  test("T4", function()
    log("For the next 15 s, try scrubbing the timeline and clicking around in Resolve; " ..
      "note whether Resolve stays responsive.")
    local touchPath = joinPath(tempDir, "kathacut-spike-t4-touch.txt")
    local startTime = os.time()
    local iterations = 0
    while os.time() - startTime < 15 do
      local f = io.open(touchPath, "w")
      if f then
        f:write(tostring(iterations))
        f:close()
      end
      iterations = iterations + 1
      if bmd and bmd.wait then
        bmd.wait(0.15)
      else
        local target = os.clock() + 0.15
        while os.clock() < target do end
      end
    end
    local elapsed = os.time() - startTime
    os.remove(touchPath)
    record("INFO", "T4", string.format("iterations=%d elapsedSeconds=%d", iterations, elapsed))
  end)

  -- T5: look for a "KathaCut" bin with a Text+ template clip.
  test("T5", function()
    local root = mediaPool:GetRootFolder()
    local clip, path = findTemplateClip(root)
    if not clip then
      record("INFO", "T5", "no KathaCut bin / Text+ template clip found")
      return
    end
    templateClip = clip
    local props = clip:GetClipProperty()
    local propParts = {}
    if type(props) == "table" then
      for k, v in pairs(props) do
        propParts[#propParts + 1] = string.format("%s=%s", tostring(k), serialize(v, 1))
      end
    end
    record("PASS", "T5", string.format("name=%s path=%s props=%s",
      tostring(clip:GetName()), tostring(path), "{" .. table.concat(propParts, ", ") .. "}"))
  end)

  -- T6: append one clip to track 1 of the spike timeline.
  test("T6", function()
    local startFrame = spikeTimeline:GetStartFrame()
    local recordFrame = startFrame + 24
    local duration = 48

    if templateClip then
      local clipInfo = {
        mediaPoolItem = templateClip,
        startFrame = 0,
        endFrame = duration - 1,
        recordFrame = recordFrame,
        trackIndex = 1,
        mediaType = 1,
      }
      local items = mediaPool:AppendToTimeline({ clipInfo })
      if not items or not items[1] then
        error("AppendToTimeline returned no items")
      end
      textClipItem = items[1]
      record("PASS", "T6", string.format(
        "via AppendToTimeline: start=%s end=%s uid=%s fusionCompCount=%s",
        tostring(textClipItem:GetStart()), tostring(textClipItem:GetEnd()),
        tostring(textClipItem:GetUniqueId()), tostring(textClipItem:GetFusionCompCount())))
    else
      local num, den = rationalFrameRate(spikeTimeline:GetSetting("timelineFrameRate"))
      local dropFrame = isTruthySetting(spikeTimeline:GetSetting("timelineDropFrameTimecode"))
      local tc = framesToTimecode(recordFrame, num, den, dropFrame)
      spikeTimeline:SetCurrentTimecode(tc)
      local item = spikeTimeline:InsertFusionTitleIntoTimeline("Text+")
      if not item then
        error("InsertFusionTitleIntoTimeline returned nil")
      end
      textClipItem = item
      record("PASS", "T6", string.format(
        "via InsertFusionTitleIntoTimeline fallback (playhead tc=%s): start=%s end=%s uid=%s fusionCompCount=%s",
        tc, tostring(item:GetStart()), tostring(item:GetEnd()),
        tostring(item:GetUniqueId()), tostring(item:GetFusionCompCount())))
    end
  end)

  -- T7: dump every TextPlus input. Ground truth for input IDs used by later briefs.
  test("T7", function()
    if not textClipItem then
      record("INFO", "T7", "skipped: no clip from T6")
      return
    end
    comp = textClipItem:GetFusionCompByIndex(1)
    if not comp then
      error("GetFusionCompByIndex(1) returned nil")
    end
    tool = comp:FindToolByID("TextPlus")
    if not tool then
      local toolList = comp:GetToolList(false) or {}
      local regIds = {}
      for _, t in pairs(toolList) do
        local attrs = t:GetAttrs()
        regIds[#regIds + 1] = tostring(attrs and attrs.TOOLS_RegID)
      end
      record("INFO", "T7", "FindToolByID('TextPlus') returned nil; tools present: " ..
        table.concat(regIds, ", "))
      return
    end
    local inputList = tool:GetInputList() or {}
    local parts = {}
    for _, input in pairs(inputList) do
      local attrs = input:GetAttrs()
      local id = attrs and attrs.INPS_ID
      local name = attrs and attrs.INPS_Name
      local dataType = attrs and attrs.INPS_DataType
      local value = "<no id>"
      if id then
        local ok, v = pcall(function() return tool:GetInput(id) end)
        value = ok and serialize(v, 1) or "<error reading>"
      end
      parts[#parts + 1] = string.format("id=%s name=%s type=%s value=%s",
        tostring(id), tostring(name), tostring(dataType), value)
    end
    record("PASS", "T7", string.format("%d inputs: %s", #parts, table.concat(parts, " | ")))
  end)

  -- T8: comp-relative time attributes.
  test("T8", function()
    if not comp then
      record("INFO", "T8", "skipped: no comp from T7")
      return
    end
    local attrs = comp:GetAttrs()
    record("INFO", "T8", string.format(
      "GlobalStart=%s GlobalEnd=%s RenderStart=%s RenderEnd=%s CurrentTime=%s",
      tostring(attrs.COMPN_GlobalStart), tostring(attrs.COMPN_GlobalEnd),
      tostring(attrs.COMPN_RenderStart), tostring(attrs.COMPN_RenderEnd),
      tostring(attrs.COMPN_CurrentTime)))
  end)

  -- T9: style a mixed Malayalam/English string.
  test("T9", function()
    if not tool then
      record("INFO", "T9", "skipped: no tool from T7")
      return
    end
    local setResults = {}
    local function setAndRecord(id, value)
      local ok, ret = pcall(function() return tool:SetInput(id, value) end)
      setResults[#setResults + 1] = string.format("%s<-%s ok=%s ret=%s",
        id, serialize(value, 1), tostring(ok), serialize(ret, 1))
    end

    local fontRequested = "Anek Malayalam"
    setAndRecord("StyledText", "മലയാളം ക്യാപ്ഷൻ Caption ശ്രീ")
    setAndRecord("Font", fontRequested)
    setAndRecord("Style", "Bold")
    setAndRecord("Size", 0.08)
    setAndRecord("Red1", 1)
    setAndRecord("Green1", 0.84)
    setAndRecord("Blue1", 0)
    setAndRecord("Enabled2", 1)
    setAndRecord("Red2", 0)
    setAndRecord("Green2", 0)
    setAndRecord("Blue2", 0)
    setAndRecord("Center", { 0.5, 0.2 })

    local readIds = {
      "StyledText", "Font", "Style", "Size",
      "Red1", "Green1", "Blue1", "Enabled2", "Red2", "Green2", "Blue2", "Center",
    }
    local readBacks = {}
    for _, id in ipairs(readIds) do
      local ok, v = pcall(function() return tool:GetInput(id) end)
      readBacks[#readBacks + 1] = string.format("%s=%s", id, ok and serialize(v, 1) or "<error>")
    end

    record("INFO", "T9-set", table.concat(setResults, " | "))
    record("INFO", "T9-readback", string.format("fontRequested=%q %s",
      fontRequested, table.concat(readBacks, " | ")))
    record("INFO", "T9-note",
      "Font substitution (if Anek Malayalam is missing) cannot be detected via the Lua API; " ..
      "check the still/screenshot per SPIKE.md step 6.")
  end)

  -- T10: End (write-on) keyframes inside Lock/Unlock. Tries two documented approaches and records
  -- which one Resolve actually accepts. Uses the ADR 0008-confirmed input id `End` (labelled
  -- "Write On End" in the Inspector), not `WriteOnEnd` — the earlier guess errored on that id
  -- ("attempt to index field 'WriteOnEnd' (a nil value)"); T7's full input dump has no such field.
  test("T10", function()
    if not comp or not tool then
      record("INFO", "T10", "skipped: no comp/tool from T7")
      return
    end

    -- Attempt A: direct table assignment (time -> value in one step).
    local okA, errA = pcall(function()
      comp:Lock()
      tool.End = { [0] = 0, [24] = 1 }
      comp:Unlock()
    end)
    if not okA then
      pcall(function() comp:Unlock() end)
    end
    local readOkA, readValA = pcall(function() return tool:GetInput("End", 12) end)
    record("INFO", "T10-A-table-assign", string.format("ok=%s err=%s readback@12=%s",
      tostring(okA), tostring(errA), readOkA and serialize(readValA, 1) or "<error>"))

    -- Attempt B: explicit BezierSpline(), then index-assign keyframes (the README's guess).
    local okB, errB = pcall(function()
      comp:Lock()
      local spline = comp:BezierSpline()
      tool.End = spline
      tool.End[0] = 0
      tool.End[24] = 1
      comp:Unlock()
    end)
    if not okB then
      pcall(function() comp:Unlock() end)
    end
    local readOkB, readValB = pcall(function() return tool:GetInput("End", 12) end)
    record("INFO", "T10-B-bezierspline", string.format("ok=%s err=%s readback@12=%s",
      tostring(okB), tostring(errB), readOkB and serialize(readValB, 1) or "<error>"))

    if okA or okB then
      record("PASS", "T10", string.format("at least one approach worked: A(table-assign)=%s B(BezierSpline)=%s",
        tostring(okA), tostring(okB)))
    else
      record("FAIL", "T10", "both keyframe approaches failed")
    end
  end)

  -- T11: read Character Level Styling data from a second, hand-styled clip on track 2.
  test("T11", function()
    local trackCount = spikeTimeline:GetTrackCount("video")
    if trackCount < 2 then
      record("INFO", "T11", "skipped: no video track 2 (see SPIKE.md step 4)")
      return
    end
    local items = spikeTimeline:GetItemListInTrack("video", 2)
    if not items or not items[1] then
      record("INFO", "T11", "skipped: no clip on video track 2")
      return
    end
    local item2 = items[1]
    local comp2 = item2:GetFusionCompByIndex(1)
    if not comp2 then
      record("INFO", "T11", "skipped: track 2 clip has no Fusion comp")
      return
    end
    local toolList = comp2:GetToolList(false) or {}
    local parts = {}
    for _, t in pairs(toolList) do
      local attrs = t:GetAttrs()
      local regId = attrs and attrs.TOOLS_RegID
      parts[#parts + 1] = "tool:" .. tostring(regId)
      if regId and (tostring(regId):find("CLS") or tostring(regId):find("Styled")) then
        local inputList = t:GetInputList() or {}
        for _, input in pairs(inputList) do
          local iattrs = input:GetAttrs()
          local id = iattrs and iattrs.INPS_ID
          local ok, v = pcall(function() return t:GetInput(id) end)
          parts[#parts + 1] = string.format("  %s.%s=%s", tostring(regId), tostring(id),
            ok and serialize(v, 6) or "<error>")
        end
      end
    end
    record("PASS", "T11", table.concat(parts, " | "))
  end)

  -- T12: tagging via comp data, clip color and name.
  test("T12", function()
    if not comp or not textClipItem then
      record("INFO", "T12", "skipped: no clip/comp from T6/T7")
      return
    end
    local setOk, setErr = pcall(function() comp:SetData("KathaCut.cueId", "cue-123") end)
    local getOk, getVal = pcall(function() return comp:GetData("KathaCut.cueId") end)
    local colorSetOk, colorSetErr = pcall(function() return textClipItem:SetClipColor("Teal") end)
    local colorGetOk, colorGetVal = pcall(function() return textClipItem:GetClipColor() end)
    local nameOk, nameVal = pcall(function() return textClipItem:GetName() end)
    record("INFO", "T12", string.format(
      "SetData ok=%s err=%s | GetData ok=%s val=%s | SetClipColor ok=%s ret=%s | GetClipColor ok=%s val=%s | GetName ok=%s val=%s",
      tostring(setOk), tostring(setErr), tostring(getOk), serialize(getVal, 1),
      tostring(colorSetOk), serialize(colorSetErr, 1), tostring(colorGetOk), serialize(colorGetVal, 1),
      tostring(nameOk), serialize(nameVal, 1)))
  end)

  -- T13: bulk append + bulk style, timed.
  test("T13", function()
    if not templateClip then
      record("INFO", "T13", "skipped: no template clip from T5 (bulk append needs a media pool item)")
      return
    end
    if not textClipItem then
      record("INFO", "T13", "skipped: no clip from T6 to measure from")
      return
    end
    local duration = 24
    local cursor = textClipItem:GetEnd() + 2
    local clipInfos = {}
    for i = 1, 100 do
      clipInfos[#clipInfos + 1] = {
        mediaPoolItem = templateClip,
        startFrame = 0,
        endFrame = duration - 1,
        recordFrame = cursor,
        trackIndex = 1,
        mediaType = 1,
      }
      cursor = cursor + duration + 2
    end

    local t0 = os.clock()
    local items = mediaPool:AppendToTimeline(clipInfos)
    local appendElapsed = os.clock() - t0
    if not items then
      error("bulk AppendToTimeline returned nil")
    end

    local t1 = os.clock()
    local styledCount = 0
    for i, item in ipairs(items) do
      local ok1, comp2 = pcall(function() return item:GetFusionCompByIndex(1) end)
      if ok1 and comp2 then
        local ok2, tool2 = pcall(function() return comp2:FindToolByID("TextPlus") end)
        if ok2 and tool2 then
          local ok3 = pcall(function() return tool2:SetInput("StyledText", "Bulk " .. tostring(i)) end)
          if ok3 then
            styledCount = styledCount + 1
          end
        end
      end
    end
    local styleElapsed = os.clock() - t1

    record("PASS", "T13", string.format(
      "appended=%d in %.3fs; styled=%d in %.3fs", #items, appendElapsed, styledCount, styleElapsed))
  end)

  -- T14: export a still of the T9 clip.
  test("T14", function()
    if not textClipItem then
      record("INFO", "T14", "skipped: no clip from T6")
      return
    end
    log("Resolve must be on the Edit or Color page for ExportCurrentFrameAsStill to work.")
    local num, den = rationalFrameRate(spikeTimeline:GetSetting("timelineFrameRate"))
    local dropFrame = isTruthySetting(spikeTimeline:GetSetting("timelineDropFrameTimecode"))
    local tc = framesToTimecode(textClipItem:GetStart(), num, den, dropFrame)
    spikeTimeline:SetCurrentTimecode(tc)
    local ok, result = pcall(function() return project:ExportCurrentFrameAsStill(stillPath) end)
    record("INFO", "T14", string.format("fps=%s/%s dropFrame=%s timecode=%s exportOk=%s result=%s",
      tostring(num), tostring(den), tostring(dropFrame), tc, tostring(ok), serialize(result, 1)))
  end)

  -- T15: render a 5 s proxy, only when RUN_RENDER is true.
  test("T15", function()
    if not RUN_RENDER then
      record("INFO", "T15", "skipped: RUN_RENDER is false")
      return
    end
    local fps = nominalFrameRate(spikeTimeline:GetSetting("timelineFrameRate"))
    local resW = tonumber(project:GetSetting("timelineResolutionWidth")) or 1920
    local resH = tonumber(project:GetSetting("timelineResolutionHeight")) or 1080
    local vertical = resH > resW
    local outW, outH
    if vertical then
      outW, outH = 720, 1280
    else
      outW, outH = 1280, 720
    end

    local startFrame = spikeTimeline:GetStartFrame()
    local markIn = startFrame
    local markOut = startFrame + (fps * 5) - 1

    local modeOk = project:SetCurrentRenderMode(1)
    local formatOk = project:SetCurrentRenderFormatAndCodec("mp4", "H264")
    local formats = project:GetRenderFormats()
    local codecs = project:GetRenderCodecs("mp4")

    local settingsOk = project:SetRenderSettings({
      SelectAllFrames = false,
      MarkIn = markIn,
      MarkOut = markOut,
      TargetDir = tempDir,
      CustomName = "kathacut-spike-proxy",
      ExportVideo = true,
      ExportAudio = true,
      FormatWidth = outW,
      FormatHeight = outH,
    })

    local jobId = project:AddRenderJob()
    if not jobId then
      error("AddRenderJob returned nil")
    end
    local startedOk = project:StartRendering(jobId)

    local t0 = os.time()
    local status
    repeat
      if bmd and bmd.wait then
        bmd.wait(0.5)
      end
      status = project:GetRenderJobStatus(jobId)
    until (not project:IsRenderingInProgress()) or (os.time() - t0 > 120)
    local elapsed = os.time() - t0

    project:DeleteRenderJob(jobId)

    record("PASS", "T15", string.format(
      "modeOk=%s formatOk=%s settingsOk=%s startedOk=%s status=%s elapsedSeconds=%d outputDir=%s formats=%s codecs=%s",
      tostring(modeOk), tostring(formatOk), tostring(settingsOk), tostring(startedOk),
      serialize(status, 2), elapsed, tempDir, serialize(formats, 1), serialize(codecs, 1)))
  end)

  -- Cleanup: leave the spike timeline in place; restore whatever was current before.
  test("CLEANUP", function()
    if hadPreviousTimeline then
      local ok = project:SetCurrentTimeline(previousTimeline)
      record("INFO", "CLEANUP", "restored previous timeline: " .. tostring(ok))
    else
      record("INFO", "CLEANUP", "no previous timeline to restore")
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
