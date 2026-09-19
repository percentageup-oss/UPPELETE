import type { Clip, Segment } from './edit'

import type { Cue } from './model'

/**
 * The one pure mapper between **source time** (canonical; where every cue, word, overlay, blur
 * region and audio anchor is stored) and **sequence time** (the output timeline after cuts).
 *
 * Only the timeline ruler/playhead, the transport clock, the SRT exported for a cut video, export
 * frame iteration and the manifest's `enable`/`adelay` values ever use sequence time —
 * see docs/EDITING.md. Every function here is pure and works in integer microseconds, and a
 * project with no `segments` is the identity edit, so every mapping is the identity function.
 */
export type TimeRange = { startUs: number; endUs: number }
export type SequencePoint = { sequenceUs: number; kept: boolean }
/** A source range projected into sequence time, carrying the source range it came from. */
export type SequenceSpan = { startUs: number; endUs: number; sourceStartUs: number; sourceEndUs: number }

/** `nextKeptSourceUs` returns this when the time is past the last kept segment. */
export const PAST_END = -1

const round = (us: number) => Math.round(us)

/** Absent → the whole media; unknown duration → an unbounded single range. */
export function effectiveSegments(segments: readonly TimeRange[] | undefined, mediaDurationUs: number | null): TimeRange[] {
  if (segments?.length) return segments.map((segment) => ({ startUs: segment.startUs, endUs: segment.endUs }))
  return [{ startUs: 0, endUs: mediaDurationUs ?? Number.MAX_SAFE_INTEGER }]
}

export function sequenceDurationUs(segments: readonly TimeRange[] | undefined, mediaDurationUs: number | null): number {
  return effectiveSegments(segments, mediaDurationUs).reduce((total, segment) => total + (segment.endUs - segment.startUs), 0)
}

/**
 * Removed source times collapse to the cut instant — the end of the preceding kept segment — so a
 * playhead dragged through a removed range never appears to run backwards. A time before the first
 * kept segment collapses to 0.
 */
export function sourceToSequence(sourceUs: number, segments: readonly TimeRange[] | undefined, mediaDurationUs: number | null = null): SequencePoint {
  const kept = effectiveSegments(segments, mediaDurationUs)
  const at = round(sourceUs)
  let elapsed = 0
  for (const segment of kept) {
    if (at < segment.startUs) return { sequenceUs: elapsed, kept: false }
    if (at < segment.endUs) return { sequenceUs: elapsed + (at - segment.startUs), kept: true }
    elapsed += segment.endUs - segment.startUs
  }
  return { sequenceUs: elapsed, kept: false }
}

/**
 * The inverse on `[0, sequenceDurationUs]`. A cut instant — the boundary shared by two kept
 * segments — maps to the **start of the following** segment, so seeking to a cut lands on the
 * first frame the viewer actually sees. Times outside the range clamp.
 */
export function sequenceToSource(sequenceUs: number, segments: readonly TimeRange[] | undefined, mediaDurationUs: number | null = null): number {
  const kept = effectiveSegments(segments, mediaDurationUs)
  const at = Math.max(0, round(sequenceUs))
  let elapsed = 0
  for (const segment of kept) {
    const length = segment.endUs - segment.startUs
    if (at < elapsed + length) return segment.startUs + (at - elapsed)
    elapsed += length
  }
  return kept[kept.length - 1].endUs
}

/**
 * Intersects a source range with each kept segment and reports the result in sequence time. A cue
 * straddling a cut yields one span per kept piece — the timeline draws N blocks and SRT clips to
 * them — while the cue itself is never split in storage.
 */
export function spansInSequence(range: TimeRange, segments: readonly TimeRange[] | undefined, mediaDurationUs: number | null = null): SequenceSpan[] {
  const kept = effectiveSegments(segments, mediaDurationUs)
  const spans: SequenceSpan[] = []
  let elapsed = 0
  for (const segment of kept) {
    const startUs = Math.max(range.startUs, segment.startUs)
    const endUs = Math.min(range.endUs, segment.endUs)
    if (endUs > startUs) {
      spans.push({
        startUs: elapsed + (startUs - segment.startUs), endUs: elapsed + (endUs - segment.startUs),
        sourceStartUs: startUs, sourceEndUs: endUs,
      })
    }
    elapsed += segment.endUs - segment.startUs
  }
  return spans
}

/**
 * `null` when the time is inside a kept segment (keep playing), the next segment's start when it
 * is inside a removed range (seek there), and `PAST_END` when it is past the last segment (pause).
 * This is the whole cut-skipping playback rule.
 */
export function nextKeptSourceUs(sourceUs: number, segments: readonly TimeRange[] | undefined, mediaDurationUs: number | null = null): number | null {
  const kept = effectiveSegments(segments, mediaDurationUs)
  const at = round(sourceUs)
  for (const segment of kept) {
    if (at < segment.startUs) return segment.startUs
    if (at < segment.endUs) return null
  }
  return PAST_END
}

/** Sorts, drops empty ranges and assigns fresh ids. Exported so callers building a whole new edit
 * list from scratch (automatic silence removal) get the same normalisation the EDL commands use,
 * without duplicating the sort/id rules. */
export function normalizeSegments(ranges: readonly TimeRange[], id: (index: number) => string): Segment[] {
  return ranges
    .filter((range) => range.endUs > range.startUs)
    .sort((a, b) => a.startUs - b.startUs || a.endUs - b.endUs)
    .map((range, index) => ({ id: id(index), startUs: range.startUs, endUs: range.endUs }))
}

/** Replaces the whole edit list with the single kept range `[inUs, outUs)` (V5's trim in/out). */
export function setTrim(segments: readonly Segment[] | undefined, inUs: number, outUs: number, mediaDurationUs: number | null, id: (index: number) => string): Segment[] {
  const bounds = effectiveSegments(segments, mediaDurationUs)
  const start = Math.max(round(inUs), bounds[0].startUs)
  const end = Math.min(round(outUs), bounds[bounds.length - 1].endUs)
  if (end <= start) throw new Error('The in point must come before the out point.')
  return normalizeSegments([{ startUs: start, endUs: end }], id)
}

/** Splits the segment containing `atUs` in two. Splitting exactly on a boundary is a no-op. */
export function splitSegmentAt(segments: readonly Segment[] | undefined, atUs: number, mediaDurationUs: number | null, id: (index: number) => string): Segment[] {
  const kept = effectiveSegments(segments, mediaDurationUs)
  const at = round(atUs)
  const ranges: TimeRange[] = []
  let split = false
  for (const segment of kept) {
    if (at > segment.startUs && at < segment.endUs) {
      ranges.push({ startUs: segment.startUs, endUs: at }, { startUs: at, endUs: segment.endUs })
      split = true
    } else ranges.push(segment)
  }
  if (!split) return normalizeSegments([...kept], id)
  return normalizeSegments(ranges, id)
}

/** Removes one kept range, turning it into a cut. The last remaining segment cannot be removed. */
export function removeSegment(segments: readonly Segment[] | undefined, segmentId: string, mediaDurationUs: number | null, id: (index: number) => string): Segment[] {
  const kept = segments?.length ? segments : normalizeSegments(effectiveSegments(segments, mediaDurationUs), id)
  if (kept.length <= 1) throw new Error('Removing the only remaining segment would leave nothing to play.')
  const remaining = kept.filter((segment) => segment.id !== segmentId)
  if (remaining.length === kept.length) throw new Error('That segment no longer exists.')
  return normalizeSegments(remaining.map((segment) => ({ startUs: segment.startUs, endUs: segment.endUs })), id)
}

/** Re-joins a segment with the one after it, restoring the source range removed between them. */
export function joinWithNext(segments: readonly Segment[] | undefined, segmentId: string, mediaDurationUs: number | null, id: (index: number) => string): Segment[] {
  const kept = segments?.length ? segments : normalizeSegments(effectiveSegments(segments, mediaDurationUs), id)
  const index = kept.findIndex((segment) => segment.id === segmentId)
  if (index < 0) throw new Error('That segment no longer exists.')
  if (index === kept.length - 1) throw new Error('The last segment has nothing to join with.')
  const ranges = kept.map((segment) => ({ startUs: segment.startUs, endUs: segment.endUs }))
  ranges.splice(index, 2, { startUs: kept[index].startUs, endUs: kept[index + 1].endUs })
  return normalizeSegments(ranges, id)
}

/**
 * Source cues → clipped sequence-time cues, for SRT export of a cut project. A cue straddling a cut
 * is clipped to the kept material and stays **one** cue; a fully removed cue (or word) is dropped
 * from the result but is never touched in the project, so undoing a cut restores it exactly.
 */
export function cuesInSequence(cues: readonly Cue[], segments: readonly TimeRange[] | undefined, mediaDurationUs: number | null = null): Cue[] {
  const result: Cue[] = []
  for (const cue of cues) {
    const spans = spansInSequence(cue, segments, mediaDurationUs)
    if (!spans.length) continue
    const startUs = spans[0].startUs
    const endUs = spans[spans.length - 1].endUs
    const words = cue.words.flatMap((word) => {
      const wordSpans = spansInSequence(word, segments, mediaDurationUs)
      if (!wordSpans.length) return []
      return [{ ...word, startUs: wordSpans[0].startUs, endUs: wordSpans[wordSpans.length - 1].endUs }]
    })
    result.push({ ...cue, startUs, endUs, words })
  }
  return result.sort((a, b) => a.startUs - b.startUs || a.endUs - b.endUs)
}

// ---------------------------------------------------------------------------------------------
// Clips (schema 4). `project.clips` is an ordered list whose array order is the sequence order; a
// clip is a source range of one video asset, and ranges may repeat or overlap. Time stays integer
// microseconds. The functions above serve schema 3's `segments` and go away in ticket V7's cleanup.
// ---------------------------------------------------------------------------------------------

/**
 * A position in the sequence, named by the clip it sits in. Asset + source time alone is ambiguous
 * because one source range can appear at two sequence positions; the clip id disambiguates them.
 */
export type SourcePoint = { clipId: string; assetId: string; sourceUs: number }
/** A source range projected into sequence time, carrying the clip it landed in. */
export type ClipSpan = SequenceSpan & { clipId: string; assetId: string }

/** `nextClipPoint` returns this when playback has run off the end of the last clip. */
export const SEQUENCE_END = 'end' as const

const lengthOf = (range: TimeRange) => range.endUs - range.startUs
const pointAt = (clip: Clip, sourceUs: number): SourcePoint => ({ clipId: clip.id, assetId: clip.assetId, sourceUs })

export function sequenceDurationOfClips(clips: readonly TimeRange[]): number {
  return clips.reduce((total, clip) => total + lengthOf(clip), 0)
}

/** Sequence time at which a clip begins, or `null` when the id is not in the list. */
export function clipSequenceStartUs(clips: readonly Clip[], clipId: string): number | null {
  let elapsed = 0
  for (const clip of clips) {
    if (clip.id === clipId) return elapsed
    elapsed += lengthOf(clip)
  }
  return null
}

/** Sequence time of a point, clamped into its clip; `null` when the clip no longer exists. */
export function sequencePointOf(point: SourcePoint, clips: readonly Clip[]): number | null {
  const start = clipSequenceStartUs(clips, point.clipId)
  const clip = clips.find((candidate) => candidate.id === point.clipId)
  if (start === null || !clip) return null
  return start + Math.min(Math.max(round(point.sourceUs), clip.startUs), clip.endUs) - clip.startUs
}

/**
 * The per-asset version of `sourceToSequence`: where a source time of one video lands in the
 * sequence. The **first** clip (in sequence order) containing it wins. A time outside every clip of
 * that asset collapses to the end of the latest-ending clip before it — the cut instant — and a time
 * before all of them collapses to the asset's first clip start, so a playhead dragged through a
 * removed range never appears to run backwards. An asset with no clips collapses to 0.
 */
export function sourceToSequenceForAsset(assetId: string, sourceUs: number, clips: readonly Clip[]): SequencePoint {
  const at = round(sourceUs)
  let elapsed = 0
  let firstStart: number | null = null
  let bestEndUs = -Infinity
  let before: number | null = null
  for (const clip of clips) {
    if (clip.assetId === assetId) {
      if (at >= clip.startUs && at < clip.endUs) return { sequenceUs: elapsed + (at - clip.startUs), kept: true }
      if (firstStart === null) firstStart = elapsed
      if (clip.endUs <= at && clip.endUs > bestEndUs) { bestEndUs = clip.endUs; before = elapsed + lengthOf(clip) }
    }
    elapsed += lengthOf(clip)
  }
  return { sequenceUs: before ?? firstStart ?? 0, kept: false }
}

/**
 * The inverse on `[0, sequenceDurationOfClips]`. A boundary between two clips maps to the **start of
 * the following** clip, so seeking to it lands on the first frame the viewer sees; times past the end
 * clamp to the last clip's end. `null` only when there are no clips.
 */
export function sequenceToSourcePoint(sequenceUs: number, clips: readonly Clip[]): SourcePoint | null {
  if (!clips.length) return null
  const at = Math.max(0, round(sequenceUs))
  let elapsed = 0
  for (const clip of clips) {
    const length = lengthOf(clip)
    if (at < elapsed + length) return pointAt(clip, clip.startUs + (at - elapsed))
    elapsed += length
  }
  const last = clips[clips.length - 1]
  return pointAt(last, last.endUs)
}

/**
 * Intersects a source range of one video with each of its clips, in sequence order. A cue straddling
 * a cut yields one span per kept piece; the cue itself is never split in storage.
 */
export function spansInSequenceForAsset(range: TimeRange, assetId: string, clips: readonly Clip[]): ClipSpan[] {
  const spans: ClipSpan[] = []
  let elapsed = 0
  for (const clip of clips) {
    if (clip.assetId === assetId) {
      const startUs = Math.max(range.startUs, clip.startUs)
      const endUs = Math.min(range.endUs, clip.endUs)
      if (endUs > startUs) {
        spans.push({
          startUs: elapsed + (startUs - clip.startUs), endUs: elapsed + (endUs - clip.startUs),
          sourceStartUs: startUs, sourceEndUs: endUs, clipId: clip.id, assetId,
        })
      }
    }
    elapsed += lengthOf(clip)
  }
  return spans
}

/**
 * The whole clip-boundary playback rule. `null` when the point is inside its clip (keep playing); the
 * clip's own start when it is before it; the next clip's start when it has run off the clip's end; and
 * `SEQUENCE_END` when there is no next clip — or when the clip was deleted mid-playback — so playback pauses.
 */
export function nextClipPoint(point: SourcePoint, clips: readonly Clip[]): SourcePoint | null | typeof SEQUENCE_END {
  const index = clips.findIndex((clip) => clip.id === point.clipId)
  if (index < 0) return SEQUENCE_END
  const clip = clips[index]
  const at = round(point.sourceUs)
  if (at < clip.startUs) return pointAt(clip, clip.startUs)
  if (at < clip.endUs) return null
  const next = clips[index + 1]
  return next ? pointAt(next, next.startUs) : SEQUENCE_END
}

export function sameClips(a: readonly Clip[], b: readonly Clip[]): boolean {
  return a.length === b.length && a.every((clip, index) => {
    const other = b[index]
    return clip.id === other.id && clip.assetId === other.assetId && clip.startUs === other.startUs && clip.endUs === other.endUs
  })
}

/** Drops empty ranges. Deliberately does **not** sort: array order is the sequence order. */
export function normalizeClips(clips: readonly Clip[]): Clip[] {
  return clips.filter((clip) => clip.endUs > clip.startUs).map((clip) => ({ ...clip }))
}

function clipIndex(clips: readonly Clip[], clipId: string): number {
  const index = clips.findIndex((clip) => clip.id === clipId)
  if (index < 0) throw new Error('That clip no longer exists.')
  return index
}

/** Inserts at `index` (append when absent), clamped into the list. */
export function insertClip(clips: readonly Clip[], clip: Clip, index?: number): Clip[] {
  const at = index === undefined ? clips.length : Math.min(Math.max(Math.round(index), 0), clips.length)
  return [...clips.slice(0, at), { ...clip }, ...clips.slice(at)]
}

/** Splits a clip at a source time strictly inside it; the first half keeps the id. Anywhere else is a no-op. */
export function splitClipAt(clips: readonly Clip[], clipId: string, atUs: number, newClipId: string): Clip[] {
  const index = clipIndex(clips, clipId)
  const clip = clips[index]
  const at = round(atUs)
  if (at <= clip.startUs || at >= clip.endUs) return clips.map((item) => ({ ...item }))
  return [...clips.slice(0, index), { ...clip, endUs: at }, { ...clip, id: newClipId, startUs: at }, ...clips.slice(index + 1)]
}

/** Removes one clip. The last remaining clip cannot be removed: an empty sequence has nothing to play. */
export function removeClip(clips: readonly Clip[], clipId: string): Clip[] {
  const index = clipIndex(clips, clipId)
  if (clips.length <= 1) throw new Error('Removing the only remaining clip would leave nothing to play.')
  return clips.filter((_, at) => at !== index).map((clip) => ({ ...clip }))
}

/**
 * Re-joins a clip with the one after it, restoring the source range between them. Only clips of the
 * same asset in ascending, non-overlapping order can join — anything else is not one continuous range.
 */
export function joinClipWithNext(clips: readonly Clip[], clipId: string): Clip[] {
  const index = clipIndex(clips, clipId)
  const clip = clips[index]
  const next = clips[index + 1]
  if (!next) throw new Error('The last clip has nothing to join with.')
  if (next.assetId !== clip.assetId) throw new Error('Only clips of the same video can be joined.')
  if (next.startUs < clip.endUs) throw new Error('These clips overlap or are out of order, so they cannot be joined into one range.')
  return [...clips.slice(0, index), { ...clip, endUs: next.endUs }, ...clips.slice(index + 2)]
}

/** Moves a clip so it sits at `toIndex` of the resulting list. */
export function moveClip(clips: readonly Clip[], clipId: string, toIndex: number): Clip[] {
  const index = clipIndex(clips, clipId)
  const rest = clips.filter((_, at) => at !== index)
  const at = Math.min(Math.max(Math.round(toIndex), 0), rest.length)
  return [...rest.slice(0, at), { ...clips[index] }, ...rest.slice(at)]
}

/** Changes a clip's source range, bounded by its asset's known duration. */
export function resizeClip(clips: readonly Clip[], clipId: string, startUs: number, endUs: number, assetDurationUs: number | null): Clip[] {
  const index = clipIndex(clips, clipId)
  const start = round(startUs)
  const end = round(endUs)
  if (start < 0 || end <= start) throw new Error('A clip must end after its start.')
  if (assetDurationUs !== null && end > assetDurationUs) throw new Error('A clip must stay within its video’s duration.')
  return clips.map((clip, at) => at === index ? { ...clip, startUs: start, endUs: end } : { ...clip })
}

/**
 * Silence removal: replaces every clip of `assetId` with the pieces of it that fall inside the
 * `kept` ranges, in place (other assets' clips do not move). The first piece keeps the clip's id and
 * later pieces take `newId(n)`. A clip with nothing kept is dropped.
 */
export function splitClipsByKeptRanges(clips: readonly Clip[], assetId: string, kept: readonly TimeRange[], newId: (serial: number) => string): Clip[] {
  const ranges = [...kept].filter((range) => range.endUs > range.startUs).sort((a, b) => a.startUs - b.startUs)
  let serial = 0
  return clips.flatMap((clip): Clip[] => {
    if (clip.assetId !== assetId) return [{ ...clip }]
    const pieces = ranges.flatMap((range) => {
      const startUs = Math.max(range.startUs, clip.startUs)
      const endUs = Math.min(range.endUs, clip.endUs)
      return endUs > startUs ? [{ startUs, endUs }] : []
    })
    return pieces.map((piece, at) => ({ id: at === 0 ? clip.id : newId(++serial), assetId, ...piece }))
  })
}

/**
 * "Restore removed ranges": every maximal run of consecutive clips of one asset collapses to a single
 * clip over the whole asset, keeping the run's first id. Runs of an asset whose duration is unknown
 * are left as they are. Undoes silence removal and cuts without disturbing the order of different videos.
 */
export function restoreFullClips(clips: readonly Clip[], durationsUs: ReadonlyMap<string, number>): Clip[] {
  const result: Clip[] = []
  for (const clip of clips) {
    const previous = result[result.length - 1]
    const durationUs = durationsUs.get(clip.assetId)
    if (durationUs === undefined) { result.push({ ...clip }); continue }
    if (previous && previous.assetId === clip.assetId) continue
    result.push({ ...clip, startUs: 0, endUs: durationUs })
  }
  return result
}

/**
 * Keeps clips valid when an asset's duration changes (a relink to a different file): a clip that
 * covered the whole old duration follows the new one, and any other clip is clamped into it. A clip
 * left with nothing inside the new duration is dropped.
 */
export function refitClipsToDuration(clips: readonly Clip[], assetId: string, oldDurationUs: number | null, newDurationUs: number): Clip[] {
  return clips.flatMap((clip): Clip[] => {
    if (clip.assetId !== assetId) return [{ ...clip }]
    const wasWhole = clip.startUs === 0 && oldDurationUs !== null && clip.endUs === oldDurationUs
    const endUs = wasWhole ? newDurationUs : Math.min(clip.endUs, newDurationUs)
    return endUs > clip.startUs ? [{ ...clip, endUs }] : []
  })
}

/**
 * Source cues → sequence-time cues for SRT export. A cue whose spans are contiguous in the sequence
 * (the usual cut case: a removed range collapses to nothing) stays **one** cue clipped to the kept
 * material. Clips may reorder or repeat, so a cue whose spans are *not* contiguous becomes one cue per
 * contiguous run — the viewer sees those words at separate moments. A cue with no spans is dropped from
 * the result but never touched in the project. A cue with no `mediaAssetId` (a project without clips)
 * passes through unchanged.
 */
export function cuesInSequenceForClips(cues: readonly Cue[], clips: readonly Clip[]): Cue[] {
  const result: Cue[] = []
  for (const cue of cues) {
    if (!cue.mediaAssetId) { result.push(cue); continue }
    const runs: ClipSpan[][] = []
    for (const span of spansInSequenceForAsset(cue, cue.mediaAssetId, clips)) {
      const run = runs[runs.length - 1]
      if (run && run[run.length - 1].endUs === span.startUs) run.push(span)
      else runs.push([span])
    }
    runs.forEach((run, runIndex) => {
      const startUs = run[0].startUs
      const endUs = run[run.length - 1].endUs
      const words = cue.words.flatMap((word) => {
        const inRun = spansInSequenceForAsset(word, cue.mediaAssetId!, clips).filter((span) => span.startUs >= startUs && span.endUs <= endUs)
        return inRun.length ? [{ ...word, startUs: inRun[0].startUs, endUs: inRun[inRun.length - 1].endUs }] : []
      })
      result.push({ ...cue, id: runIndex === 0 ? cue.id : `${cue.id}:${runIndex + 1}`, startUs, endUs, words })
    })
  }
  return result.sort((a, b) => a.startUs - b.startUs || a.endUs - b.endUs)
}
