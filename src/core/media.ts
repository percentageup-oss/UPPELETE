import { z } from 'zod'

const positiveSafeInteger = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const nonnegativeSafeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)

export const rationalSchema = z.strictObject({
  numerator: positiveSafeInteger,
  denominator: positiveSafeInteger,
})

export const mediaCodecSchema = z.strictObject({
  name: z.string().min(1).max(256),
  longName: z.string().min(1).max(512).nullable(),
  profile: z.string().min(1).max(256).nullable(),
  level: z.number().int().nullable(),
  tag: z.string().min(1).max(64).nullable(),
})

export const mediaStreamSchema = z.strictObject({
  index: z.number().int().nonnegative(),
  kind: z.enum(['audio', 'video', 'other']),
  codec: mediaCodecSchema,
  timeBase: rationalSchema.nullable(),
  startUs: z.number().int().safe().nullable(),
  durationUs: nonnegativeSafeInteger.nullable(),
  width: positiveSafeInteger.nullable(),
  height: positiveSafeInteger.nullable(),
  sampleAspectRatio: rationalSchema.nullable().optional(),
  averageFrameRate: rationalSchema.nullable(),
  nominalFrameRate: rationalSchema.nullable(),
  rotationDegrees: z.number().finite().min(-360).max(360).nullable(),
  sampleRate: positiveSafeInteger.nullable(),
  channels: positiveSafeInteger.nullable(),
})

export const mediaMetadataSchema = z.strictObject({
  durationUs: nonnegativeSafeInteger.nullable(),
  width: positiveSafeInteger.nullable(),
  height: positiveSafeInteger.nullable(),
  rotationDegrees: z.number().finite().min(-360).max(360).nullable(),
  frameRate: rationalSchema.nullable(),
  nominalFrameRate: rationalSchema.nullable(),
  streams: z.array(mediaStreamSchema).max(256),
})

export const mediaFingerprintSchema = z.strictObject({
  algorithm: z.literal('sha256-sampled-v1'),
  value: z.string().regex(/^[a-f0-9]{64}$/),
  sizeBytes: nonnegativeSafeInteger,
  sampledBytes: nonnegativeSafeInteger,
})

const safePortableRelativePath = z.string().min(1).max(32768)
  .refine((value) => !value.includes('\0'), 'NUL in relative path')
  .refine((value) => !value.includes('\\'), 'Portable relative paths must use forward slashes')
  .refine((value) => !value.startsWith('/') && !value.startsWith('\\') && !/^[a-zA-Z]:/.test(value), 'Relative path must not be absolute')
  .refine((value) => value.split('/').every((part) => part !== '' && part !== '.' && part !== '..'), 'Relative path must stay inside the project directory')

export const mediaReferenceSchema = z.strictObject({
  relativePath: safePortableRelativePath.nullable(),
  absolutePath: z.string().min(1).max(32768).refine((value) => !value.includes('\0'), 'NUL in absolute path').nullable(),
}).refine((value) => value.relativePath !== null || value.absolutePath !== null, 'A media path is required')

export const projectMediaSchema = z.strictObject({
  name: z.string().min(1).max(1024),
  reference: mediaReferenceSchema,
  fingerprint: mediaFingerprintSchema.nullable(),
  metadata: mediaMetadataSchema.nullable(),
})

export type Rational = z.infer<typeof rationalSchema>
export type MediaStream = z.infer<typeof mediaStreamSchema>
export type MediaMetadata = z.infer<typeof mediaMetadataSchema>
export type MediaFingerprint = z.infer<typeof mediaFingerprintSchema>
export type MediaReference = z.infer<typeof mediaReferenceSchema>
export type ProjectMedia = z.infer<typeof projectMediaSchema>

function describeRate(rate: Rational | null): string {
  return rate ? `${rate.numerator}/${rate.denominator}` : 'unknown'
}

/** Human-readable identity diagnostics. An empty list means the replacement matches. */
export function describeMediaMismatches(expected: ProjectMedia, actual: ProjectMedia): string[] {
  const mismatches: string[] = []
  if (!expected.fingerprint) {
    mismatches.push('This older project has no stored media fingerprint, so file identity cannot be confirmed.')
  } else if (!actual.fingerprint || expected.fingerprint.value !== actual.fingerprint.value || expected.fingerprint.sizeBytes !== actual.fingerprint.sizeBytes) {
    mismatches.push(`The sampled fingerprint differs (stored ${expected.fingerprint.sizeBytes} bytes; selected ${actual.fingerprint?.sizeBytes ?? 'unknown'} bytes).`)
  }
  const before = expected.metadata
  const after = actual.metadata
  if (!before) {
    mismatches.push('This older project has no stored media metadata for comparison.')
    return mismatches
  }
  if (!after) return [...mismatches, 'The selected file has no readable media metadata.']
  if (before.durationUs !== after.durationUs) mismatches.push(`Duration differs (stored ${before.durationUs ?? 'unknown'} µs; selected ${after.durationUs ?? 'unknown'} µs).`)
  if (before.width !== after.width || before.height !== after.height) mismatches.push(`Video dimensions differ (stored ${before.width ?? '?'}×${before.height ?? '?'}; selected ${after.width ?? '?'}×${after.height ?? '?'}).`)
  if (before.rotationDegrees !== after.rotationDegrees) mismatches.push(`Rotation differs (stored ${before.rotationDegrees ?? 'unknown'}°; selected ${after.rotationDegrees ?? 'unknown'}°).`)
  if (describeRate(before.frameRate) !== describeRate(after.frameRate)) mismatches.push(`Average frame rate differs (stored ${describeRate(before.frameRate)}; selected ${describeRate(after.frameRate)}).`)
  const streamSummary = (metadata: MediaMetadata) => metadata.streams.map((stream) => `${stream.kind}:${stream.codec.name}`).join(', ')
  if (streamSummary(before) !== streamSummary(after)) mismatches.push(`Streams/codecs differ (stored ${streamSummary(before) || 'none'}; selected ${streamSummary(after) || 'none'}).`)
  return mismatches
}
