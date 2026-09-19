import { randomUUID } from 'node:crypto'
import {
  JOB_RESOURCE_CLASS, JobFailure, canTransition, jobFailure, jobProgressSchema, isProgressRegression,
  type JobKind, type JobProgress, type JobSnapshot, type JobState, type JobStructuredError,
} from '../src/core/jobs'
import { MediaWorkerError } from '../workers/media/protocol'

/**
 * Main-owned job queue and resource arbitration. No Electron import here, so it is testable
 * directly in Node: this is the piece `MEDIA_WORKER.md` deferred to T1 ("T1 will add queues
 * and heavy-job resource arbitration"). Every currently defined job kind is resource-heavy
 * (`JOB_RESOURCE_CLASS`), so by default only one heavy job runs at a time — transcription
 * and export never compete for the machine unless a caller explicitly raises
 * `heavyConcurrency`. Queue order is strict FIFO: a blocked heavy job is never overtaken by
 * a later one.
 */

export type JobContext = {
  id: string
  signal: AbortSignal
  reportProgress(value: JobProgress): void
  /**
   * Gate an irreversible mutation (a project commit) behind this. Returns false — and
   * leaves any pending cancellation live — if cancellation was already requested; a caller
   * that gets `false` must not mutate anything. Once it returns true, a later cancel() is a
   * no-op for this job: a commit in progress is never retroactively relabeled cancelled.
   */
  enterCommit(): boolean
}

export type JobOutcome<T> =
  | { state: 'succeeded'; value: T }
  | { state: 'failed'; error: JobStructuredError }
  | { state: 'cancelled' }

export type JobHandle<T> = {
  id: string
  cancel(): void
  /** Never rejects; the terminal state and, on success, the committed value. */
  outcome: Promise<JobOutcome<T>>
}

type EnqueueOptions<T> = {
  kind: JobKind
  label: string
  run(ctx: JobContext): Promise<T>
}

type InternalJob = {
  id: string
  kind: JobKind
  label: string
  state: JobState
  cancelRequested: boolean
  commitEntered: boolean
  progress: JobProgress | null
  error: JobStructuredError | null
  pendingProgressFailure: JobStructuredError | null
  queuedAtMs: number
  startedAtMs: number | null
  finishedAtMs: number | null
  controller: AbortController
  settled: Promise<void>
  pendingRun: (ctx: JobContext) => Promise<unknown>
  resolveOutcome: (value: JobOutcome<unknown>) => void
}

export type SchedulerOptions = { heavyConcurrency?: number; now?: () => number }

function isCancellationSignal(error: unknown): boolean {
  return (error instanceof JobFailure && error.detail.code === 'CANCELLED')
    || (error instanceof MediaWorkerError && error.detail.code === 'CANCELLED')
}

function describeError(error: unknown): JobStructuredError {
  if (error instanceof JobFailure) return error.detail
  if (error instanceof MediaWorkerError) {
    return jobFailure('BACKEND_FAILED', error.detail.message, { retryable: error.detail.retryable, diagnostic: error.detail.diagnostic }).detail
  }
  const message = error instanceof Error ? error.message : String(error)
  return jobFailure('INTERNAL_ERROR', 'The job failed unexpectedly.', { diagnostic: message.slice(0, 8192) }).detail
}

export class JobScheduler {
  private readonly heavyConcurrency: number
  private readonly now: () => number
  private readonly jobs = new Map<string, InternalJob>()
  private readonly queue: string[] = []
  private runningHeavy = 0
  private closed = false
  private readonly listeners = new Set<(snapshot: JobSnapshot) => void>()

  constructor(options: SchedulerOptions = {}) {
    this.heavyConcurrency = options.heavyConcurrency ?? 1
    this.now = options.now ?? Date.now
  }

  enqueue<T>(options: EnqueueOptions<T>): JobHandle<T> {
    if (this.closed) throw jobFailure('SCHEDULER_CLOSED', 'The job scheduler is closed.')
    const id = randomUUID()
    let resolveOutcome!: (value: JobOutcome<T>) => void
    const outcome = new Promise<JobOutcome<T>>((resolve) => { resolveOutcome = resolve })
    const job: InternalJob = {
      id, kind: options.kind, label: options.label, state: 'queued', cancelRequested: false, commitEntered: false,
      progress: null, error: null, pendingProgressFailure: null,
      queuedAtMs: this.now(), startedAtMs: null, finishedAtMs: null,
      controller: new AbortController(), settled: Promise.resolve(),
      pendingRun: options.run as (ctx: JobContext) => Promise<unknown>,
      resolveOutcome: resolveOutcome as (value: JobOutcome<unknown>) => void,
    }
    this.jobs.set(id, job)
    this.queue.push(id)
    this.emit(job)
    this.pump()
    return { id, cancel: () => this.cancel(id), outcome }
  }

  cancel(id: string): void {
    const job = this.jobs.get(id)
    if (!job || job.cancelRequested) return
    job.cancelRequested = true
    if (job.state === 'queued') {
      const index = this.queue.indexOf(id)
      if (index >= 0) this.queue.splice(index, 1)
      this.finalize(job, 'cancelled', null)
      return
    }
    if (job.state === 'running') {
      job.controller.abort()
      this.emit(job)
    }
  }

  get(id: string): JobSnapshot | undefined {
    const job = this.jobs.get(id)
    return job ? this.toSnapshot(job) : undefined
  }

  list(): JobSnapshot[] {
    return [...this.jobs.values()].map((job) => this.toSnapshot(job))
  }

  subscribe(listener: (snapshot: JobSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  async close(): Promise<void> {
    this.closed = true
    for (const job of [...this.jobs.values()]) {
      if (job.state === 'queued' || job.state === 'running') this.cancel(job.id)
    }
    await Promise.allSettled([...this.jobs.values()].map((job) => job.settled))
  }

  private pump(): void {
    while (this.queue.length > 0) {
      const id = this.queue[0]
      const job = this.jobs.get(id)
      if (!job) { this.queue.shift(); continue }
      const heavy = JOB_RESOURCE_CLASS[job.kind] === 'heavy'
      if (heavy && this.runningHeavy >= this.heavyConcurrency) break
      this.queue.shift()
      if (heavy) this.runningHeavy += 1
      this.beginRun(job)
    }
  }

  private beginRun(job: InternalJob): void {
    job.state = 'running'
    job.startedAtMs = this.now()
    this.emit(job)
    const ctx: JobContext = {
      id: job.id,
      signal: job.controller.signal,
      reportProgress: (value) => {
        if (job.state !== 'running') return
        const parsed = jobProgressSchema.safeParse(value)
        if (!parsed.success || isProgressRegression(job.progress, parsed.data)) {
          job.pendingProgressFailure = jobFailure('INVALID_PROGRESS', 'Job reported malformed or regressing progress.',
            parsed.success ? {} : { diagnostic: parsed.error.message.slice(0, 8192) }).detail
          job.controller.abort()
          return
        }
        job.progress = parsed.data
        this.emit(job)
      },
      enterCommit: () => {
        if (job.cancelRequested) return false
        job.commitEntered = true
        return true
      },
    }
    job.settled = job.pendingRun(ctx).then(
      (value) => {
        if (job.cancelRequested && !job.commitEntered) { this.finalize(job, 'cancelled', null); return }
        if (job.pendingProgressFailure) { this.finalize(job, 'failed', job.pendingProgressFailure); return }
        this.finalize(job, 'succeeded', null, value)
      },
      (error: unknown) => {
        if (job.cancelRequested && !job.commitEntered) { this.finalize(job, 'cancelled', null); return }
        if (isCancellationSignal(error)) { this.finalize(job, 'cancelled', null); return }
        if (job.pendingProgressFailure) { this.finalize(job, 'failed', job.pendingProgressFailure); return }
        this.finalize(job, 'failed', describeError(error))
      },
    )
  }

  private finalize(job: InternalJob, next: JobState, error: JobStructuredError | null, value?: unknown): void {
    if (!canTransition(job.state, next)) return
    const wasRunning = job.state === 'running'
    job.state = next
    job.error = error
    job.finishedAtMs = this.now()
    this.emit(job)
    if (wasRunning && JOB_RESOURCE_CLASS[job.kind] === 'heavy') {
      this.runningHeavy -= 1
      this.pump()
    }
    if (next === 'succeeded') job.resolveOutcome({ state: 'succeeded', value })
    else if (next === 'cancelled') job.resolveOutcome({ state: 'cancelled' })
    else job.resolveOutcome({ state: 'failed', error: error! })
  }

  private toSnapshot(job: InternalJob): JobSnapshot {
    return {
      id: job.id, kind: job.kind, label: job.label, state: job.state,
      cancelRequested: job.cancelRequested, progress: job.progress, error: job.error,
      queuedAtMs: job.queuedAtMs, startedAtMs: job.startedAtMs, finishedAtMs: job.finishedAtMs,
    }
  }

  private emit(job: InternalJob): void {
    const snapshot = this.toSnapshot(job)
    for (const listener of this.listeners) {
      try { listener(snapshot) } catch { /* a listener failure never affects scheduling */ }
    }
  }
}
