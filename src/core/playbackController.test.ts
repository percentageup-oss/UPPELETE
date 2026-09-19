import { describe, expect, it, vi } from 'vitest'
import { createPlaybackClock } from './playbackClock'
import { createCutPlaybackController, cutPlaybackAction } from './playbackController'
import type { TimeRange } from './sequence'

const MEDIA = 10_000_000
/** Keeps 0-2s and 6-10s, so 2-6s is removed. */
const segments: TimeRange[] = [{ startUs: 0, endUs: 2_000_000 }, { startUs: 6_000_000, endUs: 10_000_000 }]

describe('cutPlaybackAction', () => {
  it('plays inside a kept segment, seeks out of a gap and ends past the last segment', () => {
    expect(cutPlaybackAction(1_000_000, segments, MEDIA)).toEqual({ kind: 'play' })
    expect(cutPlaybackAction(2_000_000, segments, MEDIA)).toEqual({ kind: 'seek', sourceUs: 6_000_000 })
    expect(cutPlaybackAction(5_999_999, segments, MEDIA)).toEqual({ kind: 'seek', sourceUs: 6_000_000 })
    expect(cutPlaybackAction(10_000_000, segments, MEDIA)).toEqual({ kind: 'end' })
  })

  it('always plays for the identity edit, so an uncut project behaves exactly as before', () => {
    for (const us of [0, 1_000_000, 5_000_000, MEDIA - 1]) {
      expect(cutPlaybackAction(us, undefined, MEDIA)).toEqual({ kind: 'play' })
    }
  })
})

describe('createCutPlaybackController', () => {
  const setup = (list: TimeRange[] | undefined, playing = true) => {
    const clock = createPlaybackClock()
    const seek = vi.fn()
    const pause = vi.fn()
    const controller = createCutPlaybackController({
      clock, segments: () => list, mediaDurationUs: () => MEDIA, playing: () => playing, seek, pause,
    })
    const stop = controller.start()
    return { clock, seek, pause, stop }
  }

  it('issues exactly one seek per gap, however many frames report a removed time', () => {
    const { clock, seek, stop } = setup(segments)
    for (const us of [1_000_000, 1_900_000]) clock.set(us)
    expect(seek).not.toHaveBeenCalled()
    // The video keeps presenting frames inside the removed range until the seek lands.
    for (const us of [2_000_000, 2_100_000, 3_000_000, 5_000_000]) clock.set(us)
    expect(seek).toHaveBeenCalledTimes(1)
    expect(seek).toHaveBeenCalledWith(6_000_000)
    // Once playback resumes in the kept segment the controller re-arms for the next gap.
    clock.set(6_100_000)
    clock.set(7_000_000)
    expect(seek).toHaveBeenCalledTimes(1)
    stop()
  })

  it('issues one seek per gap across three gaps', () => {
    const three: TimeRange[] = [
      { startUs: 0, endUs: 1_000_000 }, { startUs: 3_000_000, endUs: 4_000_000 },
      { startUs: 6_000_000, endUs: 7_000_000 }, { startUs: 9_000_000, endUs: 10_000_000 },
    ]
    const { clock, seek, stop } = setup(three)
    for (const us of [500_000, 1_000_000, 1_500_000, 3_200_000, 4_000_000, 4_500_000, 6_500_000, 7_000_000, 8_000_000, 9_500_000]) clock.set(us)
    expect(seek.mock.calls.map((call) => call[0])).toEqual([3_000_000, 6_000_000, 9_000_000])
    stop()
  })

  it('pauses instead of seeking past the end of the last kept segment', () => {
    const { clock, seek, pause, stop } = setup(segments)
    clock.set(10_000_000)
    expect(pause).toHaveBeenCalledTimes(1)
    expect(seek).not.toHaveBeenCalled()
    stop()
  })

  it('does nothing at all while paused or for an uncut project', () => {
    const paused = setup(segments, false)
    paused.clock.set(3_000_000)
    expect(paused.seek).not.toHaveBeenCalled()
    expect(paused.pause).not.toHaveBeenCalled()
    paused.stop()

    const identity = setup(undefined)
    identity.clock.set(3_000_000)
    identity.clock.set(MEDIA)
    expect(identity.seek).not.toHaveBeenCalled()
    expect(identity.pause).not.toHaveBeenCalled()
    identity.stop()
  })

  it('stops responding after its subscription is released', () => {
    const { clock, seek, stop } = setup(segments)
    stop()
    clock.set(3_000_000)
    expect(seek).not.toHaveBeenCalled()
  })
})
