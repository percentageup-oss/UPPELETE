/**
 * The bottom-up adjustment-layer stack over a picture clip at one instant (docs/EDITING.md "Color:
 * adjustment layers"). `adjustmentsOver` is shared verbatim by the export plan (`src/export/plan.ts`,
 * which splits a clip into constant-stack segments before baking) and the live preview
 * (`gradeStackFor` below, which only ever needs the stack at the current frame) — the same test for
 * "does this adjustment layer grade that clip right now" runs in both places, so they can never
 * disagree about which layers apply.
 */

import type { AdjustmentClip, Clip } from './edit'
import { clipEndUs, type TimeRange } from './timelineModel'

/** The enabled adjustment clips on a track above `trackIndex` that overlap `range` at all, bottom-up
 * by track order — the order stacked grades apply in, closest to the picture first. */
export function adjustmentsOver(clips: readonly Clip[], order: ReadonlyMap<string, number>, trackIndex: number, range: TimeRange): AdjustmentClip[] {
  return clips.filter((clip): clip is AdjustmentClip => clip.kind === 'adjustment' && clip.enabled !== false
    && (order.get(clip.trackId) ?? -1) > trackIndex && clip.timelineStartUs < range.endUs && clipEndUs(clip) > range.startUs)
    .sort((a, b) => (order.get(a.trackId) ?? 0) - (order.get(b.trackId) ?? 0))
}

/**
 * The bottom-up grade stack over `clip` at `sequenceUs`, for the live preview. A `color` or `audio`
 * clip is never graded in v1 (docs/EDITING.md), so this always returns `[]` for them without the
 * caller needing to check first — same rule the export plan enforces in its manifest schema.
 */
export function gradeStackFor(clips: readonly Clip[], order: ReadonlyMap<string, number>, clip: Clip, sequenceUs: number): AdjustmentClip[] {
  if (clip.kind === 'color' || clip.kind === 'audio' || clip.kind === 'adjustment') return []
  const trackIndex = order.get(clip.trackId) ?? -1
  return adjustmentsOver(clips, order, trackIndex, { startUs: sequenceUs, endUs: sequenceUs + 1 })
}
