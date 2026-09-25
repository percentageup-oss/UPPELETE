import { randomUUID } from 'node:crypto'
import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { jobFailure, type JobSnapshot } from '../src/core/jobs'
import type { ExportManifest, ExportPlan } from '../src/export/plan'
import type { MediaWorkerClient } from '../workers/media/client'
import { MediaWorkerError, type ExportTimings } from '../workers/media/protocol'
import type { JobContext, JobHandle, JobScheduler } from './jobScheduler'

export type ExportServiceOptions = {
  worker: Pick<MediaWorkerClient, 'start'>
  scheduler: JobScheduler
  temporaryRoot: string
}

export type ExportRequest = {
  /** Every file the export reads: the one source for manifests v1/v2, one per FFmpeg-read clip for v3. */
  inputPaths: string[]
  /** Output size, rate and range — derived by main from the project's format (or the probed first video). */
  plan: ExportPlan
  manifest: ExportManifest
  /** Explicit video bitrate from the user's export settings; absent keeps the automatic class. */
  encoding?: { videoBitrateKbps: number }
  /** The user's chosen final destination (a native save dialog), never the source media path. */
  destinationPath: string
}

export type ExportJobValue = { path: string; durationUs: number; frameCount: number; timings?: ExportTimings }

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Everything the worker knew about why a job stopped, in the one string a job error can carry: the
 * message, the process exit status and the tool's own stderr. The message alone ("Export process
 * failed") names nothing; the stderr is what says what the export host or encoder objected to.
 */
function describeFailure(error: unknown): string {
  if (!(error instanceof MediaWorkerError)) return messageOf(error)
  const { message, exitCode, signal, diagnostic } = error.detail
  const status = [exitCode != null ? `exit ${exitCode}` : '', signal ? `signal ${signal}` : ''].filter(Boolean).join(', ')
  return [message, status && `(${status})`, diagnostic && `— ${diagnostic}`].filter(Boolean).join(' ').slice(-8192)
}

/**
 * The media worker reports its own internal teardown — a dead export host, a closed pipe, an
 * aborted task — with the same `CANCELLED` code a user cancellation carries, and the scheduler
 * retires any `CANCELLED` job silently. An export that stopped on its own would therefore
 * disappear from the UI as "Export cancelled" (or, with the failure never surfaced, as nothing at
 * all) and leave no file. A cancellation the job never requested is a failure, so it is relabelled
 * here — before the scheduler sees it — keeping the worker's own message as the diagnostic.
 */
function isUnrequestedCancellation(error: unknown, ctx: JobContext): boolean {
  return !ctx.signal.aborted && error instanceof MediaWorkerError && error.detail.code === 'CANCELLED'
}

/**
 * Main-owned, Electron-free orchestration of one real cancellable export job, mirroring
 * `TranscriptionService`: derive the render plan, write a job-owned manifest, run the export
 * through the media worker at a temporary path, then finalize only through the scheduler's
 * commit gate (a cancel that arrives after a valid encode exists but before it is applied still
 * wins) and atomically rename onto the user's chosen destination. The job directory and any
 * leftover temporary output are removed whether the job succeeds, fails or is cancelled; the
 * source media is never opened for writing.
 */
export class ExportService {
  constructor(private readonly options: ExportServiceOptions) {}

  start(request: ExportRequest, onUpdate: (snapshot: JobSnapshot) => void): JobHandle<ExportJobValue> {
    let jobId: string | null = null
    const unsubscribe = this.options.scheduler.subscribe((snapshot) => { if (snapshot.id === jobId) onUpdate(snapshot) })
    const handle = this.options.scheduler.enqueue<ExportJobValue>({
      kind: 'export',
      label: `Export ${path.basename(request.destinationPath)}`.slice(0, 256),
      run: (ctx) => this.run(request, ctx),
    })
    jobId = handle.id
    const current = this.options.scheduler.get(handle.id)
    if (current) onUpdate(current)
    void handle.outcome.finally(unsubscribe)
    return handle
  }

  private async run(request: ExportRequest, ctx: JobContext): Promise<ExportJobValue> {
    const { plan } = request
    const directory = await mkdtemp(path.join(this.options.temporaryRoot, 'caption-studio-export-'))
    const manifestPath = path.join(directory, 'manifest.json')
    // A fresh, unpredictable temp name beside the real destination — the encoder's own `-n` flag
    // also refuses to touch a pre-existing file, so a stale leftover never gets silently reused.
    const temporaryOutputPath = `${request.destinationPath}.${randomUUID()}.tmp`
    try {
      await writeFile(manifestPath, JSON.stringify(request.manifest))
      ctx.reportProgress({ kind: 'indeterminate', phase: 'rendering' })
      const durationUs = plan.range.endUs - plan.range.startUs
      const result = await this.render(request, ctx, durationUs, manifestPath, temporaryOutputPath)
      if (!ctx.enterCommit()) throw jobFailure('CANCELLED', 'Export was cancelled before it could be finalized.')
      await rename(temporaryOutputPath, request.destinationPath)
      return { path: request.destinationPath, durationUs: result.durationUs, frameCount: result.frameCount, ...(result.timings ? { timings: result.timings } : {}) }
    } finally {
      await rm(temporaryOutputPath, { force: true })
      await rm(directory, { recursive: true, force: true })
    }
  }

  private async render(request: ExportRequest, ctx: JobContext, durationUs: number, manifestPath: string, temporaryOutputPath: string) {
    const { plan } = request
    try {
      return await this.options.worker.start({
        operation: 'export', inputPaths: request.inputPaths, renderManifestPath: manifestPath,
        outputPath: temporaryOutputPath, range: plan.range, frameRate: plan.frameRate, width: plan.width, height: plan.height,
        profile: 'mp4-caption-renderer-v1', ...(request.encoding ? { encoding: request.encoding } : {}),
      }, {
        signal: ctx.signal,
        // Generous ceiling scaled from the output duration; real progress still drives the UI.
        timeoutMs: Math.min(86_400_000, 600_000 + Math.ceil(durationUs / 1000) * 20),
        onProgress: (message) => {
          const value = message.progress
          if (value.kind === 'measured' && value.phase === 'export') {
            ctx.reportProgress({ kind: 'measured', phase: 'encoding', completed: value.completed, total: value.total, unit: value.unit })
          } else if (value.kind === 'indeterminate') {
            ctx.reportProgress({ kind: 'indeterminate', phase: 'rendering' })
          }
        },
      }).result
    } catch (error) {
      if (isUnrequestedCancellation(error, ctx)) {
        throw jobFailure('BACKEND_FAILED', 'The export stopped before it finished. See the export log for details.',
          { retryable: true, diagnostic: describeFailure(error) })
      }
      throw error
    }
  }
}
