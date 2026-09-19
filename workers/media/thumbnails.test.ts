import { describe, expect, it } from 'vitest'
import { failure } from './protocol'
import { extractThumbnails, parseShowinfo } from './thumbnails'

const showinfoLine = (pts: string, width: number, height: number) =>
  `[Parsed_showinfo_1 @ 0x600000abc123] n:   0 pts:    123 pts_time:${pts}       pos:      0 fmt:yuv420p sar:1/1 s:${width}x${height} i:P iskey:1 type:I checksum:0 plane_checksum:[0 0 0]\n`

describe('showinfo parsing', () => {
  it('extracts the actual decoded frame timestamp and post-scale dimensions FFmpeg reported', () => {
    expect(parseShowinfo(showinfoLine('1.234567', 160, 90))).toEqual({ ptsUs: 1_234_567, width: 160, height: 90 })
  })

  it('returns null instead of fabricating a timestamp when the expected fields are missing', () => {
    expect(parseShowinfo('no showinfo line here')).toBeNull()
    expect(parseShowinfo('pts_time:1.0 without a reported frame size')).toBeNull()
  })
})

describe('thumbnail extraction lifecycle', () => {
  it('requests one decoded frame per timestamp with exact seek/scale arguments and reports real decoded timestamps in order', async () => {
    const progress: unknown[] = []
    const calls: string[][] = []
    const result = await extractThumbnails('/tools/ffmpeg', {
      operation: 'thumbnails', inputPath: '/media/മലയാളം.mp4', timestampsUs: [1_200_001, 3_400_000], width: 160, outputDirectory: '/tmp/job',
    }, new AbortController().signal, (value) => progress.push(value), {
      runTool: async (_executable, args) => {
        calls.push(args as string[])
        const index = calls.length - 1
        return { stdout: '', stderr: showinfoLine(index === 0 ? '1.200050' : '3.400200', 160, 90) }
      },
    })
    expect(calls[0][calls[0].indexOf('-i') + 1]).toBe('/media/മലയാളം.mp4')
    expect(calls[0][calls[0].indexOf('-ss') + 1]).toBe('1.200001')
    expect(calls[0][calls[0].indexOf('-vf') + 1]).toBe('scale=160:-2,showinfo')
    expect(calls[0].at(-1)).toBe('/tmp/job/thumb-0.jpg')
    expect(calls[1][calls[1].indexOf('-ss') + 1]).toBe('3.400000')
    expect(calls[1].at(-1)).toBe('/tmp/job/thumb-1.jpg')
    expect(result.images).toEqual([
      { requestedUs: 1_200_001, actualUs: 1_200_050, path: '/tmp/job/thumb-0.jpg', width: 160, height: 90 },
      { requestedUs: 3_400_000, actualUs: 3_400_200, path: '/tmp/job/thumb-1.jpg', width: 160, height: 90 },
    ])
    expect(progress).toEqual([
      { kind: 'measured', phase: 'thumbnails', completed: 1, total: 2, unit: 'items' },
      { kind: 'measured', phase: 'thumbnails', completed: 2, total: 2, unit: 'items' },
    ])
  })

  it('cancels before starting the next frame rather than finishing the batch', async () => {
    const controller = new AbortController()
    let calls = 0
    const result = extractThumbnails('/tools/ffmpeg', {
      operation: 'thumbnails', inputPath: '/media/clip.mp4', timestampsUs: [0, 1_000_000, 2_000_000], width: 160, outputDirectory: '/tmp/job',
    }, controller.signal, () => {}, {
      runTool: async () => {
        calls += 1
        if (calls === 1) return { stdout: '', stderr: showinfoLine('0.000000', 160, 90) }
        controller.abort()
        throw failure('CANCELLED', 'Operation cancelled')
      },
    })
    await expect(result).rejects.toMatchObject({ detail: { code: 'CANCELLED' } })
    expect(calls).toBe(2)
  })

  it('fails closed when FFmpeg produces no parseable showinfo output, instead of copying the requested time', async () => {
    const result = extractThumbnails('/tools/ffmpeg', {
      operation: 'thumbnails', inputPath: '/media/clip.mp4', timestampsUs: [500_000], width: 160, outputDirectory: '/tmp/job',
    }, new AbortController().signal, () => {}, { runTool: async () => ({ stdout: '', stderr: 'nothing useful here' }) })
    await expect(result).rejects.toMatchObject({ detail: { code: 'TOOL_FAILED' } })
  })
})
