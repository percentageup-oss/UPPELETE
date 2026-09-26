import { z } from 'zod'
import { jobFailure } from '../src/core/jobs'
import type { CloudRecognizer } from './cloudTranscription'
import { collectWords, postAudio, recordedLanguage } from './cloudHttp'

export const ELEVENLABS_ENGINE_ID = 'elevenlabs-api'
export const ELEVENLABS_ENGINE_VERSION = 'v1'
/** Uploads are allowed up to several GB; 20-minute sections keep each request small and progress visible. */
export const ELEVENLABS_MAX_CHUNK_US = 20 * 60 * 1_000_000

const responseSchema = z.object({
  language_code: z.string().optional(),
  words: z.array(z.object({ text: z.unknown(), start: z.unknown(), end: z.unknown(), type: z.string().optional() })).optional(),
})

/**
 * `POST /v1/speech-to-text` (Scribe) with word timestamps, audio events and diarization off. `language_code` is sent
 * only for `ml`/`en`; `auto` omits it so the model detects the language. Only `word` entries become timed words;
 * `spacing` entries are ignored and `audio_event` entries such as "(laughter)" are counted as dropped, never inserted
 * into caption text.
 */
export function elevenlabsRecognizer(apiKey: string, model: string): CloudRecognizer {
  return async (audioPath, options, signal) => {
    const fields: Record<string, string> = { model_id: model, timestamps_granularity: 'word', tag_audio_events: 'false', diarize: 'false' }
    if (options.language !== 'auto') fields.language_code = options.language
    const raw = await postAudio({
      provider: 'ElevenLabs', url: 'https://api.elevenlabs.io/v1/speech-to-text',
      headers: { 'xi-api-key': apiKey }, audioPath, fields, signal,
    })
    const body = responseSchema.safeParse(raw)
    if (!body.success) throw jobFailure('MALFORMED_OUTPUT', 'ElevenLabs returned a response that did not match the expected shape.')
    const entries = body.data.words ?? []
    const timed = entries.filter((entry) => entry.type === undefined || entry.type === 'word')
    const { words, droppedAnnotations } = collectWords(timed)
    const audioEvents = entries.filter((entry) => entry.type === 'audio_event').length
    return { words, usage: {}, droppedAnnotations: droppedAnnotations + audioEvents, detectedLanguage: recordedLanguage(body.data.language_code) }
  }
}
