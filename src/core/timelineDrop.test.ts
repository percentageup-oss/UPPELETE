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
  it('puts a video on the video track under the pointer, else V1 — never replacing the source', () => {
    expect(dropPlanForAsset({ kind: 'video', durationUs: 4_000_000 }, 2_000_000, tracks, [video], 'v2'))
      .toEqual({ kind: 'clip', placement: { trackId: 'v2', startUs: 2_000_000, lengthUs: 4_000_000 } })
    expect(dropPlanForAsset({ kind: 'video', durationUs: 4_000_000 }, 2_000_000, tracks, [video], 'a1'))
      .toEqual({ kind: 'clip', placement: { trackId: 'v1', startUs: 2_000_000, lengthUs: 4_000_000 } })
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
