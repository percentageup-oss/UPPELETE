import { describe, expect, it } from 'vitest'
import { createSfxScheduler, type AudioContextLike, type BufferSourceNodeLike, type SfxClock } from './SfxScheduler'
import type { TransportState } from './sequenceClock'

function fakeAudio() {
  const started: { when: number; offset: number; duration: number; gain: number }[] = []
  const context: AudioContextLike = {
    currentTime: 100,
    destination: { connect: (target) => target, disconnect: () => {} },
    createGain: () => {
      const node = { gain: { value: 1 }, connect: (target: unknown) => target, disconnect: () => {} }
      return node as never
    },
    createBufferSource: () => {
      let gainNode: { gain: { value: number } } | null = null
      const source: BufferSourceNodeLike = {
        buffer: null, playbackRate: { value: 1 }, onended: null,
        connect: (target) => { gainNode = target as never; return target },
        disconnect: () => {},
        start: (when = 0, offset = 0, duration = 0) => started.push({ when, offset, duration, gain: gainNode?.gain.value ?? -1 }),
        stop: () => {},
      }
      return source
    },
    decodeAudioData: async () => ({ duration: 10 }),
    resume: async () => {},
  }
  return { context, started }
}

function fakeClock(initial: TransportState, us: number) {
  let state = initial
  let position = us
  const listeners = new Set<() => void>()
  const clock: SfxClock = {
    getUs: () => position,
    getState: () => state,
    subscribeState: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
  const update = (next: Partial<TransportState>, at = position) => { state = { ...state, ...next }; position = at; for (const listener of listeners) listener() }
  return { clock, update }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('SFX scheduler', () => {
  it('schedules clips from their sequence start, reschedules on a seek and stops on pause', async () => {
    const { context, started } = fakeAudio()
    const scheduler = createSfxScheduler({ createContext: () => context, fetchArrayBuffer: async () => new ArrayBuffer(8) })
    scheduler.setClips([{ id: 's', url: 'media://s', startUs: 2_000_000, inPointUs: 500_000, durationUs: 1_000_000, gain: 0.5 }])
    await flush()
    const { clock, update } = fakeClock({ playing: false, rate: 1, seekEpoch: 0 }, 0)
    scheduler.attach(clock)
    update({ playing: true })
    await flush()
    expect(started).toEqual([{ when: 102, offset: 0.5, duration: 1, gain: 0.5 }])
    // Seeking into the middle starts it now, from the right point in the file.
    update({ seekEpoch: 1 }, 2_400_000)
    await flush()
    expect(started.at(-1)).toEqual({ when: 100, offset: 0.9, duration: 0.6, gain: 0.5 })
    update({ playing: false })
    expect(scheduler.debugInfo().activeCount).toBe(0)
  })

  it('never plays a clip on a muted track', async () => {
    const { context, started } = fakeAudio()
    const scheduler = createSfxScheduler({ createContext: () => context, fetchArrayBuffer: async () => new ArrayBuffer(8) })
    scheduler.setClips([{ id: 's', url: 'media://s', startUs: 0, inPointUs: 0, durationUs: 1_000_000, gain: 0 }])
    await flush()
    const { clock, update } = fakeClock({ playing: false, rate: 1, seekEpoch: 0 }, 0)
    scheduler.attach(clock)
    update({ playing: true })
    await flush()
    expect(started).toEqual([])
  })
})
