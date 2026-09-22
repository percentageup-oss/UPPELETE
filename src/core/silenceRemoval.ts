import { z } from 'zod'
import type { TimeRange } from './timelineModel'

/**
 * Turns detected silence into kept source ranges (V6's cuts, produced automatically instead of by
 * hand) — DaVinci-Resolve-style "remove silence": detect long quiet spans below a dB threshold,
 * shrink each by a padding margin so onsets/decays are never clipped, and keep everything else.
 * Pure and integer-microsecond, like every other function in docs/EDITING.md's time model.
 */

export const SILENCE_DETECTION_DEFAULTS = { thresholdDbfs: -40, minSilenceMs: 500, padMs: 100 } as const

export const silenceDetectionOptionsSchema = z.strictObject({
  thresholdDbfs: z.number().finite().min(-80).max(0),
  minSilenceMs: z.number().int().min(100).max(10_000),
  padMs: z.number().int().min(0).max(1_000),
})
export type SilenceDetectionOptions = z.infer<typeof silenceDetectionOptionsSchema>

/**
 * The complement of `silences` over `[0, mediaDurationUs]`, with each silence shrunk by `padUs` on
 * both sides so the kept material includes a little of the quiet just before/after speech. A
 * silence shorter than `2 * padUs` disappears entirely (there is no non-padding gap left to cut).
 * Result is ascending, non-overlapping and never empty: an entirely silent media keeps the whole
 * range rather than producing zero segments, because a project with no segments is defined as "kept
 * everything" and this function must never invent a segment list an empty timeline can't play.
 */
export function keptRangesFromSilences(silences: readonly TimeRange[], mediaDurationUs: number, padUs: number): TimeRange[] {
  if (!Number.isSafeInteger(mediaDurationUs) || mediaDurationUs <= 0) throw new Error('Media duration must be a positive safe integer')
  if (!Number.isSafeInteger(padUs) || padUs < 0) throw new Error('Padding must be a non-negative safe integer')
  const ordered = [...silences].sort((a, b) => a.startUs - b.startUs)
  const cuts: TimeRange[] = []
  let cursor = 0
  for (const silence of ordered) {
    if (silence.endUs <= silence.startUs || silence.startUs < cursor || silence.endUs > mediaDurationUs) {
      throw new Error('Silences must be ordered, non-overlapping and inside the media')
    }
    const startUs = silence.startUs + padUs
    const endUs = silence.endUs - padUs
    if (endUs > startUs) cuts.push({ startUs, endUs })
    cursor = silence.endUs
  }
  const kept: TimeRange[] = []
  cursor = 0
  for (const cut of cuts) {
    if (cut.startUs > cursor) kept.push({ startUs: cursor, endUs: cut.startUs })
    cursor = cut.endUs
  }
  if (cursor < mediaDurationUs) kept.push({ startUs: cursor, endUs: mediaDurationUs })
  return kept.length ? kept : [{ startUs: 0, endUs: mediaDurationUs }]
}

export type SilenceRemovalSummary = {
  /** Number of gaps actually removed — one less than the kept-range count would suggest when the
   * media starts or ends in silence, so this counts the cuts between/around kept ranges directly. */
  cutCount: number
  removedUs: number
  sequenceDurationUs: number
  /** True when nothing would change — no cut is long enough to survive padding. */
  isNoOp: boolean
}

/** Human-facing numbers for the dialog's summary line, before the user commits to Apply. */
export function summarizeSilenceRemoval(kept: readonly TimeRange[], mediaDurationUs: number): SilenceRemovalSummary {
  const sequenceDurationUs = kept.reduce((total, range) => total + (range.endUs - range.startUs), 0)
  const removedUs = Math.max(0, mediaDurationUs - sequenceDurationUs)
  // One cut between every pair of adjacent kept ranges, plus one more for each edge that starts
  // or ends in removed material (a leading/trailing silence has no "next kept range" to count).
  const edgeCuts = (kept[0]?.startUs ?? 0) > 0 ? 1 : 0
  const trailingCuts = (kept.length ? kept[kept.length - 1].endUs : 0) < mediaDurationUs ? 1 : 0
  const cutCount = removedUs === 0 ? 0 : Math.max(0, kept.length - 1) + edgeCuts + trailingCuts
  return { cutCount, removedUs, sequenceDurationUs, isNoOp: removedUs === 0 }
}
