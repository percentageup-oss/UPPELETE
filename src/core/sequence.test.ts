import { describe, expect, it } from 'vitest'
import type { Clip, Segment } from './edit'
import type { Cue } from './model'
import {
  PAST_END, SEQUENCE_END, clipSequenceStartUs, cuesInSequence, cuesInSequenceForClips, effectiveSegments, insertClip, joinClipWithNext, joinWithNext,
  moveClip, nextClipPoint, nextKeptSourceUs, normalizeClips, refitClipsToDuration, removeClip, removeSegment, resizeClip, restoreFullClips, sameClips,
  sequenceDurationOfClips, sequenceDurationUs, sequencePointOf, sequenceToSource, sequenceToSourcePoint, sourceToSequence, sourceToSequenceForAsset,
  spansInSequence, spansInSequenceForAsset, splitClipAt, splitClipsByKeptRanges, splitSegmentAt, setTrim,
} from './sequence'

const MEDIA = 20_000_000
/** Keeps 0-3s and 5-10s: one removed range of 3-5s. */
const twoSegments: Segment[] = [
  { id: 's1', startUs: 0, endUs: 3_000_000 },
  { id: 's2', startUs: 5_000_000, endUs: 10_000_000 },
]
/** Keeps 0-2s, 4-6s and 8-10s: removed 2-4s and 6-8s. */
const threeSegments: Segment[] = [
  { id: 's1', startUs: 0, endUs: 2_000_000 },
  { id: 's2', startUs: 4_000_000, endUs: 6_000_000 },
  { id: 's3', startUs: 8_000_000, endUs: 10_000_000 },
]
const id = (index: number) => `seg-${index}`

const cue = (extra: Partial<Cue> & Pick<Cue, 'id' | 'startUs' | 'endUs'>): Cue => ({
  text: 'ഇത് React ആണ്', timingSource: 'imported', needsReview: false, textSource: 'imported', words: [], ...extra,
})

describe('identity edit', () => {
  it('maps every time to itself when there are no segments', () => {
    for (const us of [0, 1, 999_999, 7_500_000, MEDIA - 1]) {
      expect(sourceToSequence(us, undefined, MEDIA)).toEqual({ sequenceUs: us, kept: true })
      expect(sequenceToSource(us, undefined, MEDIA)).toBe(us)
      expect(nextKeptSourceUs(us, undefined, MEDIA)).toBeNull()
    }
    expect(sequenceDurationUs(undefined, MEDIA)).toBe(MEDIA)
    expect(spansInSequence({ startUs: 1_000_000, endUs: 2_000_000 }, undefined, MEDIA))
      .toEqual([{ startUs: 1_000_000, endUs: 2_000_000, sourceStartUs: 1_000_000, sourceEndUs: 2_000_000 }])
  })

  it('falls back to an unbounded range when the media duration is unknown', () => {
    expect(effectiveSegments(undefined, null)).toEqual([{ startUs: 0, endUs: Number.MAX_SAFE_INTEGER }])
    expect(sourceToSequence(5_000_000, undefined, null)).toEqual({ sequenceUs: 5_000_000, kept: true })
  })
})

describe('sourceToSequence / sequenceToSource', () => {
  it('shortens the timeline by each removed range', () => {
    expect(sequenceDurationUs(twoSegments, MEDIA)).toBe(8_000_000)
    expect(sourceToSequence(1_000_000, twoSegments, MEDIA)).toEqual({ sequenceUs: 1_000_000, kept: true })
    expect(sourceToSequence(5_000_000, twoSegments, MEDIA)).toEqual({ sequenceUs: 3_000_000, kept: true })
    expect(sourceToSequence(9_999_999, twoSegments, MEDIA)).toEqual({ sequenceUs: 7_999_999, kept: true })
  })

  it('collapses a removed source time onto the cut instant', () => {
    expect(sourceToSequence(3_000_000, twoSegments, MEDIA)).toEqual({ sequenceUs: 3_000_000, kept: false })
    expect(sourceToSequence(4_100_000, twoSegments, MEDIA)).toEqual({ sequenceUs: 3_000_000, kept: false })
    // Past the last kept segment the playhead pins to the sequence end rather than running on.
    expect(sourceToSequence(15_000_000, twoSegments, MEDIA)).toEqual({ sequenceUs: 8_000_000, kept: false })
  })

  it('collapses a time before the first kept segment to zero', () => {
    const late: Segment[] = [{ id: 's1', startUs: 2_000_000, endUs: 6_000_000 }]
    expect(sourceToSequence(0, late, MEDIA)).toEqual({ sequenceUs: 0, kept: false })
    expect(sourceToSequence(2_000_000, late, MEDIA)).toEqual({ sequenceUs: 0, kept: true })
  })

  it('maps a cut instant to the start of the following segment and clamps outside the range', () => {
    expect(sequenceToSource(3_000_000, twoSegments, MEDIA)).toBe(5_000_000)
    expect(sequenceToSource(2_999_999, twoSegments, MEDIA)).toBe(2_999_999)
    expect(sequenceToSource(-5_000, twoSegments, MEDIA)).toBe(0)
    expect(sequenceToSource(99_000_000, twoSegments, MEDIA)).toBe(10_000_000)
  })

  it('round-trips every kept source time', () => {
    for (const segments of [twoSegments, threeSegments]) {
      for (const sourceUs of [0, 1_500_000, 1_999_999, 4_000_000, 5_500_000, 9_000_000]) {
        const point = sourceToSequence(sourceUs, segments, MEDIA)
        if (!point.kept) continue
        expect(sequenceToSource(point.sequenceUs, segments, MEDIA)).toBe(sourceUs)
      }
    }
  })
})

describe('spansInSequence', () => {
  it('splits a range that straddles one cut into two sequence spans', () => {
    expect(spansInSequence({ startUs: 2_000_000, endUs: 7_000_000 }, twoSegments, MEDIA)).toEqual([
      { startUs: 2_000_000, endUs: 3_000_000, sourceStartUs: 2_000_000, sourceEndUs: 3_000_000 },
      { startUs: 3_000_000, endUs: 5_000_000, sourceStartUs: 5_000_000, sourceEndUs: 7_000_000 },
    ])
  })

  it('splits a range that straddles two cuts into three spans', () => {
    expect(spansInSequence({ startUs: 1_000_000, endUs: 9_000_000 }, threeSegments, MEDIA)).toEqual([
      { startUs: 1_000_000, endUs: 2_000_000, sourceStartUs: 1_000_000, sourceEndUs: 2_000_000 },
      { startUs: 2_000_000, endUs: 4_000_000, sourceStartUs: 4_000_000, sourceEndUs: 6_000_000 },
      { startUs: 4_000_000, endUs: 5_000_000, sourceStartUs: 8_000_000, sourceEndUs: 9_000_000 },
    ])
  })

  it('returns nothing for a range entirely inside a removed gap', () => {
    expect(spansInSequence({ startUs: 3_200_000, endUs: 4_800_000 }, twoSegments, MEDIA)).toEqual([])
  })
})

describe('nextKeptSourceUs', () => {
  it('reports null while kept, the next start inside a gap, and PAST_END past the last segment', () => {
    expect(nextKeptSourceUs(1_000_000, twoSegments, MEDIA)).toBeNull()
    expect(nextKeptSourceUs(3_000_000, twoSegments, MEDIA)).toBe(5_000_000)
    expect(nextKeptSourceUs(4_999_999, twoSegments, MEDIA)).toBe(5_000_000)
    expect(nextKeptSourceUs(10_000_000, twoSegments, MEDIA)).toBe(PAST_END)
    expect(nextKeptSourceUs(MEDIA, twoSegments, MEDIA)).toBe(PAST_END)
  })

  it('walks three gaps in order', () => {
    expect(nextKeptSourceUs(2_500_000, threeSegments, MEDIA)).toBe(4_000_000)
    expect(nextKeptSourceUs(7_000_000, threeSegments, MEDIA)).toBe(8_000_000)
    expect(nextKeptSourceUs(9_999_999, threeSegments, MEDIA)).toBeNull()
    expect(nextKeptSourceUs(10_000_001, threeSegments, MEDIA)).toBe(PAST_END)
  })
})

describe('edit list operations', () => {
  it('sets a trim on the identity edit and on an existing multi-segment list', () => {
    expect(setTrim(undefined, 2_000_000, 8_000_000, MEDIA, id)).toEqual([{ id: 'seg-0', startUs: 2_000_000, endUs: 8_000_000 }])
    expect(setTrim(threeSegments, 1_000_000, 9_000_000, MEDIA, id)).toEqual([{ id: 'seg-0', startUs: 1_000_000, endUs: 9_000_000 }])
    // Clamped to the outer bounds of the existing list, never beyond the media.
    expect(setTrim(undefined, -5_000, 99_000_000, MEDIA, id)).toEqual([{ id: 'seg-0', startUs: 0, endUs: MEDIA }])
  })

  it('rejects a trim whose in point is at or after its out point', () => {
    expect(() => setTrim(undefined, 5_000_000, 5_000_000, MEDIA, id)).toThrow()
    expect(() => setTrim(undefined, 6_000_000, 5_000_000, MEDIA, id)).toThrow()
  })

  it('splits inside a segment and is a no-op exactly on a boundary', () => {
    expect(splitSegmentAt(undefined, 4_000_000, MEDIA, id)).toEqual([
      { id: 'seg-0', startUs: 0, endUs: 4_000_000 },
      { id: 'seg-1', startUs: 4_000_000, endUs: MEDIA },
    ])
    expect(splitSegmentAt(twoSegments, 3_000_000, MEDIA, id)).toEqual([
      { id: 'seg-0', startUs: 0, endUs: 3_000_000 },
      { id: 'seg-1', startUs: 5_000_000, endUs: 10_000_000 },
    ])
    expect(splitSegmentAt(twoSegments, 0, MEDIA, id)).toHaveLength(2)
  })

  it('round-trips removeSegment then joinWithNext', () => {
    const removed = removeSegment(threeSegments, 's2', MEDIA, id)
    expect(removed).toEqual([
      { id: 'seg-0', startUs: 0, endUs: 2_000_000 },
      { id: 'seg-1', startUs: 8_000_000, endUs: 10_000_000 },
    ])
    expect(joinWithNext(removed, 'seg-0', MEDIA, id)).toEqual([{ id: 'seg-0', startUs: 0, endUs: 10_000_000 }])
  })

  it('refuses to remove the only remaining segment or to join past the end', () => {
    expect(() => removeSegment(undefined, 'seg-0', MEDIA, id)).toThrow()
    expect(() => removeSegment(threeSegments, 'missing', MEDIA, id)).toThrow()
    expect(() => joinWithNext(twoSegments, 's2', MEDIA, id)).toThrow()
  })

  it('keeps every result ascending and non-overlapping', () => {
    for (const list of [setTrim(undefined, 1_000_000, 9_000_000, MEDIA, id), splitSegmentAt(threeSegments, 5_000_000, MEDIA, id), removeSegment(threeSegments, 's1', MEDIA, id)]) {
      list.forEach((segment, index) => {
        expect(segment.endUs).toBeGreaterThan(segment.startUs)
        if (index > 0) expect(segment.startUs).toBeGreaterThanOrEqual(list[index - 1].endUs)
      })
    }
  })
})

describe('cuesInSequence', () => {
  it('is the identity for a project with no cuts', () => {
    const cues = [cue({ id: 'a', startUs: 1_000_000, endUs: 2_000_000 })]
    expect(cuesInSequence(cues, undefined, MEDIA)).toEqual(cues)
  })

  it('clips a straddling cue to the kept material without splitting it', () => {
    const cues = [cue({ id: 'a', startUs: 2_000_000, endUs: 7_000_000 })]
    const clipped = cuesInSequence(cues, twoSegments, MEDIA)
    expect(clipped).toHaveLength(1)
    expect(clipped[0]).toMatchObject({ id: 'a', startUs: 2_000_000, endUs: 5_000_000 })
  })

  it('drops fully removed cues and clips their surviving words', () => {
    const cues = [
      cue({ id: 'gone', startUs: 3_200_000, endUs: 4_800_000 }),
      cue({
        id: 'kept', startUs: 1_000_000, endUs: 6_000_000, text: 'one two',
        words: [
          { id: 'w1', startUs: 1_000_000, endUs: 2_000_000, text: 'one', timingSource: 'aligned', needsReview: false },
          { id: 'w2', startUs: 3_200_000, endUs: 4_800_000, text: 'two', timingSource: 'aligned', needsReview: false },
        ],
      }),
    ]
    const clipped = cuesInSequence(cues, twoSegments, MEDIA)
    expect(clipped.map((item) => item.id)).toEqual(['kept'])
    expect(clipped[0].words).toHaveLength(1)
    expect(clipped[0].words[0]).toMatchObject({ id: 'w1', startUs: 1_000_000, endUs: 2_000_000 })
    // Storage is untouched: the removed cue and word are still in the project.
    expect(cues[0].id).toBe('gone')
    expect(cues[1].words).toHaveLength(2)
  })

  it('starts a trimmed project at zero', () => {
    const trimmed = setTrim(undefined, 2_000_000, 8_000_000, MEDIA, id)
    const clipped = cuesInSequence([cue({ id: 'a', startUs: 2_500_000, endUs: 3_500_000 })], trimmed, MEDIA)
    expect(clipped[0]).toMatchObject({ startUs: 500_000, endUs: 1_500_000 })
  })
})

// ---- Clips (schema 4) ----------------------------------------------------------------------------

const clipOf = (id: string, assetId: string, startUs: number, endUs: number): Clip => ({ id, assetId, startUs, endUs })
/** A 0-3s + 5-10s cut of video A, then a whole 4s of video B: sequence 0-3, 3-8, 8-12. */
const mixed: Clip[] = [clipOf('a1', 'A', 0, 3_000_000), clipOf('a2', 'A', 5_000_000, 10_000_000), clipOf('b1', 'B', 0, 4_000_000)]
/** The same range of A twice, with B between: sequence 0-3, 3-5, 5-8. */
const repeated: Clip[] = [clipOf('r1', 'A', 1_000_000, 4_000_000), clipOf('b1', 'B', 0, 2_000_000), clipOf('r2', 'A', 1_000_000, 4_000_000)]

describe('clip sequence mapping', () => {
  it('sums clip lengths and finds where each clip starts', () => {
    expect(sequenceDurationOfClips(mixed)).toBe(12_000_000)
    expect(sequenceDurationOfClips([])).toBe(0)
    expect(clipSequenceStartUs(mixed, 'a1')).toBe(0)
    expect(clipSequenceStartUs(mixed, 'a2')).toBe(3_000_000)
    expect(clipSequenceStartUs(mixed, 'b1')).toBe(8_000_000)
    expect(clipSequenceStartUs(mixed, 'gone')).toBeNull()
  })

  it('maps a sequence time to the clip it lands in, with a boundary belonging to the following clip', () => {
    expect(sequenceToSourcePoint(0, mixed)).toEqual({ clipId: 'a1', assetId: 'A', sourceUs: 0 })
    expect(sequenceToSourcePoint(2_999_999, mixed)).toEqual({ clipId: 'a1', assetId: 'A', sourceUs: 2_999_999 })
    expect(sequenceToSourcePoint(3_000_000, mixed)).toEqual({ clipId: 'a2', assetId: 'A', sourceUs: 5_000_000 })
    expect(sequenceToSourcePoint(9_000_000, mixed)).toEqual({ clipId: 'b1', assetId: 'B', sourceUs: 1_000_000 })
  })

  it('clamps out-of-range sequence times and reports null for an empty sequence', () => {
    expect(sequenceToSourcePoint(-5, mixed)).toEqual({ clipId: 'a1', assetId: 'A', sourceUs: 0 })
    expect(sequenceToSourcePoint(99_000_000, mixed)).toEqual({ clipId: 'b1', assetId: 'B', sourceUs: 4_000_000 })
    expect(sequenceToSourcePoint(0, [])).toBeNull()
  })

  it('round-trips a repeated source range through the clip id, which asset + time alone could not', () => {
    const first = { clipId: 'r1', assetId: 'A', sourceUs: 2_000_000 }
    const second = { clipId: 'r2', assetId: 'A', sourceUs: 2_000_000 }
    expect(sequencePointOf(first, repeated)).toBe(1_000_000)
    expect(sequencePointOf(second, repeated)).toBe(6_000_000)
    expect(sequenceToSourcePoint(1_000_000, repeated)).toEqual(first)
    expect(sequenceToSourcePoint(6_000_000, repeated)).toEqual(second)
    expect(sequencePointOf({ clipId: 'gone', assetId: 'A', sourceUs: 0 }, repeated)).toBeNull()
  })

  it('clamps a point that has drifted outside its clip', () => {
    expect(sequencePointOf({ clipId: 'a2', assetId: 'A', sourceUs: 99_000_000 }, mixed)).toBe(8_000_000)
    expect(sequencePointOf({ clipId: 'a2', assetId: 'A', sourceUs: 0 }, mixed)).toBe(3_000_000)
  })
})

describe('per-asset source → sequence', () => {
  it('finds a video’s time in the sequence, counting other videos’ clips in the offset', () => {
    expect(sourceToSequenceForAsset('A', 6_000_000, mixed)).toEqual({ sequenceUs: 4_000_000, kept: true })
    expect(sourceToSequenceForAsset('B', 1_000_000, mixed)).toEqual({ sequenceUs: 9_000_000, kept: true })
  })

  it('uses the first clip in sequence order when a range repeats', () => {
    expect(sourceToSequenceForAsset('A', 2_000_000, repeated)).toEqual({ sequenceUs: 1_000_000, kept: true })
  })

  it('collapses a removed time to the cut instant, like the single-source rule', () => {
    expect(sourceToSequenceForAsset('A', 4_000_000, mixed)).toEqual({ sequenceUs: 3_000_000, kept: false })
    expect(sourceToSequenceForAsset('A', 12_000_000, mixed)).toEqual({ sequenceUs: 8_000_000, kept: false })
    expect(sourceToSequenceForAsset('B', 4_000_000, mixed)).toEqual({ sequenceUs: 12_000_000, kept: false })
  })

  it('collapses a time before every clip to the asset’s first clip, and an absent asset to zero', () => {
    const late = [clipOf('x', 'A', 5_000_000, 8_000_000)]
    expect(sourceToSequenceForAsset('A', 1_000_000, late)).toEqual({ sequenceUs: 0, kept: false })
    expect(sourceToSequenceForAsset('B', 1_000_000, mixed.slice(0, 2))).toEqual({ sequenceUs: 0, kept: false })
    expect(sourceToSequenceForAsset('A', 5, [])).toEqual({ sequenceUs: 0, kept: false })
  })

  it('is the identity for one clip over a whole video', () => {
    const whole = [clipOf('w', 'A', 0, MEDIA)]
    for (const us of [0, 1, 7_500_000, MEDIA - 1]) expect(sourceToSequenceForAsset('A', us, whole)).toEqual({ sequenceUs: us, kept: true })
  })
})

describe('spans of a source range', () => {
  it('yields one span per clip the range crosses, carrying the clip id', () => {
    expect(spansInSequenceForAsset({ startUs: 2_000_000, endUs: 7_000_000 }, 'A', mixed)).toEqual([
      { startUs: 2_000_000, endUs: 3_000_000, sourceStartUs: 2_000_000, sourceEndUs: 3_000_000, clipId: 'a1', assetId: 'A' },
      { startUs: 3_000_000, endUs: 5_000_000, sourceStartUs: 5_000_000, sourceEndUs: 7_000_000, clipId: 'a2', assetId: 'A' },
    ])
  })

  it('ignores clips of other videos and ranges that fall in a cut', () => {
    expect(spansInSequenceForAsset({ startUs: 3_500_000, endUs: 4_500_000 }, 'A', mixed)).toEqual([])
    expect(spansInSequenceForAsset({ startUs: 0, endUs: 2_000_000 }, 'B', mixed)).toEqual([
      { startUs: 8_000_000, endUs: 10_000_000, sourceStartUs: 0, sourceEndUs: 2_000_000, clipId: 'b1', assetId: 'B' },
    ])
  })

  it('shows a repeated range at both of its sequence positions', () => {
    const spans = spansInSequenceForAsset({ startUs: 1_000_000, endUs: 2_000_000 }, 'A', repeated)
    expect(spans.map((span) => [span.clipId, span.startUs, span.endUs])).toEqual([['r1', 0, 1_000_000], ['r2', 5_000_000, 6_000_000]])
  })
})

describe('clip-boundary playback', () => {
  it('keeps playing inside a clip', () => {
    expect(nextClipPoint({ clipId: 'a1', assetId: 'A', sourceUs: 2_999_999 }, mixed)).toBeNull()
  })

  it('moves to the next clip when the playing clip runs out, even into another video', () => {
    expect(nextClipPoint({ clipId: 'a1', assetId: 'A', sourceUs: 3_000_000 }, mixed)).toEqual({ clipId: 'a2', assetId: 'A', sourceUs: 5_000_000 })
    expect(nextClipPoint({ clipId: 'a2', assetId: 'A', sourceUs: 10_000_001 }, mixed)).toEqual({ clipId: 'b1', assetId: 'B', sourceUs: 0 })
  })

  it('ends playback after the last clip, and when the playing clip was deleted', () => {
    expect(nextClipPoint({ clipId: 'b1', assetId: 'B', sourceUs: 4_000_000 }, mixed)).toBe(SEQUENCE_END)
    expect(nextClipPoint({ clipId: 'gone', assetId: 'A', sourceUs: 0 }, mixed)).toBe(SEQUENCE_END)
  })

  it('seeks forward to a clip’s start when the element is before it', () => {
    expect(nextClipPoint({ clipId: 'a2', assetId: 'A', sourceUs: 3_000_000 }, mixed)).toEqual({ clipId: 'a2', assetId: 'A', sourceUs: 5_000_000 })
  })
})

describe('clip editing', () => {
  const whole = [clipOf('w', 'A', 0, 10_000_000)]

  it('splits a clip strictly inside it — the first half keeps the id — and ignores a boundary', () => {
    expect(splitClipAt(whole, 'w', 4_000_000, 'w2')).toEqual([clipOf('w', 'A', 0, 4_000_000), clipOf('w2', 'A', 4_000_000, 10_000_000)])
    expect(sameClips(splitClipAt(whole, 'w', 0, 'w2'), whole)).toBe(true)
    expect(sameClips(splitClipAt(whole, 'w', 10_000_000, 'w2'), whole)).toBe(true)
    expect(() => splitClipAt(whole, 'gone', 1, 'x')).toThrow('no longer exists')
  })

  it('removes a clip but never the last one', () => {
    expect(removeClip(mixed, 'a2').map((clip) => clip.id)).toEqual(['a1', 'b1'])
    expect(() => removeClip(whole, 'w')).toThrow('only remaining clip')
  })

  it('joins consecutive clips of one video into the range that spans them', () => {
    const split = splitClipAt(whole, 'w', 4_000_000, 'w2')
    expect(joinClipWithNext(split, 'w')).toEqual(whole)
    // A gap between them is restored by the join, exactly like the old segment join.
    expect(joinClipWithNext(mixed, 'a1')[0]).toEqual(clipOf('a1', 'A', 0, 10_000_000))
  })

  it('refuses to join across videos, out of order, the last clip, or overlapping clips', () => {
    expect(() => joinClipWithNext(mixed, 'a2')).toThrow('same video')
    expect(() => joinClipWithNext(mixed, 'b1')).toThrow('nothing to join')
    expect(() => joinClipWithNext(moveClip(splitClipAt(whole, 'w', 4_000_000, 'w2'), 'w2', 0), 'w2')).toThrow('out of order')
    expect(() => joinClipWithNext([clipOf('x', 'A', 0, 5_000_000), clipOf('y', 'A', 3_000_000, 8_000_000)], 'x')).toThrow('overlap')
  })

  it('moves a clip to an index of the resulting list, clamping it', () => {
    expect(moveClip(mixed, 'b1', 0).map((clip) => clip.id)).toEqual(['b1', 'a1', 'a2'])
    expect(moveClip(mixed, 'a1', 99).map((clip) => clip.id)).toEqual(['a2', 'b1', 'a1'])
    expect(sameClips(moveClip(mixed, 'a2', 1), mixed)).toBe(true)
  })

  it('does not sort: array order is the sequence order', () => {
    const reversed = [clipOf('late', 'A', 8_000_000, 9_000_000), clipOf('early', 'A', 0, 1_000_000)]
    expect(normalizeClips(reversed).map((clip) => clip.id)).toEqual(['late', 'early'])
    expect(normalizeClips([clipOf('empty', 'A', 5, 5), ...mixed]).map((clip) => clip.id)).toEqual(['a1', 'a2', 'b1'])
  })

  it('inserts at an index, appending by default and clamping past the end', () => {
    const extra = clipOf('n', 'B', 0, 1_000_000)
    expect(insertClip(mixed, extra).map((clip) => clip.id)).toEqual(['a1', 'a2', 'b1', 'n'])
    expect(insertClip(mixed, extra, 1).map((clip) => clip.id)).toEqual(['a1', 'n', 'a2', 'b1'])
    expect(insertClip(mixed, extra, 99).map((clip) => clip.id)).toEqual(['a1', 'a2', 'b1', 'n'])
  })

  it('resizes within the video’s duration and rejects a reversed or overlong range', () => {
    expect(resizeClip(mixed, 'a1', 1_000_000, 2_000_000, 10_000_000)[0]).toEqual(clipOf('a1', 'A', 1_000_000, 2_000_000))
    expect(() => resizeClip(mixed, 'a1', 2_000_000, 2_000_000, 10_000_000)).toThrow('end after its start')
    expect(() => resizeClip(mixed, 'a1', 0, 11_000_000, 10_000_000)).toThrow('duration')
    // An unknown duration cannot bound the range.
    expect(resizeClip(mixed, 'a1', 0, 99_000_000, null)[0].endUs).toBe(99_000_000)
  })
})

describe('silence removal over clips', () => {
  it('replaces a video’s clips with the pieces inside the kept ranges, in place', () => {
    const kept = [{ startUs: 0, endUs: 2_000_000 }, { startUs: 6_000_000, endUs: 8_000_000 }]
    const result = splitClipsByKeptRanges(mixed, 'A', kept, (n) => `n${n}`)
    expect(result.map((clip) => [clip.id, clip.assetId, clip.startUs, clip.endUs])).toEqual([
      ['a1', 'A', 0, 2_000_000], ['a2', 'A', 6_000_000, 8_000_000], ['b1', 'B', 0, 4_000_000],
    ])
  })

  it('splits one clip into several, the first keeping its id', () => {
    const result = splitClipsByKeptRanges([clipOf('w', 'A', 0, 10_000_000)], 'A', [{ startUs: 1_000_000, endUs: 2_000_000 }, { startUs: 4_000_000, endUs: 5_000_000 }, { startUs: 8_000_000, endUs: 9_000_000 }], (n) => `w-${n}`)
    expect(result.map((clip) => clip.id)).toEqual(['w', 'w-1', 'w-2'])
  })

  it('drops a clip with nothing kept and is the identity when everything is kept', () => {
    expect(splitClipsByKeptRanges(mixed, 'A', [{ startUs: 0, endUs: 1_000 }], (n) => `n${n}`).map((clip) => clip.id)).toEqual(['a1', 'b1'])
    expect(sameClips(splitClipsByKeptRanges(mixed, 'A', [{ startUs: 0, endUs: MEDIA }], (n) => `n${n}`), mixed)).toBe(true)
  })

  it('is order-independent for the kept ranges it is given', () => {
    const result = splitClipsByKeptRanges([clipOf('w', 'A', 0, 10_000_000)], 'A', [{ startUs: 6_000_000, endUs: 7_000_000 }, { startUs: 1_000_000, endUs: 2_000_000 }], (n) => `w-${n}`)
    expect(result.map((clip) => clip.startUs)).toEqual([1_000_000, 6_000_000])
  })
})

describe('restoring removed ranges', () => {
  const durations = new Map([['A', 10_000_000], ['B', 4_000_000]])

  it('collapses each run of one video back to the whole video, keeping the first id', () => {
    expect(restoreFullClips(mixed, durations)).toEqual([clipOf('a1', 'A', 0, 10_000_000), clipOf('b1', 'B', 0, 4_000_000)])
  })

  it('does not merge runs separated by another video, so the order of videos survives', () => {
    expect(restoreFullClips(repeated, new Map([['A', 10_000_000], ['B', 2_000_000]])).map((clip) => [clip.id, clip.assetId])).toEqual([['r1', 'A'], ['b1', 'B'], ['r2', 'A']])
  })

  it('leaves clips of a video with unknown duration alone', () => {
    expect(restoreFullClips(mixed, new Map([['B', 4_000_000]]))).toEqual(mixed)
  })

  it('is a no-op on an uncut project', () => {
    const uncut = [clipOf('a', 'A', 0, 10_000_000), clipOf('b', 'B', 0, 4_000_000)]
    expect(sameClips(restoreFullClips(uncut, durations), uncut)).toBe(true)
  })
})

describe('refitting clips to a new duration', () => {
  it('lets a whole-video clip follow the new duration and clamps the rest', () => {
    expect(refitClipsToDuration([clipOf('w', 'A', 0, 10_000_000)], 'A', 10_000_000, 15_000_000)).toEqual([clipOf('w', 'A', 0, 15_000_000)])
    expect(refitClipsToDuration([clipOf('p', 'A', 2_000_000, 9_000_000)], 'A', 10_000_000, 6_000_000)).toEqual([clipOf('p', 'A', 2_000_000, 6_000_000)])
  })

  it('drops a clip that lies wholly past the new end and leaves other videos alone', () => {
    expect(refitClipsToDuration([clipOf('p', 'A', 7_000_000, 9_000_000), clipOf('b', 'B', 0, 1)], 'A', 10_000_000, 6_000_000)).toEqual([clipOf('b', 'B', 0, 1)])
  })
})

describe('SRT cues over clips', () => {
  const words = (startUs: number) => [{ id: 'w', startUs, endUs: startUs + 500_000, text: 'ഒന്ന്', timingSource: 'aligned' as const, needsReview: false }]

  it('keeps a cue across a cut as one cue clipped to the kept material', () => {
    const cues = [cue({ id: 'across', mediaAssetId: 'A', startUs: 2_000_000, endUs: 7_000_000 })]
    const [result] = cuesInSequenceForClips(cues, mixed)
    expect(result).toMatchObject({ id: 'across', startUs: 2_000_000, endUs: 5_000_000 })
  })

  it('drops a cue that falls entirely in a removed range without touching the input', () => {
    const cues = [cue({ id: 'gone', mediaAssetId: 'A', startUs: 3_500_000, endUs: 4_500_000 })]
    expect(cuesInSequenceForClips(cues, mixed)).toEqual([])
    expect(cues).toHaveLength(1)
  })

  it('emits one cue per contiguous run when a repeated range shows the same words twice', () => {
    const result = cuesInSequenceForClips([cue({ id: 'twice', mediaAssetId: 'A', startUs: 1_000_000, endUs: 2_000_000, words: words(1_000_000) })], repeated)
    expect(result.map((item) => [item.id, item.startUs, item.endUs])).toEqual([['twice', 0, 1_000_000], ['twice:2', 5_000_000, 6_000_000]])
    expect(result.every((item) => item.words.length === 1)).toBe(true)
  })

  it('places each video’s cues on its own clips and sorts the result by sequence time', () => {
    const cues = [cue({ id: 'b', mediaAssetId: 'B', startUs: 0, endUs: 1_000_000 }), cue({ id: 'a', mediaAssetId: 'A', startUs: 5_000_000, endUs: 6_000_000 })]
    expect(cuesInSequenceForClips(cues, mixed).map((item) => [item.id, item.startUs])).toEqual([['a', 3_000_000], ['b', 8_000_000]])
  })

  it('passes an unbound cue (a project with no clips) through unchanged', () => {
    const unbound = cue({ id: 'u', startUs: 1, endUs: 9 })
    expect(cuesInSequenceForClips([unbound], [])).toEqual([unbound])
  })
})
