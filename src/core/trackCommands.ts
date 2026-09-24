import type { Track } from './edit'
import type { CaptionProject } from './model'
import { normalizeClips, trackLabel } from './timelineModel'
import { failItem, replaceById, type ItemFailure, type ItemStep } from './itemStep'

export type TrackFlags = Partial<Pick<Track, 'name' | 'muted' | 'hidden' | 'locked' | 'heightPx' | 'solo' | 'volume'>>

export type TrackCommand =
  // Appended after the last track of its kind (on top, for video) unless `index` says otherwise.
  | { type: 'track-add'; track: Track; index?: number }
  // Refused while the track holds clips, as `asset-remove` refuses an asset in use.
  | { type: 'track-remove'; trackId: string }
  | { type: 'track-update'; trackId: string; changes: TrackFlags }
  // Same semantics as the old `overlay-reorder`, among tracks of the same kind: the array is
  // back-to-front, so "forward" moves a video track up (painted later, on top).
  | { type: 'track-reorder'; trackId: string; direction: 'forward' | 'backward' | 'front' | 'back' }

/** Where a new track of `kind` goes by default: straight after the last track of its kind. */
export function defaultTrackIndex(tracks: readonly Track[], kind: Track['kind']): number {
  const last = tracks.map((track) => track.kind).lastIndexOf(kind)
  return last < 0 ? (kind === 'video' ? 0 : tracks.length) : last + 1
}

export function applyTrackCommand(project: CaptionProject, command: TrackCommand): ItemStep | ItemFailure {
  if (command.type === 'track-add') {
    if (project.tracks.some((track) => track.id === command.track.id)) return failItem('asset-missing', [command.track.id], 'Track IDs must be unique.')
    const index = Math.min(Math.max(command.index ?? defaultTrackIndex(project.tracks, command.track.kind), 0), project.tracks.length)
    const tracks = [...project.tracks.slice(0, index), command.track, ...project.tracks.slice(index)]
    return { project: { ...project, tracks, clips: normalizeClips(tracks, project.clips) } }
  }
  const track = project.tracks.find((candidate) => candidate.id === command.trackId)
  if (!track) return failItem('asset-missing', [command.trackId], 'That track no longer exists.')
  if (command.type === 'track-remove') {
    const clips = project.clips.filter((clip) => clip.trackId === track.id)
    if (clips.length) {
      return failItem('asset-in-use', clips.map((clip) => clip.id), `Move or delete the ${clips.length} clip${clips.length === 1 ? '' : 's'} on ${trackLabel(track, project.tracks)} before removing it.`)
    }
    return { project: { ...project, tracks: project.tracks.filter((candidate) => candidate.id !== track.id) } }
  }
  if (command.type === 'track-update') {
    const changes = { ...command.changes, ...(command.changes.name !== undefined ? { name: command.changes.name.trim().slice(0, 120) } : {}) }
    const tracks = replaceById(project.tracks, track.id, (candidate) => ({ ...candidate, ...changes }))!
    return { project: { ...project, tracks } }
  }
  // Reorder among tracks of the same kind only; tracks of the other kind keep their slots.
  const sameKind = project.tracks.filter((candidate) => candidate.kind === track.kind)
  const at = sameKind.indexOf(track)
  const target = command.direction === 'front' ? sameKind.length - 1 : command.direction === 'back' ? 0
    : command.direction === 'forward' ? Math.min(sameKind.length - 1, at + 1) : Math.max(0, at - 1)
  if (target === at) return { project }
  const reordered = [...sameKind]
  reordered.splice(at, 1)
  reordered.splice(target, 0, track)
  let cursor = 0
  const tracks = project.tracks.map((candidate) => candidate.kind === track.kind ? reordered[cursor++] : candidate)
  return { project: { ...project, tracks, clips: normalizeClips(tracks, project.clips) } }
}
