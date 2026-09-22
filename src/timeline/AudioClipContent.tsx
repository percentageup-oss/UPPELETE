import type { Clip } from '../core/edit'
import type { WaveformData } from '../core/waveform'
import { ClipWaveform } from './waveformPath'

/** An audio clip's waveform, sliced to exactly the part of its file it plays. */
export function AudioClipContent({ clip, waveform }: { clip: Clip; waveform: WaveformData | null }) {
  if (!waveform) return null
  return <ClipWaveform waveform={waveform} sourceStartUs={clip.sourceStartUs} sourceEndUs={clip.sourceEndUs} />
}
