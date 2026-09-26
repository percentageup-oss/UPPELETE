import { z } from 'zod'
import { jobFailure } from '../src/core/jobs'
import type { CloudRecognizer } from './cloudTranscription'
import { collectWords, postAudio, recordedLanguage } from './cloudHttp'

export const OPENAI_ENGINE_ID = 'openai-api'
export const OPENAI_ENGINE_VERSION = 'v1'
/** The API accepts up to 25 MB per file; 16 kHz mono 16-bit WAV is about 1.9 MB per minute, so 10 minutes stays well inside it. */
export const OPENAI_MAX_CHUNK_US = 10 * 60 * 1_000_000

const responseSchema = z.object({
  language: z.string().optional(),
  words: z.array(z.object({ word: z.unknown(), start: z.unknown(), end: z.unknown() })).optional(),
})

/**
 * `POST /v1/audio/transcriptions` with `verbose_json` and word timestamp granularity. `language` is sent only for
 * `ml`/`en` (ISO-639-1); `auto` omits it so the model detects the language. Models that cannot return word timestamps
 * are rejected by the API and surface as a failed job rather than untimed captions.
 */
export function openaiRecognizer(apiKey: string, model: string): CloudRecognizer {
  return async (audioPath, options, signal) => {
    const fields: Record<string, string> = { model, response_format: 'verbose_json', 'timestamp_granularities[]': 'word' }
    if (options.language !== 'auto') fields.language = options.language
    const raw = await postAudio({
      provider: 'OpenAI', url: 'https://api.openai.com/v1/audio/transcriptions',
      headers: { Authorization: `Bearer ${apiKey}` }, audioPath, fields, signal,
    })
    const body = responseSchema.safeParse(raw)
    if (!body.success) throw jobFailure('MALFORMED_OUTPUT', 'OpenAI returned a response that did not match the expected shape.')
    const { words, droppedAnnotations } = collectWords((body.data.words ?? []).map((entry) => ({ text: entry.word, start: entry.start, end: entry.end })))
    return { words, usage: {}, droppedAnnotations, detectedLanguage: recordedLanguage(body.data.language) }
  }
}
