--[[
KathaCut Resolve bridge.

Started by the generated launcher (Workspace -> Scripts -> KathaCut), which passes a `KATHACUT` table
(and `Resolve`, `bmd`) as arguments: `{ resourcesDir, mailboxDir, launch = { kind, exe, args } }` (see electron/resolve/install.ts).
Polls a small JSON-file mailbox (docs/plans/resolve-textplus/README.md) for commands from the
KathaCut app and answers them. All caption logic lives in KathaCut's TypeScript; this file only
executes a fixed whitelist of command handlers below and never `load`s or `loadstring`s request
content.

Written for KathaCut, GPL-3.0-or-later.
]]

BRIDGE_VERSION = 1

-- The launcher passes its config and Resolve's scripting globals as arguments: Resolve runs each menu
-- script in its own environment, and globals set there are not visible to a file loaded from it.
local launchArgs = { ... }
local KATHACUT = launchArgs[1] or KATHACUT
local Resolve = launchArgs[2] or Resolve
local bmd = launchArgs[3] or bmd
if type(KATHACUT) ~= "table" then error("KathaCut bridge: started without its launcher config. Reinstall the plugin from KathaCut Settings.") end

local resourcesDir = KATHACUT.resourcesDir
local mailboxDir = KATHACUT.mailboxDir
local launch = KATHACUT.launch

local json = dofile(resourcesDir .. "/json.lua")

local POLL_INTERVAL = 0.15
local APP_STALE_SECONDS = 60
local LAUNCH_WAIT_SECONDS = 60
local STATUS_WRITE_INTERVAL = 1

local pathSep = package.config:sub(1, 1)
local function joinPath(dir, name)
  if dir:sub(-1) == pathSep then return dir .. name end
  return dir .. pathSep .. name
end

local requestPath = joinPath(mailboxDir, "request.json")
local responsePath = joinPath(mailboxDir, "response.json")
local statusPath = joinPath(mailboxDir, "status.json")
local appPath = joinPath(mailboxDir, "app.json")

-- Writes `<name>.tmp` then renames it over the target. `os.rename` over an existing file fails on
-- Windows (confirmed by the spike, ADR 0008), so the target is removed first, unconditionally.
local function writeJson(targetPath, value)
  local tmpPath = targetPath .. ".tmp"
  local f = io.open(tmpPath, "w")
  if not f then return false end
  f:write(json.encode(value))
  f:close()
  os.remove(targetPath)
  return os.rename(tmpPath, targetPath) and true or false
end

-- Returns nil if the file is missing or can't be parsed (a torn read of a file mid-(remove+rename)
-- on the other side of the mailbox); the next poll picks up the next good write.
local function readJson(targetPath)
  local f = io.open(targetPath, "r")
  if not f then return nil end
  local content = f:read("*a")
  f:close()
  if not content or content == "" then return nil end
  local ok, value = pcall(json.decode, content)
  if not ok then return nil end
  return value
end

math.randomseed(os.time())
local sessionId = tostring(os.time()) .. "-" .. tostring(math.random(1000000000))

local resolve = Resolve()

local function currentProject()
  local ok, pm = pcall(function() return resolve:GetProjectManager() end)
  if not ok or not pm then return nil end
  local ok2, project = pcall(function() return pm:GetCurrentProject() end)
  if not ok2 then return nil end
  return project
end

local function currentProjectName()
  local project = currentProject()
  if not project then return nil end
  local ok, name = pcall(function() return project:GetName() end)
  return ok and name or nil
end

local function currentTimelineName()
  local project = currentProject()
  if not project then return nil end
  local ok, timeline = pcall(function() return project:GetCurrentTimeline() end)
  if not ok or not timeline then return nil end
  local ok2, name = pcall(function() return timeline:GetName() end)
  return ok2 and name or nil
end

local busy = false

local function writeStatus(closed)
  local status = {
    v = 1,
    sessionId = sessionId,
    heartbeatAt = os.time(),
    product = tostring(resolve:GetProductName()),
    version = tostring(resolve:GetVersionString()),
    projectName = currentProjectName() or json.null,
    timelineName = currentTimelineName() or json.null,
    busy = busy,
  }
  if closed then status.closed = true end
  writeJson(statusPath, status)
end

-- ---------------------------------------------------------------------------
-- Command handlers: a fixed whitelist. Each returns a plain result table, or `error(...)` on
-- failure (caught by pcall in the dispatch loop below and turned into `{ ok = false, error }`).
-- ---------------------------------------------------------------------------

local shouldExit = false
local handlers = {}

handlers["ping"] = function()
  return { pong = true, version = BRIDGE_VERSION }
end

-- A timeline with custom settings has its own resolution; the project setting is only the default (ADR 0009).
local function timelineResolution(project, timeline)
  local function read(key)
    local ok, value = pcall(function() return timeline:GetSetting(key) end)
    if ok and tonumber(value) and tonumber(value) > 0 then return tostring(value) end
    return project:GetSetting(key)
  end
  return read("timelineResolutionWidth"), read("timelineResolutionHeight")
end

local function timelineInfoOf(project, timeline)
  local width, height = timelineResolution(project, timeline)
  return {
    projectName = project:GetName(),
    timelineName = timeline:GetName(),
    timelineId = timeline:GetUniqueId(),
    startFrame = timeline:GetStartFrame(),
    endFrame = timeline:GetEndFrame(),
    -- Always a string: GetSetting has returned a Lua number for this key on Windows Studio 21.0
    -- (ADR 0008), but callers need a stable JSON type regardless.
    frameRate = tostring(timeline:GetSetting("timelineFrameRate")),
    dropFrame = timeline:GetSetting("timelineDropFrameTimecode"),
    width = width,
    height = height,
  }
end

handlers["timelineInfo"] = function()
  local project = currentProject()
  local timeline = project and project:GetCurrentTimeline()
  if not timeline then error("No timeline is open in Resolve") end
  return timelineInfoOf(project, timeline)
end

handlers["disconnect"] = function()
  shouldExit = true
  return {}
end

-- ---------------------------------------------------------------------------
-- Timeline proxy render (04): renders the current timeline to a small H.264 proxy in KathaCut's
-- cache. Resolve's own Deliver-page render format/codec is remembered per job and restored once the
-- job leaves the queue (finished, failed or cancelled), so KathaCut never leaves that changed behind.
-- ---------------------------------------------------------------------------

local pendingRenderFormats = {}

local function restoreRenderFormat(jobId, project)
  local remembered = pendingRenderFormats[jobId]
  if not remembered then return end
  pendingRenderFormats[jobId] = nil
  if project and remembered.format and remembered.codec then
    project:SetCurrentRenderFormatAndCodec(remembered.format, remembered.codec)
  end
end

handlers["renderProxyStart"] = function(params)
  local project = currentProject()
  if not project then error("No Resolve project is open") end
  if project:IsRenderingInProgress() then error("A render is already in progress in Resolve") end
  local timeline = project:GetCurrentTimeline()
  if not timeline then error("No timeline is open in Resolve") end

  local prevFormat, prevCodec = project:GetCurrentRenderFormatAndCodec()

  -- Resolution comes back as a string on Windows Studio 21.0 (ADR 0008); coerce defensively.
  local rawWidth, rawHeight = timelineResolution(project, timeline)
  local timelineWidth = tonumber(rawWidth)
  local timelineHeight = tonumber(rawHeight)
  if not timelineWidth or not timelineHeight or timelineWidth <= 0 or timelineHeight <= 0 then
    error("Could not read the timeline's resolution")
  end
  local longSide = math.max(timelineWidth, timelineHeight)
  local scale = math.min(1, params.maxLongSide / longSide)
  local width = math.max(2, math.floor((timelineWidth * scale) / 2) * 2)
  local height = math.max(2, math.floor((timelineHeight * scale) / 2) * 2)

  project:SetCurrentRenderMode(1)
  project:SetCurrentRenderFormatAndCodec("mp4", "H264")
  project:SetRenderSettings({
    SelectAllFrames = true,
    TargetDir = params.targetDir,
    CustomName = params.name,
    ExportVideo = true,
    ExportAudio = true,
    FormatWidth = width,
    FormatHeight = height,
  })

  local jobId = project:AddRenderJob()
  if not jobId then error("Resolve refused to queue the render job") end
  pendingRenderFormats[jobId] = { format = prevFormat, codec = prevCodec }
  project:StartRendering(jobId)

  return { jobId = jobId, width = width, height = height }
end

handlers["renderStatus"] = function(params)
  local project = currentProject()
  if not project then error("No Resolve project is open") end
  local status = project:GetRenderJobStatus(params.jobId)
  if not status then error("Unknown render job") end
  local jobStatus = tostring(status.JobStatus or "Unknown")
  if jobStatus == "Complete" or jobStatus == "Failed" or jobStatus == "Cancelled" then
    project:DeleteRenderJob(params.jobId)
    restoreRenderFormat(params.jobId, project)
  end
  return {
    status = jobStatus,
    percent = status.CompletionPercentage or 0,
    error = status.Error or json.null,
  }
end

handlers["renderCancel"] = function(params)
  local project = currentProject()
  if project then
    project:StopRendering()
    project:DeleteRenderJob(params.jobId)
  end
  restoreRenderFormat(params.jobId, project)
  return {}
end

-- ---------------------------------------------------------------------------
-- Sync to Resolve (06): Text+ clips on KathaCut's own video track. Batching and the diff live in
-- KathaCut's TypeScript; each handler here does one short step. Every handler checks that Resolve
-- still has the linked timeline open, and only ever touches items on the track index it was given.
-- ---------------------------------------------------------------------------

-- The only Text+ inputs KathaCut ever writes. Copied from LUA_INPUT_WHITELIST in
-- src/resolve/textPlusInputs.ts; keep the two lists identical.
local INPUT_WHITELIST = {
  StyledText = true, Font = true, Style = true, Size = true,
  Enabled1 = true, Red1 = true, Green1 = true, Blue1 = true, Alpha1 = true,
  Enabled2 = true, Red2 = true, Green2 = true, Blue2 = true, Thickness2 = true,
  Enabled3 = true,
  Enabled4 = true,
  Center = true,
  LineSpacing = true,
  CharacterSpacing = true,
  HorizontalJustificationNew = true,
  -- Write-on (07): the real IDs are `Start`/`End`, not `WriteOnStart`/`WriteOnEnd` (ADR 0008 deviation).
  Start = true, End = true,
}

local TEMPLATE_FOLDER = "KathaCut"
local KEY_TAG = "KathaCut.key"

local function isString(value) return type(value) == "string" end

local function requireTimeline(params)
  local project = currentProject()
  if not project then error("No Resolve project is open") end
  local timeline = project:GetCurrentTimeline()
  if not timeline then error("No timeline is open in Resolve") end
  if type(params) ~= "table" or timeline:GetUniqueId() ~= params.timelineId then
    error("Resolve has a different timeline open")
  end
  return project, timeline
end

local function findFolderNamed(folder, name, depth)
  if depth > 4 then return nil end
  local subs = folder:GetSubFolderList() or {}
  -- ipairs: Resolve's list tables can carry a non-object numeric entry that pairs would visit.
  for _, sub in ipairs(subs) do
    if sub:GetName() == name then return sub end
  end
  for _, sub in ipairs(subs) do
    local found = findFolderNamed(sub, name, depth + 1)
    if found then return found end
  end
  return nil
end

local function findTemplate(mediaPool, clipName)
  local folder = findFolderNamed(mediaPool:GetRootFolder(), TEMPLATE_FOLDER, 0)
  if not folder then return nil end
  for _, clip in ipairs(folder:GetClipList() or {}) do
    if clip:GetName() == clipName then return clip end
  end
  return nil
end

local function findTrackIndex(timeline, name)
  local count = timeline:GetTrackCount("video") or 0
  for index = 1, count do
    if timeline:GetTrackName("video", index) == name then return index end
  end
  return nil
end

local function itemsOnTrack(timeline, trackIndex)
  if type(trackIndex) ~= "number" or trackIndex < 1 or trackIndex > (timeline:GetTrackCount("video") or 0) then
    error("The KathaCut track is gone")
  end
  return timeline:GetItemListInTrack("video", trackIndex) or {}
end

local function textPlusTool(item)
  local comp = item:GetFusionCompByIndex(1)
  if not comp then return nil, nil end
  local tool = comp:FindToolByID("TextPlus")
  if not tool then
    for _, candidate in pairs(comp:GetToolList(false, "TextPlus") or {}) do tool = candidate; break end
  end
  return comp, tool
end

-- Attaches a BezierSpline with plain `[frame] = value` control points to a whitelisted input, replacing whatever
-- that input held before (a plain value, or an earlier spline from a previous sync). Keyframing is confirmed
-- working on the `End` input (ADR 0009, E9: `tool.End = comp:BezierSpline()`, then `tool.End[frame] = value`
-- inside `Lock`/`Unlock`, read back correctly); attaching the same mechanism to other whitelisted inputs (e.g.
-- `Alpha1` for phrase-fade) relies on Fusion's animation attachment being generic, not input-specific — a
-- reasonable assumption, not itself a repeated spike result.
local function applyKeyframe(comp, tool, entry)
  if type(entry) ~= "table" or not INPUT_WHITELIST[entry.input] or type(entry.points) ~= "table" then return end
  local spline = comp:BezierSpline()
  tool[entry.input] = spline
  for _, point in ipairs(entry.points) do
    local frame, value = point[1], point[2]
    if type(frame) == "number" and type(value) == "number" then tool[entry.input][frame] = value end
  end
end

-- Writes one spec onto a Text+ clip: whitelisted inputs only, values used as plain data.
local function applySpec(item, spec)
  local comp, tool = textPlusTool(item)
  if not comp or not tool then error("The clip has no Text+ tool") end
  comp:Lock()
  local ok, err = pcall(function()
    if type(spec.inputs) == "table" then
      for id, value in pairs(spec.inputs) do
        if INPUT_WHITELIST[id] then
          if type(value) == "table" then
            if type(value.x) == "number" and type(value.y) == "number" then tool:SetInput(id, { value.x, value.y }) end
          elseif type(value) == "number" or type(value) == "string" then
            tool:SetInput(id, value)
          end
        end
      end
    end
    if isString(spec.text) then tool:SetInput("StyledText", spec.text) end
    -- Plain inputs above (including the planner's Start=0/End=1 baseline) reset any input this spec no longer
    -- animates; keyframes below then override the ones it does, so a clip re-synced from an earlier motion never
    -- keeps a stale animation. Character Level Styling ranges aren't applied: the data format is unconfirmed by
    -- the spike (ADR 0008/0009, "no data") and the planner never sends any (`spec.styleRanges` is always empty).
    if type(spec.keyframes) == "table" then
      for _, entry in ipairs(spec.keyframes) do applyKeyframe(comp, tool, entry) end
    end
    comp:SetData(KEY_TAG, spec.key)
  end)
  comp:Unlock()
  if not ok then error(err) end
end

handlers["ensureTemplate"] = function(params)
  local project = requireTimeline(params)
  local mediaPool = project:GetMediaPool()
  if findTemplate(mediaPool, params.clipName) then return { imported = false } end
  local previous = mediaPool:GetCurrentFolder()
  mediaPool:SetCurrentFolder(mediaPool:GetRootFolder())
  local ok = mediaPool:ImportFolderFromFile(params.drbPath)
  if previous then mediaPool:SetCurrentFolder(previous) end
  if not ok or not findTemplate(mediaPool, params.clipName) then
    error("Could not import the KathaCut Text+ template into the Media Pool")
  end
  return { imported = true }
end

handlers["findTrack"] = function(params)
  local _, timeline = requireTimeline(params)
  return { trackIndex = findTrackIndex(timeline, params.name) or json.null }
end

handlers["ensureTrack"] = function(params)
  local _, timeline = requireTimeline(params)
  local index = findTrackIndex(timeline, params.name)
  if index then return { trackIndex = index } end
  if not timeline:AddTrack("video") then error("Resolve refused to add a video track") end
  index = timeline:GetTrackCount("video")
  timeline:SetTrackName("video", index, params.name)
  return { trackIndex = index }
end

handlers["readClips"] = function(params)
  local _, timeline = requireTimeline(params)
  local clips = json.array({})
  for _, item in pairs(itemsOnTrack(timeline, params.trackIndex)) do
    local ok, entry = pcall(function()
      local entry = { clipId = item:GetUniqueId(), startFrame = item:GetStart(), endFrame = item:GetEnd(), key = json.null, text = json.null }
      local okTool, comp, tool = pcall(textPlusTool, item)
      if okTool and comp then
        local key = comp:GetData(KEY_TAG)
        if isString(key) then
          entry.key = key
          if tool then
            local text = tool:GetInput("StyledText")
            if isString(text) then entry.text = text end
          end
        end
      end
      return entry
    end)
    if ok and entry and isString(entry.clipId) then table.insert(clips, entry) end
  end
  return { clips = clips }
end

handlers["insertClips"] = function(params)
  local project, timeline = requireTimeline(params)
  itemsOnTrack(timeline, params.trackIndex)
  local mediaPool = project:GetMediaPool()
  local template = findTemplate(mediaPool, params.templateName)
  if not template then error("The KathaCut Text+ template is missing from the Media Pool") end
  local infos = {}
  for index, spec in ipairs(params.clips) do
    infos[index] = {
      mediaPoolItem = template, mediaType = 1, trackIndex = params.trackIndex,
      recordFrame = spec.startFrame, startFrame = 0, endFrame = spec.endFrame - spec.startFrame - 1,
    }
  end
  local placed = mediaPool:AppendToTimeline(infos)
  if not placed then error("Resolve refused to place the Text+ clips") end
  local results = json.array({})
  for index, spec in ipairs(params.clips) do
    local item = placed[index]
    if not item then
      table.insert(results, { key = spec.key, clipId = json.null, startFrame = json.null, endFrame = json.null, error = "Resolve did not place this clip" })
    else
      local ok, err = pcall(applySpec, item, spec)
      if ok then
        table.insert(results, { key = spec.key, clipId = item:GetUniqueId(), startFrame = item:GetStart(), endFrame = item:GetEnd(), error = json.null })
      else
        -- Don't leave an untagged clip behind that KathaCut could never manage again.
        pcall(function() timeline:DeleteClips({ item }, false) end)
        table.insert(results, { key = spec.key, clipId = json.null, startFrame = json.null, endFrame = json.null, error = tostring(err) })
      end
    end
  end
  return { clips = results }
end

handlers["updateClips"] = function(params)
  local _, timeline = requireTimeline(params)
  local byId = {}
  for _, item in pairs(itemsOnTrack(timeline, params.trackIndex)) do byId[item:GetUniqueId()] = item end
  local results = json.array({})
  for _, entry in ipairs(params.clips) do
    local item = byId[entry.clipId]
    if not item then
      table.insert(results, { clipId = entry.clipId, error = "The clip is no longer on the KathaCut track" })
    else
      local ok, err = pcall(applySpec, item, entry.spec)
      table.insert(results, { clipId = entry.clipId, error = ok and json.null or tostring(err) })
    end
  end
  return { clips = results }
end

handlers["deleteClips"] = function(params)
  local _, timeline = requireTimeline(params)
  local wanted = {}
  local requested = 0
  for _, clipId in ipairs(params.clipIds) do wanted[clipId] = true; requested = requested + 1 end
  local items = {}
  for _, item in pairs(itemsOnTrack(timeline, params.trackIndex)) do
    if wanted[item:GetUniqueId()] then table.insert(items, item) end
  end
  if #items > 0 and not timeline:DeleteClips(items, false) then error("Resolve refused to delete the clips") end
  return { deleted = #items, missing = requested - #items }
end

-- ---------------------------------------------------------------------------
-- Import the timeline edit (11): the video tracks' items, mapped back to their original files. Only
-- reads; the classification rules are ADR 0009's. The retime check needs fps math, so it's done in
-- KathaCut's TypeScript (src/resolve/editToProject.ts) from the raw frames returned here.
-- ---------------------------------------------------------------------------

local MAX_EDIT_ITEMS = 5000

local function callOn(object, method)
  local ok, value = pcall(function() return object[method](object) end)
  if ok then return value end
  return nil
end

local function numberOrNull(value)
  if type(value) == "number" then return value end
  return json.null
end

local function clipProperty(mediaPoolItem, key)
  local ok, value = pcall(function() return mediaPoolItem:GetClipProperty(key) end)
  if ok and value ~= nil and tostring(value) ~= "" then return tostring(value) end
  return nil
end

local function classifyEditItem(mediaPoolItem, clipType, filePath, fusionCount)
  if not mediaPoolItem then
    if fusionCount >= 1 then return "title" end
    return "generator"
  end
  local t = clipType or ""
  if t:find("Compound") or t == "Timeline" then return "compound" end
  if t:find("Multicam") then return "multicam" end
  if t:find("Title") then return "title" end
  if t:find("Generator") then return "generator" end
  if t:find("Fusion") then return "fusion" end
  if not filePath then return "unknown" end
  if fusionCount >= 1 then return "fusion" end
  return "file"
end

local function describeEditItem(item, trackIndex)
  local mediaPoolItem = callOn(item, "GetMediaPoolItem")
  local clipType, filePath, fileFps = nil, nil, nil
  if mediaPoolItem then
    clipType = clipProperty(mediaPoolItem, "Type")
    filePath = clipProperty(mediaPoolItem, "File Path")
    fileFps = clipProperty(mediaPoolItem, "FPS")
  end
  local fusionCount = callOn(item, "GetFusionCompCount")
  if type(fusionCount) ~= "number" then fusionCount = 0 end
  local name = callOn(item, "GetName")
  return {
    trackIndex = trackIndex,
    recordStart = numberOrNull(callOn(item, "GetStart")),
    recordEnd = numberOrNull(callOn(item, "GetEnd")),
    sourceStart = numberOrNull(callOn(item, "GetSourceStartFrame")),
    sourceEnd = numberOrNull(callOn(item, "GetSourceEndFrame")),
    filePath = filePath or json.null,
    fileFps = fileFps or json.null,
    clipType = clipType or json.null,
    name = isString(name) and name or json.null,
    kind = classifyEditItem(mediaPoolItem, clipType, filePath, fusionCount),
  }
end

handlers["readTimelineEdit"] = function(params)
  local project, timeline = requireTimeline(params)
  local items = json.array({})
  local count = 0
  local truncated = false
  local videoTracks = timeline:GetTrackCount("video") or 0
  for trackIndex = 1, videoTracks do
    for _, item in ipairs(timeline:GetItemListInTrack("video", trackIndex) or {}) do
      if count >= MAX_EDIT_ITEMS then truncated = true; break end
      count = count + 1
      local ok, entry = pcall(describeEditItem, item, trackIndex)
      if not ok then
        local name = callOn(item, "GetName")
        entry = {
          trackIndex = trackIndex,
          recordStart = numberOrNull(callOn(item, "GetStart")),
          recordEnd = numberOrNull(callOn(item, "GetEnd")),
          sourceStart = json.null, sourceEnd = json.null, filePath = json.null, fileFps = json.null, clipType = json.null,
          name = isString(name) and name or json.null,
          kind = "unknown",
        }
      end
      table.insert(items, entry)
    end
    if truncated then break end
  end
  -- Audio items are only listed (a video clip's embedded audio shows up here too, so KathaCut matches
  -- them against the video items to tell separately recorded audio apart).
  local audioItems = json.array({})
  for trackIndex = 1, (timeline:GetTrackCount("audio") or 0) do
    for _, item in ipairs(timeline:GetItemListInTrack("audio", trackIndex) or {}) do
      if count >= MAX_EDIT_ITEMS then truncated = true; break end
      count = count + 1
      local mediaPoolItem = callOn(item, "GetMediaPoolItem")
      local name = callOn(item, "GetName")
      table.insert(audioItems, {
        trackIndex = trackIndex,
        recordStart = numberOrNull(callOn(item, "GetStart")),
        filePath = (mediaPoolItem and clipProperty(mediaPoolItem, "File Path")) or json.null,
        name = isString(name) and name or json.null,
      })
    end
    if truncated then break end
  end
  return { timeline = timelineInfoOf(project, timeline), items = items, audioItems = audioItems, truncated = truncated }
end

handlers["jumpTo"] = function(params)
  local _, timeline = requireTimeline(params)
  if not timeline:SetCurrentTimecode(params.timecode) then error("Resolve could not move the playhead") end
  return {}
end

-- ---------------------------------------------------------------------------
-- Create in DaVinci (12): a new timeline in the currently open Resolve project, KathaCut's video clips and
-- their media. Never switches or creates a Resolve project. Captions arrive afterwards through the existing
-- `insertClips` (Sync), against the timeline `createTimeline` returns.
-- ---------------------------------------------------------------------------

local MEDIA_FOLDER = "KathaCut Media"

local function existingTimelineNames(project)
  local names = {}
  for index = 1, (project:GetTimelineCount() or 0) do
    local timeline = project:GetTimelineByIndex(index)
    if timeline then names[timeline:GetName()] = true end
  end
  return names
end

local function uniqueTimelineName(project, base)
  local names = existingTimelineNames(project)
  if not names[base] then return base end
  local suffix = 2
  while names[base .. " (" .. suffix .. ")"] do suffix = suffix + 1 end
  return base .. " (" .. suffix .. ")"
end

handlers["createTimeline"] = function(params)
  local project = currentProject()
  if not project then error("No Resolve project is open") end
  local mediaPool = project:GetMediaPool()
  local name = uniqueTimelineName(project, params.name)
  local timeline = mediaPool:CreateEmptyTimeline(name)
  if not timeline then error("Resolve refused to create a new timeline") end
  local ok1 = pcall(function() timeline:SetSetting("useCustomSettings", "1") end)
  local ok2 = pcall(function() timeline:SetSetting("timelineFrameRate", params.fps) end)
  local ok3 = pcall(function() timeline:SetSetting("timelineResolutionWidth", tostring(params.width)) end)
  local ok4 = pcall(function() timeline:SetSetting("timelineResolutionHeight", tostring(params.height)) end)
  project:SetCurrentTimeline(timeline)
  local note = json.null
  if not (ok1 and ok2 and ok3 and ok4) then note = "Resolve could not set this timeline's custom frame rate or size; check Timeline Settings." end
  return { timelineId = timeline:GetUniqueId(), startFrame = timeline:GetStartFrame(), name = name, projectName = project:GetName(), note = note }
end

handlers["importMedia"] = function(params)
  local project = currentProject()
  if not project then error("No Resolve project is open") end
  local mediaPool = project:GetMediaPool()
  local folder = findFolderNamed(mediaPool:GetRootFolder(), MEDIA_FOLDER, 0)
  if not folder then
    folder = mediaPool:AddSubFolder(mediaPool:GetRootFolder(), MEDIA_FOLDER)
    if not folder then error("Could not create the KathaCut Media bin") end
  end
  local existingByPath = {}
  for _, clip in ipairs(folder:GetClipList() or {}) do
    local path = clipProperty(clip, "File Path")
    if path then existingByPath[path] = true end
  end
  local previous = mediaPool:GetCurrentFolder()
  mediaPool:SetCurrentFolder(folder)
  local items = json.array({})
  for _, path in ipairs(params.paths) do
    if existingByPath[path] then
      table.insert(items, { path = path, ok = true })
    else
      local imported = mediaPool:ImportMedia({ path })
      table.insert(items, { path = path, ok = imported ~= nil and #imported > 0 })
    end
  end
  if previous then mediaPool:SetCurrentFolder(previous) end
  return { items = items }
end

handlers["appendVideoClips"] = function(params)
  local project, timeline = requireTimeline(params)
  local mediaPool = project:GetMediaPool()
  local folder = findFolderNamed(mediaPool:GetRootFolder(), MEDIA_FOLDER, 0)
  if not folder then error("The KathaCut Media bin is missing") end
  local itemByPath = {}
  for _, clip in ipairs(folder:GetClipList() or {}) do
    local path = clipProperty(clip, "File Path")
    if path then itemByPath[path] = clip end
  end

  local maxTrack = 0
  for _, spec in ipairs(params.clips) do if spec.trackIndex > maxTrack then maxTrack = spec.trackIndex end end
  while (timeline:GetTrackCount("video") or 0) < maxTrack do
    if not timeline:AddTrack("video") then error("Resolve refused to add a video track") end
  end

  local infos = {}
  for index, spec in ipairs(params.clips) do
    local item = itemByPath[spec.filePath]
    if not item then error("Media for '" .. tostring(spec.filePath) .. "' is missing from the KathaCut Media bin") end
    infos[index] = { mediaPoolItem = item, trackIndex = spec.trackIndex, recordFrame = spec.recordFrame, startFrame = spec.startFrame, endFrame = spec.endFrame }
  end
  local placed = mediaPool:AppendToTimeline(infos)
  if not placed then error("Resolve refused to place the video clips") end
  local results = json.array({})
  for index = 1, #params.clips do
    local item = placed[index]
    table.insert(results, { ok = item ~= nil, error = item and json.null or "Resolve did not place this clip" })
  end
  return { clips = results }
end

-- ---------------------------------------------------------------------------
-- Launch KathaCut if it isn't already running and answering (app.json heartbeat under 5 s old).
-- ---------------------------------------------------------------------------

local function isAppFresh()
  local app = readJson(appPath)
  if type(app) ~= "table" or type(app.heartbeatAt) ~= "number" then return false end
  return os.time() - app.heartbeatAt < 5
end

-- Every arg is wrapped in "; the installer (electron/resolve/install.ts) refuses any path
-- containing a '"' character before it ever reaches this file.
local function quotedArgs()
  local out = ""
  for _, arg in ipairs(launch.args or {}) do
    out = out .. ' "' .. arg .. '"'
  end
  return out
end

local function launchApp()
  local args = quotedArgs()
  if launch.kind == "windows" then
    os.execute('start "" "' .. launch.exe .. '"' .. args)
  elseif launch.kind == "mac-app" then
    os.execute('open -a "' .. launch.exe .. '"')
  elseif launch.kind == "exec" then
    if pathSep == "\\" then
      os.execute('start "" "' .. launch.exe .. '"' .. args)
    else
      os.execute('"' .. launch.exe .. '"' .. args .. ' &')
    end
  end
end

local sawApp = isAppFresh()
if not sawApp then launchApp() end
local launchedAt = os.time()

-- ---------------------------------------------------------------------------
-- Main loop.
-- ---------------------------------------------------------------------------

writeStatus(false)
local lastStatusWrite = os.time()

while not shouldExit do
  bmd.wait(POLL_INTERVAL)

  local app = readJson(appPath)
  if type(app) == "table" and type(app.heartbeatAt) == "number" then
    sawApp = true
    if app.quitting then break end
    if os.time() - app.heartbeatAt > APP_STALE_SECONDS then break end
  elseif not sawApp and os.time() - launchedAt > LAUNCH_WAIT_SECONDS then
    break
  end

  local request = readJson(requestPath)
  if type(request) == "table" and request.sessionId == sessionId then
    os.remove(requestPath)
    local handler = handlers[request.command]
    local response
    if not handler then
      response = { v = 1, sessionId = sessionId, seq = request.seq, ok = false, error = "Unknown command" }
    else
      busy = true
      local ok, result = pcall(handler, request.params)
      busy = false
      if ok then
        response = { v = 1, sessionId = sessionId, seq = request.seq, ok = true, result = result }
      else
        response = { v = 1, sessionId = sessionId, seq = request.seq, ok = false, error = tostring(result) }
      end
    end
    writeJson(responsePath, response)
  end

  if os.time() - lastStatusWrite >= STATUS_WRITE_INTERVAL then
    writeStatus(false)
    lastStatusWrite = os.time()
  end
end

writeStatus(true)
