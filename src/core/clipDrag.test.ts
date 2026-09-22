import { describe, expect, it } from 'vitest'
import type { Clip, Track } from './edit'
import { previewClipDrag } from './clipDrag'

const US = 1_000_000
const track = (id: string, kind: Track['kind'], extra: Partial<Track> = {}): Track => ({ id, kind, name: '', muted: false, hidden: false, locked: false, ...extra })
const tracks = [track('V1', 'video'), track('V2', 'video'), track('A1', 'audio')]
const video = (id: string, timelineStartUs: number, sourceStartUs: number, sourceEndUs: number): Clip =>
  ({ kind: 'video', id, trackId: 'V1', assetId: 'x', timelineStartUs, sourceStartUs, sourceEndUs, opacity: 1, fit: 'contain', gain: 1 })
const a = video('a', 0, 0, 4 * US)
const b = video('b', 6 * US, 10 * US, 12 * US)
const base = { tracks, clips: [a, b], assetDurationUs: 60 * US, editMode: 'overwrite' as const, snap: null, targetTrack: null }

describe('clip drag preview', () => {
  it('moves a clip, snapping an edge to a target, and onto another track of its kind only', () => {
    const moved = previewClipDrag({ ...base, clip: b, mode: 'move', deltaUs: -1_950_000, snap: { targetsUs: [4 * US], thresholdUs: 100_000 } })
    expect(moved.clip.timelineStartUs).toBe(4 * US)
    expect(moved.guideUs).toBe(4 * US)
    expect(previewClipDrag({ ...base, clip: b, mode: 'move', deltaUs: 0, targetTrack: tracks[1] }).clip.trackId).toBe('V2')
    expect(previewClipDrag({ ...base, clip: b, mode: 'move', deltaUs: 0, targetTrack: tracks[2] }).clip.trackId).toBe('V1')
  })

  it('clamps a trim exactly as the commit will: at the neighbour, the source and the asset', () => {
    expect(previewClipDrag({ ...base, clip: a, mode: 'end', deltaUs: 5 * US }).appliedDeltaUs).toBe(2 * US)
    expect(previewClipDrag({ ...base, clip: a, mode: 'start', deltaUs: -3 * US }).appliedDeltaUs).toBe(0)
    const extended = previewClipDrag({ ...base, clip: b, mode: 'start', deltaUs: -1 * US })
    expect([extended.clip.timelineStartUs, extended.clip.sourceStartUs, extended.appliedDeltaUs]).toEqual([5 * US, 9 * US, -1 * US])
  })

  it('reports a ripple start trim as a change of in point, the clip start staying put', () => {
    const rippled = previewClipDrag({ ...base, editMode: 'ripple', clip: b, mode: 'start', deltaUs: 500_000 })
    expect([rippled.clip.timelineStartUs, rippled.clip.sourceStartUs, rippled.appliedDeltaUs]).toEqual([6 * US, 10_500_000, 500_000])
  })
})
