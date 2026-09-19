import { z } from 'zod'
import { jobSnapshotSchema, type JobSnapshot, type JobStructuredError } from '../core/jobs'
import { mediaFingerprintSchema } from '../core/media'
import { projectSchema } from '../core/model'

/** Renderer ↔ main export bridge, mirroring `transcriptionIpc.ts`. The renderer sends the live
 * project (captions/style are editor state main does not otherwise see) and a fingerprint that
 * must already be registered from a successful probe in this session — never a path. Main owns
 * the native save dialog, the manifest/plan derivation and the job scheduler. */

export const exportStartRequestSchema = z.strictObject({
  requestId: z.uuid(),
  fingerprint: mediaFingerprintSchema,
  project: projectSchema,
})
export type ExportStartRequest = z.infer<typeof exportStartRequestSchema>

export type ExportOutcome =
  | { state: 'succeeded'; path: string; durationUs: number; frameCount: number }
  | { state: 'failed'; error: JobStructuredError }
  | { state: 'cancelled' }

export const exportProgressSchema = z.strictObject({ requestId: z.uuid(), job: jobSnapshotSchema })
export type ExportProgress = { requestId: string; job: JobSnapshot }
