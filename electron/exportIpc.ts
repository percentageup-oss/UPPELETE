import { app, dialog, ipcMain } from 'electron'
import { readFileSync } from 'node:fs'
import { readFile, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { parseCube } from '../src/color/cube'
import { exportSupportFromConfiguration, type ExportSupport } from '../src/core/exportSupport'
import { exportStartRequestSchema, type ExportOutcome } from '../src/export/ipc'
import { buildExportManifest, exportManifestSchema, planFromMedia, type BuiltExport, type ExportPlan } from '../src/export/plan'
import { mediaUrlForPath } from './projectMedia'
import { DEFAULT_CAPTION_STYLE } from '../src/captions/style'
import type { MediaFingerprint, ProjectMedia } from '../src/core/media'
import type { ProjectAsset } from '../src/core/edit'
import { formatFromMedia } from '../src/core/format'
import { primaryVideoAsset } from '../src/core/projectClips'
import { isValidRange, projectInRange } from '../src/core/sequenceRange'
import { sequenceDurationUs } from '../src/core/timelineModel'
import type { CaptionProject } from '../src/core/model'
import { parseSrt } from '../src/core/srt'
import { ExportService } from './exportService'
import { exportSettingsSchema, resolveExportFormat, resolveVideoBitrateKbps, type ExportSettings } from '../src/export/settings'
import { logExport } from './exportLog'
import { getJobScheduler } from './jobs'
import { getMediaWorker, configuredToolchain } from './mediaWorker'

let service: ExportService | undefined
let supportCache: Promise<ExportSupport> | undefined
const activeRequests = new Map<string, { cancel(): void }>()

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'The export failed.'
}

function getService(): ExportService {
  service ??= new ExportService({ worker: getMediaWorker(), scheduler: getJobScheduler(), temporaryRoot: app.getPath('temp') })
  return service
}

/** Real, cached-per-session check of the configured tools' own reported capabilities and the
 * built export host's presence — mirrors `checkProxySupport`. The Export Video control is shown
 * only when this reports `supported`, never as a nonfunctional placeholder. */
async function checkExportSupport(): Promise<ExportSupport> {
  supportCache ??= (async () => {
    try {
      const tools = configuredToolchain()
      if (!tools?.exportHost) return { supported: false, reason: 'The GPU export host is not configured for this build.' }
      const result = await getMediaWorker().start({ operation: 'inspectToolchain' }).result
      const ffmpegSupport = exportSupportFromConfiguration(result.ffmpeg.versionOutput, process.platform)
      if (!ffmpegSupport.supported) return ffmpegSupport
      const ffprobeSupport = exportSupportFromConfiguration(result.ffprobe.versionOutput, process.platform)
      if (!ffprobeSupport.supported) return ffprobeSupport
      try {
        await stat(tools.exportHost.executable)
        await stat(tools.exportHost.scriptPath)
      } catch {
        return { supported: false, reason: 'The built GPU export host is missing; run the export build step.' }
      }
      return { supported: true, reason: null }
    } catch (error) {
      return { supported: false, reason: messageOf(error) }
    }
  })()
  return supportCache
}

const failed = (message: string): ExportOutcome => ({ state: 'failed', error: { code: 'INVALID_INPUT', message, retryable: false } })

type LookupMedia = (fingerprint: MediaFingerprint) => { path: string; media: ProjectMedia } | undefined

const KIND_NAME: Record<ProjectAsset['kind'], string> = { video: 'Video', image: 'Image', audio: 'Sound', lut: 'LUT' }

/**
 * Builds the manifest for the live project. Every file the timeline plays is resolved through this
 * session's fingerprint registry — exactly like the source video always was — never from the project
 * JSON's stored path, so a missing or unrelinked file refuses the export by name before the job
 * starts rather than being silently omitted. The output frame is the project's own `format`, else
 * what the first video on the timeline probes to (X2's `planFromMedia` rule).
 */
export function buildExportForProject(source: CaptionProject, lookupMedia: LookupMedia, settings?: ExportSettings): BuiltExport {
  let project = source
  if (settings?.range) {
    if (!isValidRange(settings.range, sequenceDurationUs(source.clips))) throw new Error('The In/Out range no longer fits the timeline. Adjust or clear it and export again.')
    project = projectInRange(source, settings.range)
  }
  const resolve = (asset: ProjectAsset) => {
    const found = asset.fingerprint && lookupMedia(asset.fingerprint)
    if (!found) throw new Error(`${KIND_NAME[asset.kind]} "${asset.name}" is missing. Relink it before exporting.`)
    return found
  }
  const primary = primaryVideoAsset(project)
  const registered = primary?.fingerprint ? lookupMedia(primary.fingerprint) : undefined
  const fallback = formatFromMedia(registered?.media.metadata ?? primary?.metadata)
  return buildExportManifest(project, {
    assetUrl: (asset) => mediaUrlForPath(resolve(asset).path), assetPath: (asset) => resolve(asset).path,
    lutCube: (asset) => parseCube(readFileSync(resolve(asset).path, 'utf8')),
  }, fallback, settings)
}

/** Media is resolved only from fingerprints this session probed; the renderer never supplies a path. */
export function registerExportIpc(lookupMedia: LookupMedia) {
  ipcMain.handle('export:support', async () => checkExportSupport())

  ipcMain.handle('export:start', async (event, value: unknown): Promise<ExportOutcome | null> => {
    const request = exportStartRequestSchema.parse(value)
    const support = await checkExportSupport()
    if (!support.supported) return failed(support.reason ?? 'MP4 export is unavailable.')
    let built: BuiltExport
    try { built = buildExportForProject(request.project, lookupMedia, request.settings) }
    catch (error) { logExport('build-failed', { requestId: request.requestId, message: messageOf(error) }); return failed(messageOf(error)) }
    const ranged = request.settings?.range ? '-range' : ''
    const scaled = request.settings && request.settings.resolution !== 'source' ? `-${request.settings.resolution}p` : ''
    const defaultName = `${request.project.title || 'export'}${ranged}${scaled}.mp4`
    const videoBitrateKbps = resolveVideoBitrateKbps(request.settings, built.plan)
    const dialogResult = await dialog.showSaveDialog({ defaultPath: defaultName, filters: [{ name: 'MP4 video', extensions: ['mp4'] }] })
    if (dialogResult.canceled || !dialogResult.filePath) return null
    const destinationPath = path.resolve(dialogResult.filePath)
    if (built.inputPaths.some((input) => path.resolve(input) === destinationPath)) return failed('Choose a destination different from every file the timeline uses.')
    const key = `${event.sender.id}:${request.requestId}`
    if (activeRequests.has(key)) return failed('This export request is already running.')
    logExport('start', {
      requestId: request.requestId, destinationPath, manifestVersion: built.manifest.version,
      inputCount: built.inputPaths.length, cueCount: built.manifest.cues.length,
      clipCount: built.manifest.version === 3 ? built.manifest.clips.length : undefined,
      overlayCount: built.manifest.overlays.length,
      plan: built.plan, settings: request.settings, videoBitrateKbps,
    })
    const handle = getService().start({ inputPaths: built.inputPaths, plan: built.plan, manifest: built.manifest, destinationPath, ...(videoBitrateKbps ? { encoding: { videoBitrateKbps } } : {}) },
      (job) => { if (!event.sender.isDestroyed()) event.sender.send('export:progress', { requestId: request.requestId, job }) })
    activeRequests.set(key, handle)
    // A destroyed renderer deliberately does *not* cancel the job. The user already chose a
    // destination, so the export's product is a file on disk, not a live window: losing a
    // half-hour encode because the window was closed or reloaded (which on macOS does not quit
    // the app) discarded real work silently, with no file and no message. App shutdown still
    // cancels every job through `closeJobs()`.
    const noteDestroyedRenderer = () => logExport('renderer-destroyed', { requestId: request.requestId })
    event.sender.once('destroyed', noteDestroyedRenderer)
    try {
      const outcome = await handle.outcome
      logExport('outcome', { requestId: request.requestId, state: outcome.state, ...(outcome.state === 'failed' ? { error: outcome.error } : {}),
        ...(outcome.state === 'succeeded' ? { path: outcome.value.path, durationUs: outcome.value.durationUs, frameCount: outcome.value.frameCount } : {}) })
      if (outcome.state === 'succeeded') return { state: 'succeeded', path: outcome.value.path, durationUs: outcome.value.durationUs, frameCount: outcome.value.frameCount }
      return outcome.state === 'failed' ? { state: 'failed', error: outcome.error } : { state: 'cancelled' }
    } finally {
      activeRequests.delete(key)
      event.sender.removeListener('destroyed', noteDestroyedRenderer)
    }
  })

  ipcMain.handle('export:cancel', (event, value: unknown) => {
    const requestId = exportStartRequestSchema.shape.requestId.parse(value)
    activeRequests.get(`${event.sender.id}:${requestId}`)?.cancel()
  })
}

/** Developer-only real export smoke through the bundled main process; opens no window or dialog.
 * `srtPath` is optional — without one, the manifest has no cues, still exercising real video/audio
 * encoding end to end. `manifestPath`, when set, replaces the SRT-derived v1 manifest with a parsed
 * and validated manifest read from disk (X3's parity script supplies full v2 manifests: presets,
 * authored word timings, mixed-script fixtures) — never trusted unvalidated. */
export async function runExportSmoke(mediaPath: string, media: ProjectMedia, srtPath: string | null, outputPath: string, manifestPath?: string | null, settings?: ExportSettings) {
  if (!media.metadata?.durationUs) throw new Error('Smoke media has no probed duration')
  const support = await checkExportSupport()
  if (!support.supported) throw new Error(support.reason ?? 'MP4 export is unavailable.')
  if (path.resolve(outputPath) === path.resolve(mediaPath)) throw new Error('Smoke output path must differ from the source media')
  const base = planFromMedia(media.metadata)
  const plan: ExportPlan = { ...base, ...resolveExportFormat({ width: base.width, height: base.height, frameRate: base.frameRate }, settings) }
  const kbps = resolveVideoBitrateKbps(settings, plan)
  let manifest
  if (manifestPath) {
    manifest = exportManifestSchema.parse(JSON.parse(await readFile(manifestPath, 'utf8')))
  } else {
    const cues = srtPath ? parseSrt(await readFile(srtPath, 'utf8')).cues : []
    manifest = { version: 2 as const, cues, style: DEFAULT_CAPTION_STYLE, overlays: [], blurRegions: [], audioClips: [] }
  }
  await rm(outputPath, { force: true })
  const outcome = await getService().start({ inputPaths: [mediaPath], plan, manifest, destinationPath: outputPath, ...(kbps ? { encoding: { videoBitrateKbps: kbps } } : {}) }, () => {}).outcome
  if (outcome.state !== 'succeeded') throw new Error(`Export ${outcome.state}: ${JSON.stringify(outcome)}`)
  return {
    parentPid: process.pid, nodeVersion: process.versions.node, electronVersion: process.versions.electron,
    cueCount: 'cues' in manifest ? manifest.cues.length : 0, path: outcome.value.path, durationUs: outcome.value.durationUs,
    frameCount: outcome.value.frameCount, plan,
  }
}

