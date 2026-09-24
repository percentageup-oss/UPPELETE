import type { Clip, Track } from './edit'
import { acceptsKind, trimClip, type EditMode } from './clipEdits'
import { snapDelta } from './timeline'
import { clipEndUs, clipLengthUs } from './timelineModel'

/**
 * One clip drag on the timeline, pure: where the dragged clip would land for a pointer delta.
 * Moves may change track (the track under the pointer, when it takes the clip's kind and is
 * unlocked); trims are clamped exactly as the commit will be, by running the real `trimClip` on the
 * real clip list, so what the user sees while dragging is what they get. Snap targets are sequence
 * time — every clip edge on every track, the playhead, 0, the sequence end and caption edges.
 */
export type ClipDragMode = 'move' | 'start' | 'end'
export type ClipDragPreview = {
  /** The dragged clip as it would be after the gesture (its track may differ). */
  clip: Clip
  /** For a trim: the edge delta the clamped result actually applied, to commit as `clip-trim`. */
  appliedDeltaUs: number
  /** The snap target the edge landed on, for the guide line. */
  guideUs: number | null
}

export function previewClipDrag(input: {
  clip: Clip
  mode: ClipDragMode
  deltaUs: number
  targetTrack: Track | null
  tracks: readonly Track[]
  clips: readonly Clip[]
  assetDurationUs: number | null
  editMode: EditMode
  snap: { targetsUs: readonly number[]; thresholdUs: number } | null
}): ClipDragPreview {
  const { clip, mode, tracks, clips } = input
  const delta = Math.round(input.deltaUs)
  const range = { startUs: clip.timelineStartUs, endUs: clipEndUs(clip) }
  if (mode === 'move') {
    const startUs = Math.max(0, range.startUs + delta)
    const moved = { startUs, endUs: startUs + clipLengthUs(clip) }
    const extra = input.snap ? snapDelta(moved, 'move', input.snap.targetsUs, input.snap.thresholdUs) : 0
    const snappedStart = Math.max(0, startUs + extra)
    const target = input.targetTrack && acceptsKind(input.targetTrack, clip.kind) && !input.targetTrack.locked ? input.targetTrack : null
    const guideUs = extra ? [snappedStart, snappedStart + clipLengthUs(clip)].find((edge) => input.snap!.targetsUs.includes(edge)) ?? null : null
    return { clip: { ...clip, trackId: target?.id ?? clip.trackId, timelineStartUs: snappedStart }, appliedDeltaUs: snappedStart - range.startUs, guideUs }
  }
  const edgeUs = mode === 'start' ? range.startUs : range.endUs
  const free = { startUs: mode === 'start' ? range.startUs + delta : range.startUs, endUs: mode === 'end' ? range.endUs + delta : range.endUs }
  const extra = input.snap ? snapDelta(free, mode, input.snap.targetsUs, input.snap.thresholdUs) : 0
  const wanted = delta + extra
  let result: readonly Clip[]
  try { result = trimClip(tracks, clips, clip.id, mode, wanted, input.editMode, input.assetDurationUs) }
  catch { return { clip, appliedDeltaUs: 0, guideUs: null } }
  const trimmed = result.find((candidate) => candidate.id === clip.id) ?? clip
  const applied = mode === 'end' ? clipEndUs(trimmed) - clipEndUs(clip)
    : input.editMode === 'ripple' ? clipLengthUs(clip) - clipLengthUs(trimmed) : trimmed.timelineStartUs - clip.timelineStartUs
  const landed = mode === 'end' ? clipEndUs(trimmed) : input.editMode === 'ripple' ? edgeUs : trimmed.timelineStartUs
  return { clip: trimmed, appliedDeltaUs: applied, guideUs: extra && input.snap!.targetsUs.includes(landed) ? landed : null }
}
