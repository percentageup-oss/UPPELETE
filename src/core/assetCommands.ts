import type { Clip, ProjectAsset, Track } from './edit'
import { assetIdOf } from './edit'
import type { CaptionProject } from './model'
import type { CommandContext } from './captionCommands'
import { formatFromMedia } from './format'
import { assetUsers, primaryVideoAsset } from './projectClips'
import { clipEndUs, normalizeClips, sourceUsAt } from './timelineModel'
import { failItem, replaceById, type ItemFailure, type ItemStep } from './itemStep'

export type AssetCommand =
  | { type: 'asset-add'; asset: ProjectAsset }
  // Refused while any clip plays the asset or any caption is bound to it (`asset-in-use`).
  | { type: 'asset-remove'; assetId: string }
  // Relinking: rewrites the stored media fields. A new duration refits the asset's clips.
  | { type: 'asset-update'; assetId: string; changes: Partial<Omit<ProjectAsset, 'id' | 'kind'>> }

/**
 * Keeps clips valid when an asset's duration changes (a relink to a different file). A clip that
 * covered the whole old file follows the new length — up to the next clip on its track, so a relink
 * can never create an overlap — and any other clip is clamped into the new length. A clip left with
 * nothing inside it is dropped.
 */
export function refitClipsToDuration(tracks: readonly Track[], clips: readonly Clip[], assetId: string, oldDurationUs: number | null, newDurationUs: number): Clip[] {
  const refit = clips.flatMap((clip): Clip[] => {
    if (assetIdOf(clip) !== assetId || clip.kind === 'image' || clip.kind === 'color') return [clip]
    const wasWhole = clip.sourceStartUs === 0 && oldDurationUs !== null && clip.sourceEndUs === oldDurationUs
    let sourceEndUs = wasWhole ? newDurationUs : Math.min(clip.sourceEndUs, newDurationUs)
    if (sourceEndUs > clip.sourceEndUs) {
      const nextStartUs = Math.min(Infinity, ...clips.filter((other) => other.trackId === clip.trackId && other.timelineStartUs >= clipEndUs(clip)).map((other) => other.timelineStartUs))
      sourceEndUs = Math.min(sourceEndUs, sourceUsAt(clip, nextStartUs))
    }
    return sourceEndUs > clip.sourceStartUs ? [{ ...clip, sourceEndUs }] : []
  })
  return normalizeClips(tracks, refit)
}

/** Importing the same file twice reuses the existing asset (matched by its sampled fingerprint)
 * rather than growing the asset list, so a second placement of one file is one undo step, not two. */
export function resolveInlineAsset(project: CaptionProject, asset: ProjectAsset | undefined): { assets: ProjectAsset[]; assetId: string | null } | ItemFailure {
  if (!asset) return { assets: project.assets, assetId: null }
  const fingerprintValue = asset.fingerprint?.value
  const existing = fingerprintValue ? project.assets.find((candidate) => candidate.fingerprint?.value === fingerprintValue && candidate.kind === asset.kind) : undefined
  if (existing) return { assets: project.assets, assetId: existing.id }
  if (project.assets.some((candidate) => candidate.id === asset.id)) return failItem('asset-missing', [asset.id], 'Asset IDs must be unique.')
  return { assets: [...project.assets, asset], assetId: asset.id }
}

export function applyAssetCommand(project: CaptionProject, command: AssetCommand, context: CommandContext): ItemStep | ItemFailure {
  if (command.type === 'asset-add') {
    if (project.assets.some((asset) => asset.id === command.asset.id)) return failItem('asset-missing', [command.asset.id], 'Asset IDs must be unique.')
    return { project: { ...project, assets: [...project.assets, command.asset] } }
  }
  if (command.type === 'asset-remove') {
    if (!project.assets.some((asset) => asset.id === command.assetId)) return failItem('asset-missing', [command.assetId], 'That asset is no longer in the project.')
    const users = assetUsers(project, command.assetId)
    if (users.length) return failItem('asset-in-use', users, `Remove the ${users.length} clip${users.length === 1 ? '' : 's'} and caption${users.length === 1 ? '' : 's'} using this file before removing it.`)
    return { project: { ...project, assets: project.assets.filter((asset) => asset.id !== command.assetId) } }
  }
  const assets = replaceById(project.assets, command.assetId, (asset) => ({ ...asset, ...command.changes }))
  if (!assets) return failItem('asset-missing', [command.assetId], 'That asset no longer exists.')
  let next: CaptionProject = { ...project, assets }
  const before = project.assets.find((asset) => asset.id === command.assetId)!
  const after = assets.find((asset) => asset.id === command.assetId)!
  const beforeUs = before.metadata?.durationUs ?? null
  const afterUs = after.metadata?.durationUs ?? context.assetDurationUs?.(after.id) ?? null
  if (after.kind !== 'image' && afterUs !== null && afterUs !== beforeUs) {
    const hasVideo = project.clips.some((clip) => clip.kind === 'video')
    if (after.kind === 'video' && !hasVideo && primaryVideoAsset(project)?.id === after.id) {
      // A video whose duration was never probed (a migrated old project) could not get its
      // whole-video clip when it was migrated; the first relink that reports a duration supplies it.
      const track = project.tracks.find((candidate) => candidate.kind === 'video')
      const tracks = track ? project.tracks : [{ id: `${after.id}-track`, kind: 'video' as const, name: '', muted: false, hidden: false, locked: false }, ...project.tracks]
      const clip: Clip = { kind: 'video', id: `${after.id}-clip`, trackId: (track ?? tracks[0]).id, assetId: after.id, timelineStartUs: 0, sourceStartUs: 0, sourceEndUs: afterUs, opacity: 1, fit: 'contain', gain: 1 }
      next = { ...next, tracks, clips: normalizeClips(tracks, [...project.clips, clip]) }
    } else {
      // A relink to a file of a different length must not strand a clip past its end.
      next = { ...next, clips: refitClipsToDuration(project.tracks, project.clips, after.id, beforeUs, afterUs) }
    }
  }
  // The output frame follows the first video until the user sets one; a relink that finally
  // reports dimensions supplies it.
  if (after.kind === 'video' && !next.format && primaryVideoAsset(next)?.id === after.id) {
    const format = formatFromMedia(after.metadata)
    if (format) next = { ...next, format }
  }
  return { project: next }
}
