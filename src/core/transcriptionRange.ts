import type { Cue } from './model'
import type { Clip } from './edit'
import { assetIdOf } from './edit'
import type { SequenceRange } from './sequenceRange'
import { clipEndUs, sourceUsAt } from './timelineModel'
import { MIN_TRANSCRIPTION_RANGE_US } from './transcriptionIpc'
import { US_PER_SECOND } from './time'

/** A stretch of one video in that video's own (source) time. */
export type SourceRange = { startUs: number; endUs: number }

const playsMedia = (clip: Clip) => clip.kind === 'video' || clip.kind === 'audio'

/** Source time of `assetId` shown at sequence time `sequenceUs`, or null when no clip of that video is there. */
export function sourceUsForAssetAt(sequenceUs: number, assetId: string, clips: readonly Clip[]): number | null {
  const at = Math.round(sequenceUs)
  const clip = clips.find((candidate) => playsMedia(candidate) && assetIdOf(candidate) === assetId && at >= candidate.timelineStartUs && at < clipEndUs(candidate))
  return clip ? Math.round(sourceUsAt(clip, at)) : null
}

/**
 * The source span of `assetId` that a sequence range covers: the hull of every clip span of that video
 * inside it. Null when none. If the video appears twice or is cut, the hull may include source material
 * that is not on the timeline; that only means a little extra audio is transcribed.
 */
export function sourceRangeForSequenceRange(range: SequenceRange, assetId: string, clips: readonly Clip[]): SourceRange | null {
  let startUs = Infinity
  let endUs = -Infinity
  for (const clip of clips) {
    if (!playsMedia(clip) || assetIdOf(clip) !== assetId) continue
    const from = Math.max(range.startUs, clip.timelineStartUs)
    const to = Math.min(range.endUs, clipEndUs(clip))
    if (to <= from) continue
    startUs = Math.min(startUs, sourceUsAt(clip, from))
    endUs = Math.max(endUs, sourceUsAt(clip, to))
  }
  return endUs > startUs ? { startUs: Math.round(startUs), endUs: Math.round(endUs) } : null
}

/** Null when valid, else a short user-facing reason (start ≥ end, beyond the video, shorter than the minimum). */
export function transcriptionRangeProblem(range: SourceRange, durationUs: number | null): string | null {
  if (range.startUs >= range.endUs) return 'The start must come before the end.'
  if (durationUs !== null && range.endUs > durationUs) return `The end is beyond the video (${formatRangeTime(durationUs)}).`
  if (range.endUs - range.startUs < MIN_TRANSCRIPTION_RANGE_US) return `Choose at least ${MIN_TRANSCRIPTION_RANGE_US / US_PER_SECOND} second of the video.`
  return null
}

/** Lenient input: "22", "22.5", "0:22.5", "1:02:03.25" → integer µs; null when unparsable. */
export function parseRangeInput(text: string): number | null {
  const parts = text.trim().split(':')
  if (parts.length > 3 || parts.some((part) => !/^\d+(\.\d+)?$/.test(part))) return null
  // Only the last field (seconds) may carry a fraction.
  if (parts.slice(0, -1).some((part) => part.includes('.'))) return null
  const seconds = parts.reduce((total, part) => total * 60 + Number(part), 0)
  return Number.isFinite(seconds) ? Math.round(seconds * US_PER_SECOND) : null
}

/** Short display for range fields and labels: "0:22.5", "1:02:03.3". Tenths of a second. */
export function formatRangeTime(us: number): string {
  const tenths = Math.max(0, Math.round(us / (US_PER_SECOND / 10)))
  const seconds = Math.floor(tenths / 10)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor(seconds / 60) % 60
  const rest = `${String(seconds % 60).padStart(2, '0')}.${tenths % 10}`
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`
}

export const MIN_CAPTION_GAP_US = 5_000_000

/** Merged, sorted spans covered by captions of `assetId`, clamped to the video. */
function coveredSpans(cues: readonly Cue[], assetId: string, durationUs: number): SourceRange[] {
  const spans = cues
    .filter((cue) => cue.mediaAssetId === assetId)
    .map((cue) => ({ startUs: Math.max(0, cue.startUs), endUs: Math.min(durationUs, cue.endUs) }))
    .filter((span) => span.endUs > span.startUs)
    .sort((a, b) => a.startUs - b.startUs)
  const merged: SourceRange[] = []
  for (const span of spans) {
    const last = merged[merged.length - 1]
    if (last && span.startUs <= last.endUs) last.endUs = Math.max(last.endUs, span.endUs)
    else merged.push({ ...span })
  }
  return merged
}

function gapsBetween(covered: readonly SourceRange[], durationUs: number): SourceRange[] {
  const gaps: SourceRange[] = []
  let cursor = 0
  for (const span of covered) {
    if (span.startUs > cursor) gaps.push({ startUs: cursor, endUs: span.startUs })
    cursor = Math.max(cursor, span.endUs)
  }
  if (durationUs > cursor) gaps.push({ startUs: cursor, endUs: durationUs })
  return gaps
}

/** Stretches of the video with no caption of that video, at least `minGapUs` long, in source time, sorted. */
export function captionGaps(cues: readonly Cue[], assetId: string, durationUs: number, minGapUs = MIN_CAPTION_GAP_US): SourceRange[] {
  return gapsBetween(coveredSpans(cues, assetId, durationUs), durationUs).filter((gap) => gap.endUs - gap.startUs >= minGapUs)
}

/** The caption gap of `assetId` containing `sourceUs`, with no minimum length; null when a caption is there. */
export function captionGapAt(cues: readonly Cue[], assetId: string, durationUs: number, sourceUs: number): SourceRange | null {
  return gapsBetween(coveredSpans(cues, assetId, durationUs), durationUs).find((gap) => sourceUs >= gap.startUs && sourceUs < gap.endUs) ?? null
}
