import { randomUUID } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { failure } from '../workers/media/protocol'
import type { MediaWorkerClient } from '../workers/media/client'
import type { MediaTask, ProgressMessage } from '../workers/media/protocol'
import { DEFAULT_CAPTION_STYLE } from '../src/captions/style'
import { JobScheduler } from './jobScheduler'
import type { ExportPlan } from '../src/export/plan'
import { ExportService, type ExportJobValue, type ExportRequest } from './exportService'

/** Test-only worker double, mirroring `transcriptionService.test.ts`'s: returns protocol-shaped
 * results so the service's manifest/temp-file/commit-gate/cleanup ordering can be checked without
 * a real FFmpeg or export host. */
type StartOptions = { signal?: AbortSignal; onProgress?: (message: ProgressMessage) => void; timeoutMs?: number }
type Handler = (task: any, options: StartOptions) => Promise<unknown>
function workerDouble(handlers: Record<string, Handler>) {
  const tasks: MediaTask[] = []
  const worker = {
    start(task: MediaTask, options: StartOptions = {}) {
      tasks.push(task)
      const handler = handlers[task.operation]
      return { id: randomUUID(), cancel() {}, result: handler ? handler(task, options) : Promise.reject(new Error(`unexpected ${task.operation}`)) }
    },
  }
  return { tasks, worker: worker as unknown as Pick<MediaWorkerClient, 'start'> }
}

const plan: ExportPlan = { width: 1080, height: 1920, frameRate: { numerator: 30, denominator: 1 }, range: { startUs: 0, endUs: 1_000_000 } }

let temporaryRoot: string
beforeEach(async () => { temporaryRoot = await mkdtemp(path.join(tmpdir(), 'caption-export-service-')) })
afterEach(async () => { await rm(temporaryRoot, { recursive: true, force: true }) })
const leftovers = async () => (await readdir(temporaryRoot)).filter((name) => name.startsWith('caption-studio-export-'))

function request(overrides: Partial<ExportRequest> = {}): ExportRequest {
  return {
    inputPaths: ['/Media/വീഡിയോ.mp4'], plan,
    manifest: { version: 1, cues: [], style: DEFAULT_CAPTION_STYLE },
    destinationPath: path.join(temporaryRoot, 'output.mp4'),
    ...overrides,
  }
}

const exportResult = (task: any) => ({ operation: 'export', path: task.outputPath, durationUs: 1_000_000, frameCount: 30, frameRate: { numerator: 30, denominator: 1 } })

describe('ExportService', () => {
  it('writes a job-owned manifest, renders through the export operation and atomically renames onto the destination, then removes the job directory', async () => {
    let manifestAtRenderTime: unknown
    const { tasks, worker } = workerDouble({
      export: async (task) => {
        // Read the manifest while the job is still running — its job directory is removed
        // (matching every other media-worker job's temp-file cleanup) as soon as the job settles.
        manifestAtRenderTime = JSON.parse(await readFile(task.renderManifestPath, 'utf8'))
        await writeFile(task.outputPath, 'fake mp4 bytes')
        return exportResult(task)
      },
    })
    const service = new ExportService({ worker, scheduler: new JobScheduler(), temporaryRoot })
    const snapshots: string[] = []
    const outcome = await service.start(request(), (snapshot) => snapshots.push(snapshot.state)).outcome
    if (outcome.state !== 'succeeded') throw new Error(JSON.stringify(outcome))
    expect(outcome.value).toEqual<ExportJobValue>({ path: path.join(temporaryRoot, 'output.mp4'), durationUs: 1_000_000, frameCount: 30 })
    expect(await readFile(path.join(temporaryRoot, 'output.mp4'), 'utf8')).toBe('fake mp4 bytes')
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({ operation: 'export', inputPaths: ['/Media/വീഡിയോ.mp4'], profile: 'mp4-caption-renderer-v1', width: 1080, height: 1920, range: plan.range })
    expect(path.dirname((tasks[0] as any).renderManifestPath).startsWith(path.join(temporaryRoot, 'caption-studio-export-'))).toBe(true)
    expect(manifestAtRenderTime).toEqual({ version: 1, cues: [], style: DEFAULT_CAPTION_STYLE })
    expect(snapshots).toContain('succeeded')
    expect(await leftovers()).toEqual([]) // the job directory is gone; only the real output.mp4 remains
  })

  it('cancels a running export, never creates the destination and removes the job directory', async () => {
    let cancelJob = () => {}
    const { worker } = workerDouble({
      export: (_task, options) => new Promise((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => reject(failure('CANCELLED', 'Operation cancelled')), { once: true })
        queueMicrotask(() => cancelJob())
      }),
    })
    const service = new ExportService({ worker, scheduler: new JobScheduler(), temporaryRoot })
    const handle = service.start(request(), () => {})
    cancelJob = handle.cancel
    expect(await handle.outcome).toEqual({ state: 'cancelled' })
    expect(await readdir(temporaryRoot)).toEqual([]) // no destination, no leftover temp file or job directory
  })

  it('a cancellation that arrives after a valid encode exists but before commit still wins, and the destination is never created', async () => {
    let handle: ReturnType<ExportService['start']>
    const { worker } = workerDouble({
      export: async (task) => {
        await writeFile(task.outputPath, 'fake mp4 bytes') // the encode genuinely finished…
        handle.cancel() // …but cancellation arrives before the commit gate
        return exportResult(task)
      },
    })
    const service = new ExportService({ worker, scheduler: new JobScheduler(), temporaryRoot })
    handle = service.start(request(), () => {})
    expect(await handle.outcome).toMatchObject({ state: 'cancelled' })
    expect(await readdir(temporaryRoot)).toEqual([]) // the completed encode is discarded, not renamed onto the destination
  })

  it('surfaces a real worker failure as a structured backend error, cleans up, and never touches a pre-existing destination', async () => {
    const destinationPath = path.join(temporaryRoot, 'existing.mp4')
    await writeFile(destinationPath, 'original bytes')
    const { worker } = workerDouble({ export: async () => { throw failure('TOOL_FAILED', 'Encoded MP4 failed stream validation') } })
    const service = new ExportService({ worker, scheduler: new JobScheduler(), temporaryRoot })
    const outcome = await service.start(request({ destinationPath }), () => {}).outcome
    expect(outcome).toMatchObject({ state: 'failed', error: { code: 'BACKEND_FAILED', message: 'Encoded MP4 failed stream validation' } })
    expect(await readFile(destinationPath, 'utf8')).toBe('original bytes') // untouched
    expect(await readdir(temporaryRoot)).toEqual(['existing.mp4'])
  })

  it('reports a worker cancellation the job never asked for as a failure, not a silent cancelled outcome', async () => {
    // The worker uses CANCELLED for its own teardown too (a dead export host, a closed pipe). Left
    // as a cancellation it retires the job with no error, so the UI shows the same thing as a user
    // cancel — or nothing — and no file is written.
    const { worker } = workerDouble({ export: async () => { throw failure('CANCELLED', 'Export interrupted') } })
    const service = new ExportService({ worker, scheduler: new JobScheduler(), temporaryRoot })
    const outcome = await service.start(request(), () => {}).outcome
    expect(outcome).toMatchObject({ state: 'failed', error: { code: 'BACKEND_FAILED', retryable: true, diagnostic: 'Export interrupted' } })
    expect(await readdir(temporaryRoot)).toEqual([]) // nothing left behind, and no destination created
  })

  it('keeps the exit status and the tool\'s stderr when it relabels an unrequested cancellation', async () => {
    const { worker } = workerDouble({ export: async () => { throw failure('CANCELLED', 'Export cancelled', { exitCode: 1, diagnostic: 'export host: frame 12 failed: paint timeout' }) } })
    const service = new ExportService({ worker, scheduler: new JobScheduler(), temporaryRoot })
    const outcome = await service.start(request(), () => {}).outcome
    expect(outcome).toMatchObject({ state: 'failed', error: { code: 'BACKEND_FAILED', diagnostic: 'Export cancelled (exit 1) — export host: frame 12 failed: paint timeout' } })
  })

  it('hands the worker every input a multi-clip timeline reads, with the plan main derived', async () => {
    const { tasks, worker } = workerDouble({ export: async (task) => { await writeFile(task.outputPath, 'fake mp4 bytes'); return exportResult(task) } })
    const service = new ExportService({ worker, scheduler: new JobScheduler(), temporaryRoot })
    const sequencePlan = { ...plan, width: 1280, height: 720, range: { startUs: 0, endUs: 16_000_000 } }
    await service.start(request({ inputPaths: ['/Media/a.mp4', '/Media/b.mov', '/Media/a.mp4'], plan: sequencePlan }), () => {}).outcome
    expect(tasks[0]).toMatchObject({ inputPaths: ['/Media/a.mp4', '/Media/b.mov', '/Media/a.mp4'], width: 1280, height: 720, range: { startUs: 0, endUs: 16_000_000 } })
  })

  it('queues behind another heavy job on the shared scheduler instead of running concurrently', async () => {
    const scheduler = new JobScheduler()
    let releaseTranscription!: () => void
    const blocked = new Promise<void>((resolve) => { releaseTranscription = resolve })
    const transcriptionHandle = scheduler.enqueue({ kind: 'transcription', label: 'blocking transcription', run: async () => { await blocked } })
    const { worker } = workerDouble({ export: async (task) => { await writeFile(task.outputPath, 'fake mp4 bytes'); return exportResult(task) } })
    const service = new ExportService({ worker, scheduler, temporaryRoot })
    const handle = service.start(request(), () => {})
    await Promise.resolve() // let both enqueue() microtasks settle
    expect(scheduler.get(handle.id)?.state).toBe('queued')
    releaseTranscription()
    expect(await transcriptionHandle.outcome).toEqual({ state: 'succeeded', value: undefined })
    expect(await handle.outcome).toMatchObject({ state: 'succeeded' })
  })
})
