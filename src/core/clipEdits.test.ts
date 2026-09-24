import { describe, expect, it } from 'vitest'
import type { Clip, Track } from './edit'
import {
  ClipEditError, carveRange, closeGap, deleteClip, freeTrackFor, gapsOnTrack, moveClip, placeClip, rippleInsertionPoint, snapTargets,
  splitAllAt, splitClip, trimClip,
} from './clipEdits'
import { clipEndUs, firstOverlap } from './timelineModel'

const track = (id: string, kind: Track['kind'] = 'video', extra: Partial<Track> = {}): Track => ({ id, kind, name: '', muted: false, hidden: false, locked: false, ...extra })
const video = (id: string, timelineStartUs: number, sourceStartUs: number, sourceEndUs: number, trackId = 'v1', assetId = 'x'): Clip =>
  ({ kind: 'video', id, trackId, assetId, timelineStartUs, sourceStartUs, sourceEndUs, opacity: 1, fit: 'contain', gain: 1 })
const image = (id: string, timelineStartUs: number, lengthUs: number, trackId = 'v2'): Clip =>
  ({ kind: 'image', id, trackId, assetId: 'img', timelineStartUs, sourceStartUs: 0, sourceEndUs: lengthUs, opacity: 1, fit: 'contain' })
const audio = (id: string, timelineStartUs: number, lengthUs: number): Clip =>
  ({ kind: 'audio', id, trackId: 'a1', assetId: 'snd', timelineStartUs, sourceStartUs: 0, sourceEndUs: lengthUs, gain: 1 })

const tracks = [track('v1'), track('v2'), track('a1', 'audio')]
const ids = () => { let serial = 0; return () => `new-${++serial}` }
const layout = (clips: readonly Clip[]) => clips.map((clip) => [clip.id, clip.trackId, clip.timelineStartUs, clip.sourceStartUs, clip.sourceEndUs])
const US = 1_000_000

describe('clip edits', () => {
  // A: 0-4s, B: 4-8s, C: 10-14s (a 2s gap before C).
  const base = [video('A', 0, 0, 4 * US), video('B', 4 * US, 10 * US, 14 * US), video('C', 10 * US, 20 * US, 24 * US)]

  it('overwrite placement carves what it lands on, splitting a clip it lands inside', () => {
    const next = placeClip(tracks, base, video('N', 1 * US, 50 * US, 52 * US), 'overwrite', ids())
    expect(layout(next)).toEqual([
      ['A', 'v1', 0, 0, 1 * US], ['N', 'v1', 1 * US, 50 * US, 52 * US], ['new-1', 'v1', 3 * US, 3 * US, 4 * US],
      ['B', 'v1', 4 * US, 10 * US, 14 * US], ['C', 'v1', 10 * US, 20 * US, 24 * US],
    ])
    expect(firstOverlap(tracks, next)).toBeNull()
  })

  it('ripple placement never splits: it inserts at the nearer clip edge and pushes the rest right', () => {
    expect(rippleInsertionPoint(base, 'v1', 1 * US)).toBe(0)
    expect(rippleInsertionPoint(base, 'v1', 3 * US)).toBe(4 * US)
    const next = placeClip(tracks, base, video('N', 3 * US, 50 * US, 52 * US), 'ripple', ids())
    expect(layout(next)).toEqual([
      ['A', 'v1', 0, 0, 4 * US], ['N', 'v1', 4 * US, 50 * US, 52 * US], ['B', 'v1', 6 * US, 10 * US, 14 * US], ['C', 'v1', 12 * US, 20 * US, 24 * US],
    ])
  })

  it('lift leaves a gap; ripple delete closes up only its own track', () => {
    const withAudio = [...base, audio('S', 9 * US, 2 * US)]
    expect(layout(deleteClip(tracks, withAudio, 'B', 'overwrite')).map((entry) => entry[0])).toEqual(['A', 'C', 'S'])
    const rippled = deleteClip(tracks, withAudio, 'B', 'ripple')
    expect(layout(rippled)).toEqual([['A', 'v1', 0, 0, 4 * US], ['C', 'v1', 6 * US, 20 * US, 24 * US], ['S', 'a1', 9 * US, 0, 2 * US]])
  })

  it('ripple insert then ripple delete round-trips exactly', () => {
    const inserted = placeClip(tracks, base, video('N', 4 * US, 50 * US, 51 * US), 'ripple', ids())
    expect(deleteClip(tracks, inserted, 'N', 'ripple')).toEqual(base)
  })

  it('moves within a track (overwrite carves the landing range) and across tracks of the same kind', () => {
    const moved = moveClip(tracks, base, 'C', 'v1', 3 * US, 'overwrite', ids())
    expect(layout(moved)).toEqual([['A', 'v1', 0, 0, 3 * US], ['C', 'v1', 3 * US, 20 * US, 24 * US], ['B', 'v1', 7 * US, 13 * US, 14 * US]])
    const across = moveClip(tracks, base, 'B', 'v2', 1 * US, 'overwrite', ids())
    expect(layout(across).find((entry) => entry[0] === 'B')).toEqual(['B', 'v2', 1 * US, 10 * US, 14 * US])
    expect(() => moveClip(tracks, base, 'B', 'a1', 0, 'overwrite', ids())).toThrow(ClipEditError)
  })

  it('a ripple move on one track is a reorder', () => {
    const reordered = moveClip(tracks, base, 'A', 'v1', 8 * US, 'ripple', ids())
    expect(layout(reordered)).toEqual([['B', 'v1', 0, 10 * US, 14 * US], ['A', 'v1', 4 * US, 0, 4 * US], ['C', 'v1', 10 * US, 20 * US, 24 * US]])
  })

  it('trims within the source, the asset and (in overwrite) the neighbours', () => {
    // A's start cannot go before source 0; its end cannot run into B.
    expect(layout(trimClip(tracks, base, 'A', 'start', -5 * US, 'overwrite', 60 * US))[0]).toEqual(['A', 'v1', 0, 0, 4 * US])
    expect(layout(trimClip(tracks, base, 'A', 'end', 3 * US, 'overwrite', 60 * US))[0]).toEqual(['A', 'v1', 0, 0, 4 * US])
    // B's end can extend into the gap before C, but no further than C, nor past the asset end.
    expect(layout(trimClip(tracks, base, 'B', 'end', 5 * US, 'overwrite', 60 * US))[1]).toEqual(['B', 'v1', 4 * US, 10 * US, 16 * US])
    expect(layout(trimClip(tracks, base, 'B', 'end', 5 * US, 'overwrite', 15 * US))[1]).toEqual(['B', 'v1', 4 * US, 10 * US, 15 * US])
    // C's start can extend back into the gap, but no further than B's end.
    expect(layout(trimClip(tracks, base, 'C', 'start', -5 * US, 'overwrite', 60 * US))[2]).toEqual(['C', 'v1', 8 * US, 18 * US, 24 * US])
  })

  it('an overwrite trim heals a cut: it passes over pieces that merely continue the clip', () => {
    // A 10 s shot cut by N landing inside it, then N removed: A (0–4) … gap … piece (6–10).
    const cut = deleteClip(tracks, placeClip(tracks, [video('A', 0, 0, 10 * US)], video('N', 4 * US, 50 * US, 52 * US), 'overwrite', ids()), 'N', 'overwrite')
    expect(layout(cut)).toEqual([['A', 'v1', 0, 0, 4 * US], ['new-1', 'v1', 6 * US, 6 * US, 10 * US]])
    // Part way in: the piece is carved to start where A now ends (an invisible through edit).
    expect(layout(trimClip(tracks, cut, 'A', 'end', 3 * US, 'overwrite', 60 * US))).toEqual([['A', 'v1', 0, 0, 7 * US], ['new-1', 'v1', 7 * US, 7 * US, 10 * US]])
    // All the way: one clip again, and on to the source end.
    expect(layout(trimClip(tracks, cut, 'A', 'end', 6 * US, 'overwrite', 60 * US))).toEqual([['A', 'v1', 0, 0, 10 * US]])
    expect(layout(trimClip(tracks, cut, 'A', 'end', 20 * US, 'overwrite', 12 * US))).toEqual([['A', 'v1', 0, 0, 12 * US]])
    // The right piece heals leftwards the same way.
    expect(layout(trimClip(tracks, cut, 'new-1', 'start', -6 * US, 'overwrite', 60 * US))).toEqual([['new-1', 'v1', 0, 0, 10 * US]])
    // Still in overwrite: a different shot, or the same shot at another offset or with other settings, blocks.
    const blocked = (piece: Clip) => layout(trimClip(tracks, [video('A', 0, 0, 4 * US), piece], 'A', 'end', 6 * US, 'overwrite', 60 * US))[0]
    expect(blocked(video('P', 6 * US, 6 * US, 10 * US, 'v1', 'y'))).toEqual(['A', 'v1', 0, 0, 6 * US])
    expect(blocked(video('P', 6 * US, 8 * US, 10 * US))).toEqual(['A', 'v1', 0, 0, 6 * US])
    expect(blocked({ ...video('P', 6 * US, 6 * US, 10 * US), opacity: 0.5 } as Clip)).toEqual(['A', 'v1', 0, 0, 6 * US])
    // A blocker beyond the piece still stops the trim.
    expect(layout(trimClip(tracks, [...cut, video('C', 11 * US, 0, 2 * US, 'v1', 'y')], 'A', 'end', 20 * US, 'overwrite', 60 * US))[0]).toEqual(['A', 'v1', 0, 0, 11 * US])
  })

  it('a ripple trim keeps the clip start fixed and moves everything after it', () => {
    const shorter = trimClip(tracks, base, 'A', 'start', 1 * US, 'ripple', 60 * US)
    expect(layout(shorter)).toEqual([['A', 'v1', 0, 1 * US, 4 * US], ['B', 'v1', 3 * US, 10 * US, 14 * US], ['C', 'v1', 9 * US, 20 * US, 24 * US]])
    const longer = trimClip(tracks, base, 'A', 'end', 2 * US, 'ripple', 60 * US)
    expect(layout(longer)).toEqual([['A', 'v1', 0, 0, 6 * US], ['B', 'v1', 6 * US, 10 * US, 14 * US], ['C', 'v1', 12 * US, 20 * US, 24 * US]])
    expect(trimClip(tracks, longer, 'A', 'end', -2 * US, 'ripple', 60 * US)).toEqual(base)
  })

  it('images have no source bound: their start extends freely and their range stays anchored at 0', () => {
    const clips = [image('I', 5 * US, 2 * US)]
    expect(layout(trimClip(tracks, clips, 'I', 'start', -3 * US, 'overwrite', null))).toEqual([['I', 'v2', 2 * US, 0, 5 * US]])
    expect(layout(splitClip(tracks, clips, 'I', 6 * US, 'I2'))).toEqual([['I', 'v2', 5 * US, 0, 1 * US], ['I2', 'v2', 6 * US, 0, 1 * US]])
  })

  it('splits only strictly inside, and split-all skips locked tracks', () => {
    expect(splitClip(tracks, base, 'A', 0, 'n')).toEqual(base)
    const lockedV2 = [track('v1'), track('v2', 'video', { locked: true }), track('a1', 'audio')]
    const clips = [...base, image('I', 1 * US, 4 * US)]
    const result = splitAllAt(lockedV2, clips, 2 * US, ids())
    expect(result.split).toEqual(['A'])
    expect(layout(result.clips).map((entry) => entry[0])).toEqual(['A', 'new-1', 'B', 'C', 'I'])
    expect(() => deleteClip(lockedV2, clips, 'I', 'overwrite')).toThrow(/locked/)
  })

  it('lists and closes gaps', () => {
    expect(gapsOnTrack(base, 'v1')).toEqual([{ startUs: 8 * US, endUs: 10 * US }])
    expect(layout(closeGap(tracks, base, 'v1', 9 * US))[2]).toEqual(['C', 'v1', 8 * US, 20 * US, 24 * US])
    expect(() => closeGap(tracks, base, 'v1', 1 * US)).toThrow(/no gap/)
  })

  it('carving a range in the middle of one clip leaves two pieces', () => {
    const carved = carveRange([video('A', 0, 0, 10 * US)], 'v1', { startUs: 2 * US, endUs: 3 * US }, () => 'right')
    expect(layout(carved)).toEqual([['A', 'v1', 0, 0, 2 * US], ['right', 'v1', 3 * US, 3 * US, 10 * US]])
    expect(carved.map(clipEndUs)).toEqual([2 * US, 10 * US])
  })

  it('offers every clip edge as a snap target, and finds a free track (images above video)', () => {
    expect(snapTargets(base, ['B'], [7 * US])).toEqual([0, 4 * US, 7 * US, 10 * US, 14 * US])
    expect(freeTrackFor(tracks, base, 'image', { startUs: 0, endUs: US })).toBe('v2')
    expect(freeTrackFor(tracks, [...base, image('I', 0, 2 * US)], 'image', { startUs: 0, endUs: US })).toBeNull()
    expect(freeTrackFor(tracks, base, 'video', { startUs: 8 * US, endUs: 9 * US })).toBe('v1')
  })
})
