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
