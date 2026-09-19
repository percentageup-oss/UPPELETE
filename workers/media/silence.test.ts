import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { detectSilence } from './silence'
import type { runExecutableCapture } from './process'
import { failure, type MediaTask, type ProgressMessage } from './protocol'
import { pcm16MonoWavHeader } from './wav'

let directory: string
beforeEach(async () => { directory = await mkdtemp(path.join(tmpdir(), 'caption-silence-test-')) })
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

const SAMPLE_RATE = 16000

/** loud(4800) → silent(6400) → loud(4800): one clean 1-second clip at a nice sample-boundary. */
function toneSilenceTone(): Buffer {
  const samples = new Int16Array(16000)
  for (let i = 0; i < 4800; i++) samples[i] = 10000
  for (let i = 4800; i < 11200; i++) samples[i] = 0
  for (let i = 11200; i < 16000; i++) samples[i] = 10000
  const pcm = Buffer.alloc(samples.length * 2)
  for (let i = 0; i < samples.length; i++) pcm.writeInt16LE(samples[i], i * 2)
  return Buffer.concat([pcm16MonoWavHeader(samples.length, SAMPLE_RATE), pcm])
}

const task = (inputPath = '/media/clip.mp4'): Extract<MediaTask, { operation: 'detectSilence' }> => ({
  operation: 'detectSilence', inputPath,
  range: { startUs: 5_000_000, endUs: 6_000_000 },
  thresholdDbfs: -40, minSilenceMs: 300,
})

describe('detectSilence', () => {
  it('finds a middle silence and offsets it into the requested range', async () => {
    const progress: ProgressMessage['progress'][] = []
    const runTool = (async (_executable, args) => {
      await writeFile(args[args.length - 1], toneSilenceTone())
      return { stdout: '', stderr: '' }
    }) as typeof runExecutableCapture
    const result = await detectSilence('/tools/ffmpeg', task(), new AbortController().signal, (value) => progress.push(value), { runTool, temporaryRoot: directory })
    expect(result).toEqual({
      operation: 'detectSilence',
      range: { startUs: 5_000_000, endUs: 6_000_000 },
      silences: [{ startUs: 5_300_000, endUs: 5_700_000 }],
      speechGating: expect.stringContaining('pcm16-rms20ms'),
    })
    expect(progress).toContainEqual({ kind: 'indeterminate', phase: 'detecting-speech' })
  })

  it('reports no silence when the whole range is loud', async () => {
    const runTool = (async (_executable, args) => {
      const samples = new Int16Array(16000).fill(10000)
      const pcm = Buffer.alloc(samples.length * 2)
      for (let i = 0; i < samples.length; i++) pcm.writeInt16LE(samples[i], i * 2)
      await writeFile(args[args.length - 1], Buffer.concat([pcm16MonoWavHeader(samples.length, SAMPLE_RATE), pcm]))
      return { stdout: '', stderr: '' }
    }) as typeof runExecutableCapture
    const result = await detectSilence('/tools/ffmpeg', task(), new AbortController().signal, () => {}, { runTool, temporaryRoot: directory })
    expect(result.silences).toEqual([])
  })

  it('reports media without an audio stream as an actionable failure', async () => {
    const noAudio = (async () => { throw failure('TOOL_FAILED', 'Local media tool failed', { exitCode: 1, diagnostic: "Stream map '0:a:0' matches no streams." }) }) as typeof runExecutableCapture
    await expect(detectSilence('/tools/ffmpeg', task(), new AbortController().signal, () => {}, { runTool: noAudio, temporaryRoot: directory }))
      .rejects.toMatchObject({ detail: { code: 'TOOL_FAILED', message: 'This media has no audio stream to check for silence' } })
  })
})
