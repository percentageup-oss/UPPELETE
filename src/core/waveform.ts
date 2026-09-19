import { z } from 'zod'
import { mediaFingerprintSchema } from './media'

export const WAVEFORM_EXTRACTION_VERSION = 'ffmpeg-f32le-mono-peaks-v1'
export const TIMELINE_WAVEFORM_PEAKS = 16_384

const microseconds = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
export const waveformRangeSchema = z.strictObject({ startUs: microseconds, endUs: microseconds })
  .refine((range) => range.endUs > range.startUs, 'End must follow start')

export const waveformDataSchema = z.strictObject({
  range: waveformRangeSchema,
  peaks: z.array(z.number().min(0).max(1)).min(1).max(100_000),
})

export const waveformLoadRequestSchema = z.strictObject({
  requestId: z.uuid(),
  fingerprint: mediaFingerprintSchema,
  range: waveformRangeSchema,
  maxPeaks: z.number().int().positive().max(32_768),
})

export type WaveformData = z.infer<typeof waveformDataSchema>
export type WaveformLoadRequest = z.infer<typeof waveformLoadRequestSchema>
export type WaveformLoadResult = {
  waveform: WaveformData
  cache: 'hit' | 'generated'
  extractionVersion: typeof WAVEFORM_EXTRACTION_VERSION
}
