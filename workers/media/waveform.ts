import { mkdtemp, open, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { WAVEFORM_EXTRACTION_VERSION } from '../../src/core/waveform'
import { runExecutableCapture } from './process'
import { failure, type MediaResult, type MediaTask, type ProgressMessage } from './protocol'

export { WAVEFORM_EXTRACTION_VERSION }
const MAX_SAMPLE_RATE = 8_000
const SAMPLES_PER_PEAK = 32
const FLOAT_BYTES = 4
const READ_BYTES = 64 * 1024
const MAX_PROGRESS_OUTPUT_BYTES = 4 * 1024 * 1024

type WaveformTask = Extract<MediaTask, { operation: 'waveform' }>
type Progress = (value: ProgressMessage['progress']) => void
type ToolRunner = typeof runExecutableCapture

export function sourceTimeArgument(timeUs: number): string {
  const seconds = Math.floor(timeUs / 1_000_000)
  return `${seconds}.${String(timeUs % 1_000_000).padStart(6, '0')}`
}

/** Keeps decoded PCM bounded while retaining multiple samples for every returned peak. */
export function waveformSampleRate(durationUs: number, maxPeaks: number): number {
  const targetSamples = BigInt(maxPeaks) * BigInt(SAMPLES_PER_PEAK)
  const rate = Number((targetSamples * 1_000_000n) / BigInt(durationUs))
  return Math.max(1, Math.min(MAX_SAMPLE_RATE, rate))
}

/** Exact, non-accumulating source-time edges for a uniform waveform result. */
export function waveformBucketEdges(range: { startUs: number; endUs: number }, peakCount: number): number[] {
  if (!Number.isSafeInteger(peakCount) || peakCount < 1) throw new Error('Peak count must be a positive safe integer')
  const start = BigInt(range.startUs)
  const duration = BigInt(range.endUs - range.startUs)
  return Array.from({ length: peakCount + 1 }, (_, index) => Number(start + (BigInt(index) * duration) / BigInt(peakCount)))
}

export function reduceWaveformSamples(samples: ArrayLike<number>, maxPeaks: number): number[] {
  if (!Number.isSafeInteger(maxPeaks) || maxPeaks < 1) throw new Error('Maximum peak count must be positive')
  if (samples.length === 0) return []
  const peakCount = Math.min(maxPeaks, samples.length)
  const peaks = new Float32Array(peakCount)
  for (let index = 0; index < samples.length; index += 1) {
    const value = Number(samples[index])
    if (!Number.isFinite(value)) continue
    const bucket = Math.min(peakCount - 1, Math.floor(index * peakCount / samples.length))
    peaks[bucket] = Math.max(peaks[bucket], Math.min(1, Math.abs(value)))
  }
  return Array.from(peaks)
}

async function reducePcmFile(filePath: string, sampleCount: number, maxPeaks: number, signal: AbortSignal): Promise<number[]> {
  const peakCount = Math.min(maxPeaks, sampleCount)
  const peaks = new Float32Array(peakCount)
  const handle = await open(filePath, 'r')
  const buffer = Buffer.allocUnsafe(READ_BYTES)
  let sampleIndex = 0
  let position = 0
  try {
    while (sampleIndex < sampleCount) {
      if (signal.aborted) throw failure('CANCELLED', 'Operation cancelled')
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position)
      if (bytesRead === 0) break
      if (bytesRead % FLOAT_BYTES !== 0) throw failure('TOOL_FAILED', 'Waveform PCM output was truncated')
      for (let offset = 0; offset < bytesRead; offset += FLOAT_BYTES) {
        const value = buffer.readFloatLE(offset)
        if (Number.isFinite(value)) {
          const bucket = Math.min(peakCount - 1, Math.floor(sampleIndex * peakCount / sampleCount))
          peaks[bucket] = Math.max(peaks[bucket], Math.min(1, Math.abs(value)))
        }
        sampleIndex += 1
      }
      position += bytesRead
    }
  } finally { await handle.close() }
  if (sampleIndex !== sampleCount) throw failure('TOOL_FAILED', 'Waveform PCM output changed while it was being read')
  return Array.from(peaks)
}

type MeasuredPhase = Extract<ProgressMessage['progress'], { kind: 'measured' }>['phase']

/** Real FFmpeg `-progress pipe:1` `out_time_us` observer, throttled and bounded to the requested duration. */
export function progressObserver(totalUs: number, progress: Progress, phase: MeasuredPhase = 'waveform') {
  let text = ''
  let lastReported = -1
  const report = (completed: number) => {
    const bounded = Math.max(0, Math.min(totalUs, completed))
    if (bounded === lastReported) return
    const threshold = Math.max(100_000, Math.floor(totalUs / 100))
    if (bounded !== totalUs && bounded - lastReported < threshold) return
    lastReported = bounded
    progress({ kind: 'measured', phase, completed: bounded, total: totalUs, unit: 'sourceUs' })
  }
  return {
    push(chunk: Buffer) {
      text += chunk.toString('utf8')
      if (text.length > 8192) throw failure('OUTPUT_LIMIT', 'FFmpeg progress line exceeded its limit')
      let newline = text.indexOf('\n')
      while (newline >= 0) {
        const line = text.slice(0, newline).trim()
        text = text.slice(newline + 1)
        if (line.startsWith('out_time_us=')) {
          const value = Number(line.slice('out_time_us='.length))
          if (Number.isSafeInteger(value) && value >= 0) report(value)
        }
        newline = text.indexOf('\n')
      }
    },
    finish() { report(totalUs) },
  }
}

export async function extractWaveform(ffmpegPath: string, task: WaveformTask, signal: AbortSignal, progress: Progress,
  dependencies: { runTool?: ToolRunner; temporaryRoot?: string } = {}): Promise<Extract<MediaResult, { operation: 'waveform' }>> {
  const durationUs = task.range.endUs - task.range.startUs
  const sampleRate = waveformSampleRate(durationUs, task.maxPeaks)
  const expectedMaximumSamples = task.maxPeaks * SAMPLES_PER_PEAK + sampleRate + 1
  const maximumBytes = expectedMaximumSamples * FLOAT_BYTES
  const directory = await mkdtemp(path.join(dependencies.temporaryRoot ?? tmpdir(), 'caption-studio-waveform-'))
  const outputPath = path.join(directory, 'decoded.f32le')
  const observer = progressObserver(durationUs, progress)
  try {
    await (dependencies.runTool ?? runExecutableCapture)(ffmpegPath, [
      '-v', 'error', '-nostdin', '-stats_period', '1',
      '-ss', sourceTimeArgument(task.range.startUs), '-i', task.inputPath,
      '-t', sourceTimeArgument(durationUs), '-map', '0:a:0', '-vn', '-sn', '-dn',
      '-ac', '1', '-ar', String(sampleRate), '-c:a', 'pcm_f32le', '-f', 'f32le',
      '-fs', String(maximumBytes + FLOAT_BYTES), '-progress', 'pipe:1', outputPath,
    ], signal, MAX_PROGRESS_OUTPUT_BYTES, { onStdout: (chunk) => observer.push(chunk) })
    if (signal.aborted) throw failure('CANCELLED', 'Operation cancelled')
    let bytes: number
    try { bytes = (await stat(outputPath)).size }
    catch { throw failure('TOOL_FAILED', 'FFmpeg did not produce waveform PCM output') }
    if (bytes === 0) throw failure('TOOL_FAILED', 'The selected media range produced no audio samples')
    if (bytes % FLOAT_BYTES !== 0) throw failure('TOOL_FAILED', 'Waveform PCM output was truncated')
    if (bytes > maximumBytes) throw failure('OUTPUT_LIMIT', 'Decoded waveform data exceeded its bounded size')
    const peaks = await reducePcmFile(outputPath, bytes / FLOAT_BYTES, task.maxPeaks, signal)
    observer.finish()
    return { operation: 'waveform', range: task.range, peaks }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
