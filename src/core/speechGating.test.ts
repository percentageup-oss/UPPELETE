import { describe, expect, it } from 'vitest'
import { LongSilenceDetector, planSpeechChunks, samplesToUs } from './speechGating'

const rate = 16000
const tone = (count: number, amplitude = 8000) => Int16Array.from({ length: count }, (_value, index) => (index % 40 < 20 ? amplitude : -amplitude))
const zeros = (count: number) => new Int16Array(count)
function concat(...parts: Int16Array[]) {
  const output = new Int16Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) { output.set(part, offset); offset += part.length }
  return output
}
function detect(samples: Int16Array, blockSize = samples.length || 1) {
  const detector = new LongSilenceDetector({ sampleRate: rate })
  for (let index = 0; index < samples.length; index += blockSize) detector.push(samples.subarray(index, index + blockSize))
  return detector.finish()
}

describe('LongSilenceDetector', () => {
  it('finds the exact sample boundaries of a long silence, independent of block size', () => {
    const audio = concat(tone(16000), zeros(80000), tone(32000))
    const expected = { totalSamples: 128000, silences: [{ startSample: 16000, endSample: 96000 }] }
    expect(detect(audio)).toEqual(expected)
    expect(detect(audio, 333)).toEqual(expected)
    expect(detect(audio, 7)).toEqual(expected)
  })

  it('ignores pauses shorter than two seconds and quiet speech above -45 dBFS', () => {
    expect(detect(concat(tone(16000), zeros(31680), tone(16000))).silences).toEqual([])
    // Square wave at amplitude 330 ≈ -40 dBFS RMS: audible, not silence.
    expect(detect(tone(48000, 330)).silences).toEqual([])
  })

  it('treats low-level noise below -45 dBFS as silence and runs a trailing silence to the end', () => {
    // Amplitude 100 ≈ -50 dBFS RMS.
    expect(detect(concat(tone(8000), tone(48000, 100)))).toEqual({ totalSamples: 56000, silences: [{ startSample: 8000, endSample: 56000 }] })
  })

  it('judges the final partial window by its own samples', () => {
    expect(detect(zeros(32100)).silences).toEqual([{ startSample: 0, endSample: 32100 }])
    expect(detect(concat(zeros(32000), tone(100))).silences).toEqual([{ startSample: 0, endSample: 32000 }])
  })

  it('rejects durations that are not whole samples', () => {
    expect(() => new LongSilenceDetector({ sampleRate: 16000, windowMs: 0.01 })).toThrow('whole number of samples')
  })
})

describe('planSpeechChunks', () => {
  it('pads speech into long silences without covering the silence interior', () => {
    expect(planSpeechChunks(128000, [{ startSample: 16000, endSample: 96000 }], { sampleRate: rate }))
      .toEqual([{ startSample: 0, endSample: 20800 }, { startSample: 91200, endSample: 128000 }])
  })

  it('returns nothing for all-silent audio and one chunk when there is no long silence', () => {
    expect(planSpeechChunks(48000, [{ startSample: 0, endSample: 48000 }], { sampleRate: rate })).toEqual([])
    expect(planSpeechChunks(48000, [], { sampleRate: rate })).toEqual([{ startSample: 0, endSample: 48000 }])
    expect(planSpeechChunks(0, [], { sampleRate: rate })).toEqual([])
  })

  it('merges padded regions when a configured silence is shorter than both paddings', () => {
    expect(planSpeechChunks(20000, [{ startSample: 8000, endSample: 9000 }], { sampleRate: rate, minSilenceMs: 50 }))
      .toEqual([{ startSample: 0, endSample: 20000 }])
  })

  it('keeps a speech chunk after an hour-long silence at its exact offset', () => {
    const hour = rate * 3600
    const chunks = planSpeechChunks(hour + 96000, [{ startSample: 32000, endSample: hour }], { sampleRate: rate })
    expect(chunks).toEqual([{ startSample: 0, endSample: 36800 }, { startSample: hour - 4800, endSample: hour + 96000 }])
    expect(samplesToUs(chunks[1].startSample, rate)).toBe(3_599_700_000)
  })

  it('rejects unordered, overlapping or out-of-range silences', () => {
    expect(() => planSpeechChunks(1000, [{ startSample: 500, endSample: 900 }, { startSample: 100, endSample: 200 }], { sampleRate: rate })).toThrow()
    expect(() => planSpeechChunks(1000, [{ startSample: 500, endSample: 1001 }], { sampleRate: rate })).toThrow()
  })
})

describe('samplesToUs', () => {
  it('floors exact integer microseconds at 16 and 48 kHz', () => {
    expect(samplesToUs(1, 16000)).toBe(62)
    expect(samplesToUs(3, 16000)).toBe(187)
    expect(samplesToUs(16000, 16000)).toBe(1_000_000)
    expect(samplesToUs(48000 * 7200 + 1, 48000)).toBe(7_200_000_020)
    expect(() => samplesToUs(-1, 16000)).toThrow()
  })
})
