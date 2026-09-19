import { randomUUID } from 'node:crypto'
import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { jobFailure, type JobSnapshot } from '../src/core/jobs'
import type { MediaMetadata } from '../src/core/media'
import { planFromMedia } from '../src/export/plan'
import type { ExportManifest } from '../src/export/plan'
import type { MediaWorkerClient } from '../workers/media/client'
import type { JobContext, JobHandle, JobScheduler } from './jobScheduler'

export type ExportServiceOptions = {
  worker: Pick<MediaWorkerClient, 'start'>
  scheduler: JobScheduler
  temporaryRoot: string
}

export type ExportRequest = {
  mediaPath: string
  metadata: MediaMetadata
  manifest: ExportManifest
  /** The user's chosen final destination (a native save dialog), never the source media path. */
  destinationPath: string
}

export type ExportJobValue = { path: string; durationUs: number; frameCount: number }

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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
    let plan
    try { plan = planFromMedia(request.metadata) }
    catch (error) { throw jobFailure('INVALID_INPUT', `This media cannot be exported: ${messageOf(error)}`) }
    const directory = await mkdtemp(path.join(this.options.temporaryRoot, 'caption-studio-export-'))
    const manifestPath = path.join(directory, 'manifest.json')
    // A fresh, unpredictable temp name beside the real destination — the encoder's own `-n` flag
    // also refuses to touch a pre-existing file, so a stale leftover never gets silently reused.
    const temporaryOutputPath = `${request.destinationPath}.${randomUUID()}.tmp`
    try {
      await writeFile(manifestPath, JSON.stringify(request.manifest))
      ctx.reportProgress({ kind: 'indeterminate', phase: 'rendering' })
      const durationUs = plan.range.endUs - plan.range.startUs
      const result = await this.options.worker.start({
        operation: 'export', inputPath: request.mediaPath, renderManifestPath: manifestPath,
        outputPath: temporaryOutputPath, range: plan.range, frameRate: plan.frameRate, width: plan.width, height: plan.height,
        profile: 'mp4-caption-renderer-v1',
      }, {
        signal: ctx.signal,
        // Generous ceiling scaled from source duration; real progress still drives the UI.
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
      if (!ctx.enterCommit()) throw jobFailure('CANCELLED', 'Export was cancelled before it could be finalized.')
      await rename(temporaryOutputPath, request.destinationPath)
      return { path: request.destinationPath, durationUs: result.durationUs, frameCount: result.frameCount }
    } finally {
      await rm(temporaryOutputPath, { force: true })
      await rm(directory, { recursive: true, force: true })
    }
  }
}
