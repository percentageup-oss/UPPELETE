import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { jobFailure } from '../src/core/jobs'
import type { MediaFingerprint } from '../src/core/media'
import type { PlaybackProxyStatus } from '../src/core/proxy'
import { mediaUrlForPath } from './projectMedia'
import type { MediaWorkerClient } from '../workers/media/client'
import { MediaWorkerError } from '../workers/media/protocol'
import type { JobContext, JobScheduler } from './jobScheduler'
import { playbackProxyCacheKey, readPlaybackProxyCache, writePlaybackProxyCache } from './playbackProxyCache'

export type PlaybackProxyRequest = { fingerprint: MediaFingerprint; inputPath: string; durationUs: number }

export type PlaybackProxyServiceOptions = {
  worker: Pick<MediaWorkerClient, 'start'>
  scheduler: JobScheduler
  cacheDirectory: string
}

/**
 * How far a re-probed proxy's duration may drift from the source before it is rejected rather than
 * cached and played. Generous relative to a frame (a shifted proxy silently makes captions land on
 * the wrong moment), but real enough to tolerate a webm container's own duration rounding.
 */
export const DURATION_TOLERANCE_US = 500_000

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Mirrors `exportService.ts`'s `isUnrequestedCancellation`: the worker's own teardown reports the
 * same CANCELLED code a user cancel does, and must not be silently swallowed as one. */
function isUnrequestedCancellation(error: unknown, ctx: JobContext): boolean {
  return !ctx.signal.aborted && error instanceof MediaWorkerError && error.detail.code === 'CANCELLED'
}

type Listener = (status: PlaybackProxyStatus) => void

/**
 * Background generation and disk caching of automatic playback proxies, mirroring `ExportService`'s
 * shape: derive a job-owned temp path, transcode through the media worker, then only ever persist a
 * result that has been re-probed and confirmed to actually match the source's duration — a proxy
 * that drifts is discarded, never cached, never handed to a caller as playable. Electron-free so it
 * is directly testable, like `ExportService`.
 *
 * Concurrent `ensure()` calls for the same fingerprint join the one in-flight job rather than
 * starting a duplicate transcode (the renderer's auto-request effect can fire more than once for
 * the same asset, e.g. under React StrictMode or after a relink that resolves to the same file).
 */
export class PlaybackProxyService {
  private readonly listeners = new Map<string, Set<Listener>>()
  private readonly inFlight = new Set<string>()

  constructor(private readonly options: PlaybackProxyServiceOptions) {}

  keyFor(fingerprint: MediaFingerprint): string {
    return playbackProxyCacheKey(fingerprint)
  }

  /** A cached, ready proxy for this fingerprint, without starting any work. */
  async cached(fingerprint: MediaFingerprint): Promise<PlaybackProxyStatus | null> {
    const entry = await readPlaybackProxyCache(this.options.cacheDirectory, fingerprint)
    return entry ? { fingerprint, state: 'ready', url: mediaUrlForPath(entry.path), reason: null } : null
  }

  /**
   * Ensures a proxy exists for `request.fingerprint`, generating one in the background if needed.
   * `onUpdate` is called at least once, synchronously-soon, with every status this call (or a job it
   * joins) reaches, ending in 'ready' or 'failed'. Never throws — a transcode failure is reported
   * through `onUpdate`, not as a rejected promise, since it must never interrupt playback of the
   * original.
   */
  ensure(request: PlaybackProxyRequest, onUpdate: Listener): void {
    const key = this.keyFor(request.fingerprint)
    const listeners = this.listeners.get(key) ?? new Set()
    listeners.add(onUpdate)
    this.listeners.set(key, listeners)
    if (this.inFlight.has(key)) return
    void this.start(key, request)
  }

  private emit(key: string, status: PlaybackProxyStatus) {
    for (const listener of this.listeners.get(key) ?? []) listener(status)
  }

  private async start(key: string, request: PlaybackProxyRequest): Promise<void> {
    this.inFlight.add(key)
    try {
      const cachedEntry = await readPlaybackProxyCache(this.options.cacheDirectory, request.fingerprint)
      if (cachedEntry) { this.emit(key, { fingerprint: request.fingerprint, state: 'ready', url: mediaUrlForPath(cachedEntry.path), reason: null }); return }
      this.emit(key, { fingerprint: request.fingerprint, state: 'queued', url: null, reason: null })
      // Subscribed before `enqueue()` (which can synchronously run and transition the job to
      // 'running' inside that very call, before `handle.id` is known) — mirrors `ExportService`'s
      // subscribe-then-enqueue-then-catch-up ordering so a job that starts immediately never has
      // its first 'running' snapshot silently missed.
      let jobId: string | null = null
      // A running job re-emits a scheduler snapshot on every progress report, still with
      // `state: 'running'` — this only ever surfaces the *first* one as 'generating', not one per
      // progress tick.
      let reportedGenerating = false
      const emitGenerating = () => {
        if (reportedGenerating) return
        reportedGenerating = true
        this.emit(key, { fingerprint: request.fingerprint, state: 'generating', url: null, reason: null })
      }
      const unsubscribe = this.options.scheduler.subscribe((snapshot) => {
        if (snapshot.id === jobId && snapshot.state === 'running') emitGenerating()
      })
      const handle = this.options.scheduler.enqueue<PlaybackProxyStatus>({
        kind: 'playback-proxy',
        label: `Playback proxy ${key.slice(0, 8)}`,
        run: (ctx) => this.run(key, request, ctx),
      })
      jobId = handle.id
      if (this.options.scheduler.get(handle.id)?.state === 'running') emitGenerating()
      const outcome = await handle.outcome
      unsubscribe()
      if (outcome.state === 'succeeded') this.emit(key, outcome.value)
      else if (outcome.state === 'failed') this.emit(key, { fingerprint: request.fingerprint, state: 'failed', url: null, reason: outcome.error.message })
      // A cancelled playback-proxy job (app shutdown) reports nothing further — there is no
      // listener left to usefully tell, and the next session's `ensure()` starts over cleanly.
    } finally {
      this.inFlight.delete(key)
      this.listeners.delete(key)
    }
  }

  private async run(key: string, request: PlaybackProxyRequest, ctx: JobContext): Promise<PlaybackProxyStatus> {
    await mkdir(this.options.cacheDirectory, { recursive: true })
    const temporaryPath = path.join(this.options.cacheDirectory, `${key}.${randomUUID()}.webm.tmp`)
    try {
      ctx.reportProgress({ kind: 'indeterminate', phase: 'proxy' })
      try {
        await this.options.worker.start({ operation: 'proxy', inputPath: request.inputPath, outputPath: temporaryPath, durationUs: request.durationUs }, {
          signal: ctx.signal,
          onProgress: (message) => {
            const value = message.progress
            if (value.kind === 'measured' && value.phase === 'proxy') {
              ctx.reportProgress({ kind: 'measured', phase: 'proxy', completed: value.completed, total: value.total, unit: value.unit })
            }
          },
        }).result
      } catch (error) {
        if (isUnrequestedCancellation(error, ctx)) {
          throw jobFailure('BACKEND_FAILED', 'The playback proxy transcode stopped before it finished.', { retryable: true, diagnostic: messageOf(error) })
        }
        throw error
      }
      const probe = await this.options.worker.start({ operation: 'probe', inputPath: temporaryPath }).result
      const probedDurationUs = probe.metadata.durationUs ?? 0
      if (Math.abs(probedDurationUs - request.durationUs) > DURATION_TOLERANCE_US) {
        throw jobFailure('MALFORMED_OUTPUT', 'The generated proxy duration does not match the source; discarding it rather than risk misaligned playback.',
          { diagnostic: `source=${request.durationUs}us proxy=${probedDurationUs}us` })
      }
      if (!ctx.enterCommit()) throw jobFailure('CANCELLED', 'Operation cancelled')
      const entry = await writePlaybackProxyCache(this.options.cacheDirectory, request.fingerprint, temporaryPath, probedDurationUs)
      return { fingerprint: request.fingerprint, state: 'ready', url: mediaUrlForPath(entry.path), reason: null }
    } finally {
      await rm(temporaryPath, { force: true })
    }
  }
}
