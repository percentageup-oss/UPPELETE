import { describe, expect, it } from 'vitest'
import { createSequenceClock, SNAP_ERROR_US } from './sequenceClock'

/** A manual frame loop and wall clock, so every tick is explicit. */
function harness() {
  let nowMs = 0
  const callbacks = new Map<number, FrameRequestCallback>()
  let next = 1
  const clock = createSequenceClock({
    now: () => nowMs,
    raf: (callback) => { callbacks.set(next, callback); return next++ },
    caf: (handle) => { callbacks.delete(handle) },
  })
  const frame = (ms: number) => {
    nowMs += ms
    const pending = [...callbacks.values()]
    callbacks.clear()
    for (const callback of pending) callback(nowMs)
  }
  return { clock, frame }
}

describe('sequence clock', () => {
  it('free-runs from wall time while playing and stops at the sequence end', () => {
    const { clock, frame } = harness()
    clock.setDurationUs(1_000_000)
    clock.play()
    frame(250)
    expect(clock.getUs()).toBe(250_000)
    frame(900)
    expect(clock.getUs()).toBe(1_000_000)
    expect(clock.isPlaying()).toBe(false)
  })

  it('runs at the playback rate and holds still while paused', () => {
    const { clock, frame } = harness()
    clock.setRate(2)
    clock.play()
    frame(100)
    expect(clock.getUs()).toBe(200_000)
    clock.pause()
    frame(100)
    expect(clock.getUs()).toBe(200_000)
  })

  it('reports seeks, play and pause as state changes, not position ticks', () => {
    const { clock, frame } = harness()
    const states: string[] = []
    clock.subscribeState(() => states.push(JSON.stringify(clock.getState())))
    clock.set(5_000_000)
    clock.play()
    frame(16)
    clock.pause()
    expect(states).toEqual([
      '{"playing":false,"rate":1,"seekEpoch":1}', '{"playing":true,"rate":1,"seekEpoch":1}', '{"playing":false,"rate":1,"seekEpoch":1}',
    ])
    expect(clock.getUs()).toBe(5_016_000)
  })

  it('slews gently toward the master video and snaps only a large error', () => {
    const { clock, frame } = harness()
    clock.play()
    frame(100) // at 100 ms
    clock.discipline(108_000) // 8 ms ahead: a quarter of it per step
    frame(0)
    expect(clock.getUs()).toBe(102_000)
    clock.discipline(102_000 + SNAP_ERROR_US + 1)
    frame(0)
    expect(clock.getUs()).toBe(102_000 + SNAP_ERROR_US + 1)
  })

  it('restarts from zero when play is pressed at the end', () => {
    const { clock } = harness()
    clock.setDurationUs(1_000)
    clock.set(1_000)
    clock.play()
    expect(clock.getUs()).toBe(0)
  })

  it('pauses exactly at the stop-at point when playing from before it, and plays on past it from after', () => {
    const { clock, frame } = harness()
    clock.setDurationUs(10_000_000)
    clock.setStopAtUs(2_000_000)
    clock.set(1_000_000)
    clock.play()
    frame(600)
    expect(clock.isPlaying()).toBe(true)
    frame(900)
    expect(clock.isPlaying()).toBe(false)
    expect(clock.getUs()).toBe(2_000_000)
    // Started at/after the mark: the Out point no longer applies, so it runs to the sequence end.
    clock.set(3_000_000)
    clock.play()
    frame(500)
    expect(clock.isPlaying()).toBe(true)
    expect(clock.getUs()).toBe(3_500_000)
  })

  it('stops at the sequence end when the stop-at point is cleared', () => {
    const { clock, frame } = harness()
    clock.setDurationUs(1_000_000)
    clock.setStopAtUs(500_000)
    clock.setStopAtUs(null)
    clock.play()
    frame(2000)
    expect(clock.getUs()).toBe(1_000_000)
    expect(clock.isPlaying()).toBe(false)
  })
})
