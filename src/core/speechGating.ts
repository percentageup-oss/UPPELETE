/**
 * Deterministic long-silence gating for 16-bit mono PCM (T3). Recognition only runs on the audio between
 * long silences, so a long pause is never handed to the recognizer (whisper.cpp was observed inventing text
 * for a silent span) and every speech chunk keeps its exact sample offset inside the extracted audio.
 *
 * This is an energy threshold over fixed, non-overlapping windows — not voice-activity detection. Music,
 * noise or room tone louder than the threshold is still sent to the recognizer, and speech quieter than it
 * for longer than the minimum silence would be skipped. All positions are integer sample indices.
 */

export const SPEECH_GATING_VERSION = 'pcm16-rms20ms-below-45dbfs-min2000ms-pad300ms-v1'

export type SampleSpan = { startSample: number; endSample: number }
export type SpeechGatingOptions = {
  sampleRate: number
  windowMs?: number
  thresholdDbfs?: number
  minSilenceMs?: number
  padMs?: number
}

const DEFAULTS = { windowMs: 20, thresholdDbfs: -45, minSilenceMs: 2000, padMs: 300 } as const

function resolveOptions(options: SpeechGatingOptions) {
  const { sampleRate } = options
  if (!Number.isSafeInteger(sampleRate) || sampleRate <= 0) throw new Error('Sample rate must be a positive integer')
  const samples = (ms: number, name: string) => {
    const value = sampleRate * ms / 1000
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} of ${ms} ms is not a whole number of samples at ${sampleRate} Hz`)
    return value
  }
  const thresholdDbfs = options.thresholdDbfs ?? DEFAULTS.thresholdDbfs
  if (!Number.isFinite(thresholdDbfs) || thresholdDbfs > 0) throw new Error('Silence threshold must be a finite dBFS value at or below 0')
  const windowSamples = samples(options.windowMs ?? DEFAULTS.windowMs, 'Window')
  if (windowSamples < 1) throw new Error('Window must contain at least one sample')
  const thresholdAmplitude = 32768 * 10 ** (thresholdDbfs / 20)
  return {
    windowSamples,
    minSilenceSamples: samples(options.minSilenceMs ?? DEFAULTS.minSilenceMs, 'Minimum silence'),
    padSamples: samples(options.padMs ?? DEFAULTS.padMs, 'Padding'),
    thresholdSquared: thresholdAmplitude * thresholdAmplitude,
  }
}

/**
 * Streaming detector: push signed 16-bit samples in any block sizes, then `finish()`. A window is silent when
 * its RMS is below the threshold; consecutive silent windows at least `minSilenceMs` long form a silence. The
 * final partial window is judged on its own sample count. Sums of at most one window of squared int16 values
 * stay far below 2^53, so the result is exact and identical for any block split.
 */
export class LongSilenceDetector {
  private readonly windowSamples: number
  private readonly minSilenceSamples: number
  private readonly thresholdSquared: number
  private windowCount = 0
  private windowSumSquares = 0
  private position = 0
  private runStart: number | null = null
  private readonly silences: SampleSpan[] = []
  private finished = false

  constructor(options: SpeechGatingOptions) {
    const resolved = resolveOptions(options)
    this.windowSamples = resolved.windowSamples
    this.minSilenceSamples = resolved.minSilenceSamples
    this.thresholdSquared = resolved.thresholdSquared
  }

  push(samples: ArrayLike<number>): void {
    if (this.finished) throw new Error('Silence detector already finished')
    for (let index = 0; index < samples.length; index += 1) {
      const value = samples[index]
      this.windowSumSquares += value * value
      this.windowCount += 1
      this.position += 1
      if (this.windowCount === this.windowSamples) this.closeWindow()
    }
  }

  finish(): { totalSamples: number; silences: SampleSpan[] } {
    if (!this.finished) {
      if (this.windowCount > 0) this.closeWindow()
      this.closeRun(this.position)
      this.finished = true
    }
    return { totalSamples: this.position, silences: this.silences.map((span) => ({ ...span })) }
  }

  private closeWindow() {
    const windowStart = this.position - this.windowCount
    if (this.windowSumSquares < this.thresholdSquared * this.windowCount) this.runStart ??= windowStart
    else this.closeRun(windowStart)
    this.windowCount = 0
    this.windowSumSquares = 0
  }

  private closeRun(endSample: number) {
    if (this.runStart !== null && endSample - this.runStart >= this.minSilenceSamples) {
      this.silences.push({ startSample: this.runStart, endSample })
    }
    this.runStart = null
  }
}

/**
 * The complement of the silences, each speech region widened by `padMs` on both sides (clamped to the audio)
 * so onsets/decays near the threshold are not clipped. Touching or overlapping padded regions are merged.
 * All-silent audio yields no chunks: nothing is recognized, so nothing can be invented.
 */
export function planSpeechChunks(totalSamples: number, silences: readonly SampleSpan[], options: SpeechGatingOptions): SampleSpan[] {
  const { padSamples } = resolveOptions(options)
  if (!Number.isSafeInteger(totalSamples) || totalSamples < 0) throw new Error('Total sample count must be a non-negative integer')
  let cursor = 0
  for (const silence of silences) {
    if (!Number.isSafeInteger(silence.startSample) || !Number.isSafeInteger(silence.endSample)
      || silence.startSample < cursor || silence.endSample <= silence.startSample || silence.endSample > totalSamples) {
      throw new Error('Silences must be ordered, non-overlapping and inside the audio')
    }
    cursor = silence.endSample
  }
  const speech: SampleSpan[] = []
  cursor = 0
  for (const silence of [...silences, { startSample: totalSamples, endSample: totalSamples }]) {
    if (silence.startSample > cursor) {
      speech.push({ startSample: Math.max(0, cursor - padSamples), endSample: Math.min(totalSamples, silence.startSample + padSamples) })
    }
    cursor = silence.endSample
  }
  const merged: SampleSpan[] = []
  for (const span of speech) {
    const previous = merged[merged.length - 1]
    if (previous && span.startSample <= previous.endSample) previous.endSample = Math.max(previous.endSample, span.endSample)
    else merged.push({ ...span })
  }
  return merged
}

/** Floor of a sample index in integer microseconds (62.5 µs per sample at 16 kHz), computed without float error. */
export function samplesToUs(sample: number, sampleRate: number): number {
  if (!Number.isSafeInteger(sample) || sample < 0 || !Number.isSafeInteger(sampleRate) || sampleRate <= 0) throw new Error('Invalid sample position')
  const value = Number((BigInt(sample) * 1_000_000n) / BigInt(sampleRate))
  if (!Number.isSafeInteger(value)) throw new Error('Sample position overflows safe microseconds')
  return value
}
