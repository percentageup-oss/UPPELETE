--[[
KathaCut Resolve bridge.

Started by the generated launcher (Workspace -> Scripts -> KathaCut) with a global `KATHACUT` table
set: `{ resourcesDir, mailboxDir, launch = { kind, exe, args } }` (see electron/resolve/install.ts).
Polls a small JSON-file mailbox (docs/plans/resolve-textplus/README.md) for commands from the
KathaCut app and answers them. All caption logic lives in KathaCut's TypeScript; this file only
executes a fixed whitelist of command handlers below and never `load`s or `loadstring`s request
content.

Written for KathaCut, GPL-3.0-or-later.
]]

BRIDGE_VERSION = 1

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

handlers["timelineInfo"] = function()
  local project = currentProject()
  local timeline = project and project:GetCurrentTimeline()
  if not timeline then error("No timeline is open in Resolve") end
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
    width = project:GetSetting("timelineResolutionWidth"),
    height = project:GetSetting("timelineResolutionHeight"),
  }
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
  local timelineWidth = tonumber(project:GetSetting("timelineResolutionWidth"))
  local timelineHeight = tonumber(project:GetSetting("timelineResolutionHeight"))
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
