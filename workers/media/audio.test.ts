import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { extractAudio, extractAudioArguments } from './audio'
import type { runExecutableCapture } from './process'
import { failure, type MediaTask, type ProgressMessage } from './protocol'
import { pcm16MonoWavHeader } from './wav'

let directory: string
beforeEach(async () => { directory = await mkdtemp(path.join(tmpdir(), 'caption-audio-test മലയാളം ')) })
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

const task = (outputPath: string): Extract<MediaTask, { operation: 'extractAudio' }> => ({
  operation: 'extractAudio', inputPath: '/Media/വീഡിയോ clip $(not-a-command).mp4',
  range: { startUs: 3_600_000_001, endUs: 3_601_500_001 }, outputPath, sampleRate: 16000, channels: 1,
})

describe('audio extraction', () => {
  it('uses a fixed argument array with exact source times, silence-padding resampling and no overwrite', () => {
    expect(extractAudioArguments(task('/tmp/job/audio.wav'))).toEqual([
      '-v', 'error', '-nostdin', '-n', '-stats_period', '1',
      '-ss', '3600.000001', '-i', '/Media/വീഡിയോ clip $(not-a-command).mp4',
      '-t', '1.500000', '-map', '0:a:0', '-vn', '-sn', '-dn',
      '-af', 'aresample=16000:async=1:first_pts=0',
      '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-bitexact', '-f', 'wav',
      '-fs', '145536', '-progress', 'pipe:1', '/tmp/job/audio.wav',
    ])
  })

  // The tool runner is a test double that writes a WAV; production runs the configured FFmpeg executable.
  it('derives duration from the real sample count, bounded by the requested range, and forwards measured FFmpeg progress', async () => {
    const outputPath = path.join(directory, 'audio.wav')
    const progress: ProgressMessage['progress'][] = []
    const runTool = (async (_executable, args, _signal, _maxBytes, observer) => {
      observer?.onStdout?.(Buffer.from('out_time_us=750000\nprogress=continue\nout_time_us=1500000\nprogress=end\n'))
      await writeFile(args[args.length - 1], Buffer.concat([pcm16MonoWavHeader(24001, 16000), Buffer.alloc(48002)]))
      return { stdout: '', stderr: '' }
    }) as typeof runExecutableCapture
    const result = await extractAudio('/tools/ffmpeg', task(outputPath), new AbortController().signal, (value) => progress.push(value), { runTool })
    // 24,001 samples end at 1,500,062 µs; the last sample starts inside the 1,500,000 µs range, which bounds the window.
    expect(result).toEqual({ operation: 'extractAudio', path: outputPath, sourceStartUs: 3_600_000_001, durationUs: 1_500_000, sampleRate: 16000, channels: 1, sampleCount: 24001 })
    expect(progress).toEqual([
      { kind: 'measured', phase: 'audio', completed: 750_000, total: 1_500_000, unit: 'sourceUs' },
      { kind: 'measured', phase: 'audio', completed: 1_500_000, total: 1_500_000, unit: 'sourceUs' },
    ])
  })

  it('reports media without an audio stream and empty output as actionable failures', async () => {
    const noAudio = (async () => { throw failure('TOOL_FAILED', 'Local media tool failed', { exitCode: 1, diagnostic: "Stream map '0:a:0' matches no streams." }) }) as typeof runExecutableCapture
    await expect(extractAudio('/tools/ffmpeg', task(path.join(directory, 'a.wav')), new AbortController().signal, () => {}, { runTool: noAudio }))
      .rejects.toMatchObject({ detail: { code: 'TOOL_FAILED', message: 'This media has no audio stream to transcribe' } })
    const empty = (async (_executable, args) => { await writeFile(args[args.length - 1], pcm16MonoWavHeader(0, 16000)); return { stdout: '', stderr: '' } }) as typeof runExecutableCapture
    await expect(extractAudio('/tools/ffmpeg', task(path.join(directory, 'b.wav')), new AbortController().signal, () => {}, { runTool: empty }))
      .rejects.toMatchObject({ detail: { code: 'TOOL_FAILED', message: 'The selected media range contains no decodable audio samples' } })
  })
})
