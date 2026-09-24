import { translateMask } from './layerMask'
import type { BackgroundMotion, BlurRegion, Clip, ClipFit, ClipSpeed, CompositionRect, Fill, Grade, Marker, ProjectAsset, SequenceFormat, Track } from './edit'
import type { AudioClip } from './edit'
import { assetIdOf, clipSpeedSchema } from './edit'
import type { CaptionProject } from './model'
import type { CommandContext } from './captionCommands'
import {
  ClipEditError, closeGap, deleteClip, freeTrackFor, keepRangesOfAsset, moveClip, overlapsOnTrack, placeClip, restoreFullClips, rippleTrack, splitAllAt, trimClip, trackFor,
  type ClipEdge, type EditMode,
} from './clipEdits'
import { formatFromMedia } from './format'
import { audioTrackForVideo, expandLinked, hasAudioStream, linkIdOf, linkPartners, mirrorAudioClip, trimPartners } from './clipLinks'
import { assetDurations } from './projectClips'
import { clipEndUs, clipLengthUs, normalizeClips, trackLabel, type TimeRange } from './timelineModel'
import { resolveInlineAsset } from './assetCommands'
import { defaultTrackIndex } from './trackCommands'
import { failItem, replaceById, serialIds, type ItemFailure, type ItemStep } from './itemStep'

/** Inspector edits. `rect: null` returns a picture-in-picture clip to filling the frame. */
/** `fill`/`motion` apply to a generated background only; `motion: null` stops its animation.
 * `grade` applies to an adjustment layer only. */
export type ClipChanges = { rect?: CompositionRect | null; opacity?: number; fit?: ClipFit; gain?: number; fill?: Fill; motion?: BackgroundMotion | null; grade?: Grade; /** Video and audio only; `null` returns to normal speed. A change in length ripples the clip's track. */ speed?: ClipSpeed | null; /** `false` disables the clip (kept on the timeline, skipped by preview and export). */ enabled?: boolean }

export type ClipCommand =
  // Places a clip, importing its asset (`asset`, omitted when reusing one) and creating a track for
  // it (`track`, when nothing free could take it) in the same undoable step. The first video on the
  // timeline seeds `project.format` and binds every caption created before it.
  | { type: 'clip-add'; clip: Clip; asset?: ProjectAsset; track?: Track; /** Where a new `track` goes in the back-to-front stack (0 = bottom); default puts it on top of its kind. */ trackIndex?: number; mode?: EditMode; idPrefix?: string }
  | { type: 'clip-move'; clipId: string; trackId: string; startUs: number; mode: EditMode; idPrefix: string; track?: Track; /** Move only this clip, not its link partners. */ unlinked?: boolean }
  | { type: 'clip-trim'; clipId: string; edge: ClipEdge; deltaUs: number; mode: EditMode; unlinked?: boolean }
  | { type: 'clip-update'; clipId: string; changes: ClipChanges; unlinked?: boolean }
  // Trim one edge of every clip under `atUs` (unlocked tracks), or only `clipIds`, to that time: one undo step.
  | { type: 'clip-trim-to'; atUs: number; edge: ClipEdge; clipIds?: string[]; mode: EditMode; unlinked?: boolean }
  // Split at the playhead: every clip under it on an unlocked track, or only `clipIds`.
  | { type: 'clip-split'; atUs: number; clipIds?: string[]; idPrefix: string; unlinked?: boolean }
  // `overwrite` lifts (leaves a gap); `ripple` closes it up on the clip's own track.
  | { type: 'clip-delete'; clipId: string; mode: EditMode; unlinked?: boolean }
  // Links clips into one group (at most one video) under `linkId`; unlinking strips the group.
  | { type: 'clips-link'; clipIds: string[]; linkId: string }
  | { type: 'clips-unlink'; clipIds: string[] }
  // Splits a legacy video's embedded sound into a linked audio clip on `trackId` (created from `track` when given).
  | { type: 'clip-detach-audio'; clipId: string; audioClipId: string; linkId: string; trackId: string; track?: Track }
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

function withTrack(project: CaptionProject, track: Track | undefined, at?: number): Track[] | ItemFailure {
  if (!track) return project.tracks
  if (project.tracks.some((candidate) => candidate.id === track.id)) return failItem('asset-missing', [track.id], 'Track IDs must be unique.')
  const index = at === undefined ? defaultTrackIndex(project.tracks, track.kind) : Math.min(Math.max(at, 0), project.tracks.length)
  return [...project.tracks.slice(0, index), track, ...project.tracks.slice(index)]
}

/**
 * Where a link partner of a clip that changed lane should follow: the lane of the partner's kind with
 * the same ordinal as the clip's new lane (V2 ↔ A2). `'create'` when that lane does not exist yet,
 * `null` to leave the partner where it is (same-kind partner, no lane change, or the lane is locked).
 */
function pairedLane(tracks: readonly Track[], target: Clip, toTrackId: string, partner: Clip): string | 'create' | null {
  if (target.trackId === toTrackId || target.kind === partner.kind) return null
  const ordinal = tracks.filter((track) => track.kind === target.kind).findIndex((track) => track.id === toTrackId)
  if (ordinal < 0) return null
  const paired = tracks.filter((track) => track.kind === partner.kind)[ordinal]
  if (!paired) return 'create'
  return paired.locked ? null : paired.id
}

/** Runs a pure clip verb, turning its `ClipEditError` into a command failure the app shows as-is. */
function edit<T>(ids: string[], run: () => T): T | ItemFailure {
  try { return run() }
  catch (error) {
    if (error instanceof ClipEditError) return failItem('clip-order', ids, error.message)
    throw error
  }
}

const isFailure = (value: unknown): value is ItemFailure => typeof value === 'object' && value !== null && !Array.isArray(value) && 'ok' in value && (value as { ok: unknown }).ok === false

export function applyClipCommand(project: CaptionProject, command: ClipCommand, context: CommandContext): ItemStep | ItemFailure {
  const durations = assetDurations(project)
  const durationOf = (assetId: string): number | null => context.assetDurationUs?.(assetId) ?? durations.get(assetId) ?? null

  if (command.type === 'clip-add') {
    if (command.clip.kind === 'color' || command.clip.kind === 'adjustment') {
      // Generated: no asset to resolve or bound; it only needs a video track.
      const tracks = withTrack(project, command.track, command.trackIndex)
      if (isFailure(tracks)) return tracks
      const generated = command.clip
      const clips = edit([generated.id], () => placeClip(tracks, project.clips, generated, command.mode ?? 'overwrite', serialIds(command.idPrefix ?? generated.id)))
      if (isFailure(clips)) return clips
      return { project: { ...project, tracks, clips }, selection: { kind: 'clip', id: generated.id } }
    }
    const resolved = resolveInlineAsset(project, command.asset)
    if ('ok' in resolved) return resolved
    const { assets, assetId } = resolved
    const clip = { ...command.clip, assetId: assetId ?? command.clip.assetId } as Clip
    const asset = assets.find((candidate) => candidate.id === assetIdOf(clip))
    if (!asset || (asset.kind !== clip.kind && !(clip.kind === 'audio' && asset.kind === 'video'))) return failItem('asset-kind', [clip.id], `A ${clip.kind} clip must reference a ${clip.kind} file.`)
    if (clip.kind !== 'image' && (asset.metadata?.durationUs ?? context.assetDurationUs?.(asset.id) ?? null) === null) {
      return failItem('media-bounds', [clip.id], `${asset.name}’s duration could not be read, so it cannot be placed on the timeline.`)
    }
    let tracks = withTrack(project, command.track)
    if (isFailure(tracks)) return tracks
    const mode = command.mode ?? 'overwrite'
    // A video with sound is placed together with a linked audio clip on its own audio lane (schema 15).
    // A clip that already names a link its group holds a video for is a clone: it gets a fresh pair.
    const audioIds = serialIds(`${command.idPrefix ?? clip.id}-audio`)
    const linked = clip.kind === 'video' && clip.detachedAudio !== false && hasAudioStream(asset)
      && (!clip.linkId || project.clips.some((other) => other.kind === 'video' && other.linkId === clip.linkId))
    const audioClipId = audioIds()
    const linkId = audioIds()
    const placedVideo = linked && clip.kind === 'video' ? { ...clip, detachedAudio: true, linkId } : clip
    let clips = edit([clip.id], () => placeClip(tracks as Track[], project.clips, placedVideo, mode, serialIds(command.idPrefix ?? clip.id)))
    if (isFailure(clips)) return clips
    if (linked) {
      const video = clips.find((candidate) => candidate.id === clip.id)
      if (video?.kind === 'video') {
        const range = { startUs: video.timelineStartUs, endUs: clipEndUs(video) }
        const audioTracks = (tracks as Track[]).filter((track) => track.kind === 'audio')
        const ordinal = (tracks as Track[]).filter((track) => track.kind === 'video').findIndex((track) => track.id === video.trackId)
        const pairedForRipple = mode === 'ripple' && ordinal >= 0 && audioTracks[ordinal] && !audioTracks[ordinal].locked ? audioTracks[ordinal] : null
        let audioTrack = pairedForRipple ?? audioTrackForVideo(tracks as Track[], clips, video.trackId, range)
        if (!audioTrack) {
          audioTrack = { id: audioIds(), kind: 'audio', name: '', muted: false, hidden: false, locked: false }
          const at = defaultTrackIndex(tracks as Track[], 'audio')
          tracks = [...(tracks as Track[]).slice(0, at), audioTrack, ...(tracks as Track[]).slice(at)]
        }
        const audio = mirrorAudioClip(video, { clipId: audioClipId, trackId: audioTrack.id, linkId })
        const withAudio = edit([audio.id], () => placeClip(tracks as Track[], clips as Clip[], audio, mode === 'ripple' ? 'ripple' : 'overwrite', serialIds(`${command.idPrefix ?? clip.id}-cut`)))
        if (isFailure(withAudio)) return withAudio
        clips = withAudio
      }
    }
    let next: CaptionProject = { ...project, assets, tracks: tracks as Track[], clips: splitLinks(clips, command.idPrefix ?? clip.id) }
    if (clip.kind === 'video' && !project.format) {
      const format = formatFromMedia(asset.metadata)
      if (format) next = { ...next, format }
    }
    return { project: next, selection: { kind: 'clip', id: clip.id } }
  }

  if (command.type === 'clip-move') {
    const tracks = withTrack(project, command.track)
    if (isFailure(tracks)) return tracks
    const target = project.clips.find((clip) => clip.id === command.clipId)
    const partners = target && !command.unlinked ? linkPartners(project.clips, target) : []
    // One shared delta, clamped so no member is pushed before 0; the grabbed clip alone changes track.
    let delta = target ? command.startUs - target.timelineStartUs : 0
    if (target && partners.length) delta = Math.max(delta, -Math.min(target.timelineStartUs, ...partners.map((partner) => partner.timelineStartUs)))
    const startUs = target ? target.timelineStartUs + delta : command.startUs
    const newId = serialIds(command.idPrefix)
    // Layering (the grabbed clip changed track): a partner that would land on top of another clip on
    // its own track goes to a free track of its kind, or a new one, instead of carving that clip.
    const layering = !!target && target.trackId !== command.trackId && command.mode === 'overwrite'
    let allTracks = tracks
    const clips = edit([command.clipId], () => {
      let next = moveClip(tracks, project.clips, command.clipId, command.trackId, startUs, command.mode, newId)
      for (const partner of partners) {
        const partnerStartUs = partner.timelineStartUs + delta
        let toTrackId = partner.trackId
        // Changing lane moves a video's audio to the same-ordinal lane (V2 → A2), and back: the
        // partner follows to its paired lane, which is created when it does not exist yet.
        const lane = pairedLane(allTracks, target!, command.trackId, partner)
        if (lane === 'create') {
          const created: Track = { id: newId(), kind: partner.kind === 'audio' ? 'audio' : 'video', name: '', muted: false, hidden: false, locked: false }
          allTracks = withTrack({ ...project, tracks: allTracks }, created) as Track[]
          toTrackId = created.id
        } else if (lane) toTrackId = lane
        else if (layering) {
          const others = next.filter((candidate) => candidate.id !== partner.id)
          const range = { startUs: partnerStartUs, endUs: partnerStartUs + clipLengthUs(partner) }
          if (overlapsOnTrack(others, partner.trackId, range).length) {
            const free = freeTrackFor(allTracks, others, partner.kind, range, null)
            if (free) toTrackId = free
            else {
              const created: Track = { id: newId(), kind: partner.kind === 'audio' ? 'audio' : 'video', name: '', muted: false, hidden: false, locked: false }
              allTracks = withTrack({ ...project, tracks: allTracks }, created) as Track[]
              toTrackId = created.id
            }
          }
        }
        next = moveClip(allTracks, next, partner.id, toTrackId, partnerStartUs, command.mode, newId)
      }
      return next
    })
    if (isFailure(clips)) return clips
    return { project: { ...project, tracks: allTracks, clips: splitLinks(clips, command.idPrefix) }, selection: { kind: 'clip', id: command.clipId } }
  }

  if (command.type === 'clip-trim') {
    const target = project.clips.find((clip) => clip.id === command.clipId)
    if (!target) return failItem('clip-order', [command.clipId], 'That clip no longer exists.')
    const members = [target, ...(command.unlinked ? [] : trimPartners(project.clips, target, command.edge, command.mode))]
    const boundOf = (clip: Clip) => clip.kind === 'color' || clip.kind === 'image' || clip.kind === 'adjustment' ? null : durationOf(clip.assetId)
    const clips = edit(members.map((clip) => clip.id), () => {
      let deltaUs = command.deltaUs
      if (members.length > 1) {
        // Each member trims as far as it can; all then take the smallest common amount so a linked
        // pair never drifts apart at a clamp (source end, a neighbour, the 1 ms minimum).
        const achieved = members.map((member) => {
          const trimmed = trimClip(project.tracks, project.clips, member.id, command.edge, command.deltaUs, command.mode, boundOf(member)).find((clip) => clip.id === member.id)!
          const lengthChange = clipLengthUs(trimmed) - clipLengthUs(member)
          return command.edge === 'start' ? -lengthChange : lengthChange
        })
        deltaUs = command.deltaUs >= 0 ? Math.min(...achieved) : Math.max(...achieved)
      }
      return members.reduce((current, member) => trimClip(project.tracks, current, member.id, command.edge, deltaUs, command.mode, boundOf(member)), project.clips)
    })
    if (isFailure(clips)) return clips
    // A trim that healed a cut can absorb one member of another pair.
    return { project: { ...project, clips: dropLoneLinks(clips) }, selection: { kind: 'clip', id: command.clipId } }
  }

  if (command.type === 'clip-trim-to') {
    const atUs = Math.round(command.atUs)
    const locked = new Set(project.tracks.filter((track) => track.locked).map((track) => track.id))
    const named = command.clipIds ? expandLinked(project.clips, command.clipIds, command.unlinked) : null
    const targets = project.clips.filter((clip) => (named ? named.includes(clip.id) : !locked.has(clip.trackId))
      && atUs > clip.timelineStartUs && atUs < clipEndUs(clip))
    if (!targets.length) return { project }
    const clips = edit(targets.map((clip) => clip.id), () => targets.reduce((current, target) => {
      const clip = current.find((candidate) => candidate.id === target.id)!
      const deltaUs = command.edge === 'start' ? atUs - clip.timelineStartUs : atUs - clipEndUs(clip)
      return trimClip(project.tracks, current, clip.id, command.edge, deltaUs, command.mode, clip.kind === 'color' || clip.kind === 'image' || clip.kind === 'adjustment' ? null : durationOf(clip.assetId))
    }, project.clips))
    if (isFailure(clips)) return clips
    return { project: { ...project, clips } }
  }

  if (command.type === 'clip-update') {
    const target = project.clips.find((clip) => clip.id === command.clipId)
    if (!target) return failItem('clip-order', [command.clipId], 'That clip no longer exists.')
    const first = updateClip(project, project.clips, target, command.changes)
    if (isFailure(first)) return first
    let clips = first
    // Speed and enabled are shared by a link group (a video and its audio must stay in step); the
    // rest (volume, picture) belong to the one clip.
    if (!command.unlinked) {
      const { speed, enabled } = command.changes
      for (const partner of linkPartners(project.clips, target)) {
        const shared: ClipChanges = {
          ...(enabled !== undefined ? { enabled } : {}),
          ...(speed !== undefined && assetIdOf(partner) === assetIdOf(target) ? { speed } : {}),
        }
        if (!Object.keys(shared).length) continue
        const current = clips.find((clip) => clip.id === partner.id)!
        const result = updateClip(project, clips, current, shared)
        if (isFailure(result)) return result
        clips = result
      }
    }
    return { project: { ...project, clips }, selection: { kind: 'clip', id: target.id } }
  }

  if (command.type === 'clip-split') {
    const ids = command.clipIds ? expandLinked(project.clips, command.clipIds, command.unlinked) : undefined
    const at = Math.round(command.atUs)
    const result = edit(command.clipIds ?? [], () => splitAllAt(project.tracks, project.clips, at, serialIds(command.idPrefix), ids))
    if (isFailure(result)) return result
    if (result.clips.length === project.clips.length) return { project }
    // Members of one group split together: the right-hand halves form a new group. A half whose
    // partner was not split (Alt-selected, or not under the playhead) stays out of any group.
    const newLink = serialIds(`${command.idPrefix}-link`)
    const rightsByLink = new Map<string, string[]>()
    for (const { leftId, rightId } of result.created) {
      const linkId = linkIdOf(project.clips.find((clip) => clip.id === leftId)!)
      if (linkId) rightsByLink.set(linkId, [...(rightsByLink.get(linkId) ?? []), rightId])
    }
    const relinked = new Map<string, string | null>()
    for (const rights of rightsByLink.values()) {
      const linkId = rights.length > 1 ? newLink() : null
      for (const rightId of rights) relinked.set(rightId, linkId)
    }
    const clips = result.clips.map((clip) => {
      if (!relinked.has(clip.id) || (clip.kind !== 'video' && clip.kind !== 'audio')) return clip
      const { linkId: _old, ...rest } = clip
      const linkId = relinked.get(clip.id)
      return (linkId ? { ...rest, linkId } : rest) as Clip
    })
    return { project: { ...project, clips } }
  }

  if (command.type === 'clip-delete') {
    const doomed = expandLinked(project.clips, [command.clipId], command.unlinked)
    const clips = edit(doomed, () => doomed.reduce((current, id) => deleteClip(project.tracks, current, id, command.mode), project.clips))
    if (isFailure(clips)) return clips
    return { project: { ...project, clips }, selection: null }
  }

  if (command.type === 'clips-link') {
    const members = project.clips.filter((clip) => command.clipIds.includes(clip.id))
    if (members.length < 2 || members.some((clip) => clip.kind !== 'video' && clip.kind !== 'audio')) return failItem('clip-order', command.clipIds, 'Only video and audio clips can be linked, two or more at a time.')
    if (members.filter((clip) => clip.kind === 'video').length > 1) return failItem('clip-order', command.clipIds, 'A link group holds at most one video clip.')
    const clips = project.clips.map((clip) => members.includes(clip) ? { ...clip, linkId: command.linkId } as Clip : clip)
    return { project: { ...project, clips: dropLoneLinks(clips) } }
  }

  if (command.type === 'clips-unlink') {
    const clips = project.clips.map((clip) => {
      if (!command.clipIds.includes(clip.id) || (clip.kind !== 'video' && clip.kind !== 'audio') || !clip.linkId) return clip
      const { linkId: _linkId, ...rest } = clip
      return rest as Clip
    })
    return { project: { ...project, clips: dropLoneLinks(clips) } }
  }

  if (command.type === 'clip-detach-audio') {
    const video = project.clips.find((clip) => clip.id === command.clipId)
    if (video?.kind !== 'video') return failItem('asset-kind', [command.clipId], 'Only a video clip has sound to detach.')
    if (video.detachedAudio || video.linkId) return failItem('clip-order', [video.id], 'This video’s audio is already separate.')
    if (!hasAudioStream(project.assets.find((asset) => asset.id === video.assetId))) return failItem('asset-kind', [video.id], 'This video has no audio track.')
    const tracks = withTrack(project, command.track)
    if (isFailure(tracks)) return tracks
    const audio = mirrorAudioClip(video, { clipId: command.audioClipId, trackId: command.trackId, linkId: command.linkId })
    const clips = edit([video.id], () => placeClip(tracks, project.clips.map((clip) => clip.id === video.id ? { ...video, detachedAudio: true, linkId: command.linkId } : clip), audio, 'overwrite', serialIds(`${command.audioClipId}-cut`)))
    if (isFailure(clips)) return clips
    return { project: { ...project, tracks, clips }, selection: { kind: 'clip', id: video.id } }
  }

  if (command.type === 'gap-close') {
    const clips = edit([], () => closeGap(project.tracks, project.clips, command.trackId, command.atUs))
    if (isFailure(clips)) return clips
    return { project: { ...project, clips } }
  }

  if (command.type === 'clips-set') {
    const locked = new Set(project.tracks.filter((track) => track.locked).map((track) => track.id))
    if (command.keptByAsset.some((entry) => project.clips.some((clip) => assetIdOf(clip) === entry.assetId && locked.has(clip.trackId)))) {
      return failItem('clip-order', [], 'A clip of this video is on a locked track. Unlock it before removing silence.')
    }
    let clips = project.clips
    command.keptByAsset.forEach((entry, entryIndex) => {
      clips = keepRangesOfAsset(project.tracks, clips, entry.assetId, entry.ranges, serialIds(`${command.idPrefix}-${entryIndex + 1}`))
    })
    if (!clips.some((clip) => clip.kind === 'video') && project.clips.some((clip) => clip.kind === 'video')) {
      return failItem('clip-empty', [], 'Remove-silence found nothing to keep; the source media has zero duration.')
    }
    clips = relinkPieces(clips, serialIds(`${command.idPrefix}-link`))
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

/** One clip's inspector edit over `current`; a `speed` change ripples the clip's own track. */
function updateClip(project: CaptionProject, current: readonly Clip[], target: Clip, changes: ClipChanges): Clip[] | ItemFailure {
  const { rect, opacity, fit, gain, fill, motion, grade, speed, enabled } = changes
  if (speed !== undefined && speed !== null && !clipSpeedSchema.safeParse(speed).success) return failItem('gain-range', [target.id], 'Speed needs 1–32 points in increasing source order, each between 0.1× and 10×.')
  if (speed !== undefined && target.kind !== 'video' && target.kind !== 'audio') return failItem('asset-kind', [target.id], 'Only video and audio clips have a speed.')
  if (target.kind !== 'color' && (fill !== undefined || motion !== undefined)) return failItem('asset-kind', [target.id], 'Only a background has a fill or motion.')
  if (target.kind !== 'adjustment' && grade !== undefined) return failItem('asset-kind', [target.id], 'Only an adjustment layer has a grade.')
  if (target.kind === 'color' && gain !== undefined) return failItem('asset-kind', [target.id], 'Backgrounds have no sound.')
  if (target.kind === 'audio' && (rect !== undefined || opacity !== undefined || fit !== undefined)) return failItem('asset-kind', [target.id], 'Audio clips have no picture to position.')
  if (target.kind === 'image' && gain !== undefined) return failItem('asset-kind', [target.id], 'Image clips have no sound.')
  if (target.kind === 'adjustment' && (rect !== undefined || opacity !== undefined || fit !== undefined || gain !== undefined)) {
    return failItem('asset-kind', [target.id], 'An adjustment layer has no picture or sound of its own.')
  }
  const clips = replaceById(current, target.id, (clip) => {
    const next: Record<string, unknown> = { ...clip }
    // A layer mask is linked to its picture: a pure move of the clip carries the mask along; a
    // resize leaves it where it is in the frame (docs/EDITING.md "Layer masks").
    const from = clip.kind === 'audio' || clip.kind === 'adjustment' ? undefined : clip.rect
    if (rect === null) delete next.rect
    else if (rect !== undefined) {
      next.rect = rect
      if (from && from.width === rect.width && from.height === rect.height && clip.kind !== 'audio' && clip.kind !== 'adjustment' && clip.mask) next.mask = translateMask(clip.mask, rect.x - from.x, rect.y - from.y)
    }
    if (opacity !== undefined) next.opacity = opacity
    if (fit !== undefined) next.fit = fit
    if (gain !== undefined) next.gain = gain
    if (fill !== undefined) next.fill = fill
    if (motion === null) delete next.motion
    else if (motion !== undefined) next.motion = motion
    if (grade !== undefined) next.grade = grade
    if (speed === null) delete next.speed
    else if (speed !== undefined) next.speed = speed
    if (enabled === true) delete next.enabled
    else if (enabled === false) next.enabled = false
    return next as Clip
  })!
  if (speed === undefined) return clips
  // A speed change alters the clip's timeline length: later clips on its track move by the difference
  // (ripple), so it can never grow into a neighbour. A locked track refuses, like every other clip edit.
  const changed = clips.find((clip) => clip.id === target.id)!
  return edit([target.id], () => {
    if (trackFor(project.tracks, target.trackId).locked) throw new ClipEditError('This track is locked. Unlock it to edit its clips.')
    return normalizeClips(project.tracks, rippleTrack(clips, target.trackId, clipEndUs(target), clipLengthUs(changed) - clipLengthUs(target)))
  })
}

/** A link group left with a single member is no group: drop its id. */
function dropLoneLinks(clips: Clip[]): Clip[] {
  const counts = new Map<string, number>()
  for (const clip of clips) { const id = linkIdOf(clip); if (id) counts.set(id, (counts.get(id) ?? 0) + 1) }
  return clips.map((clip) => {
    const id = linkIdOf(clip)
    if (!id || counts.get(id)! > 1 || (clip.kind !== 'video' && clip.kind !== 'audio')) return clip
    const { linkId: _linkId, ...rest } = clip
    return rest as Clip
  })
}

/**
 * After a cut (silence removal) turns one linked pair into several pieces that all inherited its
 * `linkId`, gives every piece after the first its own group: each later video piece is regrouped with
 * the audio piece covering the same source range, so pairs stay pairs and a group keeps one video.
 */
/** After an overwrite carved a linked clip in two: each piece is its own pair, and a piece left alone is unlinked. */
function splitLinks(clips: Clip[], idPrefix: string): Clip[] {
  return dropLoneLinks(relinkPieces(clips, serialIds(`${idPrefix}-link`)))
}

function relinkPieces(clips: Clip[], newLink: () => string): Clip[] {
  const videosByLink = new Map<string, Clip[]>()
  for (const clip of clips) if (clip.kind === 'video' && clip.linkId) videosByLink.set(clip.linkId, [...(videosByLink.get(clip.linkId) ?? []), clip])
  const relinked = new Map<string, string>()
  for (const [linkId, videos] of videosByLink) {
    if (videos.length < 2) continue
    for (const video of [...videos].sort((a, b) => a.timelineStartUs - b.timelineStartUs).slice(1)) {
      const linkIdForPiece = newLink()
      relinked.set(video.id, linkIdForPiece)
      const audio = clips.find((clip) => clip.kind === 'audio' && clip.linkId === linkId && clip.assetId === (video as { assetId: string }).assetId
        && clip.sourceStartUs === video.sourceStartUs && clip.sourceEndUs === video.sourceEndUs && !relinked.has(clip.id))
      if (audio) relinked.set(audio.id, linkIdForPiece)
    }
  }
  return relinked.size ? clips.map((clip) => relinked.has(clip.id) ? { ...clip, linkId: relinked.get(clip.id) } as Clip : clip) : clips
}

function sameClips(a: readonly Clip[], b: readonly Clip[]): boolean {
  return a.length === b.length && a.every((clip, index) => JSON.stringify(clip) === JSON.stringify(b[index]))
}

