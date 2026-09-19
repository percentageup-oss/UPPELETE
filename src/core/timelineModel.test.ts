import { describe, expect, it } from 'vitest'
import type { Clip, Track } from './edit'
import type { Cue } from './model'
import {
  activeClipsAt, activeCueAt, clipsContainingSource, cuesInSequence, firstOverlap, nextBoundaryAfter, normalizeClips,
  sequenceDurationUs, sequenceUsOf, sourceUsAt, spansInSequence, trackLabel,
} from './timelineModel'

const track = (id: string, kind: Track['kind'] = 'video', extra: Partial<Track> = {}): Track => ({ id, kind, name: '', muted: false, hidden: false, locked: false, ...extra })
const video = (id: string, trackId: string, assetId: string, timelineStartUs: number, sourceStartUs: number, sourceEndUs: number): Clip =>
  ({ kind: 'video', id, trackId, assetId, timelineStartUs, sourceStartUs, sourceEndUs, opacity: 1, fit: 'contain', gain: 1 })
const cue = (id: string, mediaAssetId: string | undefined, startUs: number, endUs: number): Cue =>
  ({ id, mediaAssetId, startUs, endUs, text: id, timingSource: 'imported', needsReview: false, textSource: 'imported', words: [] })

const V1 = track('v1'), V2 = track('v2'), A1 = track('a1', 'audio')
const tracks = [V1, V2, A1]

describe('timeline model', () => {
  it('measures the sequence to the last clip end on any track, gaps included', () => {
    expect(sequenceDurationUs([])).toBe(0)
    expect(sequenceDurationUs([video('a', 'v1', 'x', 0, 0, 5), video('b', 'v2', 'y', 10, 3, 8)])).toBe(15)
  })

  it('maps source ↔ sequence as a pure translation', () => {
    const clip = video('a', 'v1', 'x', 1_000, 5_000, 9_000)
    expect(sequenceUsOf(clip, 6_000)).toBe(2_000)
    expect(sourceUsAt(clip, 2_000)).toBe(6_000)
  })

  it('reports one active clip per track, back to front, half-open, nothing in a gap', () => {
    const clips = [video('a', 'v1', 'x', 0, 0, 100), video('b', 'v1', 'x', 200, 0, 100), video('c', 'v2', 'y', 50, 10, 60)]
    expect(activeClipsAt(60, tracks, clips).map((entry) => [entry.track.id, entry.clip.id, entry.sourceUs])).toEqual([['v1', 'a', 60], ['v2', 'c', 20]])
    expect(activeClipsAt(99, tracks, clips).map((entry) => entry.clip.id)).toEqual(['a', 'c'])
    expect(activeClipsAt(100, tracks, clips)).toEqual([])
    expect(activeClipsAt(150, tracks, clips)).toEqual([])
    expect(activeClipsAt(200, tracks, clips).map((entry) => entry.clip.id)).toEqual(['b'])
    expect(activeClipsAt(60, [V1, track('v2', 'video', { hidden: true }), A1], clips, { skipHidden: true }).map((entry) => entry.clip.id)).toEqual(['a'])
  })

  it('finds every clip playing a source time — one file can appear many times', () => {
    const clips = [video('a', 'v1', 'x', 0, 0, 100), video('b', 'v1', 'x', 100, 50, 150), video('c', 'v1', 'y', 250, 0, 100)]
    expect(clipsContainingSource('x', 60, clips).map((clip) => clip.id)).toEqual(['a', 'b'])
  })

  it('projects a source range into one span per clip, in sequence order', () => {
    const clips = [video('b', 'v1', 'x', 100, 0, 100), video('a', 'v1', 'x', 0, 200, 300)]
    expect(spansInSequence({ startUs: 50, endUs: 250 }, 'x', clips)).toEqual([
      { startUs: 0, endUs: 50, sourceStartUs: 200, sourceEndUs: 250, clipId: 'a', assetId: 'x', trackId: 'v1' },
      { startUs: 150, endUs: 200, sourceStartUs: 50, sourceEndUs: 100, clipId: 'b', assetId: 'x', trackId: 'v1' },
    ])
  })

  it('finds the next clip start or end on any track', () => {
    const clips = [video('a', 'v1', 'x', 0, 0, 100), video('c', 'v2', 'y', 50, 0, 100)]
    expect(nextBoundaryAfter(0, clips)).toBe(50)
    expect(nextBoundaryAfter(50, clips)).toBe(100)
    expect(nextBoundaryAfter(100, clips)).toBe(150)
    expect(nextBoundaryAfter(150, clips)).toBeNull()
  })

  it('keeps a cue spoken twice as two SRT cues and a cue across a cut as one', () => {
    const clips = [video('a', 'v1', 'x', 0, 0, 100), video('b', 'v1', 'x', 100, 200, 300), video('c', 'v1', 'x', 200, 50, 150)]
    const result = cuesInSequence([cue('k', 'x', 80, 220)], clips)
    // Source 80-100 plays at 80-100 and continues at 100-120 (from 200-220): one contiguous run.
    // Source 80-150 plays again at 230-300 in clip c: a second cue with a derived render key.
    expect(result.map((entry) => [entry.id, entry.startUs, entry.endUs])).toEqual([['k', 80, 120], ['k:2', 230, 300]])
  })

  it('shows the cue of the topmost visible video track that has one', () => {
    const clips = [video('a', 'v1', 'x', 0, 0, 100), video('p', 'v2', 'y', 0, 1_000, 1_100)]
    const cues = [cue('under', 'x', 0, 50), cue('over', 'y', 1_020, 1_040)]
    expect(activeCueAt(10, tracks, clips, cues)?.cue.id).toBe('under')
    expect(activeCueAt(25, tracks, clips, cues)).toMatchObject({ cue: { id: 'over' }, sourceUs: 1_025, clipId: 'p' })
    expect(activeCueAt(25, [V1, track('v2', 'video', { hidden: true }), A1], clips, cues)?.cue.id).toBe('under')
    expect(activeCueAt(60, tracks, clips, cues)).toBeNull()
  })

  it('times unbound cues in sequence time when there is no video', () => {
    expect(activeCueAt(5, tracks, [], [cue('srt', undefined, 0, 10)])).toEqual({ cue: expect.objectContaining({ id: 'srt' }), sourceUs: 5, clipId: null })
  })

  it('sorts clips by track then start and detects overlap on one track only', () => {
    const clips = [video('z', 'v2', 'y', 0, 0, 10), video('b', 'v1', 'x', 50, 0, 10), video('a', 'v1', 'x', 0, 0, 60)]
    expect(normalizeClips(tracks, clips).map((clip) => clip.id)).toEqual(['a', 'b', 'z'])
    expect(firstOverlap(tracks, clips)?.map((clip) => clip.id)).toEqual(['a', 'b'])
    expect(firstOverlap(tracks, [video('a', 'v1', 'x', 0, 0, 50), video('z', 'v2', 'y', 0, 0, 50)])).toBeNull()
  })

  it('derives V1/V2/A1 labels from position within each kind', () => {
    expect(tracks.map((entry) => trackLabel(entry, tracks))).toEqual(['V1', 'V2', 'A1'])
    expect(trackLabel(track('n', 'audio', { name: 'Music' }), tracks)).toBe('Music')
  })
})
