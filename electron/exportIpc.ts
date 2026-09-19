import { app, dialog, ipcMain } from 'electron'
import { readFile, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { exportSupportFromConfiguration, type ExportSupport } from '../src/core/exportSupport'
import { exportStartRequestSchema, type ExportOutcome } from '../src/export/ipc'
import { buildExportManifest, exportManifestSchema, planFromMedia, type ExportPlan } from '../src/export/plan'
import { mediaUrlForPath } from './projectMedia'
import { DEFAULT_CAPTION_STYLE } from '../src/captions/style'
import type { MediaFingerprint, ProjectMedia } from '../src/core/media'
import { parseSrt } from '../src/core/srt'
import { ExportService } from './exportService'
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

/** Media is resolved only from fingerprints this session probed; the renderer never supplies a path. */
export function registerExportIpc(lookupMedia: (fingerprint: MediaFingerprint) => { path: string; media: ProjectMedia } | undefined) {
  ipcMain.handle('export:support', async () => checkExportSupport())

  ipcMain.handle('export:start', async (event, value: unknown): Promise<ExportOutcome | null> => {
    const request = exportStartRequestSchema.parse(value)
    const registered = lookupMedia(request.fingerprint)
    if (!registered) return failed('Open or relink this media in the current session before exporting it.')
    if (!registered.media.metadata) return failed('Export needs the media duration/dimensions reported by the media probe.')
    const support = await checkExportSupport()
    if (!support.supported) return failed(support.reason ?? 'MP4 export is unavailable.')
    const defaultName = `${request.project.title || 'export'}.mp4`
    const dialogResult = await dialog.showSaveDialog({ defaultPath: defaultName, filters: [{ name: 'MP4 video', extensions: ['mp4'] }] })
    if (dialogResult.canceled || !dialogResult.filePath) return null
    const destinationPath = path.resolve(dialogResult.filePath)
    if (destinationPath === path.resolve(registered.path)) return failed('Choose a destination different from the source media.')
    const key = `${event.sender.id}:${request.requestId}`
    if (activeRequests.has(key)) return failed('This export request is already running.')
    // Manifest v2 (docs/EDITING.md): a strict superset of X2's v1, so an unedited project still
    // encodes exactly as before while any edit it does carry reaches the worker as data, never flags.
    // An overlay's asset path comes from this session's fingerprint registry — exactly like the
    // source media — never from the project JSON's stored path, so a missing/unrelinked asset
    // refuses the export before the job starts rather than silently omitting the overlay.
    let manifest
    try {
      manifest = buildExportManifest(request.project, planFromMedia(registered.media.metadata), (asset) => {
        const found = asset.fingerprint && lookupMedia(asset.fingerprint)
        if (!found) throw new Error(`Overlay image "${asset.name}" is missing. Relink it in the inspector before exporting.`)
        return mediaUrlForPath(found.path)
      }, (asset) => {
        // A sound effect's path never comes from the project JSON either — exactly like the
        // overlay `assetUrl` above, it is looked up in this session's fingerprint registry.
        const found = asset.fingerprint && lookupMedia(asset.fingerprint)
        if (!found) throw new Error(`Sound effect "${asset.name}" is missing. Relink it in the inspector before exporting.`)
        return found.path
      })
    } catch (error) { return failed(messageOf(error)) }
    const handle = getService().start({ mediaPath: registered.path, metadata: registered.media.metadata, manifest, destinationPath },
      (job) => { if (!event.sender.isDestroyed()) event.sender.send('export:progress', { requestId: request.requestId, job }) })
    activeRequests.set(key, handle)
    const cancelForDestroyedRenderer = () => handle.cancel()
    event.sender.once('destroyed', cancelForDestroyedRenderer)
    try {
      const outcome = await handle.outcome
      if (outcome.state === 'succeeded') return { state: 'succeeded', path: outcome.value.path, durationUs: outcome.value.durationUs, frameCount: outcome.value.frameCount }
      return outcome.state === 'failed' ? { state: 'failed', error: outcome.error } : { state: 'cancelled' }
    } finally {
      activeRequests.delete(key)
      event.sender.removeListener('destroyed', cancelForDestroyedRenderer)
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
export async function runExportSmoke(mediaPath: string, media: ProjectMedia, srtPath: string | null, outputPath: string, manifestPath?: string | null) {
  if (!media.metadata?.durationUs) throw new Error('Smoke media has no probed duration')
  const support = await checkExportSupport()
  if (!support.supported) throw new Error(support.reason ?? 'MP4 export is unavailable.')
  if (path.resolve(outputPath) === path.resolve(mediaPath)) throw new Error('Smoke output path must differ from the source media')
  let manifest
  if (manifestPath) {
    manifest = exportManifestSchema.parse(JSON.parse(await readFile(manifestPath, 'utf8')))
  } else {
    const cues = srtPath ? parseSrt(await readFile(srtPath, 'utf8')).cues : []
    manifest = { version: 2 as const, cues, style: DEFAULT_CAPTION_STYLE, overlays: [], blurRegions: [], audioClips: [] }
  }
  const plan: ExportPlan = planFromMedia(media.metadata)
  await rm(outputPath, { force: true })
  const outcome = await getService().start({ mediaPath, metadata: media.metadata, manifest, destinationPath: outputPath }, () => {}).outcome
  if (outcome.state !== 'succeeded') throw new Error(`Export ${outcome.state}: ${JSON.stringify(outcome)}`)
  return {
    parentPid: process.pid, nodeVersion: process.versions.node, electronVersion: process.versions.electron,
    cueCount: 'cues' in manifest ? manifest.cues.length : 0, path: outcome.value.path, durationUs: outcome.value.durationUs,
    frameCount: outcome.value.frameCount, plan,
  }
}

