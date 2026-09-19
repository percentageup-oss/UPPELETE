import { z } from 'zod'
import type { SegmentTimingAdjustment } from './transcription'
export { WHISPER_LANGUAGES } from './whisperLanguages'

/**
 * Pure parsers for the whisper.cpp `whisper-cli` executable (T3), verified against upstream release 1.9.4.
 * Everything here reads what the real tool reports — its JSON transcript, its `--version` line, its backend
 * initialization and progress log lines — and fails closed rather than guessing when that output changes.
 */

export const WHISPER_CPP_ENGINE_ID = 'whisper.cpp'
/** The upstream release this integration was built and verified against; see docs/DEPENDENCIES.md. */
export const WHISPER_CPP_VERIFIED_VERSION = '1.9.4'
export const WHISPER_SAMPLE_RATE = 16_000

export class WhisperOutputError extends Error {
  constructor(message: string) { super(message); this.name = 'WhisperOutputError' }
}

export function parseWhisperVersion(output: string): string | null {
  return /^whisper\.cpp version: ([0-9A-Za-z.+-]{1,64})\s*$/m.exec(output)?.[1] ?? null
}

export type WhisperBackendReport = { kind: 'gpu'; name: string } | { kind: 'cpu' } | { kind: 'unreported' }

/** Reads whisper.cpp's own `whisper_backend_init_gpu` log lines; a device is never inferred from the platform. */
export function parseWhisperBackend(stderr: string): WhisperBackendReport {
  let report: WhisperBackendReport = { kind: 'unreported' }
  for (const rawLine of stderr.split('\n')) {
    const line = rawLine.trim()
    const using = /^whisper_backend_init_gpu: using (\S{1,64}) backend$/.exec(line)
    if (using) report = { kind: 'gpu', name: using[1] }
    else if (line === 'whisper_backend_init_gpu: no GPU found') report = { kind: 'cpu' }
    // A GPU that was selected but failed to initialize is dropped by whisper.cpp, which then runs on CPU.
    else if (/^whisper_backend_init_gpu: failed to initialize \S{1,64} backend$/.test(line)) report = { kind: 'cpu' }
  }
  return report
}

/**
 * Maps ggml backend device names to contract devices. `MTL0` was observed on macOS arm64; the CUDA/Vulkan
 * names follow ggml's backend naming and are unverified on real hardware in this project.
 */
export function deviceForBackendName(name: string): 'metal' | 'cuda' | 'vulkan' | null {
  if (/^MTL\d+$/.test(name)) return 'metal'
  if (/^CUDA\d+$/.test(name)) return 'cuda'
  if (/^Vulkan\d+$/.test(name)) return 'vulkan'
  return null
}

const PROGRESS_LINE = /^whisper_print_progress_callback: progress =\s*(\d{1,3})%$/

/** Percent reported by `-pp` for the current whisper_full call, or null for any other line. */
export function parseWhisperProgressLine(line: string): number | null {
  const match = PROGRESS_LINE.exec(line.trim())
  if (!match) return null
  const value = Number(match[1])
  return value <= 100 ? value : null
}

/** Splits streamed text into lines. Over-long partial lines are truncated; they are never progress lines. */
export function createLineReader(onLine: (line: string) => void, maxLineLength = 8192) {
  let pending = ''
  return {
    push(text: string) {
      pending += text
      let newline = pending.indexOf('\n')
      while (newline >= 0) {
        onLine(pending.slice(0, newline))
        pending = pending.slice(newline + 1)
        newline = pending.indexOf('\n')
      }
      if (pending.length > maxLineLength) pending = pending.slice(-maxLineLength)
    },
    finish() {
      if (pending) onLine(pending)
      pending = ''
    },
  }
}

/**
 * whisper-cli 1.9.4 escapes only `"` and `\` in JSON strings (`escape_double_quotes_and_backslashes`), so a
 * raw control character in recognized text would make the file invalid JSON. This re-escapes exactly those
 * raw characters inside string literals — the decoded value is what the writer intended — and changes nothing
 * else. Structural problems still fail `JSON.parse`.
 */
export function escapeRawControlCharacters(json: string): string {
  let output = ''
  let copiedUpTo = 0
  let inString = false
  let escaped = false
  for (let index = 0; index < json.length; index += 1) {
    const code = json.charCodeAt(index)
    if (!inString) {
      if (code === 0x22) inString = true
      continue
    }
    if (escaped) { escaped = false; continue }
    if (code === 0x5c) { escaped = true; continue }
    if (code === 0x22) { inString = false; continue }
    if (code < 0x20) {
      output += `${json.slice(copiedUpTo, index)}\\u${code.toString(16).padStart(4, '0')}`
      copiedUpTo = index + 1
    }
  }
  if (inString) throw new WhisperOutputError('whisper.cpp JSON output ends inside a string')
  return output + json.slice(copiedUpTo)
}

const offsetMs = z.number().int().nonnegative().max(Math.floor(Number.MAX_SAFE_INTEGER / 1000))
const whisperJsonSchema = z.object({
  result: z.object({ language: z.string().min(1).max(16) }),
  transcription: z.array(z.object({
    offsets: z.object({ from: offsetMs, to: offsetMs }),
    text: z.string().max(10000),
  })).max(100000),
})

export type WhisperJsonSegment = { fromMs: number; toMs: number; text: string }

/** Parses a `-oj` transcript: integer millisecond `offsets` relative to the input file, plus the result language. */
export function parseWhisperJson(bytes: Uint8Array): { language: string; segments: WhisperJsonSegment[] } {
  let text: string
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  catch { throw new WhisperOutputError('whisper.cpp JSON output is not valid UTF-8') }
  let value: unknown
  try { value = JSON.parse(escapeRawControlCharacters(text)) }
  catch (error) {
    if (error instanceof WhisperOutputError) throw error
    throw new WhisperOutputError('whisper.cpp JSON output could not be parsed')
  }
  const parsed = whisperJsonSchema.safeParse(value)
  if (!parsed.success) throw new WhisperOutputError(`whisper.cpp JSON output has an unexpected shape: ${parsed.error.message.slice(0, 1024)}`)
  return {
    language: parsed.data.result.language,
    segments: parsed.data.transcription.map((segment) => ({ fromMs: segment.offsets.from, toMs: segment.offsets.to, text: segment.text })),
  }
}

export type ChunkSegment = { startUs: number; endUs: number; text: string; timingAdjustment?: SegmentTimingAdjustment }
export type DroppedSegmentCounts = { empty: number; outsideChunk: number; zeroDuration: number }

/**
 * Converts one chunk file's millisecond offsets to microseconds relative to the whole extracted audio
 * (`chunk.startUs + offset`). Text is only trimmed of the surrounding whitespace whisper emits. Real whisper.cpp
 * output was observed ending past the audio it was given; such an end is clamped to the chunk and marked, a
 * zero-length segment is extended to the next segment or chunk end and marked, and an overlap with the previous
 * segment moves the start and is marked. Every marked segment is surfaced for review. Text starting entirely
 * beyond the chunk has no audio to describe and is dropped and counted, as is empty text.
 */
export function normalizeChunkSegments(chunk: { startUs: number; endUs: number }, segments: readonly WhisperJsonSegment[]): { segments: ChunkSegment[]; dropped: DroppedSegmentCounts } {
  const durationUs = chunk.endUs - chunk.startUs
  if (!Number.isSafeInteger(chunk.startUs) || !Number.isSafeInteger(chunk.endUs) || durationUs <= 0) throw new Error('Chunk must be a positive integer microsecond range')
  const dropped: DroppedSegmentCounts = { empty: 0, outsideChunk: 0, zeroDuration: 0 }
  const relative = segments.map((segment) => ({ startUs: segment.fromMs * 1000, endUs: segment.toMs * 1000, text: segment.text.trim() }))
  const output: ChunkSegment[] = []
  let previousEndUs = 0
  for (const [index, segment] of relative.entries()) {
    if (!segment.text) { dropped.empty += 1; continue }
    let startUs = segment.startUs
    let endUs = segment.endUs
    let adjustment: SegmentTimingAdjustment | undefined
    if (startUs >= durationUs) { dropped.outsideChunk += 1; continue }
    if (startUs < previousEndUs) { startUs = previousEndUs; adjustment = 'start-moved-after-overlap' }
    if (endUs > durationUs) { endUs = durationUs; adjustment = 'end-clamped-to-chunk' }
    if (endUs <= startUs) {
      const next = relative.slice(index + 1).find((candidate) => candidate.text && candidate.startUs > startUs)
      endUs = Math.min(next ? next.startUs : durationUs, durationUs)
      adjustment = 'zero-duration-extended'
      if (endUs <= startUs) { dropped.zeroDuration += 1; continue }
    }
    previousEndUs = endUs
    output.push({ startUs: chunk.startUs + startUs, endUs: chunk.startUs + endUs, text: segment.text, ...(adjustment ? { timingAdjustment: adjustment } : {}) })
  }
  return { segments: output, dropped }
}
