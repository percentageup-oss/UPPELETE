import { randomUUID } from 'node:crypto'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { failure } from '../workers/media/protocol'
import type { MediaWorkerClient } from '../workers/media/client'
import type { MediaTask, ProgressMessage } from '../workers/media/protocol'
import { JobScheduler } from './jobScheduler'
import type { PlaybackProxyStatus } from '../src/core/proxy'
import { DURATION_TOLERANCE_US, PlaybackProxyService, type PlaybackProxyRequest } from './playbackProxyService'
import { playbackProxyCacheKey } from './playbackProxyCache'

/** Mirrors `exportService.test.ts`'s worker double: returns protocol-shaped results so the
 * service's transcode/probe/validate/cache ordering can be checked without a real FFmpeg. */
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

const fingerprint = { algorithm: 'sha256-sampled-v1' as const, value: 'a'.repeat(64), sizeBytes: 999, sampledBytes: 999 }

function request(overrides: Partial<PlaybackProxyRequest> = {}): PlaybackProxyRequest {
  return { fingerprint, inputPath: '/Media/സോഴ്‌സ്.mp4', durationUs: 10_000_000, ...overrides }
}

/** Collects every status `ensure()` reports and resolves once a terminal one (ready/failed) arrives. */
function collectUntilTerminal() {
  const seen: PlaybackProxyStatus[] = []
  let resolve!: (value: PlaybackProxyStatus[]) => void
  const done = new Promise<PlaybackProxyStatus[]>((r) => { resolve = r })
  const onUpdate = (status: PlaybackProxyStatus) => {
    seen.push(status)
    if (status.state === 'ready' || status.state === 'failed') resolve(seen)
  }
  return { onUpdate, done }
}

let cacheDirectory: string
beforeEach(async () => { cacheDirectory = await mkdtemp(path.join(tmpdir(), 'playback-proxy-service-')) })
afterEach(async () => { await rm(cacheDirectory, { recursive: true, force: true }) })
const remaining = async () => readdir(cacheDirectory)

const proxyResult = (task: any) => ({ operation: 'proxy', path: task.outputPath, durationUs: 10_000_000 })
const probeResult = (durationUs: number) => async (task: any) => ({
  operation: 'probe',
  fingerprint,
  metadata: { durationUs, width: 1280, height: 720, rotationDegrees: null, frameRate: null, nominalFrameRate: null, streams: [] },
})

describe('PlaybackProxyService', () => {
  it('transcodes, re-probes, validates duration and caches the result, reporting queued → generating → ready', async () => {
    const { tasks, worker } = workerDouble({
      proxy: async (task) => { await writeFile(task.outputPath, 'fake webm'); return proxyResult(task) },
      probe: probeResult(10_000_000),
    })
    const service = new PlaybackProxyService({ worker, scheduler: new JobScheduler(), cacheDirectory })
    const { onUpdate, done } = collectUntilTerminal()
    service.ensure(request(), onUpdate)
    const seen = await done
    expect(seen.map((s) => s.state)).toEqual(['queued', 'generating', 'ready'])
    const ready = seen[seen.length - 1]
    expect(ready.url).toMatch(/^media:\/\/local\//)
    expect(tasks.map((t) => t.operation)).toEqual(['proxy', 'probe'])
    // Only the cached .webm/.json remain; the job-owned temp file is cleaned up.
    expect((await remaining()).sort()).toEqual([`${playbackProxyCacheKey(fingerprint)}.json`, `${playbackProxyCacheKey(fingerprint)}.webm`])
  })

  it('rejects and never caches a proxy whose re-probed duration drifts beyond tolerance', async () => {
    const { worker } = workerDouble({
      proxy: async (task) => { await writeFile(task.outputPath, 'fake webm'); return proxyResult(task) },
      probe: probeResult(10_000_000 - DURATION_TOLERANCE_US * 3),
    })
    const service = new PlaybackProxyService({ worker, scheduler: new JobScheduler(), cacheDirectory })
    const { onUpdate, done } = collectUntilTerminal()
    service.ensure(request(), onUpdate)
    const seen = await done
    expect(seen[seen.length - 1].state).toBe('failed')
    expect(seen[seen.length - 1].url).toBeNull()
    // Nothing was cached, and the temp file was cleaned up.
    expect(await remaining()).toEqual([])
  })

  it('serves a disk cache hit without starting a worker job at all', async () => {
    const { tasks, worker } = workerDouble({
      proxy: async (task) => { await writeFile(task.outputPath, 'fake webm'); return proxyResult(task) },
      probe: probeResult(10_000_000),
    })
    const service = new PlaybackProxyService({ worker, scheduler: new JobScheduler(), cacheDirectory })
    const first = collectUntilTerminal()
    service.ensure(request(), first.onUpdate)
    await first.done
    expect(tasks).toHaveLength(2) // proxy + probe, once

    const second = collectUntilTerminal()
    service.ensure(request(), second.onUpdate)
    const seen = await second.done
    expect(seen).toEqual([expect.objectContaining({ state: 'ready' })])
    expect(tasks).toHaveLength(2) // unchanged: no new worker call for the cache hit
  })

  it('joins a second ensure() for the same fingerprint to the one in-flight job instead of starting a duplicate transcode', async () => {
    let proxyCalls = 0
    const { tasks, worker } = workerDouble({
      proxy: async (task) => { proxyCalls += 1; await writeFile(task.outputPath, 'fake webm'); return proxyResult(task) },
      probe: probeResult(10_000_000),
    })
    const service = new PlaybackProxyService({ worker, scheduler: new JobScheduler(), cacheDirectory })
    const a = collectUntilTerminal()
    const b = collectUntilTerminal()
    service.ensure(request(), a.onUpdate)
    service.ensure(request(), b.onUpdate)
    const [seenA, seenB] = await Promise.all([a.done, b.done])
    expect(proxyCalls).toBe(1)
    expect(tasks.filter((t) => t.operation === 'proxy')).toHaveLength(1)
    expect(seenA[seenA.length - 1].state).toBe('ready')
    expect(seenB[seenB.length - 1].state).toBe('ready')
  })

  it('reports "failed" (never throws) when the transcode itself fails', async () => {
    const { worker } = workerDouble({
      proxy: async () => { throw failure('TOOL_FAILED', 'ffmpeg died') },
    })
    const service = new PlaybackProxyService({ worker, scheduler: new JobScheduler(), cacheDirectory })
    const { onUpdate, done } = collectUntilTerminal()
    service.ensure(request(), onUpdate)
    const seen = await done
    expect(seen[seen.length - 1]).toMatchObject({ state: 'failed' })
    expect(await remaining()).toEqual([])
  })
})
