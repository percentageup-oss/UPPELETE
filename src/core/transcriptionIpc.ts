import { z } from 'zod'
import { jobSnapshotSchema, type JobSnapshot, type JobStructuredError } from './jobs'
import { mediaFingerprintSchema } from './media'
import type { TranscriptionRun } from './model'
import { modelIdSchema, type ManagedModelId } from './modelCatalog'
import { languageCodeSchema, type SourceTimedTranscript, type TranslatedTranscript } from './transcription'
import { CLOUD_LANGUAGE_CODES, cloudModelIdSchema, cloudProviderIdSchema } from './transcriptionProviders'

/** Renderer ↔ main transcription bridge. The renderer sends IDs and choices only — never paths, flags or executables. */

export const transcriptionDeviceSchema = z.enum(['cpu', 'metal', 'cuda', 'vulkan'])
export type TranscriptionDevice = z.infer<typeof transcriptionDeviceSchema>

export const transcriptionEngineSchema = z.enum(['whisper', 'gemini', 'openai', 'elevenlabs'])
export type TranscriptionEngine = z.infer<typeof transcriptionEngineSchema>

// Optional Gemini translation of the recognized text, offered for either engine. The main process
// supplies the stored key whenever this is non-null, exactly as it does for the Gemini engine.
const translateToSchema = z.union([languageCodeSchema, z.null()])

export const transcriptionStartRequestSchema = z.discriminatedUnion('engine', [
  z.strictObject({
    engine: z.literal('whisper'),
    requestId: z.uuid(),
    fingerprint: mediaFingerprintSchema,
    modelId: modelIdSchema,
    language: z.union([languageCodeSchema, z.literal('auto')]),
    device: transcriptionDeviceSchema,
    translateTo: translateToSchema,
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

export type TranscriptionOutcome =
  | { state: 'succeeded'; transcript: SourceTimedTranscript; run: TranscriptionRun; translation: TranslatedTranscript | null }
  | { state: 'failed'; error: JobStructuredError }
  | { state: 'cancelled' }

export const transcriptionProgressSchema = z.strictObject({ requestId: z.uuid(), job: jobSnapshotSchema })
export type TranscriptionProgress = { requestId: string; job: JobSnapshot }
