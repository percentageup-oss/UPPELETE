import type { WaveformData } from '../core/waveform'
import { slicePeaks } from '../core/waveformSlice'

export function waveformPath(peaks: readonly number[]): string {
  return peaks.map((peak, index) => {
    const amplitude = Math.max(0, Math.min(1, peak)) * .92
    return `M${index} ${1 - amplitude}V${1 + amplitude}`
  }).join('')
}

/**
 * Peaks are extracted and cached per file against its whole source range; each clip draws only the
 * slice of them it plays, so a trimmed or split clip shows exactly its own audio.
 */
export function ClipWaveform({ waveform, sourceStartUs, sourceEndUs, className = 'waveform' }: {
  waveform: WaveformData; sourceStartUs: number; sourceEndUs: number; className?: string
}) {
  const peaks = slicePeaks(waveform, { startUs: sourceStartUs, endUs: sourceEndUs })
  if (!peaks.length) return null
  // Explicit full-box geometry: a replaced element with a definite height but no width attribute
  // and no CSS width sizes itself from the viewBox aspect ratio instead of its containing block,
  // which for a long, low clip stretched the drawing tens of thousands of pixels wide and left only
  // its first sliver inside the clip's `overflow: hidden` box.
  return <svg className={className} width="100%" height="100%" viewBox={`0 0 ${peaks.length} 2`} preserveAspectRatio="none" aria-label="Audio waveform">
    <path d={waveformPath(peaks)} />
  </svg>
}
