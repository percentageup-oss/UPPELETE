import { mkdtemp, open, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { LongSilenceDetector, samplesToUs, SPEECH_GATING_VERSION } from '../../src/core/speechGating'
import { extractAudioArguments } from './audio'
import { runExecutableCapture } from './process'
import { failure, MediaWorkerError, type MediaResult, type MediaTask, type ProgressMessage } from './protocol'
import { readWavInfo, WavFormatError } from './wav'
import { forEachSampleBlock } from './whisper'
import { progressObserver } from './waveform'

type DetectSilenceTask = Extract<MediaTask, { operation: 'detectSilence' }>
type Progress = (value: ProgressMessage['progress']) => void
const MAX_PROGRESS_OUTPUT_BYTES = 4 * 1024 * 1024
// Mono/16 kHz is ample for an RMS energy threshold (speech content lives well under 8 kHz) and
// matches the rate `speechGating.ts`'s window/threshold defaults were tuned against.
const SAMPLE_RATE = 16_000 as const

/**
 * DaVinci-Resolve-style "remove silence": detect long quiet spans below a dB threshold over the
 * whole media (or a range of it), for `App.tsx` to turn into kept segments
 * (`src/core/silenceRemoval.ts`). Reuses the exact detector transcription already relies on
 * (`LongSilenceDetector`) so the two features never disagree about what counts as silence, and
 * extracts audio with the same FFmpeg profile `extractAudio` uses (`extractAudioArguments`) rather
 * than inventing a second one.
 */
export async function detectSilence(ffmpegPath: string, task: DetectSilenceTask, signal: AbortSignal, progress: Progress,
  dependencies: { runTool?: typeof runExecutableCapture; temporaryRoot?: string } = {}): Promise<Extract<MediaResult, { operation: 'detectSilence' }>> {
  const runTool = dependencies.runTool ?? runExecutableCapture
  const durationUs = task.range.endUs - task.range.startUs
  const directory = await mkdtemp(path.join(dependencies.temporaryRoot ?? tmpdir(), 'caption-studio-silence-'))
  const audioPath = path.join(directory, 'audio.wav')
  const observer = progressObserver(durationUs, progress, 'audio')
  try {
    const extractTask = { operation: 'extractAudio' as const, inputPath: task.inputPath, range: task.range, outputPath: audioPath, sampleRate: SAMPLE_RATE, channels: 1 as const }
    try {
      await runTool(ffmpegPath, extractAudioArguments(extractTask), signal, MAX_PROGRESS_OUTPUT_BYTES, { onStdout: (chunk) => observer.push(chunk) })
    } catch (error) {
      if (error instanceof MediaWorkerError && error.detail.code === 'TOOL_FAILED' && /matches no streams/.test(error.detail.diagnostic ?? '')) {
        throw failure('TOOL_FAILED', 'This media has no audio stream to check for silence', { exitCode: error.detail.exitCode, diagnostic: error.detail.diagnostic })
      }
      throw error
    }
    if (signal.aborted) throw failure('CANCELLED', 'Operation cancelled')
    observer.finish()
    let info
    try { info = await readWavInfo(audioPath) }
    catch (error) { throw failure('TOOL_FAILED', error instanceof WavFormatError ? `Extracted audio is not usable: ${error.message}` : 'FFmpeg did not produce extracted audio') }
    if (info.channels !== 1 || info.sampleRate !== SAMPLE_RATE) throw failure('TOOL_FAILED', 'Extracted audio does not have the expected mono sample rate')
    progress({ kind: 'indeterminate', phase: 'detecting-speech' })
    const handle = await open(audioPath, 'r')
    try {
      const detector = new LongSilenceDetector({ sampleRate: info.sampleRate, thresholdDbfs: task.thresholdDbfs, minSilenceMs: task.minSilenceMs })
      await forEachSampleBlock(handle, info, signal, (samples) => detector.push(samples))
      const { silences } = detector.finish()
      const ranges = silences.map((span) => ({
        // Offset into the requested range and clamp: the final window is judged on a partial
        // sample count, so its edge could otherwise round past the caller's own range.
        startUs: Math.min(task.range.startUs + samplesToUs(span.startSample, info.sampleRate), task.range.endUs),
        endUs: Math.min(task.range.startUs + samplesToUs(span.endSample, info.sampleRate), task.range.endUs),
      })).filter((range) => range.endUs > range.startUs)
      return { operation: 'detectSilence', range: task.range, silences: ranges, speechGating: SPEECH_GATING_VERSION }
    } finally {
      await handle.close()
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
