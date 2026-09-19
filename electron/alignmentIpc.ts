import { app, ipcMain } from 'electron'
import type { MediaFingerprint, ProjectMedia } from '../src/core/media'
import { alignmentStartRequestSchema, type AlignmentOutcome } from '../src/core/alignmentIpc'
import { getMediaWorker } from './mediaWorker'
import { getJobScheduler } from './jobs'
import { AlignmentService } from './alignmentService'
import { geminiSecretStore as secretStore } from './geminiKey'

let service: AlignmentService | undefined
const active = new Map<string, { cancel(): void }>()
const alignmentService = () => service ??= new AlignmentService({ worker: getMediaWorker(), scheduler: getJobScheduler(), temporaryRoot: app.getPath('temp') })
const failed = (message: string): AlignmentOutcome => ({ state: 'failed', error: { code: 'INVALID_INPUT', message, retryable: false } })

export function registerAlignmentIpc(lookupMedia: (fingerprint: MediaFingerprint) => { path: string; media: ProjectMedia } | undefined) {
  ipcMain.handle('alignment:settings-status', () => secretStore().status())
  ipcMain.handle('alignment:settings-save', async (_event, value: unknown) => {
    if (typeof value !== 'string') throw new Error('Invalid API key.')
    await secretStore().save(value); return secretStore().status()
  })
  ipcMain.handle('alignment:settings-remove', async () => { await secretStore().remove(); return secretStore().status() })
  ipcMain.handle('alignment:start', async (event, value: unknown): Promise<AlignmentOutcome> => {
    const request = alignmentStartRequestSchema.parse(value)
    const registered = lookupMedia(request.fingerprint)
    if (!registered) return failed('Open or relink this media in the current session before aligning it.')
    const mediaDurationUs = registered.media.metadata?.durationUs
    if (!mediaDurationUs) return failed('Alignment needs a verified media duration.')
    const apiKey = await secretStore().load()
    if (!apiKey) return failed('Add a Gemini API key in Settings before aligning audio.')
    const key = `${event.sender.id}:${request.requestId}`
    if (active.has(key)) return failed('This alignment request is already running.')
    const handle = alignmentService().start({ mediaPath: registered.path, mediaDurationUs, apiKey, segments: request.segments },
      (job) => { if (!event.sender.isDestroyed()) event.sender.send('alignment:progress', { requestId: request.requestId, job }) })
    active.set(key, handle)
    const destroyed = () => handle.cancel(); event.sender.once('destroyed', destroyed)
    try {
      const outcome = await handle.outcome
      if (outcome.state === 'succeeded') return { state: 'succeeded', ...outcome.value }
      return outcome.state === 'failed' ? { state: 'failed', error: outcome.error } : { state: 'cancelled' }
    } finally { active.delete(key); event.sender.removeListener('destroyed', destroyed) }
  })
  ipcMain.handle('alignment:cancel', (event, value: unknown) => {
    if (typeof value === 'string') active.get(`${event.sender.id}:${value}`)?.cancel()
  })
}
