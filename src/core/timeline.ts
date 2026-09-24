import type { Cue } from './model'
import type { DragBounds, TimelineItem } from './timelineItems'

export type CueDragMode = 'move' | 'start' | 'end'

export function timeToPixel(timeUs: number, durationUs: number, widthPx: number): number {
  if (durationUs <= 0 || widthPx <= 0) return 0
  return timeUs * widthPx / durationUs
}

export function pixelToTime(pixel: number, durationUs: number, widthPx: number): number {
  if (durationUs <= 0 || widthPx <= 0) return 0
  return Math.round(pixel * durationUs / widthPx)
}

/** Room the timeline keeps past the last clip so media can be dropped or dragged beyond the program end. */
export const TIMELINE_TAIL_MIN_US = 30_000_000
export const TIMELINE_TAIL_FRACTION = 0.25

/** The span the ruler and lanes draw: the program plus headroom. The program length itself (playback, export, seek limits) is unchanged. */
export function timelineViewSpanUs(programUs: number): number {
  const program = Math.max(0, programUs)
  return program + Math.max(TIMELINE_TAIL_MIN_US, Math.round(program * TIMELINE_TAIL_FRACTION))
}

export function anchoredScrollLeft(
  anchorUs: number,
  durationUs: number,
  oldContentWidthPx: number,
  oldScrollLeftPx: number,
  viewportWidthPx: number,
  newContentWidthPx: number,
): number {
  const screenX = timeToPixel(anchorUs, durationUs, oldContentWidthPx) - oldScrollLeftPx
  const desired = timeToPixel(anchorUs, durationUs, newContentWidthPx) - screenX
  return Math.min(Math.max(0, desired), Math.max(0, newContentWidthPx - viewportWidthPx))
}

const RULER_STEPS_US = [100_000, 250_000, 500_000, 1_000_000, 2_000_000, 5_000_000, 10_000_000, 30_000_000, 60_000_000]

/** Finest labelled tick spacing that keeps at most ~8 labels across the visible span. */
export function rulerStep(durationUs: number, zoom: number): number {
  const visibleUs = durationUs / Math.max(1, zoom)
  return RULER_STEPS_US.find((candidate) => candidate >= visibleUs / 8) ?? 5 * 60_000_000
}

/**
 * Extra delta that lands the dragged edge on the nearest snap target within the threshold, or 0.
 * For a move, whichever of start/end is closer to a target wins so the cue's duration is unchanged.
 */
export function snapDelta(preview: Pick<Cue, 'startUs' | 'endUs'>, mode: CueDragMode, targetsUs: readonly number[], thresholdUs: number): number {
  if (!(thresholdUs > 0) || !targetsUs.length) return 0
  const edges = mode === 'move' ? [preview.startUs, preview.endUs] : mode === 'start' ? [preview.startUs] : [preview.endUs]
  let best = 0
  let bestDistance = thresholdUs
  for (const edge of edges) for (const target of targetsUs) {
    const distance = Math.abs(target - edge)
    if (distance < bestDistance) {
      bestDistance = distance
      best = target - edge
    }
  }
  return best
}

/** Moves whichever cue boundary is nearer to the playhead onto it; the other boundary is untouched so duration stays positive. */
export function trimToPlayhead(cue: Pick<Cue, 'startUs' | 'endUs'>, playheadUs: number): { startUs: number; endUs: number } {
  const target = Math.max(0, Math.round(playheadUs))
  const moveStart = target <= cue.startUs || (target < cue.endUs && target - cue.startUs <= cue.endUs - target)
  return moveStart ? { startUs: target, endUs: cue.endUs } : { startUs: cue.startUs, endUs: target }
}

/**
 * Clamps for dragging one cue: never before zero or past the known media, never shorter than a
 * microsecond, and never so far that a timed word escapes its own cue.
 */
export function cueDragBounds(cue: Pick<Cue, 'startUs' | 'endUs' | 'words'>, mediaDurationUs: number | null): DragBounds {
  const mediaEndUs = mediaDurationUs ?? Number.MAX_SAFE_INTEGER
  const firstWordStartUs = cue.words.length ? Math.min(...cue.words.map((word) => word.startUs)) : cue.endUs - 1
  const lastWordEndUs = cue.words.length ? Math.max(...cue.words.map((word) => word.endUs)) : cue.startUs + 1
  return {
    minStartUs: 0,
    maxStartUs: Math.min(cue.endUs - 1, firstWordStartUs),
    minEndUs: Math.max(cue.startUs + 1, lastWordEndUs),
    maxEndUs: mediaEndUs,
  }
}

/** Clamps for any other timed item: inside the media, never shorter than `minDurationUs`. */
export function itemDragBounds(item: Pick<TimelineItem, 'startUs' | 'endUs'>, mediaDurationUs: number | null, minDurationUs = 1): DragBounds {
  const mediaEndUs = mediaDurationUs ?? Number.MAX_SAFE_INTEGER
  return {
    minStartUs: 0,
    maxStartUs: Math.max(0, item.endUs - minDurationUs),
    minEndUs: item.startUs + minDurationUs,
    maxEndUs: mediaEndUs,
  }
}

/**
 * Moves or resizes any source-time range within its clamps. A move preserves duration exactly by
 * clamping the delta rather than each edge; an edge drag leaves the other edge untouched.
 */
export function dragRangeBy<T extends { startUs: number; endUs: number }>(range: T, mode: CueDragMode, deltaUs: number, bounds: DragBounds): { startUs: number; endUs: number } {
  const roundedDelta = Math.round(deltaUs)
  if (mode === 'move') {
    const appliedDelta = Math.min(bounds.maxEndUs - range.endUs, Math.max(bounds.minStartUs - range.startUs, roundedDelta))
    return { startUs: range.startUs + appliedDelta, endUs: range.endUs + appliedDelta }
  }
  if (mode === 'start') {
    return { startUs: Math.min(bounds.maxStartUs, Math.max(bounds.minStartUs, range.startUs + roundedDelta)), endUs: range.endUs }
  }
  return { startUs: range.startUs, endUs: Math.max(bounds.minEndUs, Math.min(bounds.maxEndUs, range.endUs + roundedDelta)) }
}

/** The cue-specific wrapper: generic clamping plus word shifting and manual timing provenance. */
export function dragCueBy(cue: Cue, mode: CueDragMode, deltaUs: number, mediaDurationUs: number | null): Cue {
  const next = dragRangeBy(cue, mode, deltaUs, cueDragBounds(cue, mediaDurationUs))
  if (mode !== 'move') return { ...cue, ...next, timingSource: 'manual' }
  const appliedDelta = next.startUs - cue.startUs
  return {
    ...cue,
    ...next,
    words: cue.words.map((word) => ({ ...word, startUs: word.startUs + appliedDelta, endUs: word.endUs + appliedDelta })),
    timingSource: 'manual',
  }
}
