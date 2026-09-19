import { samplesToUs } from '../../src/core/speechGating'
import { runExecutableCapture } from './process'
import { failure, MediaWorkerError, type MediaResult, type MediaTask, type ProgressMessage } from './protocol'
import { readWavInfo, WavFormatError } from './wav'
import { progressObserver, sourceTimeArgument } from './waveform'

type ExtractAudioTask = Extract<MediaTask, { operation: 'extractAudio' }>
type Progress = (value: ProgressMessage['progress']) => void
const MAX_PROGRESS_OUTPUT_BYTES = 4 * 1024 * 1024

/** The requested duration plus one second of samples and header room; FFmpeg's `-fs` stops runaway output. */
export function extractedAudioByteLimit(durationUs: number, sampleRate: number): number {
  return Number((BigInt(durationUs) * BigInt(sampleRate) * 2n) / 1_000_000n) + sampleRate * 2 + 65536
}

/**
 * Extraction profile `AUDIO_EXTRACTION_VERSION` (src/core/audioExtraction.ts). `aresample` with `first_pts=0`
 * pads silence when audio starts after the requested source time and `async=1` fills timestamp gaps, so a
 * sample's index is its exact offset from `range.startUs`. `-n` refuses to overwrite an existing file.
 */
export function extractAudioArguments(task: ExtractAudioTask): string[] {
  const durationUs = task.range.endUs - task.range.startUs
  return [
    '-v', 'error', '-nostdin', '-n', '-stats_period', '1',
    '-ss', sourceTimeArgument(task.range.startUs), '-i', task.inputPath,
    '-t', sourceTimeArgument(durationUs), '-map', '0:a:0', '-vn', '-sn', '-dn',
    '-af', `aresample=${task.sampleRate}:async=1:first_pts=0`,
    '-ac', '1', '-ar', String(task.sampleRate), '-c:a', 'pcm_s16le', '-bitexact', '-f', 'wav',
    '-fs', String(extractedAudioByteLimit(durationUs, task.sampleRate)), '-progress', 'pipe:1', task.outputPath,
  ]
}

export async function extractAudio(ffmpegPath: string, task: ExtractAudioTask, signal: AbortSignal, progress: Progress,
  dependencies: { runTool?: typeof runExecutableCapture } = {}): Promise<Extract<MediaResult, { operation: 'extractAudio' }>> {
  const durationUs = task.range.endUs - task.range.startUs
  const observer = progressObserver(durationUs, progress, 'audio')
  try {
    await (dependencies.runTool ?? runExecutableCapture)(ffmpegPath, extractAudioArguments(task), signal, MAX_PROGRESS_OUTPUT_BYTES,
      { onStdout: (chunk) => observer.push(chunk) })
  } catch (error) {
    if (error instanceof MediaWorkerError && error.detail.code === 'TOOL_FAILED' && /matches no streams/.test(error.detail.diagnostic ?? '')) {
      throw failure('TOOL_FAILED', 'This media has no audio stream to transcribe', { exitCode: error.detail.exitCode, diagnostic: error.detail.diagnostic })
    }
    throw error
  }
  if (signal.aborted) throw failure('CANCELLED', 'Operation cancelled')
  let info
  try { info = await readWavInfo(task.outputPath) }
  catch (error) { throw failure('TOOL_FAILED', error instanceof WavFormatError ? `Extracted audio is not usable: ${error.message}` : 'FFmpeg did not produce extracted audio') }
  if (info.channels !== 1 || info.sampleRate !== task.sampleRate) throw failure('TOOL_FAILED', 'Extracted audio does not have the requested mono sample rate')
  if (info.sampleCount === 0) throw failure('TOOL_FAILED', 'The selected media range contains no decodable audio samples')
  if (info.dataBytes > extractedAudioByteLimit(durationUs, task.sampleRate)) throw failure('OUTPUT_LIMIT', 'Extracted audio exceeded its bounded size')
  observer.finish()
  return {
    operation: 'extractAudio', path: task.outputPath, sourceStartUs: task.range.startUs,
    // The last kept sample starts inside the range but may end past it; never report audio beyond the requested range.
    durationUs: Math.min(samplesToUs(info.sampleCount, info.sampleRate), durationUs), sampleRate: info.sampleRate, channels: 1, sampleCount: info.sampleCount,
  }
}
