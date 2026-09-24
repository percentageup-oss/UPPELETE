import type { Clip, ClipKind, Track } from './edit'
import { assetIdOf } from './edit'
import { clipEndUs, clipLengthUs, normalizeClips, sequenceUsOf, sourceUsAt, type TimeRange } from './timelineModel'

/**
 * The NLE verbs of schema 5 (docs/EDITING.md "Timeline"), pure over `(tracks, clips)`. Every verb
 * returns a new, normalized (sorted) clip list or throws a `ClipEditError` whose message is shown to
 * the user. Ripple is per track: it never moves clips on another track (cross-track ripple is
 * deferred).
 *
 * - **overwrite** (the default): an edit never moves other clips; whatever it lands on is carved away.
 * - **ripple**: the edit's change in length pushes or pulls everything after it on the same track.
 */
export type EditMode = 'overwrite' | 'ripple'
export type ClipEdge = 'start' | 'end'

/** The shortest clip any edit may leave behind. */
export const MIN_CLIP_US = 1_000

export class ClipEditError extends Error {}

const fail = (message: string): never => { throw new ClipEditError(message) }

/** Image clips have a synthetic source range; keep it anchored at 0 so it never limits trimming. */
function rebased(clip: Clip): Clip {
  if (clip.kind !== 'image' || clip.sourceStartUs === 0) return clip
  return { ...clip, sourceStartUs: 0, sourceEndUs: clipLengthUs(clip) }
}

export function trackFor(tracks: readonly Track[], trackId: string): Track {
  return tracks.find((track) => track.id === trackId) ?? fail('That track no longer exists.')
}

function clipFor(clips: readonly Clip[], clipId: string): Clip {
  return clips.find((clip) => clip.id === clipId) ?? fail('That clip no longer exists.')
}

function assertEditable(track: Track): void {
  if (track.locked) fail(`${track.name || 'This track'} is locked. Unlock it to edit its clips.`)
}

/** Whether a clip of `kind` may sit on `track`: audio on audio tracks, video and images on video tracks. */
export function acceptsKind(track: Track, kind: ClipKind): boolean {
  return (track.kind === 'audio') === (kind === 'audio')
}

export function clipsOnTrack(clips: readonly Clip[], trackId: string): Clip[] {
  return clips.filter((clip) => clip.trackId === trackId).sort((a, b) => a.timelineStartUs - b.timelineStartUs)
}

/** The clip on `trackId` under `sequenceUs` (half-open), or `null` in a gap. */
export function clipAt(clips: readonly Clip[], trackId: string, sequenceUs: number): Clip | null {
  return clips.find((clip) => clip.trackId === trackId && sequenceUs >= clip.timelineStartUs && sequenceUs < clipEndUs(clip)) ?? null
}

export function overlapsOnTrack(clips: readonly Clip[], trackId: string, range: TimeRange, exceptIds: readonly string[] = []): Clip[] {
  return clips.filter((clip) => clip.trackId === trackId && !exceptIds.includes(clip.id)
    && clip.timelineStartUs < range.endUs && range.startUs < clipEndUs(clip))
}

/**
 * Clears `[range)` on one track: clips inside it disappear, clips straddling an edge are trimmed,
 * and a clip spanning the whole range is split in two (the right piece takes `newId()`).
 */
export function carveRange(clips: readonly Clip[], trackId: string, range: TimeRange, newId: () => string): Clip[] {
  return clips.flatMap((clip): Clip[] => {
    const endUs = clipEndUs(clip)
    if (clip.trackId !== trackId || endUs <= range.startUs || clip.timelineStartUs >= range.endUs) return [clip]
    const pieces: Clip[] = []
    if (clip.timelineStartUs < range.startUs) pieces.push({ ...clip, sourceEndUs: sourceUsAt(clip, range.startUs) })
    if (endUs > range.endUs) {
      pieces.push(rebased({ ...clip, id: pieces.length ? newId() : clip.id, timelineStartUs: range.endUs, sourceStartUs: sourceUsAt(clip, range.endUs) }))
    }
    return pieces
  })
}

/** Shifts every clip on `trackId` that starts at or after `fromUs` by `deltaUs`. */
export function rippleTrack(clips: readonly Clip[], trackId: string, fromUs: number, deltaUs: number): Clip[] {
  if (!deltaUs) return [...clips]
  return clips.map((clip) => clip.trackId === trackId && clip.timelineStartUs >= fromUs ? { ...clip, timelineStartUs: clip.timelineStartUs + deltaUs } : clip)
}

/** A ripple insert never splits a clip: a point inside one moves to that clip's nearer edge. */
export function rippleInsertionPoint(clips: readonly Clip[], trackId: string, atUs: number): number {
  const under = clipAt(clips, trackId, atUs)
  if (!under || atUs === under.timelineStartUs) return Math.max(0, Math.round(atUs))
  const endUs = clipEndUs(under)
  return atUs - under.timelineStartUs < endUs - atUs ? under.timelineStartUs : endUs
}

/** Puts a new clip on its track. Overwrite carves whatever it lands on; ripple pushes later clips right. */
export function placeClip(tracks: readonly Track[], clips: readonly Clip[], clip: Clip, mode: EditMode, newId: () => string): Clip[] {
  const track = trackFor(tracks, clip.trackId)
  assertEditable(track)
  if (!acceptsKind(track, clip.kind)) fail(track.kind === 'audio' ? 'Only audio can go on an audio track.' : 'Audio cannot go on a video track.')
  if (clips.some((existing) => existing.id === clip.id)) fail('Clip IDs must be unique.')
  const length = clipLengthUs(clip)
  if (length < MIN_CLIP_US) fail('A clip must be at least a millisecond long.')
  if (mode === 'ripple') {
    const at = rippleInsertionPoint(clips, track.id, clip.timelineStartUs)
    return normalizeClips(tracks, [...rippleTrack(clips, track.id, at, length), rebased({ ...clip, timelineStartUs: at })])
  }
  const startUs = Math.max(0, Math.round(clip.timelineStartUs))
  const placed = rebased({ ...clip, timelineStartUs: startUs })
  return normalizeClips(tracks, [...carveRange(clips, track.id, clipRange(placed), newId), placed])
}

const clipRange = (clip: Clip): TimeRange => ({ startUs: clip.timelineStartUs, endUs: clipEndUs(clip) })

/** A clip's settings: everything but its identity, placement, source range and link group. */
function settingsKey(clip: Clip): string {
  const { id: _id, timelineStartUs: _start, sourceStartUs: _in, sourceEndUs: _out, ...rest } = clip as Clip & { linkId?: string }
  delete (rest as { linkId?: string }).linkId
  const sorted = (value: unknown): unknown => Array.isArray(value) ? value.map(sorted)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, inner]) => [key, sorted(inner)]))
      : value
  return JSON.stringify(sorted(rest))
}

/**
 * Whether `other` is more of `clip`: the same file on the same track at the same source↔sequence
 * mapping with identical settings — typically the piece an overwrite carved off when another clip
 * landed inside it. Trimming `clip` over it changes nothing seen or heard, so trims pass through it
 * (healing the cut) instead of stopping at it. Images and generated clips have no source to continue.
 */
export function continuesClip(clip: Clip, other: Clip): boolean {
  if (other.id === clip.id || other.trackId !== clip.trackId || other.kind !== clip.kind || clip.kind === 'image' || clip.kind === 'color' || clip.kind === 'adjustment') return false
  if (assetIdOf(other) !== assetIdOf(clip) || Math.abs(sequenceUsOf(clip, other.sourceStartUs) - other.timelineStartUs) > 1) return false
  return settingsKey(clip) === settingsKey(other)
}

/** Lift (overwrite: leaves a gap) or ripple delete (later clips on the track close up). */
export function deleteClip(tracks: readonly Track[], clips: readonly Clip[], clipId: string, mode: EditMode): Clip[] {
  const clip = clipFor(clips, clipId)
  assertEditable(trackFor(tracks, clip.trackId))
  const remaining = clips.filter((candidate) => candidate.id !== clipId)
  return normalizeClips(tracks, mode === 'ripple' ? rippleTrack(remaining, clip.trackId, clipEndUs(clip), -clipLengthUs(clip)) : remaining)
}

/**
 * Moves a clip to `toStartUs` on `toTrackId` — within its track or across tracks of the same kind.
 * `toStartUs` is where the user dropped it in the layout they were looking at. Overwrite lifts the
 * clip and carves its landing range; ripple closes the hole it leaves and pushes the destination
 * track open to make room (on its own track this is a reorder).
 */
export function moveClip(tracks: readonly Track[], clips: readonly Clip[], clipId: string, toTrackId: string, toStartUs: number, mode: EditMode, newId: () => string): Clip[] {
  const clip = clipFor(clips, clipId)
  const from = trackFor(tracks, clip.trackId)
  const to = trackFor(tracks, toTrackId)
  assertEditable(from)
  assertEditable(to)
  if (!acceptsKind(to, clip.kind)) fail(to.kind === 'audio' ? 'Video and images cannot move to an audio track.' : 'Audio cannot move to a video track.')
  let target = Math.max(0, Math.round(toStartUs))
  if (target === clip.timelineStartUs && to.id === from.id) return normalizeClips(tracks, clips)
  const without = clips.filter((candidate) => candidate.id !== clipId)
  if (mode === 'ripple') {
    const length = clipLengthUs(clip)
    const closed = rippleTrack(without, from.id, clipEndUs(clip), -length)
    if (to.id === from.id) target = target >= clipEndUs(clip) ? target - length : target > clip.timelineStartUs ? clip.timelineStartUs : target
    return placeClip(tracks, closed, { ...clip, trackId: to.id, timelineStartUs: target }, 'ripple', newId)
  }
  return placeClip(tracks, without, { ...clip, trackId: to.id, timelineStartUs: target }, 'overwrite', newId)
}

/**
 * Drags one edge by `deltaUs`. Trimming clamps to the source (`sourceStartUs >= 0`, `sourceEndUs`
 * within the asset's known duration — images have no source bound), to `MIN_CLIP_US` and, in
 * overwrite mode, to the neighbouring clip's edge. An overwrite trim passes over neighbours that
 * merely continue the clip (`continuesClip`), carving them away, so a clip cut by something dropped
 * inside it can be dragged back to its full length once that is gone. A ripple trim keeps the clip's start fixed and
 * moves everything after it by the change in length. `deltaUs` is in **timeline** time; a clip with a
 * speed curve maps it to the source edge through `sourceUsAt`, so the edge lands where the user sees it.
 */
export function trimClip(tracks: readonly Track[], clips: readonly Clip[], clipId: string, edge: ClipEdge, deltaUs: number,
  mode: EditMode, assetDurationUs: number | null): Clip[] {
  const clip = clipFor(clips, clipId)
  assertEditable(trackFor(tracks, clip.trackId))
  const bounded = clip.kind !== 'image'
  const length = clipLengthUs(clip)
  const endUs = clipEndUs(clip)
  const siblings = clipsOnTrack(clips, clip.trackId).filter((candidate) => candidate.id !== clip.id)
  const blocking = siblings.filter((candidate) => !continuesClip(clip, candidate))
  const previousEndUs = Math.max(0, ...blocking.filter((candidate) => clipEndUs(candidate) <= clip.timelineStartUs).map(clipEndUs))
  const nextStartUs = Math.min(Infinity, ...blocking.filter((candidate) => candidate.timelineStartUs >= endUs).map((candidate) => candidate.timelineStartUs))
  // What an overwrite trim newly covers can only hold continuations (blockers bound it): carve them.
  const overwritten = (next: Clip, covered: TimeRange) => normalizeClips(tracks, [
    ...carveRange(clips.filter((candidate) => candidate.id !== clipId), clip.trackId, covered, () => fail('A trim cannot split a clip.')), rebased(next),
  ])
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
  let delta = Math.round(deltaUs)
  let next: Clip
  if (edge === 'start') {
    const shortest = length - MIN_CLIP_US
    if (mode === 'ripple') {
      delta = clamp(delta, bounded ? sequenceUsOf(clip, 0) - clip.timelineStartUs : -Infinity, shortest)
      next = { ...clip, sourceStartUs: sourceUsAt(clip, clip.timelineStartUs + delta) }
      const rest = clips.filter((candidate) => candidate.id !== clipId)
      return normalizeClips(tracks, [...rippleTrack(rest, clip.trackId, endUs, clipLengthUs(next) - length), rebased(next)])
    }
    delta = clamp(delta, Math.max(previousEndUs - clip.timelineStartUs, bounded ? sequenceUsOf(clip, 0) - clip.timelineStartUs : -Infinity, -clip.timelineStartUs), shortest)
    next = { ...clip, timelineStartUs: clip.timelineStartUs + delta, sourceStartUs: sourceUsAt(clip, clip.timelineStartUs + delta) }
    if (delta < 0) return overwritten(next, { startUs: next.timelineStartUs, endUs: clip.timelineStartUs })
  } else {
    const sourceRoom = bounded && assetDurationUs !== null ? sequenceUsOf(clip, assetDurationUs) - endUs : Infinity
    const neighbourRoom = mode === 'ripple' ? Infinity : nextStartUs - endUs
    delta = clamp(delta, MIN_CLIP_US - length, Math.min(sourceRoom, neighbourRoom))
    next = { ...clip, sourceEndUs: sourceUsAt(clip, endUs + delta) }
    if (mode === 'ripple') {
      const rest = clips.filter((candidate) => candidate.id !== clipId)
      return normalizeClips(tracks, [...rippleTrack(rest, clip.trackId, endUs, clipLengthUs(next) - length), rebased(next)])
    }
    if (delta > 0) return overwritten(next, { startUs: endUs, endUs: clipEndUs(next) })
  }
  return normalizeClips(tracks, clips.map((candidate) => candidate.id === clipId ? rebased(next) : candidate))
}

/** Splits one clip at a sequence time strictly inside it; the left piece keeps the id. Anywhere else is a no-op. */
export function splitClip(tracks: readonly Track[], clips: readonly Clip[], clipId: string, atUs: number, newClipId: string): Clip[] {
  const clip = clipFor(clips, clipId)
  const at = Math.round(atUs)
  if (at <= clip.timelineStartUs || at >= clipEndUs(clip)) return normalizeClips(tracks, clips)
  assertEditable(trackFor(tracks, clip.trackId))
  const sourceAt = sourceUsAt(clip, at)
  const left: Clip = { ...clip, sourceEndUs: sourceAt }
  const right = rebased({ ...clip, id: newClipId, timelineStartUs: at, sourceStartUs: sourceAt })
  return normalizeClips(tracks, [...clips.filter((candidate) => candidate.id !== clipId), left, right])
}

/**
 * Split at the playhead: every clip under `atUs` on an unlocked track — or only `onlyClipIds` when
 * given (the selection). Returns the new list and the ids that were actually split.
 */
export function splitAllAt(tracks: readonly Track[], clips: readonly Clip[], atUs: number, newId: () => string, onlyClipIds?: readonly string[]): { clips: Clip[]; split: string[]; /** Each split clip's id with the id its right-hand piece took. */ created: { leftId: string; rightId: string }[] } {
  const locked = new Set(tracks.filter((track) => track.locked).map((track) => track.id))
  const targets = clips.filter((clip) => (onlyClipIds ? onlyClipIds.includes(clip.id) : !locked.has(clip.trackId))
    && atUs > clip.timelineStartUs && atUs < clipEndUs(clip))
  let next = [...clips]
  const created: { leftId: string; rightId: string }[] = []
  for (const clip of targets) {
    const rightId = newId()
    next = splitClip(tracks, next, clip.id, atUs, rightId)
    created.push({ leftId: clip.id, rightId })
  }
  return { clips: normalizeClips(tracks, next), split: targets.map((clip) => clip.id), created }
}

/** Gaps on one track: empty time before the first clip and between clips (not after the last). */
export function gapsOnTrack(clips: readonly Clip[], trackId: string): TimeRange[] {
  const gaps: TimeRange[] = []
  let cursor = 0
  for (const clip of clipsOnTrack(clips, trackId)) {
    if (clip.timelineStartUs > cursor) gaps.push({ startUs: cursor, endUs: clip.timelineStartUs })
    cursor = Math.max(cursor, clipEndUs(clip))
  }
  return gaps
}

/** Closes the gap containing `atUs` on one track by pulling everything after it left. */
export function closeGap(tracks: readonly Track[], clips: readonly Clip[], trackId: string, atUs: number): Clip[] {
  assertEditable(trackFor(tracks, trackId))
  const gap = gapsOnTrack(clips, trackId).find((range) => atUs >= range.startUs && atUs < range.endUs)
  if (!gap) fail('There is no gap there to close.')
  return normalizeClips(tracks, rippleTrack(clips, trackId, gap!.endUs, gap!.startUs - gap!.endUs))
}

/** Sequence-time snap targets: every clip edge on every track (minus the ones being dragged) plus `extra`. */
export function snapTargets(clips: readonly Clip[], exceptIds: readonly string[], extra: readonly number[] = []): number[] {
  const values = new Set<number>(extra.filter((value) => Number.isFinite(value) && value >= 0))
  for (const clip of clips) {
    if (exceptIds.includes(clip.id)) continue
    values.add(clip.timelineStartUs)
    values.add(clipEndUs(clip))
  }
  return [...values].sort((a, b) => a - b)
}

/**
 * A track of `kind` that can take `range` without overlapping anything: `preferTrackId` when it
 * fits, else the lowest fitting unlocked track — for images, only tracks above every track holding
 * video, so a dropped title lands over the picture rather than under it. `null` means a new track
 * is needed.
 */
export function freeTrackFor(tracks: readonly Track[], clips: readonly Clip[], kind: ClipKind, range: TimeRange, preferTrackId?: string | null): string | null {
  const fits = (track: Track) => !track.locked && acceptsKind(track, kind) && !overlapsOnTrack(clips, track.id, range).length
  const preferred = preferTrackId ? tracks.find((track) => track.id === preferTrackId) : undefined
  if (preferred && fits(preferred)) return preferred.id
  let floor = 0
  if (kind === 'image') {
    const withVideo = new Set(clips.filter((clip) => clip.kind === 'video').map((clip) => clip.trackId))
    tracks.forEach((track, index) => { if (withVideo.has(track.id)) floor = index + 1 })
  }
  return tracks.find((track, index) => index >= floor && fits(track))?.id ?? null
}

/**
 * Where a background (a generated `color` clip) goes: `preferTrackId` when it fits, else the lowest
 * free unlocked video track that sits **below** every track holding a picture, since a background
 * that lands over the video would hide it. `null` means a new track is needed at the bottom of the
 * stack (`clip-add`'s `trackIndex: 0`).
 */
export function backgroundTrackFor(tracks: readonly Track[], clips: readonly Clip[], range: TimeRange, preferTrackId?: string | null): string | null {
  const fits = (track: Track) => !track.locked && track.kind === 'video' && !overlapsOnTrack(clips, track.id, range).length
  const preferred = preferTrackId ? tracks.find((track) => track.id === preferTrackId) : undefined
  if (preferred && fits(preferred)) return preferred.id
  const holdsPicture = new Set(clips.filter((clip) => clip.kind === 'video' || clip.kind === 'image').map((clip) => clip.trackId))
  const ceiling = tracks.findIndex((track) => holdsPicture.has(track.id))
  return tracks.find((track, index) => (ceiling < 0 || index < ceiling) && fits(track))?.id ?? null
}

/**
 * Where a new adjustment layer goes when it must grade a specific target clip (dropping a Color tile
 * onto that clip, docs/EDITING.md "Color: adjustment layers"): the lowest free unlocked video track
 * **above** `targetTrackIndex` in track order that fits `range`, or `null` for a new track directly
 * above it (`clip-add`'s `trackIndex: targetTrackIndex + 1`).
 */
export function adjustmentTrackAbove(tracks: readonly Track[], clips: readonly Clip[], targetTrackIndex: number, range: TimeRange): string | null {
  const fits = (track: Track) => !track.locked && track.kind === 'video' && !overlapsOnTrack(clips, track.id, range).length
  return tracks.find((track, index) => index > targetTrackIndex && fits(track))?.id ?? null
}

/**
 * Where a new adjustment layer goes with no specific clip to span (a click on the Color panel, or a
 * drop over empty timeline space with no track under the pointer): the highest-index free unlocked
 * video track that fits `range`, or `null` for a new track at the top of the video stack
 * (`clip-add`'s default `trackIndex`, so it grades every picture clip below it).
 */
export function topAdjustmentTrackFor(tracks: readonly Track[], clips: readonly Clip[], range: TimeRange): string | null {
  const fits = (track: Track) => !track.locked && track.kind === 'video' && !overlapsOnTrack(clips, track.id, range).length
  for (let index = tracks.length - 1; index >= 0; index--) if (fits(tracks[index])) return tracks[index].id
  return null
}

/** The end of the last clip on one track — where an appended clip goes. */
export function trackEndUs(clips: readonly Clip[], trackId: string): number {
  return Math.max(0, ...clips.filter((clip) => clip.trackId === trackId).map(clipEndUs))
}

/**
 * Silence removal: every clip of `assetId` is replaced by the pieces of it inside the `kept` source
 * ranges, laid end to end from the clip's own start, and everything after it **on the same track**
 * closes up by what was removed (a per-track ripple; other tracks never move). The first piece keeps
 * the clip's id, later pieces take `newId()`; a clip with nothing kept disappears.
 */
export function keepRangesOfAsset(tracks: readonly Track[], clips: readonly Clip[], assetId: string, kept: readonly TimeRange[], newId: () => string): Clip[] {
  const ranges = kept.filter((range) => range.endUs > range.startUs).sort((a, b) => a.startUs - b.startUs)
  const result: Clip[] = []
  for (const track of tracks) {
    let shift = 0
    for (const clip of clipsOnTrack(clips, track.id)) {
      const startUs = clip.timelineStartUs + shift
      if (assetIdOf(clip) !== assetId || clip.kind === 'image' || clip.kind === 'color') { result.push({ ...clip, timelineStartUs: startUs }); continue }
      let cursor = startUs
      for (const range of ranges) {
        const sourceStartUs = Math.max(range.startUs, clip.sourceStartUs)
        const sourceEndUs = Math.min(range.endUs, clip.sourceEndUs)
        if (sourceEndUs <= sourceStartUs) continue
        const piece: Clip = { ...clip, id: cursor === startUs ? clip.id : newId(), timelineStartUs: cursor, sourceStartUs, sourceEndUs }
        result.push(piece)
        cursor += clipLengthUs(piece)
      }
      shift -= clipLengthUs(clip) - (cursor - startUs)
    }
  }
  return normalizeClips(tracks, result)
}

/**
 * "Restore removed ranges": on each track, every run of touching clips of one video collapses back
 * to one clip over the whole file (keeping the run's first id), and everything after it on the
 * track moves right by the restored length. Clips of a file whose duration is unknown stay as they
 * are. Undoes silence removal and cuts without disturbing the order of different videos.
 */
export function restoreFullClips(tracks: readonly Track[], clips: readonly Clip[], durationsUs: ReadonlyMap<string, number>): Clip[] {
  const result: Clip[] = []
  for (const track of tracks) {
    let shift = 0
    // `originalEndUs` is where the run ends in the layout before restoring, so touching is judged
    // against the clips as they were, not as already shifted.
    let run = null as { clip: Clip; originalEndUs: number } | null
    const flush = () => {
      if (run) result.push(run.clip)
      run = null
    }
    for (const clip of clipsOnTrack(clips, track.id)) {
      const durationUs = clip.kind === 'video' || (clip.kind === 'audio' && clip.linkId) ? durationsUs.get(clip.assetId) : undefined
      if (run && durationUs !== undefined && assetIdOf(run.clip) === assetIdOf(clip) && run.originalEndUs === clip.timelineStartUs) {
        // Absorbed into the run: the restored whole file already covers it.
        run.originalEndUs = clipEndUs(clip)
        shift -= clipLengthUs(clip)
        continue
      }
      flush()
      const startUs = clip.timelineStartUs + shift
      if (durationUs === undefined) { result.push({ ...clip, timelineStartUs: startUs }); continue }
      const whole: Clip = { ...clip, timelineStartUs: startUs, sourceStartUs: 0, sourceEndUs: durationUs }
      shift += clipLengthUs(whole) - clipLengthUs(clip)
      run = { clip: whole, originalEndUs: clipEndUs(clip) }
    }
    flush()
  }
  return normalizeClips(tracks, result)
}
