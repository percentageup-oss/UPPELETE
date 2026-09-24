import { describe, expect, it } from 'vitest'
import type { Clip, Track } from './edit'
import { DEFAULT_IMAGE_CLIP_US, dropPlanForAsset, dropTimeAt } from './timelineDrop'

const track = (id: string, kind: Track['kind'], extra: Partial<Track> = {}): Track => ({ id, kind, name: '', muted: false, hidden: false, locked: false, ...extra })
const tracks = [track('v1', 'video'), track('v2', 'video'), track('a1', 'audio')]
const video: Clip = { kind: 'video', id: 'c', trackId: 'v1', assetId: 'x', timelineStartUs: 0, sourceStartUs: 0, sourceEndUs: 10_000_000, opacity: 1, fit: 'contain', gain: 1 }
const title: Clip = { kind: 'image', id: 'i', trackId: 'v2', assetId: 'img', timelineStartUs: 0, sourceStartUs: 0, sourceEndUs: 5_000_000, opacity: 1, fit: 'contain' }

describe('dropTimeAt', () => {
  const rect = { left: 100, width: 1000 }

  it('maps a clientX within the content to sequence time', () => {
    expect(dropTimeAt(600, rect, 10_000_000)).toBe(5_000_000)
  })

  it('clamps before the content start and after its end', () => {
    expect(dropTimeAt(0, rect, 10_000_000)).toBe(0)
    expect(dropTimeAt(5000, rect, 10_000_000)).toBe(10_000_000)
  })
})

describe('dropPlanForAsset', () => {
  it('puts a video on a free video track under or near the pointer, never overwriting a clip it lands on', () => {
    // v1 is free before the existing video starts... but here it's occupied for the whole test
    // fixture, so a drop with no free video track asks the caller for a new one (trackId: null)
    // instead of landing on top of what's already there.
    expect(dropPlanForAsset({ kind: 'video', durationUs: 4_000_000 }, 2_000_000, tracks, [video], 'v2'))
      .toEqual({ kind: 'clip', placement: { trackId: 'v2', startUs: 2_000_000, lengthUs: 4_000_000 } })
    // Dropping onto the span the existing video already occupies is refused, even when explicitly
    // targeted at that track — the pointer target is only honoured when it's actually free there.
    expect(dropPlanForAsset({ kind: 'video', durationUs: 4_000_000 }, 2_000_000, tracks, [video, title], 'v2'))
      .toEqual({ kind: 'clip', placement: { trackId: null, startUs: 2_000_000, lengthUs: 4_000_000 } })
    // Targeting a non-video track falls back to searching video tracks in array order; none free.
    expect(dropPlanForAsset({ kind: 'video', durationUs: 4_000_000 }, 2_000_000, tracks, [video, title], 'a1'))
      .toEqual({ kind: 'clip', placement: { trackId: null, startUs: 2_000_000, lengthUs: 4_000_000 } })
  })

  it('puts an image above the video for three seconds, or asks for a new track when nothing is free', () => {
    expect(dropPlanForAsset({ kind: 'image', durationUs: null }, 1_000_000, tracks, [video]))
      .toEqual({ kind: 'clip', placement: { trackId: 'v2', startUs: 1_000_000, lengthUs: DEFAULT_IMAGE_CLIP_US } })
    expect(dropPlanForAsset({ kind: 'image', durationUs: null }, 1_000_000, tracks, [video, title]))
      .toEqual({ kind: 'clip', placement: { trackId: null, startUs: 1_000_000, lengthUs: DEFAULT_IMAGE_CLIP_US } })
  })

  it('puts audio on a free audio track for its whole length', () => {
    expect(dropPlanForAsset({ kind: 'audio', durationUs: 2_500_000 }, 0, tracks, [video]))
      .toEqual({ kind: 'clip', placement: { trackId: 'a1', startUs: 0, lengthUs: 2_500_000 } })
  })

  it('refuses media whose duration was never read', () => {
    expect(dropPlanForAsset({ kind: 'audio', durationUs: null }, 0, tracks, []).kind).toBe('refused')
    expect(dropPlanForAsset({ kind: 'video', durationUs: null }, 0, tracks, []).kind).toBe('refused')
  })
})

describe('dropTimeAt with headroom', () => {
  it('lands past the program end when the span includes a tail', () => {
    const programUs = 60_000_000
    const spanUs = programUs + 30_000_000
    expect(dropTimeAt(900, { left: 0, width: 1000 }, spanUs)).toBeGreaterThan(programUs)
  })
})
