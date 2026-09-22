import type { Clip, Track } from '../core/edit'
import { activeClipsAt, nextBoundaryAfter } from '../core/timelineModel'
import type { SequenceClock } from './sequenceClock'
import type { PooledVideo, VideoLike, VideoPool } from './videoPool'

/**
 * Sequence playback across clips and stacked tracks (docs/EDITING.md "Playback"). One pooled
 * `<video>` per (track, asset) — per track alone would force a full `src` reload between
 * consecutive clips of different files, per clip would be unbounded.
 *
 * `transportActionsAt` is the whole rule, pure so it is tested against plain records: given where
 * the playhead is and what each element is doing, it says which element to load, seek, play or
 * pause. Shortly before a clip begins its element is **prerolled** — loaded and seeked while
 * paused — because a seek (100-400 ms) is what makes a boundary stall; starting an already-seeked
 * element is cheap.
 *
 * The **master** — the topmost playing video, the one the clock is disciplined to — is never
 * re-seeked for ordinary drift: a seek is exactly what stops a decoder presenting frames (100-400 ms
 * at 1440x2560), so seeking it only makes it fall further behind; the clock is corrected toward it
 * instead (`SequenceClock.discipline`, fed from its presented-frame time). It is seeked only on an
 * explicit seek, or as a last resort when a full second out. Every other playing video (a
 * picture-in-picture, a lower track) has nothing disciplining it, so a re-seek past the playing
 * tolerance is still its only correction.
 */
export type ElementKey = string
export const elementKey = (trackId: string, assetId: string): ElementKey => `${trackId}/${assetId}`

/** What the transport needs to know about one pooled element. */
export type ElementState = { key: ElementKey; trackId: string; assetId: string; currentUs: number; paused: boolean; seeking: boolean; loaded: boolean }

export type TransportAction =
  | { kind: 'load'; key: ElementKey; trackId: string; assetId: string }
  | { kind: 'seek'; key: ElementKey; sourceUs: number }
  | { kind: 'play'; key: ElementKey }
  | { kind: 'pause'; key: ElementKey }

export type TransportOptions = {
  playing: boolean
  /** True for the evaluation right after an explicit seek, so a playing element jumps to the new
   * playhead at once instead of waiting for `discipline` to slew the clock all the way back. */
  justSought?: boolean
  /** The master video this far from where it should be is re-seeked as a last resort. Smaller
   * drift is the clock's job (`discipline`), never a seek. */
  playingDriftLimitUs?: number
  /** How far any other playing video may drift before it is re-seeked; nothing else corrects it. */
  playingToleranceUs?: number
  /** While paused (scrubbing), elements are held to within this of the playhead. */
  pausedToleranceUs?: number
  /** How long before a clip starts its element is loaded and seeked. */
  prerollUs?: number
}

export const DEFAULT_PLAYING_DRIFT_LIMIT_US = 1_000_000
export const DEFAULT_PLAYING_TOLERANCE_US = 250_000
export const DEFAULT_PAUSED_TOLERANCE_US = 20_000
export const DEFAULT_PREROLL_US = 500_000

/** The element each visible video track needs now, and the ones it will need next. */
export function wantedElements(sequenceUs: number, tracks: readonly Track[], clips: readonly Clip[], prerollUs = DEFAULT_PREROLL_US) {
  const videoClips = clips.filter((clip) => clip.kind === 'video')
  const active = activeClipsAt(sequenceUs, tracks, videoClips, { skipHidden: true })
  const activeKeys = new Map(active.map((entry) => [elementKey(entry.track.id, entry.clip.assetId), entry]))
  const preroll = new Map<ElementKey, { trackId: string; assetId: string; sourceUs: number }>()
  const upcoming = nextBoundaryAfter(sequenceUs, videoClips)
  if (upcoming !== null && upcoming - sequenceUs <= prerollUs) {
    for (const track of tracks) {
      if (track.kind !== 'video' || track.hidden) continue
      const next = videoClips.find((clip) => clip.trackId === track.id && clip.timelineStartUs > sequenceUs && clip.timelineStartUs <= sequenceUs + prerollUs)
      if (!next) continue
      const key = elementKey(track.id, next.assetId)
      if (!activeKeys.has(key)) preroll.set(key, { trackId: track.id, assetId: next.assetId, sourceUs: next.sourceStartUs })
    }
  }
  return { active, activeKeys, preroll }
}

export function transportActionsAt(sequenceUs: number, tracks: readonly Track[], clips: readonly Clip[], elements: readonly ElementState[], options: TransportOptions): TransportAction[] {
  const playingDriftLimit = options.playingDriftLimitUs ?? DEFAULT_PLAYING_DRIFT_LIMIT_US
  const playingTolerance = options.playingToleranceUs ?? DEFAULT_PLAYING_TOLERANCE_US
  const pausedTolerance = options.pausedToleranceUs ?? DEFAULT_PAUSED_TOLERANCE_US
  const { activeKeys, preroll } = wantedElements(sequenceUs, tracks, clips, options.prerollUs)
  const byKey = new Map(elements.map((element) => [element.key, element]))
  // The last active key is the topmost video: the one `createSequenceTransport` arms as master.
  const masterKey = [...activeKeys.keys()].at(-1)
  const actions: TransportAction[] = []
  for (const [key, entry] of activeKeys) {
    const element = byKey.get(key)
    if (!element || !element.loaded) {
      actions.push({ kind: 'load', key, trackId: entry.track.id, assetId: entry.clip.assetId }, { kind: 'seek', key, sourceUs: entry.sourceUs })
      if (options.playing) actions.push({ kind: 'play', key })
      continue
    }
    const driftUs = Math.abs(element.currentUs - entry.sourceUs)
    if (options.playing) {
      const limit = key === masterKey ? playingDriftLimit : playingTolerance
      if (!element.seeking && (options.justSought || driftUs > limit)) actions.push({ kind: 'seek', key, sourceUs: entry.sourceUs })
      if (element.paused) actions.push({ kind: 'play', key })
    } else {
      if (!element.seeking && driftUs > pausedTolerance) actions.push({ kind: 'seek', key, sourceUs: entry.sourceUs })
      if (!element.paused) actions.push({ kind: 'pause', key })
    }
  }
  for (const [key, entry] of preroll) {
    const element = byKey.get(key)
    if (!element || !element.loaded) {
      actions.push({ kind: 'load', key, trackId: entry.trackId, assetId: entry.assetId }, { kind: 'seek', key, sourceUs: entry.sourceUs })
      continue
    }
    if (!element.paused) actions.push({ kind: 'pause', key })
    if (!element.seeking && Math.abs(element.currentUs - entry.sourceUs) > pausedTolerance) actions.push({ kind: 'seek', key, sourceUs: entry.sourceUs })
  }
  // Everything else falls silent; the pool evicts it when it needs the slot.
  for (const element of elements) {
    if (!activeKeys.has(element.key) && !preroll.has(element.key) && !element.paused) actions.push({ kind: 'pause', key: element.key })
  }
  return actions
}

/** The clip each active key is playing, for volume/mute and for the master clock discipline. */
export function activeByKey(sequenceUs: number, tracks: readonly Track[], clips: readonly Clip[]) {
  return wantedElements(sequenceUs, tracks, clips, 0).activeKeys
}

// ---------------------------------------------------------------------------------------------
// The runtime: applies `transportActionsAt` to a pool of real elements on every clock change.
// ---------------------------------------------------------------------------------------------

export type TransportTimeline = {
  tracks: readonly Track[]
  clips: readonly Clip[]
  /** The runtime `media://` URL of an asset, or `null` while it is offline. */
  urlOf(assetId: string): string | null
}

export type SequenceTransport = {
  /** Starts following `clock`. The subscription belongs to the caller's effect, not to the
   * transport's construction, so it survives an effect being torn down and set up again (React
   * StrictMode does exactly that on mount). Detaches from any clock it followed before. */
  attach(clock: SequenceClock): void
  /** Stops following the clock. The pooled elements stay loaded, so a re-attach does not reload media. */
  detach(): void
  /** Re-evaluate now — after a timeline edit, a relink or a track mute/hide toggle. */
  refresh(): void
  /** The element currently showing (track, asset), for the compositor's `VideoSlot`. */
  elementFor(trackId: string, assetId: string): VideoLike | null
  /** Detaches and unloads every pooled element. */
  dispose(): void
}

/**
 * Reads the live timeline on every evaluation, so track mute/hide and edits take effect while
 * playing. Video audio plays from the elements themselves: `muted` for a muted track or a silent
 * clip, and `volume = min(gain, 1)` — a gain above 1 needs the audio routed through Web Audio,
 * so preview clamps it to 1 and says so, while export honours it.
 */
export function createSequenceTransport<V extends VideoLike>(options: {
  pool: VideoPool<V>
  timeline: () => TransportTimeline
  onPlayError?: (error: unknown, element: V) => void
}): SequenceTransport {
  const { pool } = options
  let clock: SequenceClock | null = null
  let unsubscribe: (() => void) | null = null
  let unsubscribeState: (() => void) | null = null
  let lastSeekEpoch = 0
  let master: { element: V; handle: number; clip: Clip } | null = null
  const stopMaster = () => {
    if (master?.element.cancelVideoFrameCallback) master.element.cancelVideoFrameCallback(master.handle)
    master = null
  }
  const armMaster = (entry: PooledVideo<V>, clip: Clip) => {
    if (master?.element === entry.element && master.clip.id === clip.id) return
    stopMaster()
    const element = entry.element
    if (!element.requestVideoFrameCallback) return
    const onFrame = (_now: number, metadata: { mediaTime: number }) => {
      if (!master || master.element !== element || !clock) return
      if (clock.isPlaying() && !element.paused && !element.seeking) {
        clock.discipline(master.clip.timelineStartUs + Math.round(metadata.mediaTime * 1_000_000) - master.clip.sourceStartUs)
      }
      master.handle = element.requestVideoFrameCallback!(onFrame)
    }
    master = { element, clip, handle: element.requestVideoFrameCallback(onFrame) }
  }

  const evaluate = () => {
    if (!clock) return
    const { tracks, clips, urlOf } = options.timeline()
    const sequenceUs = clock.getUs()
    const { playing, rate, seekEpoch } = clock.getState()
    // `clock.set` (a scrub, a click on the ruler, a jump) bumps the epoch; nothing else does.
    const justSought = seekEpoch !== lastSeekEpoch
    lastSeekEpoch = seekEpoch
    const states: ElementState[] = pool.entries().map((entry) => ({
      key: entry.key, trackId: entry.trackId, assetId: entry.assetId,
      currentUs: Math.round(entry.element.currentTime * 1_000_000), paused: entry.element.paused, seeking: entry.element.seeking,
      loaded: entry.element.readyState >= 1 && entry.url === urlOf(entry.assetId),
    }))
    for (const action of transportActionsAt(sequenceUs, tracks, clips, states, { playing, justSought })) {
      if (action.kind === 'load') {
        const url = urlOf(action.assetId)
        if (url) pool.acquire(action.key, action.trackId, action.assetId, url)
        continue
      }
      const element = pool.get(action.key)?.element
      if (!element) continue
      if (action.kind === 'seek') element.currentTime = action.sourceUs / 1_000_000
      else if (action.kind === 'pause') element.pause()
      else void element.play().catch((error: unknown) => options.onPlayError?.(error, element))
    }
    const active = activeByKey(sequenceUs, tracks, clips)
    pool.touch(active.keys())
    let top: { entry: PooledVideo<V>; clip: Clip } | null = null
    for (const [key, { track, clip }] of active) {
      const entry = pool.get(key)
      if (!entry) continue
      const gain = clip.kind === 'video' ? clip.gain : 1
      entry.element.muted = track.muted || gain === 0
      entry.element.volume = Math.min(1, gain)
      if (entry.element.playbackRate !== rate) entry.element.playbackRate = rate
      top = { entry, clip }
    }
    if (top && playing) {
      if (top.entry.element.requestVideoFrameCallback) armMaster(top.entry, top.clip)
      else {
        // No presented-frame callback: discipline from `currentTime` instead — coarser, but a playing
        // element is never seeked to correct drift, so the clock must still be pulled onto it.
        stopMaster()
        const { element } = top.entry
        const { clip } = top
        if (!element.paused && !element.seeking) clock.discipline(clip.timelineStartUs + Math.round(element.currentTime * 1_000_000) - clip.sourceStartUs)
      }
    } else stopMaster()
  }

  return {
    attach(next) {
      this.detach()
      clock = next
      lastSeekEpoch = next.getState().seekEpoch
      unsubscribe = next.subscribe(evaluate)
      unsubscribeState = next.subscribeState(evaluate)
      evaluate()
    },
    detach() {
      unsubscribe?.()
      unsubscribeState?.()
      unsubscribe = null
      unsubscribeState = null
      stopMaster()
      clock = null
    },
    refresh: evaluate,
    elementFor(trackId, assetId) { return pool.get(elementKey(trackId, assetId))?.element ?? null },
    dispose() { this.detach(); pool.dispose() },
  }
}
