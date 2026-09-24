import type { CaptionTrack } from './edit'
import type { CaptionProject } from './model'
import { failItem, replaceById, type ItemFailure, type ItemStep } from './itemStep'

export type CaptionTrackFlags = Partial<Pick<CaptionTrack, 'name' | 'locked'>>

export type CaptionTrackCommand =
  // Appended after the last caption track unless `index` says otherwise.
  | { type: 'caption-track-add'; track: CaptionTrack; index?: number }
  // Refused while the track holds captions, as `track-remove` refuses a track holding clips.
  | { type: 'caption-track-remove'; trackId: string }
  | { type: 'caption-track-update'; trackId: string; changes: CaptionTrackFlags }
  | { type: 'caption-track-reorder'; trackId: string; direction: 'forward' | 'backward' | 'front' | 'back' }
  // Moves one caption onto a different caption track; refused for a locked source or destination.
  | { type: 'caption-track-move-cue'; cueId: string; trackId: string }

/** Where a new caption track goes by default: straight after the last one. */
export function defaultCaptionTrackIndex(tracks: readonly CaptionTrack[]): number {
  return tracks.length
}

export function applyCaptionTrackCommand(project: CaptionProject, command: CaptionTrackCommand): ItemStep | ItemFailure {
  if (command.type === 'caption-track-add') {
    if (project.captionTracks.some((track) => track.id === command.track.id)) return failItem('asset-missing', [command.track.id], 'Caption track IDs must be unique.')
    const index = Math.min(Math.max(command.index ?? defaultCaptionTrackIndex(project.captionTracks), 0), project.captionTracks.length)
    const captionTracks = [...project.captionTracks.slice(0, index), command.track, ...project.captionTracks.slice(index)]
    return { project: { ...project, captionTracks } }
  }
  if (command.type === 'caption-track-move-cue') {
    const cue = project.cues.find((candidate) => candidate.id === command.cueId)
    if (!cue) return failItem('asset-missing', [command.cueId], 'That caption no longer exists.')
    const destination = project.captionTracks.find((candidate) => candidate.id === command.trackId)
    if (!destination) return failItem('asset-missing', [command.trackId], 'That caption track no longer exists.')
    const source = project.captionTracks.find((candidate) => candidate.id === cue.captionTrackId)
    if (source?.locked) return failItem('asset-in-use', [cue.id], `${source.name || 'That caption track'} is locked.`)
    if (destination.locked) return failItem('asset-in-use', [cue.id], `${destination.name || 'That caption track'} is locked.`)
    const cues = replaceById(project.cues, cue.id, (candidate) => ({ ...candidate, captionTrackId: command.trackId }))!
    return { project: { ...project, cues } }
  }
  const track = project.captionTracks.find((candidate) => candidate.id === command.trackId)
  if (!track) return failItem('asset-missing', [command.trackId], 'That caption track no longer exists.')
  if (command.type === 'caption-track-remove') {
    const cues = project.cues.filter((cue) => cue.captionTrackId === track.id)
    if (cues.length) {
      return failItem('asset-in-use', cues.map((cue) => cue.id), `Move or delete the ${cues.length} caption${cues.length === 1 ? '' : 's'} on ${track.name || 'this caption track'} before removing it.`)
    }
    return { project: { ...project, captionTracks: project.captionTracks.filter((candidate) => candidate.id !== track.id) } }
  }
  if (command.type === 'caption-track-update') {
    const changes = { ...command.changes, ...(command.changes.name !== undefined ? { name: command.changes.name.trim().slice(0, 120) } : {}) }
    const captionTracks = replaceById(project.captionTracks, track.id, (candidate) => ({ ...candidate, ...changes }))!
    return { project: { ...project, captionTracks } }
  }
  // caption-track-reorder
  const at = project.captionTracks.indexOf(track)
  const target = command.direction === 'front' ? project.captionTracks.length - 1 : command.direction === 'back' ? 0
    : command.direction === 'forward' ? Math.min(project.captionTracks.length - 1, at + 1) : Math.max(0, at - 1)
  if (target === at) return { project }
  const reordered = [...project.captionTracks]
  reordered.splice(at, 1)
  reordered.splice(target, 0, track)
  return { project: { ...project, captionTracks: reordered } }
}
