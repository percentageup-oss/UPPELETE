import { createHash } from 'node:crypto'
import { open } from 'node:fs/promises'
import { mediaMetadataSchema, type MediaFingerprint, type MediaMetadata, type MediaStream, type Rational } from '../../src/core/media'
import { failure, MediaWorkerError } from './protocol'
import { runExecutableCapture } from './process'

const SAMPLE_CHUNK_BYTES = 256 * 1024
const MAX_PROBE_OUTPUT_BYTES = 2 * 1024 * 1024

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null
}

export function parseRational(value: unknown): Rational | null {
  if (typeof value !== 'string') return null
  const match = value.match(/^(\d+)\/(\d+)$/)
  if (!match) return null
  const numerator = Number(match[1])
  const denominator = Number(match[2])
  if (!Number.isSafeInteger(numerator) || numerator <= 0 || !Number.isSafeInteger(denominator) || denominator <= 0) return null
  return { numerator, denominator }
}

/** Converts ffprobe's decimal seconds without a floating-point multiply. */
export function decimalSecondsToUs(value: unknown, allowNegative = false): number | null {
  if (typeof value !== 'string') return null
  const match = value.match(/^(-?)(\d+)(?:\.(\d+))?$/)
  if (!match || (match[1] && !allowNegative)) return null
  const whole = BigInt(match[2])
  const fractional = (match[3] ?? '').padEnd(7, '0')
  let micros = whole * 1_000_000n + BigInt(fractional.slice(0, 6) || '0')
  if (fractional[6] && fractional[6] >= '5') micros += 1n
  if (match[1]) micros = -micros
  const converted = Number(micros)
  return Number.isSafeInteger(converted) ? converted : null
}

function nullableString(value: unknown, max = 512): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : null
}

function nullablePositiveInteger(value: unknown): number | null {
  const number = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN
  return Number.isSafeInteger(number) && number > 0 ? number : null
}

function rotationOf(stream: JsonRecord): number | null {
  const sideData = Array.isArray(stream.side_data_list) ? stream.side_data_list : []
  for (const item of sideData) {
    const rotation = record(item)?.rotation
    const number = typeof rotation === 'number' ? rotation : typeof rotation === 'string' ? Number(rotation) : NaN
    if (Number.isFinite(number) && number >= -360 && number <= 360) return number
  }
  const rotation = record(stream.tags)?.rotate
  const number = typeof rotation === 'number' ? rotation : typeof rotation === 'string' ? Number(rotation) : NaN
  return Number.isFinite(number) && number >= -360 && number <= 360 ? number : null
}

function parseStream(value: unknown): MediaStream | null {
  const stream = record(value)
  if (!stream || !Number.isInteger(stream.index) || (stream.index as number) < 0) return null
  const codecName = nullableString(stream.codec_name, 256) ?? 'unknown'
  const codecType = stream.codec_type
  const kind = codecType === 'audio' || codecType === 'video' ? codecType : 'other'
  const width = nullablePositiveInteger(stream.width)
  const height = nullablePositiveInteger(stream.height)
  return {
    index: stream.index as number,
    kind,
    codec: {
      name: codecName,
      longName: nullableString(stream.codec_long_name),
      profile: nullableString(stream.profile, 256),
      level: typeof stream.level === 'number' && Number.isInteger(stream.level) ? stream.level : null,
      tag: nullableString(stream.codec_tag_string, 64),
    },
    timeBase: parseRational(stream.time_base),
    startUs: decimalSecondsToUs(stream.start_time, true),
    durationUs: decimalSecondsToUs(stream.duration),
    width,
    height,
    sampleAspectRatio: kind === 'video' ? parseRational(typeof stream.sample_aspect_ratio === 'string' ? stream.sample_aspect_ratio.replace(':', '/') : null) : null,
    averageFrameRate: kind === 'video' ? parseRational(stream.avg_frame_rate) : null,
    nominalFrameRate: kind === 'video' ? parseRational(stream.r_frame_rate) : null,
    rotationDegrees: kind === 'video' ? rotationOf(stream) : null,
    sampleRate: kind === 'audio' ? nullablePositiveInteger(stream.sample_rate) : null,
    channels: kind === 'audio' ? nullablePositiveInteger(stream.channels) : null,
  }
}

export function parseProbeJson(text: string): MediaMetadata {
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { throw failure('TOOL_FAILED', 'ffprobe returned malformed JSON') }
  const root = record(parsed)
  if (!root) throw failure('TOOL_FAILED', 'ffprobe returned an invalid metadata document')
  const streams = (Array.isArray(root.streams) ? root.streams : []).map(parseStream).filter((stream): stream is MediaStream => stream !== null)
  const video = streams.find((stream) => stream.kind === 'video')
  const metadata = {
    durationUs: decimalSecondsToUs(record(root.format)?.duration),
    width: video?.width ?? null,
    height: video?.height ?? null,
    rotationDegrees: video?.rotationDegrees ?? null,
    frameRate: video?.averageFrameRate ?? null,
    nominalFrameRate: video?.nominalFrameRate ?? null,
    streams,
  }
  return mediaMetadataSchema.parse(metadata)
}

export async function fingerprintMedia(inputPath: string, signal: AbortSignal): Promise<MediaFingerprint> {
  let handle
  try {
    handle = await open(inputPath, 'r')
    const before = await handle.stat({ bigint: true })
    if (!before.isFile()) throw failure('TOOL_FAILED', 'Selected media is not a regular file')
    if (before.size > BigInt(Number.MAX_SAFE_INTEGER)) throw failure('TOOL_FAILED', 'Selected media is too large to fingerprint safely')
    const sizeBytes = Number(before.size)
    const chunkLength = sizeBytes <= 3 * SAMPLE_CHUNK_BYTES ? sizeBytes : SAMPLE_CHUNK_BYTES
    const offsets = sizeBytes <= 3 * SAMPLE_CHUNK_BYTES
      ? [0]
      : [0, Math.floor((sizeBytes - chunkLength) / 2), sizeBytes - chunkLength]
    const hash = createHash('sha256')
    hash.update('caption-studio:sha256-sampled-v1\0')
    hash.update(String(sizeBytes))
    let sampledBytes = 0
    for (const offset of offsets) {
      if (signal.aborted) throw failure('CANCELLED', 'Operation cancelled')
      const buffer = Buffer.alloc(chunkLength)
      const { bytesRead } = await handle.read(buffer, 0, chunkLength, offset)
      hash.update(`\0${offset}:${bytesRead}\0`)
      hash.update(buffer.subarray(0, bytesRead))
      sampledBytes += bytesRead
    }
    const after = await handle.stat({ bigint: true })
    if (after.size !== before.size || after.mtimeNs !== before.mtimeNs) throw failure('TOOL_FAILED', 'Media changed while it was being fingerprinted', { retryable: true })
    return { algorithm: 'sha256-sampled-v1', value: hash.digest('hex'), sizeBytes, sampledBytes }
  } catch (error) {
    if (error instanceof MediaWorkerError) throw error
    const detail = error instanceof Error ? error.message : 'Unknown file error'
    throw failure('TOOL_FAILED', 'Could not read the selected media file', { diagnostic: detail.slice(0, 8192) })
  } finally {
    await handle?.close().catch(() => {})
  }
}

export async function probeMedia(ffprobePath: string, inputPath: string, signal: AbortSignal) {
  const entries = [
    'format=duration',
    'stream=index,codec_type,codec_name,codec_long_name,profile,level,codec_tag_string,time_base,start_time,duration,width,height,avg_frame_rate,r_frame_rate,sample_rate,channels',
    'stream_tags=rotate',
    'stream_side_data=rotation',
  ].join(':')
  const [output, fingerprint] = await Promise.all([
    runExecutableCapture(ffprobePath, ['-v', 'error', '-show_entries', entries, '-of', 'json', inputPath], signal, MAX_PROBE_OUTPUT_BYTES),
    fingerprintMedia(inputPath, signal),
  ])
  try {
    return { operation: 'probe' as const, metadata: parseProbeJson(output.stdout), fingerprint }
  } catch (error) {
    if (error instanceof MediaWorkerError && output.stderr) {
      throw failure(error.detail.code, error.message, { ...error.detail, diagnostic: output.stderr.slice(-8192) })
    }
    throw error
  }
}
