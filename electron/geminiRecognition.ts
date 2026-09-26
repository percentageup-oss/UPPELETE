import { GoogleGenAI } from '@google/genai'
import { jobFailure } from '../src/core/jobs'
import type { RecognizedWord } from '../src/core/alignment'

export const GEMINI_TRANSCRIBE_MODEL = 'gemini-3.5-transcribe'
export type GeminiUsage = { inputTokens?: number; outputTokens?: number }
/** `droppedAnnotations` counts model output that could not become a timed word (wrong annotation
 * type, missing text, or an invalid/non-positive offset) — visible instead of silently vanishing. */
export type GeminiRecognition = { words: RecognizedWord[]; usage: GeminiUsage; droppedAnnotations: number }
/** BCP-47 hints passed to Gemini. */
export type GeminiLocale = 'ml-IN' | 'en-IN' | 'ta-IN' | 'hi-IN'
/**
 * `locales`: empty lets Gemini detect the language and switch between languages mid-sentence, rather
 * than biasing it toward a fixed set. The transcription docs document `language_codes` as "If omitted
 * or empty ([]), the model automatically detects the language and handles code-switching", and the
 * production default is now empty for mixed speech (see `geminiLocales`).
 * `systemInstruction`/`customVocabulary` are unmeasured knobs, wired here only so
 * `scripts/gemini-recognition-probe.ts` can measure them against a real code-switched clip before
 * either becomes a production default (see docs/decisions/evidence/).
 */
export type GeminiRecognitionOptions = {
  locales: readonly GeminiLocale[]
  systemInstruction?: string
  customVocabulary?: readonly string[]
}
export type GeminiRecognizer = (audioPath: string, options: GeminiRecognitionOptions, signal: AbortSignal) => Promise<GeminiRecognition>

function offsetUs(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?s$/.test(value)) return null
  const result = Math.round(Number(value.slice(0, -1)) * 1_000_000)
  return Number.isSafeInteger(result) && result >= 0 ? result : null
}

/**
 * Uploads one WAV, requests verbatim word timestamps with response storage disabled, and best-effort deletes the
 * upload. Returns only timed word annotations (audio-relative microseconds), sorted; untimed text is ignored.
 */
export function geminiRecognizer(apiKey: string, action: 'align' | 'transcribe', model: string = GEMINI_TRANSCRIBE_MODEL): GeminiRecognizer {
  return async (audioPath, options, signal) => {
    const ai = new GoogleGenAI({ apiKey })
    let uploadedName: string | undefined
    try {
      const uploaded = await ai.files.upload({ file: audioPath, config: { mimeType: 'audio/wav', abortSignal: signal } })
      uploadedName = uploaded.name
      if (!uploaded.uri) throw new Error('Gemini did not return an uploaded audio URI.')
      const response = await ai.interactions.create({
        model,
        input: [{ type: 'audio', uri: uploaded.uri, mime_type: 'audio/wav' }],
        generation_config: { transcription_config: {
          // Sending an empty list is not the same as omitting the key: the SDK only auto-detects
          // when the key itself is absent.
          ...(options.locales.length ? { language_codes: [...options.locales] } : {}),
          ...(options.customVocabulary?.length ? { custom_vocabulary: [...options.customVocabulary] } : {}),
          mode: { type: 'verbatim', timestamp_granularities: ['word'] },
        } },
        ...(options.systemInstruction ? { system_instruction: options.systemInstruction } : {}),
        store: false,
      }, { signal })
      const words: RecognizedWord[] = []
      let droppedAnnotations = 0
      for (const step of response.steps ?? []) {
        if (step.type !== 'model_output') continue
        for (const content of step.content ?? []) {
          if (content.type !== 'text') continue
          for (const annotation of content.annotations ?? []) {
            if (annotation.type !== 'word_info' || !annotation.text) { droppedAnnotations += 1; continue }
            const startUs = offsetUs(annotation.start_offset), endUs = offsetUs(annotation.end_offset)
            if (startUs !== null && endUs !== null && endUs > startUs) words.push({ text: annotation.text, startUs, endUs })
            else droppedAnnotations += 1
          }
        }
      }
      words.sort((a, b) => a.startUs - b.startUs || a.endUs - b.endUs)
      return { words, usage: { inputTokens: response.usage?.total_input_tokens, outputTokens: response.usage?.total_output_tokens }, droppedAnnotations }
    } catch (error) {
      const verb = action === 'align' ? 'Alignment' : 'Transcription'
      if (signal.aborted) throw jobFailure('CANCELLED', `${verb} was cancelled.`)
      const diagnostic = error instanceof Error ? error.message : String(error)
      throw jobFailure('BACKEND_FAILED', `Gemini could not ${action} this audio. Check the API key and connection, then try again.`, { diagnostic: diagnostic.slice(0, 8192), retryable: true })
    } finally {
      if (uploadedName) {
        try { await ai.files.delete({ name: uploadedName }) } catch { /* provider files also expire; deletion is best-effort */ }
      }
    }
  }
}
