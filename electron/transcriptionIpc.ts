import { app, ipcMain } from 'electron'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import type { MediaFingerprint, ProjectMedia } from '../src/core/media'
import { createProject } from '../src/core/model'
import { modelIdSchema, type ManagedModelId } from '../src/core/modelCatalog'
import { applyTranscription } from '../src/core/transcriptionApply'
import { transcriptionStartRequestSchema, type TranscriptionOutcome } from '../src/core/transcriptionIpc'
import { getJobScheduler } from './jobs'
import { getMediaWorker, whisperCliConfigured } from './mediaWorker'
import { getModelManager } from './modelIpc'
import { TranscriptionService } from './transcriptionService'
import { geminiSecretStore } from './geminiKey'

let service: TranscriptionService | undefined
const activeRequests = new Map<string, { cancel(): void }>()

function getService(): TranscriptionService {
  if (!service) {
    service = new TranscriptionService({
      worker: getMediaWorker(), scheduler: getJobScheduler(), whisperConfigured: whisperCliConfigured(), temporaryRoot: app.getPath('temp'),
      installedModelPath: (id) => getModelManager().installedPath(id),
    })
  }
  return service
}

const failed = (message: string): TranscriptionOutcome => ({ state: 'failed', error: { code: 'INVALID_INPUT', message, retryable: false } })

/** Media is resolved only from fingerprints this session probed; the renderer never supplies a path. */
export function registerTranscriptionIpc(lookupMedia: (fingerprint: MediaFingerprint) => { path: string; media: ProjectMedia } | undefined) {
  ipcMain.handle('transcription:availability', (_event, value: unknown) => getService().availability(modelIdSchema.parse(value)))

  ipcMain.handle('transcription:start', async (event, value: unknown): Promise<TranscriptionOutcome> => {
    const request = transcriptionStartRequestSchema.parse(value)
    const registered = lookupMedia(request.fingerprint)
    if (!registered) return failed('Open or relink this media in the current session before transcribing it.')
    const durationUs = registered.media.metadata?.durationUs
    if (!durationUs) return failed('Transcription needs the media duration reported by the media probe.')
    const key = `${event.sender.id}:${request.requestId}`
    if (activeRequests.has(key)) return failed('This transcription request is already running.')
    const sourceRange = { startUs: 0, endUs: durationUs }
    let apiKey: string | null = null
    if (request.engine === 'gemini' || request.translateTo !== null) {
      try { apiKey = await geminiSecretStore().load() } catch (error) { return failed(error instanceof Error ? error.message : 'The Gemini API key could not be read.') }
      if (!apiKey) return failed(request.engine === 'gemini' ? 'Add a Gemini API key in Settings before transcribing with Gemini.' : 'Add a Gemini API key in Settings before translating captions.')
    }
    const handle = getService().start(request.engine === 'gemini'
      ? { engine: 'gemini', mediaPath: registered.path, sourceRange, language: request.language, translateTo: request.translateTo, apiKey: apiKey! }
      : { mediaPath: registered.path, sourceRange, modelId: request.modelId, language: request.language, device: request.device, translateTo: request.translateTo, apiKey: apiKey ?? undefined },
    (job) => { if (!event.sender.isDestroyed()) event.sender.send('transcription:progress', { requestId: request.requestId, job }) })
    activeRequests.set(key, handle)
    const cancelForDestroyedRenderer = () => handle.cancel()
    event.sender.once('destroyed', cancelForDestroyedRenderer)
    try {
      const outcome = await handle.outcome
      if (outcome.state === 'succeeded') return { state: 'succeeded', transcript: outcome.value.transcript, run: outcome.value.run, translation: outcome.value.translation }
      return outcome.state === 'failed' ? { state: 'failed', error: outcome.error } : { state: 'cancelled' }
    } finally {
      activeRequests.delete(key)
      event.sender.removeListener('destroyed', cancelForDestroyedRenderer)
    }
  })

  ipcMain.handle('transcription:cancel', (event, value: unknown) => {
    const requestId = z.uuid().parse(value)
    activeRequests.get(`${event.sender.id}:${requestId}`)?.cancel()
  })
}

/** Developer-only Electron-hosted smoke: the bundled main process, real worker, real engine and a fresh project. */
export async function runTranscriptionSmoke(mediaPath: string, media: ProjectMedia, modelId: ManagedModelId) {
  const durationUs = media.metadata?.durationUs
  if (!durationUs) throw new Error('Smoke media has no probed duration')
  const availability = await getService().availability(modelId)
  if (!availability.available) throw new Error(availability.reason)
  const device = availability.devices.find((entry) => entry !== 'cpu') ?? 'cpu'
  const handle = getService().start({ mediaPath, sourceRange: { startUs: 0, endUs: durationUs }, modelId, language: availability.autoDetectLanguage ? 'auto' : 'en', device, translateTo: null }, () => {})
  const outcome = await handle.outcome
  if (outcome.state !== 'succeeded') throw new Error(`Transcription ${outcome.state}: ${JSON.stringify(outcome)}`)
  const applied = applyTranscription(createProject(), outcome.value.transcript, outcome.value.run, null, randomUUID)
  return {
    parentPid: process.pid, nodeVersion: process.versions.node, electronVersion: process.versions.electron,
    engine: availability.engine, devices: availability.devices, gpuBackend: availability.gpuBackend,
    run: outcome.value.run, cues: applied.project.cues.map(({ startUs, endUs, text, timingSource, textSource, needsReview }) => ({ startUs, endUs, text, timingSource, textSource, needsReview })),
  }
}

