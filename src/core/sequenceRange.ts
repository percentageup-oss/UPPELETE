import { COMPOSITION_WIDTH, type Clip } from './edit'
import type { CaptionProject, Cue } from './model'
import { clipEndUs, normalizeClips, sourceUsAt } from './timelineModel'
import { zoomRectAt } from './zoomRegion'

/** A sequence-time range [startUs, endUs) chosen with the I/O marks. */
export type SequenceRange = { startUs: number; endUs: number }

export function isValidRange(range: SequenceRange, sequenceEndUs: number): boolean {
  return Number.isInteger(range.startUs) && Number.isInteger(range.endUs)
    && range.startUs >= 0 && range.endUs > range.startUs && range.endUs <= sequenceEndUs
}

/** One clip cut to the range and moved so the range starts at 0; `null` when it is entirely outside. */
function cropClip(clip: Clip, range: SequenceRange): Clip | null {
  const startUs = Math.max(clip.timelineStartUs, range.startUs)
  const endUs = Math.min(clipEndUs(clip), range.endUs)
  if (endUs <= startUs) return null
  let next = clip
  if (startUs > clip.timelineStartUs) {
    next = { ...next, timelineStartUs: startUs, sourceStartUs: sourceUsAt(clip, startUs) }
    // Image clips keep a synthetic source range anchored at 0 (see clipEdits `rebased`).
    if (next.kind === 'image') next = { ...next, sourceStartUs: 0, sourceEndUs: endUs - startUs }
  }
  if (endUs < clipEndUs(clip)) next = { ...next, sourceEndUs: next.kind === 'image' ? endUs - startUs : sourceUsAt(next, endUs) }
  return { ...next, timelineStartUs: next.timelineStartUs - range.startUs }
}

type Timed = { startUs: number; endUs: number }

/** Sequence-time items: cut at both ends of the range, then shifted. */
function cropItems<T extends Timed>(items: readonly T[], range: SequenceRange): T[] {
  return items.flatMap((item) => {
    const startUs = Math.max(item.startUs, range.startUs)
    const endUs = Math.min(item.endUs, range.endUs)
    return endUs > startUs ? [{ ...item, startUs: startUs - range.startUs, endUs: endUs - range.startUs }] : []
  })
}

/** An unbound cue (no video yet) is stored in sequence time, so it is cropped like any other item. */
function cropUnboundCue(cue: Cue, range: SequenceRange): Cue[] {
  const [cropped] = cropItems([cue], range)
  if (!cropped) return []
  const words = cue.words.flatMap((word) => cropItems([word], range))
  return [{ ...cropped, words }]
}

/**
 * The project as it would be if the timeline were exactly [range.startUs, range.endUs): the
 * export-only transform behind "export In to Out". Never enters history and never touches the saved
 * project. Bound cues are stored in source time and follow their clips, so they are left alone; the
 * manifest and SRT paths then map them through the cropped clips like any other project.
 *
 * Limits: a plain zoom, glow or text layer cut by the In mark starts its ease/entry animation at
 * the new zero rather than mid-way; a pan (Ken Burns) cut by In starts at the frame it had reached
 * but then eases across the remaining time.
 */
export function projectInRange(project: CaptionProject, range: SequenceRange): CaptionProject {
  const clips = normalizeClips(project.tracks, project.clips.flatMap((clip) => cropClip(clip, range) ?? []))
  // A pan never reads the composition (only plain zoom eases to/from the full frame).
  const composition = { width: COMPOSITION_WIDTH, height: COMPOSITION_WIDTH }
  const zoomRegions = project.zoomRegions.flatMap((region) => {
    if (region.endUs <= range.startUs || region.startUs >= range.endUs) return []
    const shifted = { ...region, startUs: Math.max(region.startUs, range.startUs) - range.startUs }
    if (region.fromRect) {
      // A pan's progress spans its whole length, so its true end is kept even past the range end.
      const fromRect = region.startUs < range.startUs ? zoomRectAt([region], range.startUs, composition) ?? region.fromRect : region.fromRect
      return [{ ...shifted, endUs: region.endUs - range.startUs, fromRect }]
    }
    return [{ ...shifted, endUs: Math.min(region.endUs, range.endUs) - range.startUs }]
  })
  return {
    ...project,
    clips,
    cues: project.cues.flatMap((cue) => cue.mediaAssetId ? [cue] : cropUnboundCue(cue, range)),
    blurRegions: cropItems(project.blurRegions, range),
    zoomRegions,
    effects: cropItems(project.effects, range),
    textOverlays: cropItems(project.textOverlays, range),
    markers: project.markers.filter((marker) => marker.atUs >= range.startUs && marker.atUs < range.endUs).map((marker) => ({ ...marker, atUs: marker.atUs - range.startUs })),
  }
}
