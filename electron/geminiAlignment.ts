import { matchRecognizedWords } from '../src/core/alignment'
import type { AudioRelativeAlignmentSegment, RawAlignmentOutput } from '../src/core/transcription'
import { GEMINI_TRANSCRIBE_MODEL, geminiRecognizer, type GeminiUsage } from './geminiRecognition'

export const GEMINI_ALIGNMENT_MODEL = GEMINI_TRANSCRIBE_MODEL
export type { GeminiUsage }

export async function alignWithGemini(
  apiKey: string,
  audioPath: string,
  segments: readonly AudioRelativeAlignmentSegment[],
  signal: AbortSignal,
): Promise<{ output: RawAlignmentOutput; usage: GeminiUsage }> {
  // No locale hint, for the reason `geminiLocales` documents: pinning ml-IN/en-IN made the model
  // transliterate spoken English into Malayalam script, and `alignmentKey` only lowercases and strips
  // punctuation — a recognized "സീ" can never match the imported SRT's "See", so every English token
  // fell back to estimated timing. Detection keeps English in Latin script, where it can match.
  const { words, usage } = await geminiRecognizer(apiKey, 'align')(audioPath, { locales: [] }, signal)
  return { output: matchRecognizedWords(segments, words, 'gemini-api', GEMINI_ALIGNMENT_MODEL), usage }
}
