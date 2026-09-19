import { sourceToSequence, type TimeRange } from '../core/sequence'

/** The minimal surface the scheduler needs from an `HTMLVideoElement` — mirrors
 * `src/core/playbackClock.ts`'s `FrameVideo`, kept narrow so tests can supply a plain fake. */
export type SfxVideo = {
  readonly paused: boolean
  readonly currentTime: number
  readonly playbackRate: number
  readonly muted: boolean
  readonly volume: number
  addEventListener(type: string, listener: () => void): void
  removeEventListener(type: string, listener: () => void): void
}

/** The minimal `AudioContext`/`AudioBufferSourceNode`/`GainNode` surface used, so a test can
 * supply a fake implementation instead of a real `AudioContext` (none exists under vitest's node
 * environment, and jsdom does not implement Web Audio either). */
export type AudioBufferLike = { duration: number }
export type AudioParamLike = { value: number }
export type AudioNodeLike = { connect(target: AudioNodeLike): AudioNodeLike; disconnect(): void }
export type GainNodeLike = AudioNodeLike & { gain: AudioParamLike }
export type BufferSourceNodeLike = AudioNodeLike & {
  buffer: AudioBufferLike | null
  playbackRate: AudioParamLike
  // Shaped like the real `AudioScheduledSourceNode.onended` (this project's assignments are always
  // zero-arg, which remains assignable here) so a real `AudioContext` satisfies `AudioContextLike`.
  onended: ((ev: Event) => unknown) | null
  start(when?: number, offset?: number, duration?: number): void
  stop(when?: number): void
}
export type AudioContextLike = {
  readonly currentTime: number
  readonly destination: AudioNodeLike
  readonly baseLatency?: number
  readonly outputLatency?: number
  createGain(): GainNodeLike
  createBufferSource(): BufferSourceNodeLike
  decodeAudioData(data: ArrayBuffer): Promise<AudioBufferLike>
  resume(): Promise<void>
}

/** A clip resolved to what the scheduler needs: a playable URL and its length already resolved to
 * a concrete number of microseconds (`clipDurationUs`, `src/core/sfxClip.ts`) — the scheduler
 * itself never reads project/asset state. */
export type SfxClipSpec = {
  id: string
  url: string
  /** Source-time anchor; mapped to sequence time per reschedule via `sourceToSequence`. */
  atUs: number
  inPointUs: number
  durationUs: number
  gain: number
}

export type SfxScheduler = {
  attach(video: SfxVideo): void
  detach(): void
  setClips(clips: readonly SfxClipSpec[], segments: readonly TimeRange[] | undefined, mediaDurationUs: number | null): void
  /** Developer-facing snapshot for the manual drift checklist (docs/STATUS.md). Real onset
   * accuracy can only be measured against a recording (`scripts/export-parity.mjs`'s method) —
   * this only reports what the Web Audio context itself exposes. */
  debugInfo(): { contextTime: number; baseLatency: number; outputLatency: number; activeCount: number }
}

const EVENTS = ['play', 'seeked', 'ratechange', 'pause', 'ended', 'emptied', 'volumechange'] as const

type BufferState = AudioBufferLike | 'loading' | 'error'

/**
 * Schedules each sound effect's `AudioBufferSourceNode`s against the `<video>` element's clock
 * (docs/EDITING.md's "Preview compositing and playback"). Clips are decoded once per URL and
 * cached; a cut is a seek from the video's own point of view, so `seeked` re-scheduling is the one
 * mechanism that keeps clips in sync across it — no separate cut-awareness is needed here beyond
 * mapping each clip's anchor through `sourceToSequence` and dropping it when the cut removed it.
 */
export function createSfxScheduler(deps: {
  createContext: () => AudioContextLike
  fetchArrayBuffer: (url: string) => Promise<ArrayBuffer>
  onIssue?: (clipId: string, message: string) => void
}): SfxScheduler {
  let video: SfxVideo | null = null
  let ctx: AudioContextLike | null = null
  let clips: readonly SfxClipSpec[] = []
  let segments: readonly TimeRange[] | undefined
  let mediaDurationUs: number | null = null
  const buffers = new Map<string, BufferState>()
  const active = new Map<string, { source: BufferSourceNodeLike; gain: GainNodeLike; clipGain: number }>()
  let lastKey = ''

  const ensureContext = (): AudioContextLike => { if (!ctx) ctx = deps.createContext(); return ctx }

  const stopAll = () => {
    for (const { source, gain } of active.values()) {
      try { source.onended = null; source.stop() } catch { /* already stopped */ }
      source.disconnect()
      gain.disconnect()
    }
    active.clear()
  }

  const decode = (url: string): void => {
    if (buffers.has(url)) return
    buffers.set(url, 'loading')
    void deps.fetchArrayBuffer(url)
      .then((data) => ensureContext().decodeAudioData(data))
      .then((buffer) => {
        buffers.set(url, buffer)
        if (video && !video.paused) rescheduleAll()
      })
      .catch((error: unknown) => {
        buffers.set(url, 'error')
        const message = error instanceof Error ? error.message : 'Could not decode this sound effect.'
        for (const clip of clips) if (clip.url === url) deps.onIssue?.(clip.id, message)
      })
  }

  function rescheduleAll(): void {
    stopAll()
    if (!video || video.paused) return
    const context = ensureContext()
    const rate = video.playbackRate || 1
    const posSourceUs = Math.round(video.currentTime * 1_000_000)
    const posSeqUs = sourceToSequence(posSourceUs, segments, mediaDurationUs).sequenceUs
    for (const clip of clips) {
      const buffer = buffers.get(clip.url)
      if (!buffer || buffer === 'loading' || buffer === 'error') continue
      const point = sourceToSequence(clip.atUs, segments, mediaDurationUs)
      if (!point.kept) continue // Anchored inside a removed range — dropped, like the export builder.
      const startSeqUs = point.sequenceUs
      const endSeqUs = startSeqUs + clip.durationUs
      if (endSeqUs <= posSeqUs) continue // Already finished.
      const elapsedIntoClipUs = Math.max(0, posSeqUs - startSeqUs)
      // `when` is wall-clock; offset/duration below are buffer-native time, unaffected by rate.
      const when = elapsedIntoClipUs > 0 ? context.currentTime : context.currentTime + (startSeqUs - posSeqUs) / 1_000_000 / rate
      const offsetUs = clip.inPointUs + elapsedIntoClipUs
      const portionUs = clip.durationUs - elapsedIntoClipUs
      if (portionUs <= 0) continue
      const gainNode = context.createGain()
      gainNode.gain.value = clip.gain * (video.muted ? 0 : video.volume)
      const source = context.createBufferSource()
      source.buffer = buffer
      source.playbackRate.value = rate
      source.connect(gainNode)
      gainNode.connect(context.destination)
      source.onended = () => { active.delete(clip.id) }
      source.start(when, offsetUs / 1_000_000, portionUs / 1_000_000)
      active.set(clip.id, { source, gain: gainNode, clipGain: clip.gain })
    }
  }

  const onPlay = () => { void ensureContext().resume().then(rescheduleAll) }
  const onReschedule = () => { if (video && !video.paused) rescheduleAll() }
  const onStop = () => stopAll()
  const onVolumeChange = () => {
    if (!video) return
    const factor = video.muted ? 0 : video.volume
    for (const entry of active.values()) entry.gain.gain.value = entry.clipGain * factor
  }
  const listeners: Record<(typeof EVENTS)[number], () => void> = {
    play: onPlay, seeked: onReschedule, ratechange: onReschedule,
    pause: onStop, ended: onStop, emptied: onStop, volumechange: onVolumeChange,
  }

  return {
    attach(next) {
      this.detach()
      video = next
      for (const type of EVENTS) video.addEventListener(type, listeners[type])
      if (!video.paused) onPlay()
    },
    detach() {
      if (!video) return
      stopAll()
      for (const type of EVENTS) video.removeEventListener(type, listeners[type])
      video = null
    },
    setClips(nextClips, nextSegments, nextMediaDurationUs) {
      clips = nextClips
      segments = nextSegments
      mediaDurationUs = nextMediaDurationUs
      const key = nextClips.map((clip) => `${clip.id}:${clip.url}:${clip.atUs}:${clip.inPointUs}:${clip.durationUs}:${clip.gain}`).join('|')
        + `#${nextSegments?.map((range) => `${range.startUs}-${range.endUs}`).join(',') ?? ''}#${nextMediaDurationUs}`
      const urls = new Set(nextClips.map((clip) => clip.url))
      for (const url of urls) if (!buffers.has(url)) decode(url)
      if (key === lastKey) return
      lastKey = key
      if (video && !video.paused) rescheduleAll()
    },
    debugInfo() {
      const context = ctx
      return { contextTime: context?.currentTime ?? 0, baseLatency: context?.baseLatency ?? 0, outputLatency: context?.outputLatency ?? 0, activeCount: active.size }
    },
  }
}
