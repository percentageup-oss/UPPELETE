import { z } from 'zod'
import { jobSnapshotSchema, type JobSnapshot, type JobStructuredError } from './jobs'
import { mediaFingerprintSchema } from './media'
import type { TranscriptionRun } from './model'
import type { TranslationWithUsage } from './transcriptionApply'
import { modelIdSchema, type ManagedModelId } from './modelCatalog'
import { languageCodeSchema, translationTargetSchema, type TranslationTarget, type SourceTimedTranscript } from './transcription'
import { CLOUD_LANGUAGE_CODES, cloudModelIdSchema, cloudProviderIdSchema } from './transcriptionProviders'

/** Renderer ↔ main transcription bridge. The renderer sends IDs and choices only — never paths, flags or executables. */

export const transcriptionDeviceSchema = z.enum(['cpu', 'metal', 'cuda', 'vulkan'])
export type TranscriptionDevice = z.infer<typeof transcriptionDeviceSchema>

export const transcriptionEngineSchema = z.enum(['whisper', 'gemini', 'openai', 'elevenlabs'])
export type TranscriptionEngine = z.infer<typeof transcriptionEngineSchema>

// Optional Gemini translation of the recognized text, offered for either engine: up to five unique targets, each one
// text-only call after a single audio pass. The main process supplies the stored key whenever this is non-empty.
export const MAX_TRANSLATION_TARGETS = 5
const translateToSchema = z.array(translationTargetSchema).max(MAX_TRANSLATION_TARGETS)
  .refine((targets) => new Set(targets).size === targets.length, 'Translation targets must be unique')

export const MIN_TRANSCRIPTION_RANGE_US = 1_000_000

/** One stretch of the video to transcribe: source time of the media identified by `fingerprint`, not sequence time. */
export const transcriptionRangeSchema = z.strictObject({ startUs: z.number().int().min(0), endUs: z.number().int().positive() })
  .refine((range) => range.endUs > range.startUs, 'Range end must follow its start')
export type TranscriptionRange = z.infer<typeof transcriptionRangeSchema>

export const transcriptionStartRequestSchema = z.discriminatedUnion('engine', [
  z.strictObject({
    engine: z.literal('whisper'),
    requestId: z.uuid(),
    fingerprint: mediaFingerprintSchema,
    modelId: modelIdSchema,
    language: z.union([languageCodeSchema, z.literal('auto')]),
    device: transcriptionDeviceSchema,
    translateTo: translateToSchema,
    range: transcriptionRangeSchema.optional(),
  }),
  // Optional cloud engines: the main process supplies the stored key; the renderer never sends or receives it.
  // An absent model means the provider's catalog default.
  z.strictObject({
    engine: cloudProviderIdSchema,
    requestId: z.uuid(),
    fingerprint: mediaFingerprintSchema,
    model: cloudModelIdSchema.optional(),
    language: z.enum(['auto', ...CLOUD_LANGUAGE_CODES]),
    translateTo: translateToSchema,
    range: transcriptionRangeSchema.optional(),
  }),
])
export type TranscriptionStartRequest = z.infer<typeof transcriptionStartRequestSchema>

export type TranscriptionAvailability =
  | {
    available: true
    engine: { id: string; version: string }
    modelId: ManagedModelId
    languages: string[]
    autoDetectLanguage: boolean
    devices: TranscriptionDevice[]
    gpuBackend: string | null
    systemInfo: string | null
  }
  | { available: false; reason: string }

/** A target language that could not be translated; the transcript and the other languages are kept. */
export type TranslationFailure = { target: TranslationTarget; message: string }

export type TranscriptionOutcome =
  | { state: 'succeeded'; transcript: SourceTimedTranscript; run: TranscriptionRun; translations: TranslationWithUsage[]; translationFailures: TranslationFailure[] }
  | { state: 'failed'; error: JobStructuredError }
  | { state: 'cancelled' }

export const transcriptionProgressSchema = z.strictObject({ requestId: z.uuid(), job: jobSnapshotSchema })
export type TranscriptionProgress = { requestId: string; job: JobSnapshot }
