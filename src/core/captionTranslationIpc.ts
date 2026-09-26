import { z } from 'zod'
import type { JobStructuredError } from './jobs'
import { languageCodeSchema, translationTargetSchema, type TranslationTarget } from './transcription'

/**
 * Renderer ↔ main bridge for translating captions that already exist. Only caption text crosses it: no media,
 * no key. The main process loads the stored Gemini key itself.
 */

export const MAX_TRANSLATE_TARGETS = 5
export const MAX_TRANSLATE_LINES = 5000
export const MAX_TRANSLATE_LINE_LENGTH = 2000

export const captionTranslationRequestSchema = z.strictObject({
  requestId: z.uuid(),
  sourceLanguage: languageCodeSchema.nullable(),
  targets: z.array(translationTargetSchema).min(1).max(MAX_TRANSLATE_TARGETS)
    .refine((targets) => new Set(targets).size === targets.length, 'Each target language can be listed once'),
  lines: z.array(z.string().min(1).max(MAX_TRANSLATE_LINE_LENGTH)).min(1).max(MAX_TRANSLATE_LINES),
})
export type CaptionTranslationRequest = z.infer<typeof captionTranslationRequestSchema>

export type CaptionTranslationResult =
  | { target: TranslationTarget; ok: true; texts: string[]; model: string; inputTokens?: number; outputTokens?: number }
  | { target: TranslationTarget; ok: false; error: JobStructuredError }

export type CaptionTranslationOutcome =
  | { state: 'succeeded'; results: CaptionTranslationResult[] }
  | { state: 'failed'; error: JobStructuredError }
  | { state: 'cancelled' }

export const captionTranslationProgressSchema = z.strictObject({
  requestId: z.uuid(),
  /** Batches finished across every target, out of all batches. */
  completed: z.number().int().nonnegative(),
  total: z.number().int().positive(),
  /** The language being translated right now. */
  target: translationTargetSchema,
})
export type CaptionTranslationProgress = z.infer<typeof captionTranslationProgressSchema>
