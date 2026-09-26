import { GoogleGenAI } from '@google/genai'
import { z } from 'zod'
import { jobFailure, type JobProgress } from '../src/core/jobs'
import { checkTranscriptScript } from '../src/core/scriptCheck'
import { validateTranslationOutput, type LanguageCode, type TranslationTarget, type SourceTimedTranscript, type TranslatedTranscript } from '../src/core/transcription'
import { isRomanizedTarget, romanizedBase } from '../src/core/translationLanguages'
import type { GeminiUsage } from './geminiRecognition'

export const GEMINI_TRANSLATE_MODEL = 'gemini-3.8-flash'
/** Caption lines translated per request; keeps prompts small and lets progress advance visibly on long transcripts. */
export const GEMINI_TRANSLATE_BATCH_SIZE = 60

export type GeminiTranslator = (
  texts: readonly string[],
  target: TranslationTarget,
  sourceLanguage: LanguageCode | null,
  signal: AbortSignal,
) => Promise<{ texts: string[]; usage: GeminiUsage }>

const responseJsonSchema = {
  type: 'object',
  properties: {
    segments: {
      type: 'array',
      items: {
        type: 'object',
        properties: { i: { type: 'integer' }, text: { type: 'string' } },
        required: ['i', 'text'],
      },
    },
  },
  required: ['segments'],
}
const responseBodySchema = z.strictObject({ segments: z.array(z.strictObject({ i: z.number().int(), text: z.string() })) })

/**
 * One Gemini text-generation call translating up to `GEMINI_TRANSLATE_BATCH_SIZE` caption lines
 * at once. Every input line must come back exactly once, identified by its index, so a partial
 * or reordered response is rejected rather than silently misaligned against caption timing.
 */
export function geminiTranslator(apiKey: string): GeminiTranslator {
  return async (texts, target, sourceLanguage, signal) => {
    const ai = new GoogleGenAI({ apiKey })
    try {
      const response = await ai.models.generateContent({
        model: GEMINI_TRANSLATE_MODEL,
        contents: JSON.stringify({ segments: texts.map((text, i) => ({ i, text })) }),
        config: {
          abortSignal: signal,
          temperature: 0,
          responseMimeType: 'application/json',
          responseJsonSchema,
          systemInstruction: isRomanizedTarget(target)
            ? [
              `Transliterate each subtitle line's "text" into ${romanizedBase(target) === 'hi' ? 'Hindi' : 'Malayalam'} written in Latin (English) letters, as people type it in chat (${target === 'hi-latn' ? 'Hinglish' : 'Manglish'}). Do NOT translate the meaning.`,
              `Keep every word that is already English (Latin script) exactly as written. Do not translate ${romanizedBase(target) === 'hi' ? 'Hindi' : 'Malayalam'} words into English.`,
              'Use simple, common spellings a native reader expects; no diacritics, no IPA, no long-vowel marks. Keep numbers, names and punctuation style.',
              'Return exactly one output line per input line, in the same order, each keeping its original "i".',
              'Never merge, split, add or drop lines, and never add commentary or notes.',
            ].join(' ')
            : [
              `Translate each subtitle line's "text" into ${target}${sourceLanguage ? ` from ${sourceLanguage}` : ''}.`,
              'Return exactly one output line per input line, in the same order, each keeping its original "i".',
              'Translate meaning naturally for subtitles; preserve names, numbers and punctuation style.',
              'Never merge, split, add or drop lines, and never add commentary or notes.',
            ].join(' '),
        },
      })
      const raw = response.text
      if (!raw) throw new Error('Gemini returned no translation text.')
      let parsed: unknown
      try { parsed = JSON.parse(raw) } catch { throw new Error('Gemini did not return valid JSON.') }
      const body = responseBodySchema.safeParse(parsed)
      if (!body.success) throw new Error('Gemini translation response did not match the expected shape.')
      const byIndex = new Map(body.data.segments.map((segment) => [segment.i, segment.text]))
      if (byIndex.size !== body.data.segments.length) throw new Error('Gemini answered the same line index more than once.')
      const ordered = texts.map((_, i) => {
        const value = byIndex.get(i)
        if (value === undefined) throw new Error(`Gemini did not answer line ${i}.`)
        return value
      })
      return {
        texts: ordered,
        usage: { inputTokens: response.usageMetadata?.promptTokenCount, outputTokens: response.usageMetadata?.candidatesTokenCount },
      }
    } catch (error) {
      if (signal.aborted) throw jobFailure('CANCELLED', 'Translation was cancelled.')
      const diagnostic = error instanceof Error ? error.message : String(error)
      throw jobFailure('BACKEND_FAILED', 'Gemini could not translate this transcript. Check the API key and connection, then try again.', { diagnostic: diagnostic.slice(0, 8192), retryable: true })
    }
  }
}

/**
 * Translates caption lines in fixed-size batches, reporting measured progress per batch, then runs the same
 * wrong-script sanity check recognition uses against the requested target language. Text only: no timing,
 * no audio. Shared by transcript translation and by translating captions that already exist.
 */
export async function translateLines(
  translator: GeminiTranslator,
  texts: readonly string[],
  target: TranslationTarget,
  sourceLanguage: LanguageCode | null,
  signal: AbortSignal,
  onProgress?: (value: JobProgress) => void,
): Promise<{ texts: string[]; usage: GeminiUsage }> {
  if (!texts.length) return { texts: [], usage: {} }
  const batches: string[][] = []
  for (let start = 0; start < texts.length; start += GEMINI_TRANSLATE_BATCH_SIZE) batches.push(texts.slice(start, start + GEMINI_TRANSLATE_BATCH_SIZE))

  const translated: string[] = []
  let inputTokens = 0, outputTokens = 0
  onProgress?.({ kind: 'measured', phase: 'translating', completed: 0, total: batches.length, unit: 'items' })
  for (const [index, batch] of batches.entries()) {
    const result = await translator(batch, target, sourceLanguage, signal)
    if (result.texts.length !== batch.length) throw jobFailure('MALFORMED_OUTPUT', 'Gemini returned a different number of translated lines than were sent.')
    translated.push(...result.texts)
    inputTokens += result.usage.inputTokens ?? 0
    outputTokens += result.usage.outputTokens ?? 0
    onProgress?.({ kind: 'measured', phase: 'translating', completed: index + 1, total: batches.length, unit: 'items' })
  }

  const scriptCheck = checkTranscriptScript(target, translated)
  if (!scriptCheck.ok) {
    throw jobFailure('UNEXPECTED_SCRIPT',
      `Translation to "${target}" was requested, but the returned text is mostly ${scriptCheck.dominantScript} script, not ${scriptCheck.expectedScript}. Try translating again, or expect to correct this section by hand.`,
      { diagnostic: `Expected ${scriptCheck.expectedScript}, got ${scriptCheck.dominantScript} (${Math.round(scriptCheck.dominantShare * 100)}%): ${scriptCheck.sample}`.slice(0, 8192), retryable: true })
  }
  return { texts: translated, usage: { inputTokens, outputTokens } }
}

/**
 * Translates a validated, source-timed transcript's segment texts, then validates the assembled result
 * against the source transcript (same segment count, clean text).
 */
export async function translateTranscript(
  translator: GeminiTranslator,
  transcript: SourceTimedTranscript,
  target: TranslationTarget,
  signal: AbortSignal,
  onProgress?: (value: JobProgress) => void,
): Promise<{ translation: TranslatedTranscript; usage: GeminiUsage }> {
  const texts = transcript.segments.map((segment) => segment.text)
  if (!texts.length) return { translation: validateTranslationOutput(transcript, target, GEMINI_TRANSLATE_MODEL, { segments: [] }), usage: {} }
  const result = await translateLines(translator, texts, target, transcript.language, signal, onProgress)
  const translation = validateTranslationOutput(transcript, target, GEMINI_TRANSLATE_MODEL, { segments: result.texts.map((text) => ({ text })) })
  return { translation, usage: result.usage }
}
