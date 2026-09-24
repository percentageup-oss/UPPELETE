import { z } from 'zod'
import { jobSnapshotSchema, type JobSnapshot, type JobStructuredError } from '../core/jobs'
import { projectSchema } from '../core/model'
import { exportSettingsSchema } from './settings'

/** Renderer ↔ main export bridge, mirroring `transcriptionIpc.ts`. The renderer sends only the live
 * project — never a path. Main resolves every file the timeline plays through the fingerprints it
 * registered from successful probes this session, refusing by name any that is not registered, and
 * owns the native save dialog, the manifest/plan derivation and the job scheduler. */

export const exportStartRequestSchema = z.strictObject({
  requestId: z.uuid(),
  project: projectSchema,
  settings: exportSettingsSchema.optional(),
})
export type ExportStartRequest = z.infer<typeof exportStartRequestSchema>

export type ExportOutcome =
  | { state: 'succeeded'; path: string; durationUs: number; frameCount: number }
  | { state: 'failed'; error: JobStructuredError }
  | { state: 'cancelled' }

export const exportProgressSchema = z.strictObject({ requestId: z.uuid(), job: jobSnapshotSchema })
export type ExportProgress = { requestId: string; job: JobSnapshot }
