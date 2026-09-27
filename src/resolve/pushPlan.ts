import type { CaptionProject } from '../core/model'
import { formatFromMedia } from '../core/format'
import { primaryVideoAsset } from '../core/projectClips'
import { captionClips } from '../core/timelineModel'
import { usToTimelineFrame } from './frames'

type Fps = { num: number; den: number }

/** One video clip to place on the new Resolve timeline. Source frames are in the asset's own frame rate
 * (ADR 0009: what `AppendToTimeline` expects), record frames in the new timeline's. */
export type PushClip = {
  assetId: string
  /** 1-based, in KathaCut video-track order (only tracks that actually have a clip get a number). */
  trackIndex: number
  /** Frames from the new Resolve timeline's start frame — main adds the actual `startFrame` once known. */
  recordOffsetFrames: number
  sourceStartFrame: number
  /** Inclusive, matching the convention `bridge.lua`'s `insertClips` already uses for `AppendToTimeline`
   * (ADR 0009 could not tell inclusive/exclusive apart at its test precision). */
  sourceEndFrame: number
}

export type PushPlan = {
  timeline: { name: string; fps: Fps; width: number; height: number }
  /** Asset ids to import into Resolve, in first-use order. */
  media: string[]
  clips: PushClip[]
  notSent: { feature: string; count: number }[]
}

const usToFrames = (us: number, fps: Fps) => usToTimelineFrame(us, { startFrame: 0, fps })

function sourceFpsOf(project: CaptionProject, assetId: string, fallback: Fps): Fps {
  const rate = project.assets.find((asset) => asset.id === assetId)?.metadata?.nominalFrameRate
    ?? project.assets.find((asset) => asset.id === assetId)?.metadata?.frameRate
  return rate ? { num: rate.numerator, den: rate.denominator } : fallback
}

/**
 * Plans a new Resolve timeline from a KathaCut project (docs/plans/resolve-textplus/12-push-to-resolve.md):
 * pure and Resolve-agnostic, like `planEditImport`'s inverse. Captions aren't planned here — `planTextPlus`
 * does that once the new timeline's link exists (brief 10).
 */
export function planPush(project: CaptionProject): PushPlan {
  const format = project.format ?? formatFromMedia(primaryVideoAsset(project)?.metadata)
  if (!format) throw new Error('Add a video before creating a DaVinci timeline.')
  const timelineFps: Fps = { num: format.frameRate.numerator, den: format.frameRate.denominator }

  const trackOrder = new Map(project.tracks.map((track, index) => [track.id, index]))
  const allVideoClips = captionClips(project.tracks, project.clips)
  const plain = allVideoClips
    .filter((clip) => !clip.speed)
    .sort((a, b) => (trackOrder.get(a.trackId) ?? 0) - (trackOrder.get(b.trackId) ?? 0) || a.timelineStartUs - b.timelineStartUs)

  const trackIndexOf = new Map<string, number>()
  for (const clip of plain) if (!trackIndexOf.has(clip.trackId)) trackIndexOf.set(clip.trackId, trackIndexOf.size + 1)

  const media: string[] = []
  const seenAssets = new Set<string>()
  const clips: PushClip[] = plain.map((clip) => {
    if (!seenAssets.has(clip.assetId)) { seenAssets.add(clip.assetId); media.push(clip.assetId) }
    const sourceFps = sourceFpsOf(project, clip.assetId, timelineFps)
    return {
      assetId: clip.assetId,
      trackIndex: trackIndexOf.get(clip.trackId)!,
      recordOffsetFrames: usToFrames(clip.timelineStartUs, timelineFps),
      sourceStartFrame: usToFrames(clip.sourceStartUs, sourceFps),
      sourceEndFrame: usToFrames(clip.sourceEndUs, sourceFps) - 1,
    }
  })

  const counts = new Map<string, number>()
  const bump = (feature: string, count: number) => { if (count > 0) counts.set(feature, (counts.get(feature) ?? 0) + count) }
  bump('Speed-adjusted video clips', allVideoClips.length - plain.length)
  bump('Audio clips', project.clips.filter((clip) => clip.kind === 'audio').length)
  bump('Images', project.clips.filter((clip) => clip.kind === 'image').length)
  bump('Color backgrounds', project.clips.filter((clip) => clip.kind === 'color').length)
  bump('Adjustment layers (grades)', project.clips.filter((clip) => clip.kind === 'adjustment').length)
  bump('Text overlays', project.textOverlays.length)
  bump('Shapes', project.shapes.length)
  bump('Effects', project.effects.length + project.blurRegions.length)
  bump('Zoom regions', project.zoomRegions.length)
  const notSent = [...counts.entries()].map(([feature, count]) => ({ feature, count }))

  return {
    timeline: { name: project.title || 'KathaCut', fps: timelineFps, width: format.width, height: format.height },
    media, clips, notSent,
  }
}
