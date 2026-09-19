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
  const { words, usage } = await geminiRecognizer(apiKey, 'align')(audioPath, ['ml-IN', 'en-IN'], signal)
  return { output: matchRecognizedWords(segments, words, 'gemini-api', GEMINI_ALIGNMENT_MODEL), usage }
}
