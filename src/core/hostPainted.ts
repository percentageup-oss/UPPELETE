import type { Clip, Track } from './edit'

/**
 * Whether image clips are painted by the export host (pinned above the picture, exact preview parity,
 * ADR 0003) rather than composited by FFmpeg (ADR 0005). Preview, the layer list and the export plan
 * all ask this one question so they cannot drift.
 *
 * Images are host-painted only when every image track sits above every video/background track, no
 * adjustment layer needs to grade them, and no image blends: the host paints onto a transparent
 * layer, which cannot blend against the picture underneath.
 */
export function imagesHostPainted(clips: readonly Clip[], tracks: readonly Track[], { adjustments }: { adjustments: boolean }): boolean {
  if (adjustments) return false
  const order = new Map(tracks.map((track, index) => [track.id, index]))
  const highestVideoTrack = Math.max(-1, ...clips.filter((clip) => clip.kind === 'video' || clip.kind === 'color').map((clip) => order.get(clip.trackId) ?? -1))
  return clips.every((clip) => clip.kind !== 'image' || ((order.get(clip.trackId) ?? -1) > highestVideoTrack && (clip.blendMode ?? 'normal') === 'normal'))
}
