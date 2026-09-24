import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, session } from 'electron'
import { z } from 'zod'
import { mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { createReadStream, existsSync } from 'node:fs'
import { Readable } from 'node:stream'
import { planMediaRange } from './mediaRange'
import { getMediaWorker, closeMediaWorker, configuredToolchain } from './mediaWorker'
import { loadProject, projectSchema, PROJECT_FILE_EXTENSION, PROJECT_FILE_FILTER_NAME, type CaptionProject } from '../src/core/model'
import type { ProjectMedia } from '../src/core/media'
import { projectAssetSchema, type ProjectAsset } from '../src/core/edit'
import { candidateFromProbe, candidatePaths, mediaPathFromUrl, projectForSave, type AssetResolution } from './projectMedia'
import { classifyAsset, classifyMedia, AUDIO_EXTENSIONS, IMAGE_EXTENSIONS, SUBTITLE_EXTENSIONS, VIDEO_EXTENSIONS } from '../src/core/assetKind'
import { inspectFileForBin, MAX_SUBTITLE_BYTES, type AssetInspectDeps } from './assetInspect'
import { WAVEFORM_EXTRACTION_VERSION, waveformDataSchema, waveformLoadRequestSchema } from '../src/core/waveform'
import { silenceDetectRequestSchema, silenceDetectResultSchema } from '../src/core/silenceIpc'
import { THUMBNAIL_EXTRACTION_VERSION, thumbnailLoadRequestSchema, type ThumbnailImage } from '../src/core/thumbnails'
import { proxyCreateRequestSchema, proxySupportFromConfiguration, type ProxySupport } from '../src/core/proxy'
import { failure, type ProgressMessage } from '../workers/media/protocol'
import { readWaveformCache, writeWaveformCache } from './waveformCache'
import { registerModelIpc, closeModelManager } from './modelIpc'
import { readThumbnailCache, writeThumbnailCache } from './thumbnailCache'
import { registerTranscriptionIpc, runTranscriptionSmoke } from './transcriptionIpc'
import { modelIdSchema } from '../src/core/modelCatalog'
import { registerExportIpc, runExportSmoke } from './exportIpc'
import { logExport } from './exportLog'
import { closeJobs } from './jobs'
import { registerAlignmentIpc } from './alignmentIpc'
import { appMenuTemplate } from './appMenu'
import { registerMcpIpc, initMcp, closeMcp } from './mcp/ipc'

// Display name for menus, the About panel and the dock. userData stays at the original 'caption-studio' folder so
// downloaded models, caches, logs and stored secrets survive the rename.
const userDataPath = app.getPath('userData')
app.setName('KathaCut')
app.setPath('userData', userDataPath)
app.setAboutPanelOptions({ applicationName: 'KathaCut', credits: 'Your local AI video toolkit.' })

// Must run before the app is ready. Marks the scheme as fetchable from any page origin (dev
// server included) and as a secure context, without weakening default webSecurity/CSP elsewhere.
protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, bypassCSP: false } },
])

registerModelIpc()
registerMcpIpc()

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL)
const inspectedMedia = new Map<string, { path: string; media: ProjectMedia }>()
const activeWaveforms = new Map<string, { cancelled: boolean; cancel?: () => void }>()
const activeThumbnailRequests = new Map<string, { cancelled: boolean; cancel?: () => void }>()
const activeProxyJobs = new Map<string, { cancelled: boolean; cancel?: () => void }>()
const activeSilenceDetections = new Map<string, { cancelled: boolean; cancel?: () => void }>()
let shuttingDown = false
let proxySupportCache: Promise<ProxySupport> | undefined

function fingerprintKey(fingerprint: NonNullable<ProjectMedia['fingerprint']>) {
  return `${fingerprint.algorithm}:${fingerprint.value}:${fingerprint.sizeBytes}:${fingerprint.sampledBytes}`
}

registerTranscriptionIpc((fingerprint) => inspectedMedia.get(fingerprintKey(fingerprint)))
registerExportIpc((fingerprint) => inspectedMedia.get(fingerprintKey(fingerprint)))
registerAlignmentIpc((fingerprint) => inspectedMedia.get(fingerprintKey(fingerprint)))

const appIconPath = path.join(app.getAppPath(), 'build', 'icon.png')
const appIcon = existsSync(appIconPath) ? appIconPath : undefined

function createWindow() {
  const window = new BrowserWindow({
    ...(appIcon ? { icon: appIcon } : {}),
    width: 1440,
    height: 920,
    minWidth: 940,
    minHeight: 680,
    backgroundColor: '#090b10',
    title: 'KathaCut',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  if (isDev) void window.loadURL(process.env.VITE_DEV_SERVER_URL!)
  else void window.loadFile(path.join(__dirname, '../dist/index.html'))
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return 'The media operation failed.'
}

async function inspectMedia(filePath: string, expected: ProjectMedia | null = null) {
  const probe = await getMediaWorker().start({ operation: 'probe', inputPath: filePath }).result
  const candidate = candidateFromProbe(filePath, expected, probe)
  if (candidate.media.fingerprint) inspectedMedia.set(fingerprintKey(candidate.media.fingerprint), { path: candidate.path, media: candidate.media })
  return candidate
}

async function readTextForBin(filePath: string): Promise<{ content: string; sizeBytes: number }> {
  const info = await stat(filePath)
  if (info.size > MAX_SUBTITLE_BYTES) return { content: '', sizeBytes: info.size }
  return { content: await readFile(filePath, 'utf8'), sizeBytes: info.size }
}

const assetInspectDeps: AssetInspectDeps = { inspect: (filePath) => inspectMedia(filePath), readText: readTextForBin }

ipcMain.handle('media:waveform-load', async (event, value: unknown) => {
  const request = waveformLoadRequestSchema.parse(value)
  const registered = inspectedMedia.get(fingerprintKey(request.fingerprint))
  if (!registered) throw failure('INVALID_MESSAGE', 'Waveform media has not been selected or verified in this app session')
  const knownDurationUs = registered.media.metadata?.durationUs
  if (knownDurationUs !== null && knownDurationUs !== undefined && request.range.endUs > knownDurationUs) {
    throw failure('INVALID_MESSAGE', 'Waveform range exceeds the verified media duration')
  }
  const requestKey = `${event.sender.id}:${request.requestId}`
  if (activeWaveforms.has(requestKey)) throw failure('BUSY', 'This waveform request is already active', { retryable: true })
  const active = { cancelled: false, cancel: undefined as (() => void) | undefined }
  activeWaveforms.set(requestKey, active)
  const cancelForDestroyedRenderer = () => { active.cancelled = true; active.cancel?.() }
  event.sender.once('destroyed', cancelForDestroyedRenderer)
  const cacheRequest = { fingerprint: request.fingerprint, range: request.range, maxPeaks: request.maxPeaks }
  try {
    const cached = await readWaveformCache(path.join(app.getPath('userData'), 'Cache', 'waveforms'), cacheRequest)
    if (active.cancelled) throw failure('CANCELLED', 'Operation cancelled')
    if (cached) return { waveform: cached, cache: 'hit' as const, extractionVersion: WAVEFORM_EXTRACTION_VERSION }
    const job = getMediaWorker().start({ operation: 'waveform', inputPath: registered.path, range: request.range, maxPeaks: request.maxPeaks }, {
      onProgress: (message: ProgressMessage) => {
        if (!active.cancelled && !event.sender.isDestroyed()) {
          event.sender.send('media:waveform-progress', { requestId: request.requestId, progress: message.progress })
        }
      },
    })
    active.cancel = job.cancel
    if (active.cancelled) job.cancel()
    const result = await job.result
    const waveform = waveformDataSchema.parse({ range: result.range, peaks: result.peaks })
    if (active.cancelled) throw failure('CANCELLED', 'Operation cancelled')
    await writeWaveformCache(path.join(app.getPath('userData'), 'Cache', 'waveforms'), cacheRequest, waveform)
    return { waveform, cache: 'generated' as const, extractionVersion: WAVEFORM_EXTRACTION_VERSION }
  } finally {
    event.sender.removeListener('destroyed', cancelForDestroyedRenderer)
    activeWaveforms.delete(requestKey)
  }
})

ipcMain.handle('media:waveform-cancel', (event, requestIdValue: unknown) => {
  const requestId = waveformLoadRequestSchema.shape.requestId.parse(requestIdValue)
  const active = activeWaveforms.get(`${event.sender.id}:${requestId}`)
  if (active) { active.cancelled = true; active.cancel?.() }
})

// No disk cache, unlike waveform-load: the result depends on the threshold/minimum-silence
// parameters the dialog lets the user retune between detections, so a cached result from a
// different setting would silently be wrong.
ipcMain.handle('media:silence-detect', async (event, value: unknown) => {
  const request = silenceDetectRequestSchema.parse(value)
  const registered = inspectedMedia.get(fingerprintKey(request.fingerprint))
  if (!registered) throw failure('INVALID_MESSAGE', 'Silence-detection media has not been selected or verified in this app session')
  const durationUs = registered.media.metadata?.durationUs
  if (!durationUs) throw failure('INVALID_MESSAGE', 'Silence detection needs the media’s probed duration')
  const requestKey = `${event.sender.id}:${request.requestId}`
  if (activeSilenceDetections.has(requestKey)) throw failure('BUSY', 'This silence-detection request is already active', { retryable: true })
  const active = { cancelled: false, cancel: undefined as (() => void) | undefined }
  activeSilenceDetections.set(requestKey, active)
  const cancelForDestroyedRenderer = () => { active.cancelled = true; active.cancel?.() }
  event.sender.once('destroyed', cancelForDestroyedRenderer)
  try {
    const job = getMediaWorker().start({
      operation: 'detectSilence', inputPath: registered.path, range: { startUs: 0, endUs: durationUs },
      thresholdDbfs: request.thresholdDbfs, minSilenceMs: request.minSilenceMs,
    }, {
      onProgress: (message: ProgressMessage) => {
        if (!active.cancelled && !event.sender.isDestroyed()) {
          event.sender.send('media:silence-progress', { requestId: request.requestId, progress: message.progress })
        }
      },
    })
    active.cancel = job.cancel
    if (active.cancelled) job.cancel()
    const result = await job.result
    if (active.cancelled) throw failure('CANCELLED', 'Operation cancelled')
    return silenceDetectResultSchema.parse({ durationUs, silences: result.silences, speechGating: result.speechGating })
  } finally {
    event.sender.removeListener('destroyed', cancelForDestroyedRenderer)
    activeSilenceDetections.delete(requestKey)
  }
})

ipcMain.handle('media:silence-cancel', (event, requestIdValue: unknown) => {
  const requestId = silenceDetectRequestSchema.shape.requestId.parse(requestIdValue)
  const active = activeSilenceDetections.get(`${event.sender.id}:${requestId}`)
  if (active) { active.cancelled = true; active.cancel?.() }
})

ipcMain.handle('media:thumbnails-load', async (event, value: unknown) => {
  const request = thumbnailLoadRequestSchema.parse(value)
  const registered = inspectedMedia.get(fingerprintKey(request.fingerprint))
  if (!registered) throw failure('INVALID_MESSAGE', 'Thumbnail media has not been selected or verified in this app session')
  const knownDurationUs = registered.media.metadata?.durationUs
  if (knownDurationUs != null && request.timestampsUs.some((timestampUs) => timestampUs > knownDurationUs)) {
    throw failure('INVALID_MESSAGE', 'Thumbnail timestamp exceeds the verified media duration')
  }
  const requestKey = `${event.sender.id}:${request.requestId}`
  if (activeThumbnailRequests.has(requestKey)) throw failure('BUSY', 'This thumbnail request is already active', { retryable: true })
  const active = { cancelled: false, cancel: undefined as (() => void) | undefined }
  activeThumbnailRequests.set(requestKey, active)
  const cancelForDestroyedRenderer = () => { active.cancelled = true; active.cancel?.() }
  event.sender.once('destroyed', cancelForDestroyedRenderer)
  const cacheDirectory = path.join(app.getPath('userData'), 'Cache', 'thumbnails')
  let jobDirectory: string | undefined
  try {
    const results = new Array<ThumbnailImage | undefined>(request.timestampsUs.length)
    const missing: { index: number; requestedUs: number }[] = []
    for (const [index, requestedUs] of request.timestampsUs.entries()) {
      const cached = await readThumbnailCache(cacheDirectory, { fingerprint: request.fingerprint, requestedUs, width: request.width })
      if (active.cancelled) throw failure('CANCELLED', 'Operation cancelled')
      if (cached) results[index] = cached
      else missing.push({ index, requestedUs })
    }
    if (missing.length) {
      jobDirectory = await mkdtemp(path.join(app.getPath('temp'), 'caption-studio-thumbnails-'))
      const job = getMediaWorker().start({
        operation: 'thumbnails', inputPath: registered.path,
        timestampsUs: missing.map((entry) => entry.requestedUs), width: request.width, outputDirectory: jobDirectory,
      }, {
        onProgress: (message: ProgressMessage) => {
          if (!active.cancelled && !event.sender.isDestroyed()) {
            event.sender.send('media:thumbnails-progress', { requestId: request.requestId, progress: message.progress })
          }
        },
      })
      active.cancel = job.cancel
      if (active.cancelled) job.cancel()
      const result = await job.result
      if (active.cancelled) throw failure('CANCELLED', 'Operation cancelled')
      if (result.images.length !== missing.length) throw failure('INTERNAL_ERROR', 'Thumbnail worker returned a mismatched result count')
      for (const [position, image] of result.images.entries()) {
        const { index, requestedUs } = missing[position]
        const bytes = await readFile(image.path)
        const thumbnail: ThumbnailImage = {
          requestedUs, actualUs: image.actualUs, width: image.width, height: image.height,
          dataUrl: `data:image/jpeg;base64,${bytes.toString('base64')}`,
        }
        await writeThumbnailCache(cacheDirectory, { fingerprint: request.fingerprint, requestedUs, width: request.width }, thumbnail)
        results[index] = thumbnail
      }
    }
    return { thumbnails: results as ThumbnailImage[], extractionVersion: THUMBNAIL_EXTRACTION_VERSION }
  } finally {
    event.sender.removeListener('destroyed', cancelForDestroyedRenderer)
    activeThumbnailRequests.delete(requestKey)
    if (jobDirectory) await rm(jobDirectory, { recursive: true, force: true })
  }
})

ipcMain.handle('media:thumbnails-cancel', (event, requestIdValue: unknown) => {
  const requestId = thumbnailLoadRequestSchema.shape.requestId.parse(requestIdValue)
  const active = activeThumbnailRequests.get(`${event.sender.id}:${requestId}`)
  if (active) { active.cancelled = true; active.cancel?.() }
})

/** Real, cached-per-session check of the configured tool's own reported capabilities; never assumed. */
async function checkProxySupport(): Promise<ProxySupport> {
  proxySupportCache ??= (async () => {
    try {
      const result = await getMediaWorker().start({ operation: 'inspectToolchain' }).result
      return proxySupportFromConfiguration(result.ffmpeg.versionOutput)
    } catch (error) {
      return { supported: false, reason: errorMessage(error) }
    }
  })()
  return proxySupportCache
}

ipcMain.handle('media:proxy-support', async () => checkProxySupport())

ipcMain.handle('media:proxy-create', async (event, value: unknown) => {
  const request = proxyCreateRequestSchema.parse(value)
  const registered = inspectedMedia.get(fingerprintKey(request.fingerprint))
  if (!registered) throw failure('INVALID_MESSAGE', 'Proxy media has not been selected or verified in this app session')
  const support = await checkProxySupport()
  if (!support.supported) throw failure('UNSUPPORTED_OPERATION', support.reason ?? 'Local proxy conversion is unavailable')
  const durationUs = registered.media.metadata?.durationUs
  if (durationUs == null) throw failure('INVALID_MESSAGE', 'Proxy conversion requires known media duration')
  const defaultName = `${path.basename(registered.path).replace(/\.[^.]+$/, '')}.proxy.webm`
  const dialogResult = await dialog.showSaveDialog({ defaultPath: defaultName, filters: [{ name: 'WebM proxy video', extensions: ['webm'] }] })
  if (dialogResult.canceled || !dialogResult.filePath) return null
  const destinationPath = path.resolve(dialogResult.filePath)
  if (destinationPath === path.resolve(registered.path)) throw failure('INVALID_MESSAGE', 'Cannot overwrite source media with a proxy')
  const requestKey = `${event.sender.id}:${request.requestId}`
  if (activeProxyJobs.has(requestKey)) throw failure('BUSY', 'This proxy request is already active', { retryable: true })
  const active = { cancelled: false, cancel: undefined as (() => void) | undefined }
  activeProxyJobs.set(requestKey, active)
  const cancelForDestroyedRenderer = () => { active.cancelled = true; active.cancel?.() }
  event.sender.once('destroyed', cancelForDestroyedRenderer)
  const temporaryPath = `${destinationPath}.${randomUUID()}.tmp`
  try {
    const job = getMediaWorker().start({ operation: 'proxy', inputPath: registered.path, outputPath: temporaryPath, durationUs }, {
      onProgress: (message: ProgressMessage) => {
        if (!active.cancelled && !event.sender.isDestroyed()) {
          event.sender.send('media:proxy-progress', { requestId: request.requestId, progress: message.progress })
        }
      },
    })
    active.cancel = job.cancel
    if (active.cancelled) job.cancel()
    const jobResult = await job.result
    if (active.cancelled) throw failure('CANCELLED', 'Operation cancelled')
    await rename(temporaryPath, destinationPath)
    return { path: destinationPath, durationUs: jobResult.durationUs }
  } finally {
    event.sender.removeListener('destroyed', cancelForDestroyedRenderer)
    activeProxyJobs.delete(requestKey)
    await rm(temporaryPath, { force: true })
  }
})

ipcMain.handle('media:proxy-cancel', (event, requestIdValue: unknown) => {
  const requestId = proxyCreateRequestSchema.shape.requestId.parse(requestIdValue)
  const active = activeProxyJobs.get(`${event.sender.id}:${requestId}`)
  if (active) { active.cancelled = true; active.cancel?.() }
})

ipcMain.handle('dialog:open-video', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'webm', 'm4v'] }],
  })
  if (result.canceled || !result.filePaths[0]) return null
  const filePath = result.filePaths[0]
  try { return { ok: true as const, candidate: await inspectMedia(filePath) } }
  catch (error) { return { ok: false as const, message: errorMessage(error) } }
})

ipcMain.handle('dialog:open-text', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'SubRip subtitles', extensions: ['srt'] }] })
  if (result.canceled || !result.filePaths[0]) return null
  const filePath = result.filePaths[0]
  return { path: filePath, content: await readFile(filePath, 'utf8') }
})

// Project paths the user chose through a native dialog this session. Dialog-free writes (autosave, ⌘S on a
// named project) are only allowed to these, so the renderer can never direct a write at an arbitrary path.
const knownProjectPaths = new Set<string>()

async function writeProjectFile(project: CaptionProject, filePath: string) {
  const savedProject: CaptionProject = projectSchema.parse(projectForSave(project, filePath))
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`
  await writeFile(temporaryPath, JSON.stringify(savedProject, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' })
  await rename(temporaryPath, filePath)
  knownProjectPaths.add(filePath)
  return { path: filePath, project: savedProject }
}

ipcMain.handle('project:open', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: PROJECT_FILE_FILTER_NAME, extensions: [PROJECT_FILE_EXTENSION] },
      { name: 'Legacy JSON project', extensions: ['json'] },
    ],
  })
  if (result.canceled || !result.filePaths[0]) return null
  const projectPath = result.filePaths[0]
  try {
    const loaded = loadProject(JSON.parse(await readFile(projectPath, 'utf8')))
    // Every asset — the video(s) included — resolves the same way: only a resolved (fingerprint-verified) asset
    // has its stored reference rewritten to the path actually found, so a later save keeps it linked.
    const assetResolutions: AssetResolution[] = []
    let assets: ProjectAsset[] = loaded.project.assets
    for (const asset of loaded.project.assets) {
      const paths = await candidatePaths(projectPath, asset)
      if (!paths.existing) { assetResolutions.push({ id: asset.id, resolution: { kind: 'missing', triedPaths: paths.tried } }); continue }
      const candidate = await inspectMedia(paths.existing, asset)
      if (candidate.mismatches.length) { assetResolutions.push({ id: asset.id, resolution: { kind: 'mismatch', candidate } }); continue }
      assetResolutions.push({ id: asset.id, resolution: { kind: 'resolved', candidate } })
      assets = assets.map((entry) => entry.id === asset.id ? { ...entry, ...candidate.media } : entry)
    }
    const project = { ...loaded.project, assets }
    knownProjectPaths.add(projectPath)
    return { ok: true as const, path: projectPath, project, migratedFrom: loaded.migratedFrom, migrationNotes: loaded.migrationNotes, assets: assetResolutions }
  } catch (error) {
    return { ok: false as const, message: errorMessage(error) }
  }
})

const assetKindSchema = z.enum(['image', 'audio'])

/** Imports a new asset file. Classification is real (probed streams), never the extension the user
 * picked, so a video renamed to .png is refused rather than silently accepted as an overlay image. */
ipcMain.handle('assets:import', async (_event, kindValue: unknown) => {
  const kind = assetKindSchema.parse(kindValue)
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: kind === 'image' ? 'Image' : 'Audio', extensions: kind === 'image' ? IMAGE_EXTENSIONS : AUDIO_EXTENSIONS }],
  })
  if (result.canceled || !result.filePaths[0]) return null
  const filePath = result.filePaths[0]
  try {
    const candidate = await inspectMedia(filePath)
    const actualKind = candidate.media.metadata ? classifyAsset(candidate.media.metadata) : null
    if (actualKind !== kind) return { ok: false as const, message: `${candidate.media.name} could not be recognized as a usable ${kind} file.` }
    return { ok: true as const, media: candidate.media, url: candidate.url }
  } catch (error) { return { ok: false as const, message: errorMessage(error) } }
})

const RELINK_FILTERS = {
  image: { name: 'Image', extensions: IMAGE_EXTENSIONS },
  audio: { name: 'Audio', extensions: AUDIO_EXTENSIONS },
  video: { name: 'Video', extensions: VIDEO_EXTENSIONS },
} as const

ipcMain.handle('assets:relink', async (_event, expectedValue: unknown) => {
  const expected = projectAssetSchema.parse(expectedValue)
  const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: [RELINK_FILTERS[expected.kind]] })
  if (result.canceled || !result.filePaths[0]) return null
  try {
    const candidate = await inspectMedia(result.filePaths[0], expected)
    const actualKind = candidate.media.metadata ? classifyMedia(candidate.media.metadata) : null
    if (actualKind !== expected.kind) return { ok: false as const, message: `${candidate.media.name} is not a usable ${expected.kind} file.` }
    return { ok: true as const, candidate }
  } catch (error) { return { ok: false as const, message: errorMessage(error) } }
})

const MEDIA_BIN_EXTENSIONS = [...IMAGE_EXTENSIONS, ...AUDIO_EXTENSIONS, ...VIDEO_EXTENSIONS, ...SUBTITLE_EXTENSIONS]

/** Multi-select import for the media bin (Media panel "Import…" button). Each picked file is
 * classified independently, so a mixed selection of images/audio/video/SRT succeeds file-by-file. */
ipcMain.handle('assets:import-files', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'All media', extensions: MEDIA_BIN_EXTENSIONS },
      { name: 'Video', extensions: VIDEO_EXTENSIONS },
      { name: 'Image', extensions: IMAGE_EXTENSIONS },
      { name: 'Audio', extensions: AUDIO_EXTENSIONS },
      { name: 'Subtitles', extensions: SUBTITLE_EXTENSIONS },
    ],
  })
  if (result.canceled || !result.filePaths.length) return null
  return Promise.all(result.filePaths.map((filePath) => inspectFileForBin(filePath, assetInspectDeps)))
})

const droppedFilePathsSchema = z.array(z.string().min(1).max(32768).refine((value) => path.isAbsolute(value), 'Dropped file path must be absolute')).max(64)

/** OS drag-and-drop onto the media bin. The renderer never sees a filesystem path — the preload
 * resolves each dropped `File` to its path via `webUtils.getPathForFile` before this call. */
ipcMain.handle('assets:inspect-dropped', async (_event, value: unknown) => {
  const paths = droppedFilePathsSchema.parse(value)
  return Promise.all(paths.map((filePath) => inspectFileForBin(filePath, assetInspectDeps)))
})

ipcMain.handle('dialog:save-text', async (_event, request: { content: string; defaultName: string }) => {
  if (!request || typeof request.content !== 'string' || typeof request.defaultName !== 'string') {
    throw new Error('Invalid save request')
  }
  const result = await dialog.showSaveDialog({
    defaultPath: request.defaultName,
    filters: [{ name: 'SubRip subtitles', extensions: ['srt'] }],
  })
  if (result.canceled || !result.filePath) return null
  const temporaryPath = `${result.filePath}.${randomUUID()}.tmp`
  await writeFile(temporaryPath, request.content, { encoding: 'utf8', flag: 'wx' })
  await rename(temporaryPath, result.filePath)
  return { path: result.filePath }
})

ipcMain.handle('project:save', async (_event, request: { project: unknown; defaultName: unknown }) => {
  if (!request || typeof request.defaultName !== 'string') throw new Error('Invalid project save request')
  const project = projectSchema.parse(request.project)
  const result = await dialog.showSaveDialog({
    defaultPath: request.defaultName,
    filters: [{ name: PROJECT_FILE_FILTER_NAME, extensions: [PROJECT_FILE_EXTENSION] }],
  })
  if (result.canceled || !result.filePath) return null
  const filePath = result.filePath.toLowerCase().endsWith(`.${PROJECT_FILE_EXTENSION}`)
    ? result.filePath
    : `${result.filePath}.${PROJECT_FILE_EXTENSION}`
  return writeProjectFile(project, filePath)
})

// Writes a named project in place without a dialog (autosave and Save on an already-saved project).
ipcMain.handle('project:write', async (_event, request: { project: unknown; path: unknown }) => {
  if (!request || typeof request.path !== 'string') throw new Error('Invalid project write request')
  if (!knownProjectPaths.has(request.path)) throw new Error('This project has not been saved or opened through a dialog yet')
  const project = projectSchema.parse(request.project)
  return writeProjectFile(project, request.path)
})

// Native Edit → Undo/Redo accelerators reach the renderer even while a text field is focused; it asks for the
// field's own edit history through here instead of touching project history.
ipcMain.handle('edit:text', (event, action: unknown) => {
  if (action === 'undo') event.sender.undo()
  else if (action === 'redo') event.sender.redo()
  else throw new Error('Invalid text edit action')
})

// Only 'local-fonts' (the Style panel's installed-font list) and 'fullscreen' (the <video controls>
// fullscreen button) are ever granted, and only to this app's own window — never an arbitrary
// requesting origin. Everything else (camera, geolocation, clipboard, …) is refused outright.
const ALLOWED_PERMISSIONS = new Set(['local-fonts', 'fullscreen'])
function isAppOrigin(url: string): boolean {
  if (url.startsWith('file://')) return true
  return isDev && !!process.env.VITE_DEV_SERVER_URL && url.startsWith(process.env.VITE_DEV_SERVER_URL)
}

app.whenReady().then(async () => {
  // Unpackaged runs otherwise show Electron's dock icon; a packaged .app uses its bundle icon.
  if (appIcon && !app.isPackaged) app.dock?.setIcon(appIcon)
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    callback(ALLOWED_PERMISSIONS.has(permission) && isAppOrigin(details.requestingUrl))
  })
  session.defaultSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    return ALLOWED_PERMISSIONS.has(permission) && isAppOrigin(requestingOrigin)
  })

  // Serves only paths this session has already probed and registered via inspectMedia — never an
  // arbitrary renderer-supplied path — so the custom scheme can't be used to read other files.
  protocol.handle('media', async (request) => {
    const filePath = mediaPathFromUrl(request.url)
    if (!filePath) return new Response('Bad Request', { status: 400 })
    const allowed = [...inspectedMedia.values()].some((entry) => path.resolve(entry.path) === filePath)
    if (!allowed) return new Response('Forbidden', { status: 403 })
    // Ranges are answered here (206 + Content-Range) because net.fetch on file URLs slices the body
    // but reports 200, which makes Chromium's media pipeline treat the video as unseekable.
    let sizeBytes: number
    try { sizeBytes = (await stat(filePath)).size } catch { return new Response('Not Found', { status: 404 }) }
    const plan = planMediaRange(request.headers.get('range'), sizeBytes, filePath)
    if (plan.status === 416 || request.method === 'HEAD') return new Response(null, { status: plan.status, headers: plan.headers })
    const stream = Readable.toWeb(createReadStream(filePath, { start: plan.start, end: plan.end })) as ReadableStream
    return new Response(stream, { status: plan.status, headers: plan.headers })
  })

  // Developer-only, read-only smoke entry; no renderer IPC is exposed by M1.
  if (process.argv.includes('--media-worker-smoke')) {
    try {
      const runtime = await getMediaWorker().start({ operation: 'runtime' }).result
      if (runtime.pid === process.pid) throw new Error('Worker must run in a separate process')
      console.log(JSON.stringify({ parentPid: process.pid, worker: runtime }))
      if (configuredToolchain()) {
        console.log(JSON.stringify(await getMediaWorker().start({ operation: 'inspectToolchain' }).result))
        if (process.env.CAPTION_STUDIO_MEDIA_SMOKE_PATH) {
          console.log(JSON.stringify(await getMediaWorker().start({ operation: 'probe', inputPath: process.env.CAPTION_STUDIO_MEDIA_SMOKE_PATH }).result))
        }
      }
    } catch (error) { console.error(error); process.exitCode = 1 }
    app.quit()
    return
  }
  // Developer-only real transcription smoke through the bundled main process; opens no window or dialog.
  if (process.argv.includes('--transcription-smoke')) {
    try {
      const mediaPath = process.env.CAPTION_STUDIO_TRANSCRIPTION_SMOKE_PATH
      if (!mediaPath) throw new Error('Set CAPTION_STUDIO_TRANSCRIPTION_SMOKE_PATH to an absolute media path')
      const candidate = await inspectMedia(mediaPath)
      const modelId = modelIdSchema.parse(process.env.CAPTION_STUDIO_TRANSCRIPTION_SMOKE_MODEL ?? 'whisper-base')
      console.log(JSON.stringify(await runTranscriptionSmoke(candidate.path, candidate.media, modelId)))
    } catch (error) { console.error(error); process.exitCode = 1 }
    app.quit()
    return
  }
  // Developer-only real export smoke through the bundled main process, real FFmpeg/export host and
  // job scheduler; opens no window or dialog. Writes to an explicit output path, never the source.
  if (process.argv.includes('--export-smoke')) {
    try {
      const mediaPath = process.env.CAPTION_STUDIO_EXPORT_SMOKE_PATH
      const outputPath = process.env.CAPTION_STUDIO_EXPORT_SMOKE_OUTPUT
      if (!mediaPath || !outputPath) throw new Error('Set CAPTION_STUDIO_EXPORT_SMOKE_PATH and CAPTION_STUDIO_EXPORT_SMOKE_OUTPUT to absolute paths')
      const candidate = await inspectMedia(mediaPath)
      const srtPath = process.env.CAPTION_STUDIO_EXPORT_SMOKE_SRT || null
      const manifestPath = process.env.CAPTION_STUDIO_EXPORT_SMOKE_MANIFEST || null
      console.log(JSON.stringify(await runExportSmoke(candidate.path, candidate.media, srtPath, outputPath, manifestPath)))
    } catch (error) { console.error(error); process.exitCode = 1 }
    app.quit()
    return
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate(appMenuTemplate(process.platform, (command) => {
    const target = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    target?.webContents.send('menu:command', command)
  })))
  createWindow()
  app.on('activate', () => {
    if (!shuttingDown && BrowserWindow.getAllWindows().length === 0) createWindow()
  })
  // Resumes agent access (docs/MCP.md) if it was left enabled last session; off by default on a
  // fresh install. Never blocks the window from opening — a failure here (a port that can no
  // longer bind) is reported through the Settings tab's status, not a startup dialog.
  void initMcp().catch((error) => logExport('agent-start-failed', { message: error instanceof Error ? error.message : String(error) }))
})

// A renderer or helper process that dies takes any work it was driving with it, and Chromium
// reports it nowhere the user can see. Recorded so a run that ended with no message on screen —
// the export host running out of memory, a renderer crash mid-encode — leaves evidence behind.
app.on('render-process-gone', (_event, _contents, details) => {
  logExport('render-process-gone', { reason: details.reason, exitCode: details.exitCode })
})
app.on('child-process-gone', (_event, details) => {
  logExport('child-process-gone', { type: details.type, name: details.name, reason: details.reason, exitCode: details.exitCode })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', (event) => {
  event.preventDefault()
  if (shuttingDown) return
  shuttingDown = true
  // All owned work is settled before exit; re-entering app.quit after prevention can
  // leave a windowless macOS process with a closed model manager.
  // Cancel scheduled transcription (reaping its worker) before closing the shared worker client and models.
  void closeJobs().catch(() => {})
    .then(() => Promise.all([closeMediaWorker(), closeModelManager(), closeMcp()]))
    .finally(() => app.exit(0))
})
