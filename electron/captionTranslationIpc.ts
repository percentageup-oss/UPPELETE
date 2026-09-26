import { ipcMain } from 'electron'
import { z } from 'zod'
import { captionTranslationRequestSchema, type CaptionTranslationOutcome, type CaptionTranslationResult } from '../src/core/captionTranslationIpc'
import { JobFailure, jobFailure, type JobStructuredError } from '../src/core/jobs'
import { GEMINI_TRANSLATE_BATCH_SIZE, GEMINI_TRANSLATE_MODEL, geminiTranslator, translateLines } from './geminiTranslation'
import { providerSecretStore } from './geminiKey'
import { getJobScheduler } from './jobs'

const activeRequests = new Map<string, { cancel(): void }>()

const failed = (message: string): CaptionTranslationOutcome => ({ state: 'failed', error: { code: 'INVALID_INPUT', message, retryable: false } })

function describeFailure(error: unknown): JobStructuredError {
  if (error instanceof JobFailure) return error.detail
  return jobFailure('INTERNAL_ERROR', 'Translation failed unexpectedly.', { diagnostic: (error instanceof Error ? error.message : String(error)).slice(0, 8192) }).detail
}

/** Translates caption text with Gemini. The key is read here in the main process only; the renderer never sends or receives it. */
export function registerCaptionTranslationIpc() {
  ipcMain.handle('captions:translate', async (event, value: unknown): Promise<CaptionTranslationOutcome> => {
    const request = captionTranslationRequestSchema.parse(value)
    const key = `${event.sender.id}:${request.requestId}`
    if (activeRequests.has(key)) return failed('This translation request is already running.')
    let apiKey: string | null
    try { apiKey = await providerSecretStore().load('gemini') } catch (error) { return failed(error instanceof Error ? error.message : 'The Gemini API key could not be read.') }
    if (!apiKey) return failed('Add a Gemini API key in Settings before translating captions.')
    const translator = geminiTranslator(apiKey)
    const batchesPerTarget = Math.ceil(request.lines.length / GEMINI_TRANSLATE_BATCH_SIZE)
    const total = batchesPerTarget * request.targets.length

    const handle = getJobScheduler().enqueue<CaptionTranslationResult[]>({
      kind: 'transcription',
      label: `Translate captions to ${request.targets.join(', ')}`.slice(0, 256),
      run: async (ctx) => {
        const results: CaptionTranslationResult[] = []
        for (const [targetIndex, target] of request.targets.entries()) {
          if (ctx.signal.aborted) throw jobFailure('CANCELLED', 'Translation was cancelled.')
          try {
            const translated = await translateLines(translator, request.lines, target, request.sourceLanguage, ctx.signal, (progress) => {
              if (progress.kind !== 'measured' || event.sender.isDestroyed()) return
              event.sender.send('captions:translate:progress', { requestId: request.requestId, completed: targetIndex * batchesPerTarget + progress.completed, total, target })
            })
            results.push({ target, ok: true, texts: translated.texts, model: GEMINI_TRANSLATE_MODEL, ...translated.usage })
          } catch (error) {
            // A failed language never discards the ones that worked; only a cancellation ends the whole run.
            if (ctx.signal.aborted || (error instanceof JobFailure && error.detail.code === 'CANCELLED')) throw jobFailure('CANCELLED', 'Translation was cancelled.')
            results.push({ target, ok: false, error: describeFailure(error) })
          }
        }
        return results
      },
    })
    activeRequests.set(key, handle)
    const cancelForDestroyedRenderer = () => handle.cancel()
    event.sender.once('destroyed', cancelForDestroyedRenderer)
    try {
      const outcome = await handle.outcome
      if (outcome.state === 'succeeded') return { state: 'succeeded', results: outcome.value }
      return outcome.state === 'failed' ? { state: 'failed', error: outcome.error } : { state: 'cancelled' }
    } finally {
      activeRequests.delete(key)
      event.sender.removeListener('destroyed', cancelForDestroyedRenderer)
    }
  })

  ipcMain.handle('captions:translate:cancel', (event, value: unknown) => {
    const requestId = z.uuid().parse(value)
    activeRequests.get(`${event.sender.id}:${requestId}`)?.cancel()
  })
}
