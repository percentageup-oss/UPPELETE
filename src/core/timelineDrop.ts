import type { Clip, ProjectAsset, Track } from './edit'
import { freeTrackFor } from './clipEdits'
import { pixelToTime } from './timeline'

/** Sequence-time µs under a drag's clientX, clamped to the visible sequence. */
export function dropTimeAt(clientX: number, contentRect: { left: number; width: number }, durationUs: number): number {
  const pixel = clientX - contentRect.left
  return Math.min(Math.max(0, pixelToTime(pixel, durationUs, contentRect.width)), durationUs)
}

/** A newly placed image lasts three seconds, like a new title in any editor. */
export const DEFAULT_IMAGE_CLIP_US = 3_000_000
/** A new background is short by default (trim or stretch it as needed), not the whole timeline. */
export const DEFAULT_BACKGROUND_CLIP_US = 2_000_000
/** A new adjustment layer dropped at an empty spot (docs/EDITING.md "Color: adjustment layers");
 * one dropped onto a clip instead spans that clip's own range. */
export const DEFAULT_ADJUSTMENT_CLIP_US = 5_000_000

/** Where a dropped or imported asset lands. `trackId: null` means no existing track can take it and
 * the caller creates one (in the same undo step, via `clip-add`'s `track`). */
export type DropPlacement = { trackId: string | null; startUs: number; lengthUs: number }
export type DropPlan = { kind: 'clip'; placement: DropPlacement } | { kind: 'refused'; reason: string }

/**
 * What dropping a bin asset at `sequenceUs` does. Every kind becomes a clip:
 * - **video** lands on the video track under the pointer when free there, else the first free video
 *   track, else a new track on top — never overwriting a clip it lands on;
 * - **image** lands on the track under the pointer when it is free there, else the lowest free
 *   track above every track holding video, else a new track on top;
 * - **audio** lands on the audio track under the pointer when free, else the first free audio track,
 *   else a new audio track.
 * Media whose duration was never read cannot be placed: there is no length to give its clip.
 */
export function dropPlanForAsset(asset: { kind: ProjectAsset['kind']; durationUs: number | null }, sequenceUs: number,
  tracks: readonly Track[], clips: readonly Clip[], targetTrackId?: string | null): DropPlan {
  const startUs = Math.max(0, Math.round(sequenceUs))
  // A LUT asset has no clip kind of its own: it is dropped from the Color panel as an adjustment
  // layer (docs/EDITING.md "Color: adjustment layers"), not from the bin through this generic path.
  if (asset.kind === 'lut') return { kind: 'refused', reason: 'Drag a LUT from the Color tab onto a video track to grade it.' }
  if (asset.kind !== 'image' && asset.durationUs === null) return { kind: 'refused', reason: 'This file’s duration could not be read, so it cannot be placed on the timeline. Relink it first.' }
  const lengthUs = asset.kind === 'image' ? DEFAULT_IMAGE_CLIP_US : asset.durationUs!
  const target = targetTrackId ? tracks.find((track) => track.id === targetTrackId) : undefined
  const trackId = freeTrackFor(tracks, clips, asset.kind, { startUs, endUs: startUs + lengthUs }, target?.id)
  return { kind: 'clip', placement: { trackId, startUs, lengthUs } }
}
