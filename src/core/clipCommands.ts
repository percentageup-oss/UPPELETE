import type { BlurRegion, Clip, ClipFit, CompositionRect, Marker, ProjectAsset, SequenceFormat, Track } from './edit'
import type { CaptionProject } from './model'
import type { CommandContext } from './captionCommands'
import {
  ClipEditError, closeGap, deleteClip, keepRangesOfAsset, moveClip, placeClip, restoreFullClips, splitAllAt, trimClip,
  type ClipEdge, type EditMode,
} from './clipEdits'
import { formatFromMedia } from './format'
import { assetDurations } from './projectClips'
import type { TimeRange } from './timelineModel'
import { resolveInlineAsset } from './assetCommands'
import { defaultTrackIndex } from './trackCommands'
import { failItem, replaceById, serialIds, type ItemFailure, type ItemStep } from './itemStep'

/** Inspector edits. `rect: null` returns a picture-in-picture clip to filling the frame. */
export type ClipChanges = { rect?: CompositionRect | null; opacity?: number; fit?: ClipFit; gain?: number }

export type ClipCommand =
  // Places a clip, importing its asset (`asset`, omitted when reusing one) and creating a track for
  // it (`track`, when nothing free could take it) in the same undoable step. The first video on the
  // timeline seeds `project.format` and binds every caption created before it.
  | { type: 'clip-add'; clip: Clip; asset?: ProjectAsset; track?: Track; mode?: EditMode; idPrefix?: string }
  | { type: 'clip-move'; clipId: string; trackId: string; startUs: number; mode: EditMode; idPrefix: string; track?: Track }
  | { type: 'clip-trim'; clipId: string; edge: ClipEdge; deltaUs: number; mode: EditMode }
  | { type: 'clip-update'; clipId: string; changes: ClipChanges }
  // Split at the playhead: every clip under it on an unlocked track, or only `clipIds`.
  | { type: 'clip-split'; atUs: number; clipIds?: string[]; idPrefix: string }
  // `overwrite` lifts (leaves a gap); `ripple` closes it up on the clip's own track.
  | { type: 'clip-delete'; clipId: string; mode: EditMode }
  | { type: 'gap-close'; trackId: string; atUs: number }
  // Automatic silence removal: each listed video keeps only its kept source ranges, rippled per track.
  | { type: 'clips-set'; keptByAsset: { assetId: string; ranges: TimeRange[] }[]; idPrefix: string }
  // Collapses each run of touching clips of one video back to that whole video.
  | { type: 'clips-restore' }
  | { type: 'format-set'; format: SequenceFormat }
  | { type: 'blur-add'; region: BlurRegion }
  | { type: 'blur-update'; blurId: string; changes: Partial<Omit<BlurRegion, 'id'>> }
  | { type: 'blur-delete'; blurId: string }
  // A ruler note, not an edit: authored by the user or, over MCP, proposed by an agent shot list
  // (docs/MCP.md) for the user to accept or dismiss. No rect, no asset, no validation beyond timing.
  | { type: 'marker-add'; marker: Marker }
  | { type: 'marker-update'; markerId: string; changes: Partial<Omit<Marker, 'id'>> }
  | { type: 'marker-delete'; markerId: string }

function withTrack(project: CaptionProject, track: Track | undefined): Track[] | ItemFailure {
  if (!track) return project.tracks
  if (project.tracks.some((candidate) => candidate.id === track.id)) return failItem('asset-missing', [track.id], 'Track IDs must be unique.')
  const index = defaultTrackIndex(project.tracks, track.kind)
  return [...project.tracks.slice(0, index), track, ...project.tracks.slice(index)]
}

/** Runs a pure clip verb, turning its `ClipEditError` into a command failure the app shows as-is. */
function edit(ids: string[], run: () => Clip[]): Clip[] | ItemFailure {
  try { return run() }
  catch (error) {
    if (error instanceof ClipEditError) return failItem('clip-order', ids, error.message)
    throw error
  }
}

const isFailure = (value: unknown): value is ItemFailure => typeof value === 'object' && value !== null && !Array.isArray(value) && 'ok' in value

export function applyClipCommand(project: CaptionProject, command: ClipCommand, context: CommandContext): ItemStep | ItemFailure {
  const durations = assetDurations(project)
  const durationOf = (assetId: string): number | null => context.assetDurationUs?.(assetId) ?? durations.get(assetId) ?? null

  if (command.type === 'clip-add') {
    const resolved = resolveInlineAsset(project, command.asset)
    if ('ok' in resolved) return resolved
    const { assets, assetId } = resolved
    const clip = { ...command.clip, assetId: assetId ?? command.clip.assetId } as Clip
    const asset = assets.find((candidate) => candidate.id === clip.assetId)
    if (!asset || asset.kind !== clip.kind) return failItem('asset-kind', [clip.id], `A ${clip.kind} clip must reference a ${clip.kind} file.`)
    if (clip.kind !== 'image' && (asset.metadata?.durationUs ?? context.assetDurationUs?.(asset.id) ?? null) === null) {
      return failItem('media-bounds', [clip.id], `${asset.name}’s duration could not be read, so it cannot be placed on the timeline.`)
    }
    const tracks = withTrack(project, command.track)
    if (isFailure(tracks)) return tracks
    const clips = edit([clip.id], () => placeClip(tracks, project.clips, clip, command.mode ?? 'overwrite', serialIds(command.idPrefix ?? clip.id)))
    if (isFailure(clips)) return clips
    let next: CaptionProject = { ...project, assets, tracks, clips }
    if (clip.kind === 'video' && !project.format) {
      const format = formatFromMedia(asset.metadata)
      if (format) next = { ...next, format }
    }
    return { project: next, selection: { kind: 'clip', id: clip.id } }
  }

  if (command.type === 'clip-move') {
    const tracks = withTrack(project, command.track)
    if (isFailure(tracks)) return tracks
    const clips = edit([command.clipId], () => moveClip(tracks, project.clips, command.clipId, command.trackId, command.startUs, command.mode, serialIds(command.idPrefix)))
    if (isFailure(clips)) return clips
    return { project: { ...project, tracks, clips }, selection: { kind: 'clip', id: command.clipId } }
  }

  if (command.type === 'clip-trim') {
    const target = project.clips.find((clip) => clip.id === command.clipId)
    if (!target) return failItem('clip-order', [command.clipId], 'That clip no longer exists.')
    const clips = edit([command.clipId], () => trimClip(project.tracks, project.clips, command.clipId, command.edge, command.deltaUs, command.mode, durationOf(target.assetId)))
    if (isFailure(clips)) return clips
    return { project: { ...project, clips }, selection: { kind: 'clip', id: command.clipId } }
  }

  if (command.type === 'clip-update') {
    const target = project.clips.find((clip) => clip.id === command.clipId)
    if (!target) return failItem('clip-order', [command.clipId], 'That clip no longer exists.')
    const { rect, opacity, fit, gain } = command.changes
    if (target.kind === 'audio' && (rect !== undefined || opacity !== undefined || fit !== undefined)) return failItem('asset-kind', [target.id], 'Audio clips have no picture to position.')
    if (target.kind === 'image' && gain !== undefined) return failItem('asset-kind', [target.id], 'Image clips have no sound.')
    const clips = replaceById(project.clips, target.id, (clip) => {
      const next: Record<string, unknown> = { ...clip }
      if (rect === null) delete next.rect
      else if (rect !== undefined) next.rect = rect
      if (opacity !== undefined) next.opacity = opacity
      if (fit !== undefined) next.fit = fit
      if (gain !== undefined) next.gain = gain
      return next as Clip
    })!
    return { project: { ...project, clips }, selection: { kind: 'clip', id: target.id } }
  }

  if (command.type === 'clip-split') {
    const result = edit(command.clipIds ?? [], () => splitAllAt(project.tracks, project.clips, Math.round(command.atUs), serialIds(command.idPrefix), command.clipIds).clips)
    if (isFailure(result)) return result
    if (result.length === project.clips.length) return { project }
    return { project: { ...project, clips: result } }
  }

  if (command.type === 'clip-delete') {
    const clips = edit([command.clipId], () => deleteClip(project.tracks, project.clips, command.clipId, command.mode))
    if (isFailure(clips)) return clips
    return { project: { ...project, clips }, selection: null }
  }

  if (command.type === 'gap-close') {
    const clips = edit([], () => closeGap(project.tracks, project.clips, command.trackId, command.atUs))
    if (isFailure(clips)) return clips
    return { project: { ...project, clips } }
  }

  if (command.type === 'clips-set') {
    const locked = new Set(project.tracks.filter((track) => track.locked).map((track) => track.id))
    if (command.keptByAsset.some((entry) => project.clips.some((clip) => clip.assetId === entry.assetId && locked.has(clip.trackId)))) {
      return failItem('clip-order', [], 'A clip of this video is on a locked track. Unlock it before removing silence.')
    }
    let clips = project.clips
    command.keptByAsset.forEach((entry, entryIndex) => {
      clips = keepRangesOfAsset(project.tracks, clips, entry.assetId, entry.ranges, serialIds(`${command.idPrefix}-${entryIndex + 1}`))
    })
    if (!clips.some((clip) => clip.kind === 'video') && project.clips.some((clip) => clip.kind === 'video')) {
      return failItem('clip-empty', [], 'Remove-silence found nothing to keep; the source media has zero duration.')
    }
    return { project: sameClips(project.clips, clips) ? project : { ...project, clips }, selection: null }
  }

  if (command.type === 'clips-restore') {
    const clips = restoreFullClips(project.tracks, project.clips, durations)
    return { project: sameClips(project.clips, clips) ? project : { ...project, clips }, selection: null }
  }

  if (command.type === 'format-set') return { project: { ...project, format: command.format } }

  if (command.type === 'blur-add') {
    const blurRegions = [...project.blurRegions, command.region].sort((a, b) => a.startUs - b.startUs || a.id.localeCompare(b.id))
    return { project: { ...project, blurRegions }, selection: { kind: 'blur', id: command.region.id } }
  }
  if (command.type === 'blur-update') {
    const blurRegions = replaceById(project.blurRegions, command.blurId, (region) => ({ ...region, ...command.changes }))
    if (!blurRegions) return failItem('asset-missing', [command.blurId], 'That blur region no longer exists.')
    return { project: { ...project, blurRegions }, selection: { kind: 'blur', id: command.blurId } }
  }
  if (command.type === 'blur-delete') {
    const blurRegions = project.blurRegions.filter((region) => region.id !== command.blurId)
    if (blurRegions.length === project.blurRegions.length) return failItem('asset-missing', [command.blurId], 'That blur region no longer exists.')
    return { project: { ...project, blurRegions }, selection: null }
  }

  if (command.type === 'marker-add') {
    const markers = [...project.markers, command.marker].sort((a, b) => a.atUs - b.atUs || a.id.localeCompare(b.id))
    return { project: { ...project, markers }, selection: { kind: 'marker', id: command.marker.id } }
  }
  if (command.type === 'marker-update') {
    const markers = replaceById(project.markers, command.markerId, (marker) => ({ ...marker, ...command.changes }))
    if (!markers) return failItem('asset-missing', [command.markerId], 'That marker no longer exists.')
    return { project: { ...project, markers: markers.sort((a, b) => a.atUs - b.atUs || a.id.localeCompare(b.id)) }, selection: { kind: 'marker', id: command.markerId } }
  }
  const markers = project.markers.filter((marker) => marker.id !== command.markerId)
  if (markers.length === project.markers.length) return failItem('asset-missing', [command.markerId], 'That marker no longer exists.')
  return { project: { ...project, markers }, selection: null }
}

function sameClips(a: readonly Clip[], b: readonly Clip[]): boolean {
  return a.length === b.length && a.every((clip, index) => JSON.stringify(clip) === JSON.stringify(b[index]))
}

