/** The minimal surface `createPlaybackClock` needs from an `HTMLVideoElement`. Kept narrow so
 * tests can supply a plain fake instead of a real DOM element. */
export type FrameVideo = {
  readonly paused: boolean
  readonly currentTime: number
  requestVideoFrameCallback?(callback: (now: number, metadata: { mediaTime: number }) => void): number
  cancelVideoFrameCallback?(handle: number): void
  addEventListener(type: string, listener: () => void): void
  removeEventListener(type: string, listener: () => void): void
}

export type PlaybackClock = {
  /** Subscribe to timestamp changes; returns an unsubscribe function (React `useSyncExternalStore` shape). */
  subscribe(listener: () => void): () => void
  getUs(): number
  /** Sets the current absolute source-time timestamp (integer microseconds). No-op if unchanged. */
  set(us: number): void
  attach(video: FrameVideo): void
  detach(): void
}

const PLAY_EVENTS = ['play', 'playing']
const STOP_EVENTS = ['pause', 'ended', 'emptied']

/**
 * The editor's only playback clock was `<video onTimeUpdate>`, which Chromium fires roughly 4
 * times a second — far coarser than a spoken word (150-400ms) or word-pop's 200ms curve, so
 * word-by-word motion looked like it "wasn't working": the highlight skipped words and the pop
 * curve was never actually sampled mid-animation.
 *
 * This clock ticks once per *presented video frame* while playing (via `requestVideoFrameCallback`,
 * falling back to `requestAnimationFrame` when unavailable), reading the real presented frame's
 * `mediaTime` rather than accumulating an elapsed-time estimate — so seeking, pausing and resuming
 * all stay exact, and it can never drift ahead of or behind the actual decoded video. Every emitted
 * value is `Math.round(seconds * 1e6)`, matching the rest of the app's integer-microsecond timebase.
 * `set` is idempotent (no notify on an unchanged value) so callers can freely call it from both
 * `timeupdate` and this loop without doubling renders.
 */
// `typeof` on a possibly-undeclared global identifier never throws, unlike referencing it bare —
// this module runs under both a browser/Electron renderer (where these exist) and plain Node
// (vitest's default environment here), so the defaults must not evaluate the identifier directly.
const globalRaf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (cb: FrameRequestCallback) => { cb(0); return 0 }
const globalCaf = typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : () => {}

export function createPlaybackClock(raf: typeof requestAnimationFrame = globalRaf,
  caf: typeof cancelAnimationFrame = globalCaf): PlaybackClock {
  let us = 0
  let video: FrameVideo | null = null
  let handle: number | null = null
  let usingRvfc = false
  const listeners = new Set<() => void>()

  const notify = () => { for (const listener of listeners) listener() }
  const setUs = (next: number) => {
    if (!Number.isSafeInteger(next) || next < 0) return
    if (next === us) return
    us = next
    notify()
  }

  const tick = () => {
    if (!video) return
    setUs(Math.round(video.currentTime * 1_000_000))
    if (video.paused) { handle = null; return }
    schedule()
  }
  const rvfcTick = (_now: number, metadata: { mediaTime: number }) => {
    if (!video) return
    setUs(Math.round(metadata.mediaTime * 1_000_000))
    if (video.paused) { handle = null; return }
    schedule()
  }
  function schedule() {
    if (!video) return
    if (video.requestVideoFrameCallback) { usingRvfc = true; handle = video.requestVideoFrameCallback(rvfcTick) }
    else { usingRvfc = false; handle = raf(tick) }
  }
  function cancelScheduled() {
    if (handle === null) return
    if (usingRvfc) video?.cancelVideoFrameCallback?.(handle)
    else caf(handle)
    handle = null
  }

  const onStart = () => { cancelScheduled(); schedule() }
  const onStop = () => { cancelScheduled(); if (video) setUs(Math.round(video.currentTime * 1_000_000)) }

  return {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    getUs: () => us,
    set: setUs,
    attach(next) {
      this.detach()
      video = next
      for (const type of PLAY_EVENTS) video.addEventListener(type, onStart)
      for (const type of STOP_EVENTS) video.addEventListener(type, onStop)
      setUs(Math.round(video.currentTime * 1_000_000))
      if (!video.paused) onStart()
    },
    detach() {
      if (!video) return
      cancelScheduled()
      for (const type of PLAY_EVENTS) video.removeEventListener(type, onStart)
      for (const type of STOP_EVENTS) video.removeEventListener(type, onStop)
      video = null
    },
  }
}
