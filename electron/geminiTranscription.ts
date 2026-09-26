import type { TranscriptionOptions } from '../src/core/transcription'
import type { MediaWorkerClient } from '../workers/media/client'
import { CloudTranscriptionAdapter, type CloudRecognizer } from './cloudTranscription'
import { GEMINI_TRANSCRIBE_MODEL, type GeminiLocale, type GeminiRecognizer } from './geminiRecognition'

export { segmentsFromWords } from './cloudTranscription'
export const GEMINI_ENGINE_ID = 'gemini-api'
export const GEMINI_ENGINE_VERSION = 'v1beta'
/**
 * Length bound per request; longer continuous speech is split at a short pause. Kept short because a 10-minute
 * video sent as one request came back with captions missing for whole stretches (suspected partial word timings;
 * unconfirmed against the run record).
 */
export const GEMINI_MAX_CHUNK_US = 3 * 60 * 1_000_000

/**
 * `auto` returns no locale at all. The transcription docs are explicit that `language_codes`
 * "omitted or empty" is what enables detection *and* code-switching — the model "handles
 * intra-sentence and inter-sentential code-switching without manual configuration", and Google's own
 * word-timestamp sample sends no `language_codes`. Pinning `['ml-IN', 'en-IN']` here was that manual
 * configuration: each speech chunk is its own request, so the model committed to one language per
 * chunk and wrote spoken English phonetically in Malayalam script ("സീ യു" for "See you").
 * `ml`/`en` still pin one locale — those options exist precisely to force one script, and the
 * Transcribe dialog says so.
 */
export function geminiLocales(language: TranscriptionOptions['language']): GeminiLocale[] {
  switch (language) {
    case 'ml': return ['ml-IN']
    case 'en': return ['en-IN']
    case 'ta': return ['ta-IN']
    case 'hi': return ['hi-IN']
    default: return []
  }
}

/** Adapts the locale-based Gemini recognizer to the provider-neutral cloud contract. */
export function geminiCloudRecognizer(recognize: GeminiRecognizer): CloudRecognizer {
  return (audioPath, options, signal) => recognize(audioPath, { locales: geminiLocales(options.language) }, signal)
}

export class GeminiTranscriptionAdapter extends CloudTranscriptionAdapter {
  constructor(worker: Pick<MediaWorkerClient, 'start'>, recognize: GeminiRecognizer, chunkDirectory: string, model: string = GEMINI_TRANSCRIBE_MODEL) {
    super(worker, geminiCloudRecognizer(recognize), chunkDirectory, { engineId: GEMINI_ENGINE_ID, engineVersion: GEMINI_ENGINE_VERSION, model, maxChunkUs: GEMINI_MAX_CHUNK_US })
  }
}
