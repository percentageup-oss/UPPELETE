import type { Clip, Track } from '../core/edit'
import { captionClips, trackIndexMap } from '../core/timelineModel'
import { stableStringify, fnv1a32Hex } from './specHash'

/**
 * A hash of the video edit a project's `resolveLink` was made against (docs/plans/resolve-textplus/10-link-sequence-mapping.md).
 * Only video clips count — moving a text overlay or an audio clip doesn't invalidate the link. If this no longer
 * matches `link.editSignature`, Sync is disabled: the cut change would move captions to the wrong Resolve frames.
 */
export function editSignature(project: { tracks: readonly Track[]; clips: readonly Clip[] }): string {
  const order = trackIndexMap(project.tracks)
  const clips = captionClips(project.tracks, project.clips)
    .slice()
    .sort((a, b) => (order.get(a.trackId) ?? Infinity) - (order.get(b.trackId) ?? Infinity) || a.timelineStartUs - b.timelineStartUs)
  const entries = clips.map((clip) => [clip.assetId, clip.trackId, clip.timelineStartUs, clip.sourceStartUs, clip.sourceEndUs, clip.speed ?? null])
  return fnv1a32Hex(stableStringify(entries))
}
