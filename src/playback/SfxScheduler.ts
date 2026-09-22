import type { TransportState } from './sequenceClock'

/** The minimal surface the scheduler needs from the transport clock (src/playback/sequenceClock.ts). */
export type SfxClock = {
  getUs(): number
  getState(): TransportState
  subscribeState(listener: () => void): () => void
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

/** An audio clip resolved to what the scheduler needs: a playable URL and where it sits. The
 * scheduler itself never reads project/asset state. `gain` already includes a muted track (0). */
export type SfxClipSpec = {
  id: string
  url: string
  /** Sequence time at which the clip starts playing. */
  startUs: number
  inPointUs: number
  durationUs: number
  gain: number
}

export type SfxScheduler = {
  attach(clock: SfxClock): void
  detach(): void
  setClips(clips: readonly SfxClipSpec[]): void
  /** Developer-facing snapshot for the manual drift checklist (docs/STATUS.md). Real onset
   * accuracy can only be measured against a recording (`scripts/export-parity.mjs`'s method) —
   * this only reports what the Web Audio context itself exposes. */
  debugInfo(): { contextTime: number; baseLatency: number; outputLatency: number; activeCount: number }
}

type BufferState = AudioBufferLike | 'loading' | 'error'

/**
 * Schedules each audio clip's `AudioBufferSourceNode`s against the transport clock
 * (docs/EDITING.md "Playback"). Clips are decoded once per URL and cached. Every play, seek and
 * rate change the transport reports reschedules everything from the clock's position; clips already
 * carry their sequence start, so there is no mapping to do and nothing a cut can drop.
 */
export function createSfxScheduler(deps: {
  createContext: () => AudioContextLike
  fetchArrayBuffer: (url: string) => Promise<ArrayBuffer>
  onIssue?: (clipId: string, message: string) => void
}): SfxScheduler {
  let clock: SfxClock | null = null
  let unsubscribe: (() => void) | null = null
  let lastState = ''
  let ctx: AudioContextLike | null = null
  let clips: readonly SfxClipSpec[] = []
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
        if (clock?.getState().playing) rescheduleAll()
      })
      .catch((error: unknown) => {
        buffers.set(url, 'error')
        const message = error instanceof Error ? error.message : 'Could not decode this sound effect.'
        for (const clip of clips) if (clip.url === url) deps.onIssue?.(clip.id, message)
      })
  }

  function rescheduleAll(): void {
    stopAll()
    if (!clock || !clock.getState().playing) return
    const context = ensureContext()
    const rate = clock.getState().rate || 1
    const posSeqUs = clock.getUs()
    for (const clip of clips) {
      const buffer = buffers.get(clip.url)
      if (!buffer || buffer === 'loading' || buffer === 'error' || clip.gain <= 0) continue
      const startSeqUs = clip.startUs
      const endSeqUs = startSeqUs + clip.durationUs
      if (endSeqUs <= posSeqUs) continue // Already finished.
      const elapsedIntoClipUs = Math.max(0, posSeqUs - startSeqUs)
      // `when` is wall-clock; offset/duration below are buffer-native time, unaffected by rate.
      const when = elapsedIntoClipUs > 0 ? context.currentTime : context.currentTime + (startSeqUs - posSeqUs) / 1_000_000 / rate
      const offsetUs = clip.inPointUs + elapsedIntoClipUs
      const portionUs = clip.durationUs - elapsedIntoClipUs
      if (portionUs <= 0) continue
      const gainNode = context.createGain()
      gainNode.gain.value = clip.gain
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

  // Play, pause, seek and rate changes arrive as transport state changes; a position tick alone is
  // not one, so steady playback never reschedules.
  const onState = () => {
    if (!clock) return
    const state = clock.getState()
    const key = `${state.playing}:${state.rate}:${state.seekEpoch}`
    if (key === lastState) return
    lastState = key
    if (!state.playing) { stopAll(); return }
    void ensureContext().resume().then(rescheduleAll)
  }

  return {
    attach(next) {
      this.detach()
      clock = next
      lastState = ''
      unsubscribe = next.subscribeState(onState)
      onState()
    },
    detach() {
      if (!clock) return
      stopAll()
      unsubscribe?.()
      unsubscribe = null
      clock = null
    },
    setClips(nextClips) {
      clips = nextClips
      const key = nextClips.map((clip) => `${clip.id}:${clip.url}:${clip.startUs}:${clip.inPointUs}:${clip.durationUs}:${clip.gain}`).join('|')
      const urls = new Set(nextClips.map((clip) => clip.url))
      for (const url of urls) if (!buffers.has(url)) decode(url)
      if (key === lastKey) return
      lastKey = key
      if (clock?.getState().playing) rescheduleAll()
    },
    debugInfo() {
      const context = ctx
      return { contextTime: context?.currentTime ?? 0, baseLatency: context?.baseLatency ?? 0, outputLatency: context?.outputLatency ?? 0, activeCount: active.size }
    },
  }
}
