import type { PlaybackClock } from './playbackClock'
import { PAST_END, nextKeptSourceUs, type TimeRange } from './sequence'

/**
 * Cut-skipping playback, built on `playbackClock`'s per-presented-frame clock. On every frame it
 * asks `nextKeptSourceUs` what to do with the current **source** time: keep playing, jump to the
 * start of the next kept segment, or stop because the sequence has ended.
 *
 * Expected preview behaviour is 0-1 removed frames visible and one seek stall per cut; the export
 * is exact because it never visits a removed source time at all (docs/EDITING.md). With no
 * segments every frame reports `play`, so playback is bit-for-bit what it was before V1.
 */
export type CutAction = { kind: 'play' } | { kind: 'seek'; sourceUs: number } | { kind: 'end' }

export function cutPlaybackAction(sourceUs: number, segments: readonly TimeRange[] | undefined, mediaDurationUs: number | null): CutAction {
  const next = nextKeptSourceUs(sourceUs, segments, mediaDurationUs)
  if (next === null) return { kind: 'play' }
  return next === PAST_END ? { kind: 'end' } : { kind: 'seek', sourceUs: next }
}

export type CutPlaybackOptions = {
  clock: PlaybackClock
  /** Read at each tick, so undoing a cut takes effect without re-attaching. */
  segments: () => readonly TimeRange[] | undefined
  mediaDurationUs: () => number | null
  /** True only while the video is actually playing; a paused playhead is never dragged around. */
  playing: () => boolean
  seek: (sourceUs: number) => void
  pause: () => void
}

export function createCutPlaybackController(options: CutPlaybackOptions) {
  // While a seek is in flight the clock still reports times inside the gap we are leaving. Holding
  // the target means one seek per cut instead of one per frame until the seek lands.
  let pendingSeekUs: number | null = null

  const evaluate = () => {
    if (!options.playing()) { pendingSeekUs = null; return }
    const sourceUs = options.clock.getUs()
    const segments = options.segments()
    if (!segments?.length) { pendingSeekUs = null; return }
    const action = cutPlaybackAction(sourceUs, segments, options.mediaDurationUs())
    if (action.kind === 'play') { pendingSeekUs = null; return }
    if (action.kind === 'end') {
      pendingSeekUs = null
      options.pause()
      return
    }
    if (pendingSeekUs === action.sourceUs) return
    pendingSeekUs = action.sourceUs
    options.seek(action.sourceUs)
  }

  return {
    /** Subscribe to the frame clock; returns the unsubscribe function. */
    start(): () => void {
      const unsubscribe = options.clock.subscribe(evaluate)
      evaluate()
      return () => { pendingSeekUs = null; unsubscribe() }
    },
    /** Exposed for tests and for a manual seek that should re-arm the controller. */
    evaluate,
  }
}
