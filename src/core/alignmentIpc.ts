import { z } from 'zod'
import { jobSnapshotSchema, type JobSnapshot, type JobStructuredError } from './jobs'
import { mediaFingerprintSchema } from './media'
import { alignmentRequestSegmentSchema, type AlignedTranscript } from './transcription'
import type { AlignmentRun } from './model'

export const alignmentStartRequestSchema = z.strictObject({
  requestId: z.uuid(),
  fingerprint: mediaFingerprintSchema,
  segments: z.array(alignmentRequestSegmentSchema).min(1).max(100000),
})
export type AlignmentStartRequest = z.infer<typeof alignmentStartRequestSchema>
export type AlignmentSettingsStatus = { configured: boolean; source: 'environment' | 'keychain' }
export type AlignmentOutcome =
  | { state: 'succeeded'; transcript: AlignedTranscript; run: AlignmentRun }
  | { state: 'failed'; error: JobStructuredError }
  | { state: 'cancelled' }
export const alignmentProgressSchema = z.strictObject({ requestId: z.uuid(), job: jobSnapshotSchema })
export type AlignmentProgress = { requestId: string; job: JobSnapshot }
