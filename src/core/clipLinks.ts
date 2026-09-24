import type { AudioClip, Clip, ProjectAsset, Track, VideoClip } from './edit'
import { clipEndUs } from './timelineModel'

/**
 * Linked audio (docs/EDITING.md "Linked audio", schema 15). Clips sharing a `linkId` form a link
 * group — one video and its audio — that is cut, moved, trimmed, disabled and deleted together
 * unless a command says `unlinked`. Pure helpers only; the verbs live in `clipCommands.ts`.
 */
export const linkIdOf = (clip: Clip): string | undefined => clip.kind === 'video' || clip.kind === 'audio' ? clip.linkId : undefined

/** The other members of `clip`'s link group (empty when unlinked). */
export function linkPartners(clips: readonly Clip[], clip: Clip): Clip[] {
  const linkId = linkIdOf(clip)
  return linkId ? clips.filter((candidate) => candidate.id !== clip.id && linkIdOf(candidate) === linkId) : []
}

/**
 * The partners an overwrite trim of `clip`'s `edge` carries along: those whose same edge sits where
 * `clip`'s does. A partner cut apart from it (e.g. its audio carved by an overlap) stays put, so
 * dragging either side can bring the pair back into line instead of being held by the other.
 * Ripple trims carry every partner, so later clips on each lane stay in sync.
 */
export function trimPartners(clips: readonly Clip[], clip: Clip, edge: 'start' | 'end', mode: 'overwrite' | 'ripple'): Clip[] {
  const partners = linkPartners(clips, clip)
  if (mode === 'ripple') return partners
  const edgeOf = (candidate: Clip) => edge === 'start' ? candidate.timelineStartUs : clipEndUs(candidate)
  return partners.filter((partner) => Math.abs(edgeOf(partner) - edgeOf(clip)) <= 1)
}

/** `ids` plus every link partner of each — the clips a linked edit acts on — or just `ids` when `unlinked`. */
export function expandLinked(clips: readonly Clip[], ids: readonly string[], unlinked = false): string[] {
  const wanted = new Set(ids)
  if (!unlinked) for (const clip of clips) if (wanted.has(clip.id)) for (const partner of linkPartners(clips, clip)) wanted.add(partner.id)
  return clips.filter((clip) => wanted.has(clip.id)).map((clip) => clip.id)
}

export const hasAudioStream = (asset: ProjectAsset | undefined): boolean => Boolean(asset?.metadata?.streams.some((stream) => stream.kind === 'audio'))

/** Whether a video clip's own sound plays: not once its audio was detached to a separate clip. */
export const hasEmbeddedAudio = (clip: Clip): boolean => clip.kind === 'video' && !clip.detachedAudio

/** The audio clip that mirrors `video` — same timing, source range, speed and gain, on `trackId`. */
export function mirrorAudioClip(video: VideoClip, ids: { clipId: string; trackId: string; linkId: string }): AudioClip {
  return {
    kind: 'audio', id: ids.clipId, trackId: ids.trackId, assetId: video.assetId, linkId: ids.linkId, gain: video.gain,
    timelineStartUs: video.timelineStartUs, sourceStartUs: video.sourceStartUs, sourceEndUs: video.sourceEndUs,
    ...(video.speed ? { speed: video.speed } : {}),
  }
}

/**
 * The audio track a video on `videoTrackId` pairs with: the audio track with the same ordinal (V2 →
 * A2), or — when that one cannot take `range` free — the lowest free unlocked audio track. `null`
 * means a new audio track is needed.
 */
export function audioTrackForVideo(tracks: readonly Track[], clips: readonly Clip[], videoTrackId: string, range: { startUs: number; endUs: number }): Track | null {
  const audio = tracks.filter((track) => track.kind === 'audio')
  const ordinal = tracks.filter((track) => track.kind === 'video').findIndex((track) => track.id === videoTrackId)
  const free = (track: Track) => !track.locked && !clips.some((clip) => clip.trackId === track.id && clip.timelineStartUs < range.endUs && range.startUs < clipEndUs(clip))
  const paired = ordinal >= 0 ? audio[ordinal] : undefined
  if (paired && free(paired)) return paired
  return audio.find(free) ?? null
}

/** Whether a track is heard: not muted, and — when any audio track is soloed — soloed itself. */
export function trackAudible(track: Track | undefined, tracks: readonly Track[]): boolean {
  if (!track || track.muted) return false
  const anySolo = tracks.some((candidate) => candidate.kind === 'audio' && candidate.solo)
  return !anySolo || track.kind === 'audio' && Boolean(track.solo)
}

/** The gain a clip plays at: its own `gain` times its track fader, 0 when muted, unsoloed or disabled. */
export function effectiveGain(clip: Clip, tracks: readonly Track[]): number {
  if (clip.kind !== 'audio' && clip.kind !== 'video') return 0
  if (clip.enabled === false) return 0
  const track = tracks.find((candidate) => candidate.id === clip.trackId)
  if (!trackAudible(track, tracks)) return 0
  if (clip.kind === 'video' && clip.detachedAudio) return 0
  return clip.gain * (track?.volume ?? 1)
}
