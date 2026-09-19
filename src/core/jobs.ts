import { z } from 'zod'

/**
 * Shared job vocabulary for anything long-running and cancellable: transcription,
 * alignment and (later) export. Pure and renderer-safe so it can eventually cross
 * the preload bridge unchanged, mirroring how `workers/media/protocol.ts` is the
 * source of truth for the media-worker wire contract.
 */

export const jobKindSchema = z.enum(['transcription', 'alignment', 'export'])
export type JobKind = z.infer<typeof jobKindSchema>

/** Every kind currently defined is resource-heavy; T1 arbitrates all of them together. */
export const JOB_RESOURCE_CLASS: Record<JobKind, 'heavy'> = {
  transcription: 'heavy',
  alignment: 'heavy',
  export: 'heavy',
}

export const jobStateSchema = z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled'])
export type JobState = z.infer<typeof jobStateSchema>

export const TERMINAL_STATES: readonly JobState[] = ['succeeded', 'failed', 'cancelled']

const TRANSITIONS: Record<JobState, readonly JobState[]> = {
  queued: ['running', 'cancelled', 'failed'],
  running: ['succeeded', 'failed', 'cancelled'],
  succeeded: [],
  failed: [],
  cancelled: [],
}

export function canTransition(from: JobState, to: JobState): boolean {
  return TRANSITIONS[from].includes(to)
}

const microseconds = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const positiveInt = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)

export const jobProgressPhaseSchema = z.enum([
  'loading-model',
  'extracting-audio',
  'recognizing',
  'translating',
  'aligning',
  'rendering',
  'encoding',
])
export type JobProgressPhase = z.infer<typeof jobProgressPhaseSchema>

export const jobProgressSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('indeterminate'), phase: jobProgressPhaseSchema }),
  z.strictObject({
    kind: z.literal('measured'),
    phase: jobProgressPhaseSchema,
    completed: microseconds,
    total: positiveInt,
    unit: z.enum(['sourceUs', 'items', 'frames']),
  }).refine((p) => p.completed <= p.total, 'Progress exceeds total'),
])
export type JobProgress = z.infer<typeof jobProgressSchema>

/**
 * A later progress report that claims to have completed less than an earlier one
 * for the same phase/unit is not honest progress; callers must reject it rather
 * than let a UI progress bar visibly rewind.
 */
export function isProgressRegression(previous: JobProgress | null, next: JobProgress): boolean {
  if (!previous) return false
  if (previous.kind !== 'measured' || next.kind !== 'measured') return false
  if (previous.phase !== next.phase || previous.unit !== next.unit) return false
  return next.completed < previous.completed
}

export const jobErrorSchema = z.strictObject({
  code: z.enum([
    'INVALID_INPUT',
    'INVALID_CAPABILITIES',
    'UNSUPPORTED_LANGUAGE',
    'UNSUPPORTED_OPTION',
    'MODEL_UNAVAILABLE',
    'BACKEND_FAILED',
    'MALFORMED_OUTPUT',
    'UNEXPECTED_SCRIPT',
    'INVALID_PROGRESS',
    'COMMIT_FAILED',
    'SCHEDULER_CLOSED',
    'CANCELLED',
    'INTERNAL_ERROR',
  ]),
  message: z.string().min(1).max(2048),
  retryable: z.boolean(),
  diagnostic: z.string().max(8192).optional(),
})
export type JobStructuredError = z.infer<typeof jobErrorSchema>

export class JobFailure extends Error {
  readonly detail: JobStructuredError
  constructor(detail: JobStructuredError) {
    super(detail.message)
    this.name = 'JobFailure'
    this.detail = detail
  }
}

export function jobFailure(code: JobStructuredError['code'], message: string, extra: Partial<JobStructuredError> = {}): JobFailure {
  return new JobFailure(jobErrorSchema.parse({ code, message, retryable: false, ...extra }))
}

export const jobSnapshotSchema = z.strictObject({
  id: z.string().min(1),
  kind: jobKindSchema,
  label: z.string().min(1).max(256),
  state: jobStateSchema,
  cancelRequested: z.boolean(),
  progress: jobProgressSchema.nullable(),
  error: jobErrorSchema.nullable(),
  queuedAtMs: z.number().finite(),
  startedAtMs: z.number().finite().nullable(),
  finishedAtMs: z.number().finite().nullable(),
})
export type JobSnapshot = z.infer<typeof jobSnapshotSchema>
