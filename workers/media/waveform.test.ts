import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { failure } from './protocol'
import {
  extractWaveform,
  reduceWaveformSamples,
  sourceTimeArgument,
  waveformBucketEdges,
  waveformSampleRate,
} from './waveform'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))) })

describe('waveform peak reduction and source timing', () => {
  it('reduces deterministic signed samples to bounded normalized absolute peaks', () => {
    const peaks = reduceWaveformSamples([-.2, .4, -.9, .1, 1.4, -.7, 0, .25], 4)
    expect(peaks).toHaveLength(4)
    expect(peaks[0]).toBeCloseTo(.4)
    expect(peaks[1]).toBeCloseTo(.9)
    expect(peaks[2]).toBe(1)
    expect(peaks[3]).toBeCloseTo(.25)
    expect(reduceWaveformSamples([.1, -.2], 10)).toHaveLength(2)
    expect(reduceWaveformSamples([], 10)).toEqual([])
  })

  it('maps non-divisible buckets to exact source-time edges without accumulated rounding', () => {
    expect(waveformBucketEdges({ startUs: 1_200_001, endUs: 3_123_456 }, 4))
      .toEqual([1_200_001, 1_680_864, 2_161_728, 2_642_592, 3_123_456])
    const edges = waveformBucketEdges({ startUs: 8_000_000_000_001, endUs: 8_000_001_923_456 }, 7)
    expect(edges[0]).toBe(8_000_000_000_001)
    expect(edges.at(-1)).toBe(8_000_001_923_456)
    expect(edges.every((edge, index) => index === 0 || edge >= edges[index - 1])).toBe(true)
  })

  it('formats exact FFmpeg times and chooses a bounded adaptive decode rate', () => {
    expect(sourceTimeArgument(1_200_001)).toBe('1.200001')
    expect(sourceTimeArgument(0)).toBe('0.000000')
    expect(waveformSampleRate(2_000_000, 4_096)).toBe(8_000)
    expect(waveformSampleRate(3_600_000_000, 4_096)).toBe(36)
  })
})

describe('waveform extraction lifecycle', () => {
  it('uses a literal input path, reports measured progress, reduces real PCM bytes and removes its temporary directory', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'waveform test root-'))
    directories.push(root)
    const progress: unknown[] = []
    const inputPath = path.join(root, 'മലയാളം & $(literal).mp4')
    const result = await extractWaveform('/tools/ffmpeg', {
      operation: 'waveform', inputPath, range: { startUs: 1_200_001, endUs: 3_200_001 }, maxPeaks: 2,
    }, new AbortController().signal, (value) => progress.push(value), {
      temporaryRoot: root,
      runTool: async (_executable, args, _signal, _maxBytes, observer) => {
        expect(args[args.indexOf('-i') + 1]).toBe(inputPath)
        expect(args[args.indexOf('-ss') + 1]).toBe('1.200001')
        expect(args[args.indexOf('-t') + 1]).toBe('2.000000')
        const pcm = Buffer.alloc(16)
        ;[-.25, .75, -.5, 1.25].forEach((value, index) => pcm.writeFloatLE(value, index * 4))
        await writeFile(args.at(-1)!, pcm, { flag: 'wx' })
        observer?.onStdout?.(Buffer.from('out_time_us=1000000\nprogress=continue\nout_time_us=2000000\nprogress=end\n'))
        return { stdout: '', stderr: '' }
      },
    })
    expect(result.range).toEqual({ startUs: 1_200_001, endUs: 3_200_001 })
    expect(result.peaks[0]).toBeCloseTo(.75)
    expect(result.peaks[1]).toBe(1)
    expect(progress).toContainEqual({ kind: 'measured', phase: 'waveform', completed: 2_000_000, total: 2_000_000, unit: 'sourceUs' })
    expect(await readdir(root)).toEqual([])
  })

  it('cleans only its job directory after cancellation', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'waveform cancel root-'))
    directories.push(root)
    const unrelated = path.join(root, 'keep.txt')
    await writeFile(unrelated, 'keep')
    const controller = new AbortController()
    const result = extractWaveform('/tools/ffmpeg', {
      operation: 'waveform', inputPath: path.join(root, 'input.mp4'), range: { startUs: 0, endUs: 1_000_000 }, maxPeaks: 100,
    }, controller.signal, () => {}, {
      temporaryRoot: root,
      runTool: async () => {
        controller.abort()
        throw failure('CANCELLED', 'Operation cancelled')
      },
    })
    await expect(result).rejects.toMatchObject({ detail: { code: 'CANCELLED' } })
    expect(await readdir(root)).toEqual(['keep.txt'])
  })
})
