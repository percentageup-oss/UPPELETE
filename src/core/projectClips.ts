import type { Clip, ProjectAsset, Track, VideoClip } from './edit'
import type { CaptionProject } from './model'
import { clipLengthUs } from './timelineModel'

/**
 * Read-side helpers over schema 5's `assets` + `tracks` + `clips`. Kept out of `model.ts` so the
 * schema module stays free of editing concepts, and out of `timelineModel.ts` so that module stays
 * free of the project.
 */

export const videoAssets = (project: Pick<CaptionProject, 'assets'>): ProjectAsset[] =>
  project.assets.filter((asset) => asset.kind === 'video')

export const videoClips = (project: Pick<CaptionProject, 'clips'>): VideoClip[] =>
  project.clips.filter((clip): clip is VideoClip => clip.kind === 'video')

/** Known probed durations by asset id; an asset whose duration was never probed is absent. */
export function assetDurations(project: Pick<CaptionProject, 'assets'>): Map<string, number> {
  const durations = new Map<string, number>()
  for (const asset of project.assets) {
    const durationUs = asset.metadata?.durationUs
    if (durationUs != null) durations.set(asset.id, durationUs)
  }
  return durations
}

/** Distinct video assets in the sequence, in order of first appearance on the timeline. */
export function sequenceAssetIds(project: Pick<CaptionProject, 'clips'>): string[] {
  return [...new Set(videoClips(project).sort((a, b) => a.timelineStartUs - b.timelineStartUs).map((clip) => clip.assetId))]
}

/**
 * The first video on the timeline, else the first video asset (a migrated project whose media
 * duration was never probed has the asset but no clip yet). `null` for a project with no video.
 * Used where one video has to stand for the project: its title, and seeding `format`.
 */
export function primaryVideoAsset(project: Pick<CaptionProject, 'assets' | 'clips'>): ProjectAsset | null {
  const firstId = sequenceAssetIds(project)[0]
  const byClip = firstId ? project.assets.find((asset) => asset.id === firstId && asset.kind === 'video') : undefined
  return byClip ?? project.assets.find((asset) => asset.kind === 'video') ?? null
}

/** True once any clip plays less than its whole file — i.e. there is something to restore. */
export function hasTrimmedClips(project: Pick<CaptionProject, 'assets' | 'clips'>): boolean {
  const durations = assetDurations(project)
  return videoClips(project).some((clip) => clip.sourceStartUs > 0 || (durations.has(clip.assetId) && clip.sourceEndUs < durations.get(clip.assetId)!))
}

/**
 * Stamps every unbound caption with `assetId`, the video its source time belongs to. Used by
 * commands and by the App's direct commits, because a project with video requires every caption to
 * be bound. Returns the same object when nothing needed stamping, so history sees no change.
 */
export function bindUnboundItems(project: CaptionProject, assetId: string | null | undefined): CaptionProject {
  if (!assetId || !project.clips.some((clip) => clip.kind === 'video')) return project
  if (project.cues.every((cue) => cue.mediaAssetId !== undefined)) return project
  return { ...project, cues: project.cues.map((cue) => cue.mediaAssetId === undefined ? { ...cue, mediaAssetId: assetId } : cue) }
}

/** Everything that would be orphaned by removing an asset: the clips that play it and the captions bound to it. */
export function assetUsers(project: Pick<CaptionProject, 'clips' | 'cues'>, assetId: string): string[] {
  return [
    ...project.clips.filter((clip) => clip.assetId === assetId).map((clip) => clip.id),
    ...project.cues.filter((cue) => cue.mediaAssetId === assetId).map((cue) => cue.id),
  ]
}

/**
 * The video a freshly created, unbound caption should be stamped with: the caller's explicit choice
 * (the video under the playhead), else the sequence's only video. `null` when it is ambiguous — the
 * schema then reports the unbound caption instead of a command guessing wrong.
 */
export function defaultBindingAssetId(project: Pick<CaptionProject, 'clips'>, explicit?: string | null): string | null {
  if (explicit) return explicit
  const ids = sequenceAssetIds(project)
  return ids.length === 1 ? ids[0] : null
}

export const videoTracks = (project: Pick<CaptionProject, 'tracks'>): Track[] => project.tracks.filter((track) => track.kind === 'video')
export const audioTracks = (project: Pick<CaptionProject, 'tracks'>): Track[] => project.tracks.filter((track) => track.kind === 'audio')

/** Clip counts per asset, for the media bin's "used N times" badges. */
export function clipCountByAsset(clips: readonly Clip[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const clip of clips) counts.set(clip.assetId, (counts.get(clip.assetId) ?? 0) + 1)
  return counts
}

/** Total sequence time that clips of one asset play. */
export function playedUsOfAsset(clips: readonly Clip[], assetId: string): number {
  return clips.filter((clip) => clip.assetId === assetId).reduce((total, clip) => total + clipLengthUs(clip), 0)
}

