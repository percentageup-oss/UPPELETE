import { z } from 'zod'
import { exportPlanSchema } from '../../src/export/plan'
import { mediaFingerprintSchema, mediaMetadataSchema, rationalSchema } from '../../src/core/media'
import { languageCodeSchema, segmentTimingAdjustmentSchema } from '../../src/core/transcription'

export const PROTOCOL_VERSION = 1
export const MAX_MESSAGE_BYTES = 1024 * 1024
export const microseconds = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const positiveInt = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
// The wire accepts POSIX, drive-absolute and UNC paths. Execution also checks the host's rules.
export const filePath = z.string().min(1).max(32768)
  .refine((s) => !s.includes('\0'), 'NUL in path')
  .refine((s) => s.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(s) || /^\\\\[^\\]+\\[^\\]+/.test(s), 'Path must be absolute')
const range = z.strictObject({ startUs: microseconds, endUs: microseconds })
  .refine((r) => r.endUs > r.startUs, 'End must follow start')
const rational = rationalSchema

export const taskSchema = z.discriminatedUnion('operation', [
  z.strictObject({ operation: z.literal('runtime') }),
  z.strictObject({ operation: z.literal('inspectToolchain') }),
  z.strictObject({ operation: z.literal('probe'), inputPath: filePath }),
  z.strictObject({ operation: z.literal('waveform'), inputPath: filePath, range, maxPeaks: positiveInt.max(100000) }),
  z.strictObject({ operation: z.literal('thumbnails'), inputPath: filePath,
    timestampsUs: z.array(microseconds).min(1).max(1000), width: positiveInt.max(8192), outputDirectory: filePath }),
  z.strictObject({ operation: z.literal('extractAudio'), inputPath: filePath, range,
    outputPath: filePath, sampleRate: z.union([z.literal(16000), z.literal(48000)]), channels: z.literal(1) }),
  // DaVinci-Resolve-style "remove silence": long-silence detection over a range, reusing the same
  // detector transcription's speech gating relies on (src/core/speechGating.ts).
  z.strictObject({ operation: z.literal('detectSilence'), inputPath: filePath, range,
    thresholdDbfs: z.number().finite().max(0), minSilenceMs: positiveInt }),
  // A local playback proxy, never a silent replacement for source media.
  z.strictObject({ operation: z.literal('proxy'), inputPath: filePath, outputPath: filePath, durationUs: microseconds }),
  // T3: the executable is main-owned configuration; only an absolute model path and job-owned audio travel here.
  z.strictObject({ operation: z.literal('inspectWhisper'), modelPath: filePath }),
  z.strictObject({ operation: z.literal('whisperTranscribe'), audioPath: filePath, modelPath: filePath,
    language: z.union([languageCodeSchema, z.literal('auto')]), useGpu: z.boolean(),
    // The extracted audio window; every reported time is bounded by it.
    durationUs: positiveInt }),
  // Cloud transcription: split job-owned audio at long silences into per-chunk WAVs inside a job-owned directory.
  z.strictObject({ operation: z.literal('speechChunks'), audioPath: filePath, outputDirectory: filePath, durationUs: positiveInt,
    maxChunkUs: positiveInt }),
  // A versioned render manifest, never arbitrary FFmpeg flags or drawtext. `inputPaths` lists every
  // file the export reads (one for manifests v1/v2; one per FFmpeg-read clip for v3) so the worker can
  // refuse a destination that would overwrite any of them. Nothing here is persisted, so the protocol
  // version is unchanged.
  z.strictObject({ operation: z.literal('export'), inputPaths: z.array(filePath).min(1).max(256), renderManifestPath: filePath,
    outputPath: filePath, range: exportPlanSchema.shape.range, frameRate: exportPlanSchema.shape.frameRate, width: exportPlanSchema.shape.width, height: exportPlanSchema.shape.height,
    profile: z.literal('mp4-caption-renderer-v1'),
    /** One validated number, never flags; absent keeps the automatic bitrate class (argv unchanged). */
    encoding: z.strictObject({ videoBitrateKbps: z.number().int().min(500).max(100_000) }).optional() }),
])
export type MediaTask = z.infer<typeof taskSchema>
export type Operation = MediaTask['operation']
const operationSchema = z.enum(['runtime', 'inspectToolchain', 'probe', 'waveform', 'thumbnails', 'extractAudio', 'detectSilence', 'proxy', 'inspectWhisper', 'whisperTranscribe', 'speechChunks', 'export'])
const idSchema = z.uuid()
const envelope = { version: z.literal(PROTOCOL_VERSION), id: idSchema }
export const requestSchema = z.strictObject({ ...envelope, type: z.literal('request'), task: taskSchema })
export const cancelSchema = z.strictObject({ ...envelope, type: z.literal('cancel') })
export const clientMessageSchema = z.discriminatedUnion('type', [requestSchema, cancelSchema])
export type RequestMessage = z.infer<typeof requestSchema>

const toolReport = z.strictObject({ versionOutput: z.string().min(1).max(65536), licenseOutput: z.string().min(1).max(65536) })
/** Local-only export stage timings (milliseconds and frame counts, never content). */
const exportTimingsSchema = z.strictObject({
  startupMs: z.number().nonnegative(), hostWaitMs: z.number().nonnegative(), encoderWaitMs: z.number().nonnegative(),
  paintedFrames: z.number().int().nonnegative(), reusedFrames: z.number().int().nonnegative(),
  finalizeMs: z.number().nonnegative(), totalMs: z.number().nonnegative(), fps: z.number().nonnegative(),
})
export type ExportTimings = z.infer<typeof exportTimingsSchema>

export const resultSchema =z.discriminatedUnion('operation', [
  z.strictObject({ operation: z.literal('runtime'), pid: positiveInt, platform: z.string().min(1).max(32),
    architecture: z.string().min(1).max(32), nodeVersion: z.string().min(1).max(128) }),
  z.strictObject({ operation: z.literal('inspectToolchain'), ffmpeg: toolReport, ffprobe: toolReport }),
  z.strictObject({ operation: z.literal('probe'), metadata: mediaMetadataSchema, fingerprint: mediaFingerprintSchema }),
  z.strictObject({ operation: z.literal('waveform'), range,
    peaks: z.array(z.number().min(0).max(1)).min(1).max(100000) }),
  z.strictObject({ operation: z.literal('thumbnails'), images: z.array(z.strictObject({
    requestedUs: microseconds, actualUs: microseconds, path: filePath, width: positiveInt, height: positiveInt,
  })).max(1000) }),
  z.strictObject({ operation: z.literal('extractAudio'), path: filePath, sourceStartUs: microseconds,
    durationUs: microseconds, sampleRate: positiveInt, channels: z.literal(1), sampleCount: microseconds }),
  z.strictObject({ operation: z.literal('detectSilence'), range, silences: z.array(range).max(100000), speechGating: z.string().min(1).max(128) }),
  z.strictObject({ operation: z.literal('proxy'), path: filePath, durationUs: microseconds }),
  z.strictObject({ operation: z.literal('inspectWhisper'), version: z.string().min(1).max(64), gpuBackend: z.string().min(1).max(64).nullable(),
    cpuFallbackVerified: z.literal(true), systemInfo: z.string().min(1).max(2048).nullable() }),
  z.strictObject({ operation: z.literal('whisperTranscribe'), language: languageCodeSchema.nullable(),
    languageSource: z.enum(['requested', 'detected', 'none']), backends: z.array(z.string().min(1).max(64)).max(16),
    threads: positiveInt.max(1024), speechGating: z.string().min(1).max(128),
    silences: z.array(range).max(100000), chunks: z.array(range).max(100000),
    segments: z.array(z.strictObject({ startUs: microseconds, endUs: microseconds, text: z.string().min(1).max(10000),
      timingAdjustment: segmentTimingAdjustmentSchema.optional() })).max(100000),
    dropped: z.strictObject({ empty: microseconds, outsideChunk: microseconds, zeroDuration: microseconds }) }),
  z.strictObject({ operation: z.literal('speechChunks'), speechGating: z.string().min(1).max(128), silences: z.array(range).max(100000),
    chunks: z.array(z.strictObject({ path: filePath, startUs: microseconds, endUs: microseconds })).max(100000) }),
  z.strictObject({ operation: z.literal('export'), path: filePath, durationUs: microseconds,
    frameCount: positiveInt, frameRate: rational, timings: exportTimingsSchema.optional() }),
])
export type MediaResult = z.infer<typeof resultSchema>
export type ResultFor<T extends MediaTask> = Extract<MediaResult, { operation: T['operation'] }>

export const errorSchema = z.strictObject({
  code: z.enum(['INVALID_MESSAGE', 'UNSUPPORTED_OPERATION', 'TOOL_NOT_CONFIGURED', 'SPAWN_FAILED',
    'TOOL_FAILED', 'OUTPUT_LIMIT', 'WORKER_EXITED', 'TIMEOUT', 'CANCELLED', 'INTERNAL_ERROR', 'BUSY']),
  message: z.string().min(1).max(2048), retryable: z.boolean(),
  exitCode: z.number().int().nullable().optional(), signal: z.string().max(32).nullable().optional(),
  diagnostic: z.string().max(8192).optional(),
})
export type StructuredError = z.infer<typeof errorSchema>
const progressValue = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('indeterminate'), phase: z.enum(['running', 'inspecting-tools', 'probing', 'inspecting-whisper', 'detecting-speech', 'rendering', 'encoding']) }),
  z.strictObject({ kind: z.literal('measured'), phase: z.enum(['probing', 'waveform', 'thumbnails', 'audio', 'proxy', 'recognizing', 'export']),
    completed: microseconds, total: positiveInt, unit: z.enum(['sourceUs', 'items', 'frames']) })
    .refine((p) => p.completed <= p.total, 'Progress exceeds total'),
])
export const progressSchema = z.strictObject({ ...envelope, type: z.literal('progress'), operation: operationSchema, progress: progressValue })
export type ProgressMessage = z.infer<typeof progressSchema>
export const serverMessageSchema = z.discriminatedUnion('type', [
  progressSchema,
  z.strictObject({ ...envelope, type: z.literal('result'), result: resultSchema }),
  z.strictObject({ ...envelope, type: z.literal('error'), operation: operationSchema, error: errorSchema }),
  z.strictObject({ ...envelope, type: z.literal('cancelled'), operation: operationSchema }),
  z.strictObject({ version: z.literal(PROTOCOL_VERSION), type: z.literal('fatal'), error: errorSchema }),
])
export type ServerMessage = z.infer<typeof serverMessageSchema>
export const toolchainSchema = z.strictObject({ ffmpegPath: filePath, ffprobePath: filePath, whisperCliPath: filePath.optional(),
  exportHost: z.strictObject({ executable: filePath, scriptPath: filePath, args: z.array(z.string().max(256)).max(8).optional() }).optional() })
export type Toolchain = z.infer<typeof toolchainSchema>

export class MediaWorkerError extends Error {
  constructor(readonly detail: StructuredError) { super(detail.message); this.name = 'MediaWorkerError' }
}
export function failure(code: StructuredError['code'], message: string, extra: Partial<StructuredError> = {}) {
  return new MediaWorkerError(errorSchema.parse({ code, message, retryable: false, ...extra }))
}
