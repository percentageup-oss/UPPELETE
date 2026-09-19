import type { AudioClip, ProjectAsset } from './edit'
import { sourceToSequence, type TimeRange } from './sequence'

/**
 * Pure helpers shared by the SFX timeline track, inspector and export builder (docs/EDITING.md,
 * ticket V3). A clip is stored as an anchor + optional duration (`edit.ts`'s `audioClipSchema`),
 * unlike an overlay's explicit `startUs/endUs`, so every consumer that needs a range projects one
 * with `clipRange` first.
 */

const DEFAULT_CLIP_DURATION_US = 1_000_000

/** The clip's effective length: an explicit `durationUs`, or what remains of the asset from its
 * in point, or a one-second placeholder when the asset's own duration isn't known yet. */
export function clipDurationUs(clip: Pick<AudioClip, 'durationUs' | 'inPointUs'>, asset: Pick<ProjectAsset, 'metadata'> | null | undefined): number {
  if (clip.durationUs !== null) return clip.durationUs
  const assetDurationUs = asset?.metadata?.durationUs
  if (assetDurationUs != null) return Math.max(1, assetDurationUs - clip.inPointUs)
  return DEFAULT_CLIP_DURATION_US
}

/** Projects a clip to a `{startUs, endUs}` range in source time, for the timeline drag path
 * (`itemDragBounds`/`dragRangeBy`) and lane packing, both of which are range-typed. */
export function clipRange(clip: AudioClip, asset: ProjectAsset | null | undefined): TimeRange {
  const startUs = clip.atUs
  return { startUs, endUs: startUs + clipDurationUs(clip, asset) }
}

/** A newly imported sound effect is anchored at the playhead, plays its whole length and mixes at
 * unity gain — mirroring `defaultOverlayRange`'s "anchor at the playhead" default. */
export function defaultClipAt(id: string, assetId: string, currentUs: number): AudioClip {
  return { id, assetId, atUs: Math.max(0, Math.round(currentUs)), inPointUs: 0, durationUs: null, gain: 1 }
}

/**
 * A clip anchored inside a removed range collapses to the cut instant under `sourceToSequence`
 * (docs/EDITING.md: "clips anchored inside a removed range are dropped with a warning"). Shared by
 * the pre-export warning (`App.tsx`) and the manifest builder (`plan.ts`), which must agree on
 * exactly which clips are dropped.
 */
export function droppedSoundEffects(clips: readonly AudioClip[], segments: readonly TimeRange[] | undefined, mediaDurationUs: number | null): AudioClip[] {
  if (!segments) return []
  return clips.filter((clip) => !sourceToSequence(clip.atUs, segments, mediaDurationUs).kept)
}
