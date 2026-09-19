import { describe, expect, it, vi } from 'vitest'
import { createPlaybackClock, type FrameVideo } from './playbackClock'

/** A minimal fake video: stores listeners so tests can fire them directly, and a stubbable
 * requestVideoFrameCallback so both the rVFC path and the rAF fallback can be exercised. */
function fakeVideo(overrides: Partial<FrameVideo> = {}): FrameVideo & { fire(type: string): void; setTime(seconds: number, paused?: boolean): void } {
  const listeners = new Map<string, Set<() => void>>()
  let currentTime = 0
  let paused = true
  return {
    get currentTime() { return currentTime },
    get paused() { return paused },
    addEventListener(type, listener) { (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(listener) },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener) },
    fire(type) { for (const listener of listeners.get(type) ?? []) listener() },
    setTime(seconds, nextPaused = paused) { currentTime = seconds; paused = nextPaused },
    ...overrides,
  }
}

describe('createPlaybackClock', () => {
  it('reports the initial currentTime as integer microseconds on attach', () => {
    const clock = createPlaybackClock()
    const video = fakeVideo()
    video.setTime(1.5)
    clock.attach(video)
    expect(clock.getUs()).toBe(1_500_000)
  })

  it('does not notify subscribers when the value is unchanged', () => {
    const clock = createPlaybackClock()
    const listener = vi.fn()
    clock.subscribe(listener)
    clock.set(0)
    expect(listener).not.toHaveBeenCalled()
    clock.set(1)
    expect(listener).toHaveBeenCalledTimes(1)
    clock.set(1)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('starts a requestVideoFrameCallback loop on play and ticks per presented frame', () => {
    const callbacks: ((now: number, metadata: { mediaTime: number }) => void)[] = []
    const video = fakeVideo({
      requestVideoFrameCallback: vi.fn((cb) => { callbacks.push(cb); return callbacks.length }),
      cancelVideoFrameCallback: vi.fn(),
    })
    const clock = createPlaybackClock()
    clock.attach(video)
    video.setTime(0, false)
    video.fire('play')
    expect(video.requestVideoFrameCallback).toHaveBeenCalledTimes(1)
    const listener = vi.fn()
    clock.subscribe(listener)
    callbacks[0](0, { mediaTime: 2.25 })
    expect(clock.getUs()).toBe(2_250_000)
    expect(listener).toHaveBeenCalledTimes(1)
    // Still playing: the tick reschedules itself.
    expect(video.requestVideoFrameCallback).toHaveBeenCalledTimes(2)
  })

  it('falls back to requestAnimationFrame when requestVideoFrameCallback is unavailable', () => {
    const rafCallbacks: FrameRequestCallback[] = []
    const raf = vi.fn((cb: FrameRequestCallback) => { rafCallbacks.push(cb); return rafCallbacks.length })
    const caf = vi.fn()
    const clock = createPlaybackClock(raf, caf)
    const video = fakeVideo()
    clock.attach(video)
    video.setTime(0, false)
    video.fire('play')
    expect(raf).toHaveBeenCalledTimes(1)
    video.setTime(0.5, false)
    rafCallbacks[0](0)
    expect(clock.getUs()).toBe(500_000)
    expect(raf).toHaveBeenCalledTimes(2)
  })

  it('cancels the loop and syncs to the final currentTime on pause', () => {
    const cancelVideoFrameCallback = vi.fn()
    const video = fakeVideo({
      requestVideoFrameCallback: vi.fn((cb) => { setTimeout(() => cb(0, { mediaTime: 0 }), 0); return 7 }),
      cancelVideoFrameCallback,
    })
    const clock = createPlaybackClock()
    clock.attach(video)
    video.setTime(1, false)
    video.fire('play')
    video.setTime(3.4, true)
    video.fire('pause')
    expect(cancelVideoFrameCallback).toHaveBeenCalledWith(7)
    expect(clock.getUs()).toBe(3_400_000)
  })

  it('detach cancels the loop and removes all listeners', () => {
    const cancelVideoFrameCallback = vi.fn()
    const video = fakeVideo({
      requestVideoFrameCallback: vi.fn(() => 3),
      cancelVideoFrameCallback,
    })
    const clock = createPlaybackClock()
    clock.attach(video)
    video.setTime(0, false)
    video.fire('play')
    clock.detach()
    expect(cancelVideoFrameCallback).toHaveBeenCalledWith(3)
    // Firing events on the detached video must not affect the clock any further.
    const before = clock.getUs()
    video.setTime(9, false)
    video.fire('play')
    expect(clock.getUs()).toBe(before)
  })

  it('ignores non-integer or negative values passed to set', () => {
    const clock = createPlaybackClock()
    clock.set(-1)
    expect(clock.getUs()).toBe(0)
    clock.set(1.5)
    expect(clock.getUs()).toBe(0)
    clock.set(NaN)
    expect(clock.getUs()).toBe(0)
  })
})
