import type { CaptionTrack, Clip, Track, VideoClip } from './edit'
import { assetIdOf } from './edit'
import type { Cue } from './model'
import { sourceToTimelineOffsetUs, timelineLengthUs, timelineToSourceOffsetUs } from './clipTime'
import type { Retime } from './clipTime'

/**
 * The pure time model of schema 5 (docs/EDITING.md "Schema 5"). **Position is position**: every
 * clip carries an absolute `timelineStartUs`, so what schema 4 derived by walking the clip list
 * with a running `elapsed` total is plain arithmetic on one clip here, and a gap is just time no
 * clip covers.
 *
 * Captions stay stored in the source time of the video they were transcribed from; a cue is visible
 * wherever a clip of that video plays the cue's source range. Overlays, blur and audio are authored
 * against the program, so they already live in sequence time. Everything is integer microseconds.
 */
export type TimeRange = { startUs: number; endUs: number }

const round = (us: number) => Math.round(us)

/** The clip's length on the timeline: its source span, retimed by its `speed` curve when it has one. */
export const clipLengthUs = (clip: Retime): number => timelineLengthUs(clip)
export const clipEndUs = (clip: Retime): number => clip.timelineStartUs + clipLengthUs(clip)
export const clipRange = (clip: Retime): TimeRange => ({ startUs: clip.timelineStartUs, endUs: clipEndUs(clip) })
/** The clip's length in its own source time, ignoring any speed (what a trim or an export `-t` measures). */
export const clipSourceSpanUs = (clip: Pick<Clip, 'sourceStartUs' | 'sourceEndUs'>): number => clip.sourceEndUs - clip.sourceStartUs

/** Where the last clip on any track ends; 0 for an empty sequence. */
export function sequenceDurationUs(clips: readonly Clip[]): number {
  let end = 0
  for (const clip of clips) end = Math.max(end, clipEndUs(clip))
  return end
}

/** The sequence time at which `clip` shows source time `sourceUs` (not clamped). */
export function sequenceUsOf(clip: Retime, sourceUs: number): number {
  return clip.timelineStartUs + sourceToTimelineOffsetUs(clip, sourceUs)
}

/** The source time `clip` shows at `sequenceUs` (not clamped). */
export function sourceUsAt(clip: Retime, sequenceUs: number): number {
  return timelineToSourceOffsetUs(clip, round(sequenceUs) - clip.timelineStartUs)
}

export function trackIndexMap(tracks: readonly Track[]): Map<string, number> {
  return new Map(tracks.map((track, index) => [track.id, index]))
}

/** Default display names: V1, V2… and A1, A2… in array order within each kind. */
export function trackLabel(track: Track, tracks: readonly Track[]): string {
  if (track.name) return track.name
  const sameKind = tracks.filter((candidate) => candidate.kind === track.kind)
  return `${track.kind === 'video' ? 'V' : 'A'}${sameKind.indexOf(track) + 1}`
}

/** `C1`/`C2`… — the same empty-name-derives-a-label convention `trackLabel` uses for video/audio. */
export function captionTrackLabel(track: CaptionTrack, tracks: readonly CaptionTrack[]): string {
  return track.name || `C${tracks.indexOf(track) + 1}`
}

/**
 * The canonical clip order: `(track index, timelineStartUs, id)`. With absolute positions array
 * order carries no information, so keeping it sorted makes saved diffs stable and lets the
 * no-overlap check run in one pass.
 */
export function compareClips(order: ReadonlyMap<string, number>) {
  return (a: Clip, b: Clip) => (order.get(a.trackId) ?? Infinity) - (order.get(b.trackId) ?? Infinity)
    || a.timelineStartUs - b.timelineStartUs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

/** Sorted copy with empty clips dropped — the form every command writes. */
export function normalizeClips(tracks: readonly Track[], clips: readonly Clip[]): Clip[] {
  return clips.filter((clip) => clip.sourceEndUs > clip.sourceStartUs).map((clip) => ({ ...clip })).sort(compareClips(trackIndexMap(tracks)))
}

/** The first pair of clips on one track whose timeline ranges intersect, or `null`. Any order. */
export function firstOverlap(tracks: readonly Track[], clips: readonly Clip[]): [Clip, Clip] | null {
  const sorted = [...clips].sort(compareClips(trackIndexMap(tracks)))
  for (let index = 1; index < sorted.length; index++) {
    const previous = sorted[index - 1]
    const clip = sorted[index]
    if (previous.trackId === clip.trackId && clip.timelineStartUs < clipEndUs(previous)) return [previous, clip]
  }
  return null
}

export type ActiveClip = { track: Track; clip: Clip; sourceUs: number }

/**
 * **The core primitive**: what each track plays at `sequenceUs`, one entry per track, back to front,
 * a track in a gap contributing nothing. Clips are half-open `[start, end)`, so at a boundary the
 * following clip is the one shown. Transport, compositing, caption selection and export all call it.
 */
export function activeClipsAt(sequenceUs: number, tracks: readonly Track[], clips: readonly Clip[], options: { skipHidden?: boolean } = {}): ActiveClip[] {
  const at = round(sequenceUs)
  const byTrack = new Map<string, Clip>()
  for (const clip of clips) {
    // A disabled clip (schema 15) is on the timeline but plays and paints nothing.
    if (clip.enabled === false) continue
    if (at >= clip.timelineStartUs && at < clipEndUs(clip) && !byTrack.has(clip.trackId)) byTrack.set(clip.trackId, clip)
  }
  const active: ActiveClip[] = []
  for (const track of tracks) {
    if (options.skipHidden && track.hidden) continue
    const clip = byTrack.get(track.id)
    if (clip) active.push({ track, clip, sourceUs: sourceUsAt(clip, at) })
  }
  return active
}

/** Every clip playing source time `sourceUs` of an asset — plural: one file may appear many times. */
export function clipsContainingSource(assetId: string, sourceUs: number, clips: readonly Clip[]): Clip[] {
  const at = round(sourceUs)
  return clips.filter((clip) => assetIdOf(clip) === assetId && at >= clip.sourceStartUs && at < clip.sourceEndUs)
}

/** A source range projected into sequence time, carrying the clip it landed in. */
export type ClipSpan = TimeRange & { sourceStartUs: number; sourceEndUs: number; clipId: string; assetId: string; trackId: string; /** The clip the span was cut from, so a source time inside it can be placed on a retimed clip. */ retime?: Retime }

/** The sequence time of `sourceUs` within a span: through the clip's speed curve when it has one, else a translation. */
export function spanSequenceUs(span: Pick<ClipSpan, 'startUs' | 'sourceStartUs' | 'retime'>, sourceUs: number): number {
  return span.retime ? sequenceUsOf(span.retime, sourceUs) : span.startUs + Math.round(sourceUs) - span.sourceStartUs
}

/**
 * Intersects a source range of one asset with each clip of it, in sequence order. A cue straddling
 * a cut yields one span per kept piece; the cue itself is never split in storage.
 */
export function spansInSequence(range: TimeRange, assetId: string, clips: readonly Clip[]): ClipSpan[] {
  const spans: ClipSpan[] = []
  for (const clip of clips) {
    if (assetIdOf(clip) !== assetId) continue
    const sourceStartUs = Math.max(range.startUs, clip.sourceStartUs)
    const sourceEndUs = Math.min(range.endUs, clip.sourceEndUs)
    if (sourceEndUs <= sourceStartUs) continue
    spans.push({ startUs: sequenceUsOf(clip, sourceStartUs), endUs: sequenceUsOf(clip, sourceEndUs), sourceStartUs, sourceEndUs, clipId: clip.id, assetId, trackId: clip.trackId, ...(clip.kind !== 'image' && clip.kind !== 'color' && clip.kind !== 'adjustment' && clip.speed ? { retime: clip } : {}) })
  }
  return spans.sort((a, b) => a.startUs - b.startUs || a.endUs - b.endUs || (a.clipId < b.clipId ? -1 : a.clipId > b.clipId ? 1 : 0))
}

/** The next clip start or end on any track strictly after `sequenceUs`; `null` past the last one. */
export function nextBoundaryAfter(sequenceUs: number, clips: readonly Clip[]): number | null {
  const at = round(sequenceUs)
  let next: number | null = null
  for (const clip of clips) {
    for (const edge of [clip.timelineStartUs, clipEndUs(clip)]) if (edge > at && (next === null || edge < next)) next = edge
  }
  return next
}

/** The clips captions can be seen through: video clips on video tracks that are not hidden. */
export function captionClips(tracks: readonly Track[], clips: readonly Clip[]): VideoClip[] {
  const hidden = new Set(tracks.filter((track) => track.hidden).map((track) => track.id))
  return clips.filter((clip): clip is VideoClip => clip.kind === 'video' && !hidden.has(clip.trackId))
}

/**
 * Source cues → sequence-time cues (SRT export). A cue whose spans are contiguous in the sequence —
 * the usual cut case — stays **one** cue clipped to the kept material. A cue whose spans are not
 * contiguous (its video plays twice, or is reordered) becomes one cue per contiguous run: those words
 * are heard at separate moments. The 2nd..Nth run gets the render key `${cue.id}:${n}`; the project
 * still has one real cue. A cue with no `mediaAssetId` (a project with no video) passes through.
 */
export function cuesInSequence(cues: readonly Cue[], clips: readonly Clip[]): Cue[] {
  const result: Cue[] = []
  for (const cue of cues) {
    if (!cue.mediaAssetId) { result.push(cue); continue }
    const spans = spansInSequence(cue, cue.mediaAssetId, clips)
    const runs: ClipSpan[][] = []
    for (const span of spans) {
      const run = runs[runs.length - 1]
      if (run && run[run.length - 1].endUs === span.startUs) run.push(span)
      else runs.push([span])
    }
    runs.forEach((run, runIndex) => {
      const startUs = run[0].startUs
      const endUs = run[run.length - 1].endUs
      const words = cue.words.flatMap((word) => {
        const inRun = spansInSequence(word, cue.mediaAssetId!, clips).filter((span) => span.startUs >= startUs && span.endUs <= endUs)
        return inRun.length ? [{ ...word, startUs: inRun[0].startUs, endUs: inRun[inRun.length - 1].endUs }] : []
      })
      result.push({ ...cue, id: runIndex === 0 ? cue.id : `${cue.id}:${runIndex + 1}`, startUs, endUs, words })
    })
  }
  return result.sort((a, b) => a.startUs - b.startUs || a.endUs - b.endUs)
}

export type ActiveCue = {
  cue: Cue
  /** The source time the renderer evaluates the cue's motion at. */
  sourceUs: number
  /** The clip it is seen through; `null` for an unbound cue in a project with no video. */
  clipId: string | null
}

/**
 * **The one active-cue rule**, shared by the preview (`CaptionStage`), the export frame requests and
 * the export layer plan so they can never diverge. With stacked videos two cues can be live at
 * once; the one shown comes from the **topmost visible video track that has one**. Within a track
 * the first cue in array order wins and ranges are half-open — the same policy captions always had.
 * A project with no video clips times its (necessarily unbound) cues directly in sequence time.
 */
export function activeCueAt(sequenceUs: number, tracks: readonly Track[], clips: readonly Clip[], cues: readonly Cue[]): ActiveCue | null {
  const at = round(sequenceUs)
  const videoClips = clips.filter((clip) => clip.kind === 'video')
  if (!videoClips.length) {
    const cue = cues.find((candidate) => !candidate.mediaAssetId && at >= candidate.startUs && at < candidate.endUs)
    return cue ? { cue, sourceUs: at, clipId: null } : null
  }
  const active = activeClipsAt(at, tracks, videoClips, { skipHidden: true })
  for (let index = active.length - 1; index >= 0; index--) {
    const { clip, sourceUs } = active[index]
    const cue = cues.find((candidate) => candidate.mediaAssetId === assetIdOf(clip) && sourceUs >= candidate.startUs && sourceUs < candidate.endUs)
    if (cue) return { cue, sourceUs, clipId: clip.id }
  }
  return null
}

/** The topmost visible video clip under the playhead — what "this video" means for transcription,
 * silence detection and a caption added at the playhead. */
export function videoUnderPlayhead(sequenceUs: number, tracks: readonly Track[], clips: readonly Clip[]): ActiveClip | null {
  const active = activeClipsAt(sequenceUs, tracks, clips.filter((clip) => clip.kind === 'video'), { skipHidden: true })
  return active[active.length - 1] ?? null
}

/** Where the playhead is in one asset's source time: the topmost visible clip of it under the playhead. */
export function sourceUsOfAssetAt(sequenceUs: number, assetId: string, tracks: readonly Track[], clips: readonly Clip[]): ActiveClip | null {
  const active = activeClipsAt(sequenceUs, tracks, clips.filter((clip) => assetIdOf(clip) === assetId), { skipHidden: true })
  return active[active.length - 1] ?? null
}

/** The sequence time a source time of one asset first appears at, for seeking to a caption. */
export function firstSequenceUsOf(assetId: string, sourceUs: number, clips: readonly Clip[]): number | null {
  const spans = spansInSequence({ startUs: sourceUs, endUs: sourceUs + 1 }, assetId, clips)
  return spans.length ? spans[0].startUs : null
}
