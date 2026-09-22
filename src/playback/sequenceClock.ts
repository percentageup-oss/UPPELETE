import type { PlaybackClock } from '../core/playbackClock'

/**
 * The transport's clock in **sequence** microseconds (docs/EDITING.md "Playback"). With stacked
 * tracks no single `<video>` owns the transport any more, so the clock free-runs from wall time ×
 * rate on animation frames — which is also exactly right in a gap or an image/audio-only stretch,
 * where nothing is decoding. Wherever a video *is* playing on the topmost visible video track, the
 * transport feeds that element's presented-frame time to `discipline`, which slews the clock toward
 * it (snapping only on a large error, since snapping every frame jitters). The single-video case —
 * every existing project — therefore stays frame-accurate, while N stacked videos are approximately
 * frame-accurate in preview. Export is always exact: it never plays, it iterates frame indices.
 *
 * It keeps `PlaybackClock`'s `subscribe`/`getUs`/`set` shape, so `CaptionStage`'s
 * `useSyncExternalStore` subscription (the only subtree that re-renders per frame) is unchanged.
 */
export type TransportState = { playing: boolean; rate: number; seekEpoch: number }

export type SequenceClock = PlaybackClock & {
  play(): void
  pause(): void
  isPlaying(): boolean
  setRate(rate: number): void
  /** Sequence length; playback stops (and stays) at the end. `null` means unbounded. */
  setDurationUs(durationUs: number | null): void
  /** Slews the free-running position toward a measured one (the master video's presented frame). */
  discipline(targetUs: number): void
  getState(): TransportState
  /** Play/pause, rate and seek changes — not per-frame position ticks. */
  subscribeState(listener: () => void): () => void
  dispose(): void
}

/** Errors beyond this snap; smaller ones are slewed away over a few frames. */
export const SNAP_ERROR_US = 40_000
/** The most a single discipline step moves the clock, so corrections never read as a jump. */
const MAX_SLEW_STEP_US = 4_000

const globalRaf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 16) as unknown as number
const globalCaf = typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : (handle: number) => clearTimeout(handle)
const globalNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

export function createSequenceClock(options: { raf?: typeof requestAnimationFrame; caf?: typeof cancelAnimationFrame; now?: () => number } = {}): SequenceClock {
  const raf = options.raf ?? globalRaf
  const caf = options.caf ?? globalCaf
  const now = options.now ?? globalNow
  let us = 0
  let playing = false
  let rate = 1
  let seekEpoch = 0
  let durationUs: number | null = null
  // While playing, position = anchorUs + (now - anchorMs) × rate.
  let anchorUs = 0
  let anchorMs = 0
  let handle: number | null = null
  const listeners = new Set<() => void>()
  const stateListeners = new Set<() => void>()
  const notify = () => { for (const listener of listeners) listener() }
  const notifyState = () => { for (const listener of stateListeners) listener() }

  const setPosition = (next: number) => {
    const clamped = Math.max(0, Math.round(durationUs === null ? next : Math.min(next, durationUs)))
    if (clamped === us) return
    us = clamped
    notify()
  }
  const rebase = () => { anchorUs = us; anchorMs = now() }
  const stopLoop = () => { if (handle !== null) { caf(handle); handle = null } }
  const tick = () => {
    handle = null
    if (!playing) return
    setPosition(anchorUs + (now() - anchorMs) * 1000 * rate)
    if (durationUs !== null && us >= durationUs) { pause(); return }
    handle = raf(tick)
  }
  function pause() {
    if (!playing) return
    setPosition(anchorUs + (now() - anchorMs) * 1000 * rate)
    playing = false
    stopLoop()
    notifyState()
  }

  return {
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    getUs: () => us,
    set(next) {
      if (!Number.isFinite(next)) return
      setPosition(next)
      rebase()
      seekEpoch++
      notifyState()
    },
    play() {
      if (playing) return
      if (durationUs !== null && us >= durationUs) setPosition(0)
      playing = true
      rebase()
      stopLoop()
      handle = raf(tick)
      notifyState()
    },
    pause,
    isPlaying: () => playing,
    setRate(next) {
      if (!(next > 0) || next === rate) return
      if (playing) { setPosition(anchorUs + (now() - anchorMs) * 1000 * rate); rebase() }
      rate = next
      notifyState()
    },
    setDurationUs(next) {
      durationUs = next
      if (next !== null && us > next) setPosition(next)
    },
    discipline(targetUs) {
      if (!playing || !Number.isFinite(targetUs)) return
      const current = anchorUs + (now() - anchorMs) * 1000 * rate
      const error = targetUs - current
      if (Math.abs(error) > SNAP_ERROR_US) anchorUs += error
      else anchorUs += Math.max(-MAX_SLEW_STEP_US, Math.min(MAX_SLEW_STEP_US, error / 4))
    },
    getState: () => ({ playing, rate, seekEpoch }),
    subscribeState(listener) { stateListeners.add(listener); return () => { stateListeners.delete(listener) } },
    dispose() { stopLoop(); listeners.clear(); stateListeners.clear(); playing = false },
  }
}
