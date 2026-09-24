import type { ClipSpeed } from './edit'
import { isConstantSpeed, timelineLengthUs, timelineToSourceOffsetUs } from './clipTime'
import type { WaveformData } from './waveform'

/**
 * `waveform.peaks` tiles `waveform.range` into equal-width source-time buckets (the same edges
 * `waveformBucketEdges` in `workers/media/waveform.ts` produces). To draw one `<svg>` per kept
 * segment after a cut, each segment needs its own slice of that array without re-extracting or
 * re-decoding audio — this finds the bucket span a source range overlaps and returns it as-is.
 */
export function slicePeaks(waveform: Pick<WaveformData, 'range' | 'peaks'>, sourceRange: { startUs: number; endUs: number }): number[] {
  const { range, peaks } = waveform
  const total = range.endUs - range.startUs
  if (total <= 0 || !peaks.length) return []
  const startUs = Math.max(range.startUs, sourceRange.startUs)
  const endUs = Math.min(range.endUs, sourceRange.endUs)
  if (endUs <= startUs) return []
  const startIndex = Math.floor((startUs - range.startUs) * peaks.length / total)
  const endIndex = Math.ceil((endUs - range.startUs) * peaks.length / total)
  return peaks.slice(Math.max(0, startIndex), Math.min(peaks.length, endIndex))
}

/** Columns drawn for a ramped clip: enough to show the speed change, cheap enough for a long clip. */
const RAMP_COLUMNS = 320

/**
 * The peaks a clip draws, one per column of its **timeline** width. A steady rate is a linear stretch
 * of the source slice, so the plain slice is right; a ramp stretches some parts and squeezes others,
 * so each column takes the loudest bucket of the source range it actually plays.
 */
export function clipPeaks(waveform: Pick<WaveformData, 'range' | 'peaks'>, clip: { sourceStartUs: number; sourceEndUs: number; speed?: ClipSpeed }): number[] {
  if (isConstantSpeed(clip)) return slicePeaks(waveform, { startUs: clip.sourceStartUs, endUs: clip.sourceEndUs })
  const retime = { timelineStartUs: 0, sourceStartUs: clip.sourceStartUs, sourceEndUs: clip.sourceEndUs, speed: clip.speed }
  const total = timelineLengthUs(retime)
  const columns: number[] = []
  for (let column = 0; column < RAMP_COLUMNS; column++) {
    const startUs = timelineToSourceOffsetUs(retime, column * total / RAMP_COLUMNS)
    const endUs = Math.max(startUs + 1, timelineToSourceOffsetUs(retime, (column + 1) * total / RAMP_COLUMNS))
    const slice = slicePeaks(waveform, { startUs, endUs })
    columns.push(slice.length ? Math.max(...slice) : 0)
  }
  return columns
}
