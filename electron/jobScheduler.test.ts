import { describe, expect, it } from 'vitest'
import { JobScheduler } from './jobScheduler'
import { JobFailure, type JobProgress, type JobSnapshot } from '../src/core/jobs'
import { failure as mediaFailure } from '../workers/media/protocol'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}

describe('JobScheduler: snapshots and lifecycle', () => {
  it('reports queued -> running -> succeeded with an injected clock', async () => {
    let clock = 1000
    const scheduler = new JobScheduler({ now: () => clock })
    const snapshots: JobSnapshot[] = []
    scheduler.subscribe((snapshot) => snapshots.push(snapshot))
    const work = deferred<string>()
    const handle = scheduler.enqueue({ kind: 'transcription', label: 'Job A', run: async () => work.promise })
    expect(scheduler.get(handle.id)?.state).toBe('running')
    clock = 2000
    work.resolve('done')
    expect(await handle.outcome).toEqual({ state: 'succeeded', value: 'done' })
    expect(snapshots.map((s) => s.state)).toEqual(['queued', 'running', 'succeeded'])
    expect(snapshots[1].startedAtMs).toBe(1000)
    expect(snapshots[2].finishedAtMs).toBe(2000)
  })
})

describe('JobScheduler: heavy-job arbitration', () => {
  it('serializes heavy jobs (transcription/export) by default in strict FIFO order', async () => {
    const scheduler = new JobScheduler()
    const order: string[] = []
    const first = deferred<void>()
    const a = scheduler.enqueue({ kind: 'transcription', label: 'A', run: async () => { order.push('a-start'); await first.promise; order.push('a-end') } })
    const b = scheduler.enqueue({ kind: 'export', label: 'B', run: async () => { order.push('b-start'); order.push('b-end') } })
    expect(scheduler.get(a.id)?.state).toBe('running')
    expect(scheduler.get(b.id)?.state).toBe('queued')
    first.resolve()
    await a.outcome
    await b.outcome
    expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end'])
  })

  it('allows heavyConcurrency > 1 to run heavy jobs concurrently', async () => {
    const scheduler = new JobScheduler({ heavyConcurrency: 2 })
    const a = scheduler.enqueue({ kind: 'transcription', label: 'A', run: async () => 'a' })
    const b = scheduler.enqueue({ kind: 'export', label: 'B', run: async () => 'b' })
    expect(scheduler.get(a.id)?.state).toBe('running')
    expect(scheduler.get(b.id)?.state).toBe('running')
    expect(await a.outcome).toEqual({ state: 'succeeded', value: 'a' })
    expect(await b.outcome).toEqual({ state: 'succeeded', value: 'b' })
  })
})

describe('JobScheduler: cancellation', () => {
  it('cancels a queued job immediately, never calling its run function', async () => {
    const scheduler = new JobScheduler()
    const blocker = deferred<void>()
    const a = scheduler.enqueue({ kind: 'transcription', label: 'A', run: async () => blocker.promise })
    let bCalled = false
    const b = scheduler.enqueue({ kind: 'export', label: 'B', run: async () => { bCalled = true } })
    b.cancel()
    expect(await b.outcome).toEqual({ state: 'cancelled' })
    expect(bCalled).toBe(false)
    blocker.resolve()
    await a.outcome
  })

  it('leaves a running job "running" with cancelRequested set until run() settles', async () => {
    const scheduler = new JobScheduler()
    let sawAbort = false
    const blocker = deferred<void>()
    const a = scheduler.enqueue({
      kind: 'transcription', label: 'A',
      run: async (ctx) => { ctx.signal.addEventListener('abort', () => { sawAbort = true }); await blocker.promise; return 'value' },
    })
    a.cancel()
    expect(scheduler.get(a.id)).toMatchObject({ state: 'running', cancelRequested: true })
    expect(sawAbort).toBe(true)
    blocker.resolve()
    expect(await a.outcome).toEqual({ state: 'cancelled' })
  })

  it('does not relabel a successful outcome as cancelled once enterCommit() has been entered', async () => {
    const scheduler = new JobScheduler()
    const a = scheduler.enqueue({
      kind: 'transcription', label: 'A',
      run: async (ctx) => {
        expect(ctx.enterCommit()).toBe(true)
        return 'committed'
      },
    })
    // Requested synchronously right after enqueue, i.e. after run() already entered commit.
    a.cancel()
    expect(await a.outcome).toEqual({ state: 'succeeded', value: 'committed' })
  })

  it('lets enterCommit() report false and the job finish cancelled when cancel precedes it', async () => {
    const scheduler = new JobScheduler()
    const blocker = deferred<void>()
    const a = scheduler.enqueue({
      kind: 'transcription', label: 'A',
      run: async (ctx) => {
        await blocker.promise
        expect(ctx.enterCommit()).toBe(false)
        return 'should not count'
      },
    })
    a.cancel()
    blocker.resolve()
    expect(await a.outcome).toEqual({ state: 'cancelled' })
  })
})

describe('JobScheduler: error mapping', () => {
  it('passes a thrown JobFailure through unchanged', async () => {
    const scheduler = new JobScheduler()
    const a = scheduler.enqueue({ kind: 'transcription', label: 'A', run: async () => { throw new JobFailure({ code: 'MODEL_UNAVAILABLE', message: 'no model', retryable: false }) } })
    expect(await a.outcome).toMatchObject({ state: 'failed', error: { code: 'MODEL_UNAVAILABLE' } })
  })

  it('wraps a non-cancelled MediaWorkerError as BACKEND_FAILED, keeping message/retryable/diagnostic', async () => {
    const scheduler = new JobScheduler()
    const b = scheduler.enqueue({ kind: 'transcription', label: 'B', run: async () => { throw mediaFailure('TOOL_FAILED', 'ffmpeg died', { retryable: true, diagnostic: 'stderr text' }) } })
    expect(await b.outcome).toMatchObject({ state: 'failed', error: { code: 'BACKEND_FAILED', message: 'ffmpeg died', retryable: true, diagnostic: 'stderr text' } })
  })

  it('treats a CANCELLED-coded MediaWorkerError as a cancelled outcome, not a failure', async () => {
    const scheduler = new JobScheduler()
    const c = scheduler.enqueue({ kind: 'transcription', label: 'C', run: async () => { throw mediaFailure('CANCELLED', 'media worker cancelled') } })
    expect(await c.outcome).toEqual({ state: 'cancelled' })
  })

  it('maps an unrecognized thrown value to INTERNAL_ERROR', async () => {
    const scheduler = new JobScheduler()
    const d = scheduler.enqueue({ kind: 'transcription', label: 'D', run: async () => { throw new Error('boom') } })
    expect(await d.outcome).toMatchObject({ state: 'failed', error: { code: 'INTERNAL_ERROR' } })
  })
})

describe('JobScheduler: progress', () => {
  it('fails a job on malformed progress and aborts its signal', async () => {
    const scheduler = new JobScheduler()
    let sawAbort = false
    const a = scheduler.enqueue({
      kind: 'transcription', label: 'A',
      run: async (ctx) => {
        ctx.signal.addEventListener('abort', () => { sawAbort = true })
        ctx.reportProgress({ kind: 'measured', phase: 'recognizing', completed: 5, total: 10 } as unknown as JobProgress)
        return 'unused'
      },
    })
    expect(await a.outcome).toMatchObject({ state: 'failed', error: { code: 'INVALID_PROGRESS' } })
    expect(sawAbort).toBe(true)
  })

  it('fails a job when reported progress regresses', async () => {
    const scheduler = new JobScheduler()
    const a = scheduler.enqueue({
      kind: 'transcription', label: 'A',
      run: async (ctx) => {
        ctx.reportProgress({ kind: 'measured', phase: 'recognizing', completed: 50, total: 100, unit: 'sourceUs' })
        ctx.reportProgress({ kind: 'measured', phase: 'recognizing', completed: 10, total: 100, unit: 'sourceUs' })
        return 'unused'
      },
    })
    expect(await a.outcome).toMatchObject({ state: 'failed', error: { code: 'INVALID_PROGRESS' } })
  })

  it('forwards valid, advancing progress to subscribers and ignores progress reported after settlement', async () => {
    const scheduler = new JobScheduler()
    // Isolate reports made *while running*: the terminal snapshot legitimately still
    // carries the last progress value forward, which is not a new report to count.
    const seenWhileRunning: JobProgress[] = []
    scheduler.subscribe((snapshot) => { if (snapshot.state === 'running' && snapshot.progress) seenWhileRunning.push(snapshot.progress) })
    let lateReport!: () => void
    const a = scheduler.enqueue({
      kind: 'transcription', label: 'A',
      run: async (ctx) => {
        ctx.reportProgress({ kind: 'measured', phase: 'recognizing', completed: 10, total: 100, unit: 'sourceUs' })
        lateReport = () => ctx.reportProgress({ kind: 'measured', phase: 'recognizing', completed: 99, total: 100, unit: 'sourceUs' })
        return 'done'
      },
    })
    expect(await a.outcome).toEqual({ state: 'succeeded', value: 'done' })
    expect(seenWhileRunning).toHaveLength(1)
    lateReport()
    expect(seenWhileRunning).toHaveLength(1)
  })
})

describe('JobScheduler: listeners and shutdown', () => {
  it('isolates a throwing listener from scheduling and from other listeners', async () => {
    const scheduler = new JobScheduler()
    scheduler.subscribe(() => { throw new Error('listener bug') })
    const seen: string[] = []
    scheduler.subscribe((snapshot) => seen.push(snapshot.state))
    const a = scheduler.enqueue({ kind: 'transcription', label: 'A', run: async () => 'ok' })
    expect(await a.outcome).toEqual({ state: 'succeeded', value: 'ok' })
    expect(seen).toContain('succeeded')
  })

  it('close() rejects new work, cancels queued/running jobs and awaits their settlement', async () => {
    const scheduler = new JobScheduler()
    const blocker = deferred<void>()
    let bCalled = false
    const a = scheduler.enqueue({ kind: 'transcription', label: 'A', run: async () => { await blocker.promise; return 'a' } })
    const b = scheduler.enqueue({ kind: 'export', label: 'B', run: async () => { bCalled = true } })
    const closing = scheduler.close()
    blocker.resolve()
    await closing
    expect(await a.outcome).toEqual({ state: 'cancelled' })
    expect(await b.outcome).toEqual({ state: 'cancelled' })
    expect(bCalled).toBe(false)
    expect(() => scheduler.enqueue({ kind: 'transcription', label: 'C', run: async () => 'x' })).toThrow()
  })
})
