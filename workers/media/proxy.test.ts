import { describe, expect, it } from 'vitest'
import { failure } from './protocol'
import { createProxy } from './proxy'

describe('proxy conversion lifecycle', () => {
  it('uses literal paths, the bounded VP8/Opus encoder profile, reports measured progress and returns the measured duration', async () => {
    const progress: unknown[] = []
    const result = await createProxy('/tools/ffmpeg', {
      operation: 'proxy', inputPath: '/media/മലയാളം.mp4', outputPath: '/tmp/job/proxy.webm', durationUs: 2_000_000,
    }, new AbortController().signal, (value) => progress.push(value), {
      runTool: async (_executable, args, _signal, _maxBytes, observer) => {
        expect(args[args.indexOf('-i') + 1]).toBe('/media/മലയാളം.mp4')
        expect(args.at(-1)).toBe('/tmp/job/proxy.webm')
        expect(args).toContain('libvpx')
        expect(args).toContain('libopus')
        observer?.onStdout?.(Buffer.from('out_time_us=1000000\nprogress=continue\nout_time_us=1950000\nprogress=end\n'))
        return { stdout: '', stderr: '' }
      },
    })
    expect(result).toEqual({ operation: 'proxy', path: '/tmp/job/proxy.webm', durationUs: 2_000_000 })
    expect(progress).toContainEqual({ kind: 'measured', phase: 'proxy', completed: 1_000_000, total: 2_000_000, unit: 'sourceUs' })
    expect(progress.at(-1)).toEqual({ kind: 'measured', phase: 'proxy', completed: 2_000_000, total: 2_000_000, unit: 'sourceUs' })
  })

  it('rejects with CANCELLED when the tool run is aborted', async () => {
    const result = createProxy('/tools/ffmpeg', {
      operation: 'proxy', inputPath: '/media/clip.mp4', outputPath: '/tmp/job/proxy.webm', durationUs: 1_000_000,
    }, new AbortController().signal, () => {}, {
      runTool: async () => { throw failure('CANCELLED', 'Operation cancelled') },
    })
    await expect(result).rejects.toMatchObject({ detail: { code: 'CANCELLED' } })
  })
})
