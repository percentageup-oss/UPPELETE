import { z } from 'zod'
import { mediaFingerprintSchema } from './media'
import { silenceDetectionOptionsSchema } from './silenceRemoval'

const microseconds = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const range = z.strictObject({ startUs: microseconds, endUs: microseconds }).refine((r) => r.endUs > r.startUs, 'End must follow start')

/** One request per Detect click: main resolves the fingerprint to a verified path exactly as the
 * waveform/thumbnail IPC does, so no path ever crosses the bridge. */
export const silenceDetectRequestSchema = z.strictObject({
  requestId: z.uuid(),
  fingerprint: mediaFingerprintSchema,
  thresholdDbfs: silenceDetectionOptionsSchema.shape.thresholdDbfs,
  minSilenceMs: silenceDetectionOptionsSchema.shape.minSilenceMs,
})
export type SilenceDetectRequest = z.infer<typeof silenceDetectRequestSchema>

export const silenceDetectResultSchema = z.strictObject({
  durationUs: microseconds,
  silences: z.array(range).max(100_000),
  speechGating: z.string().min(1).max(128),
})
export type SilenceDetectResult = z.infer<typeof silenceDetectResultSchema>
