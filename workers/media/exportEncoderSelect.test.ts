import { beforeEach, describe, expect, it } from 'vitest'
import { resetVideoEncoderCacheForTests, selectVideoEncoder } from './exportEncoderSelect'

const LIST = ' V....D h264_nvenc  NVIDIA NVENC\n V....D h264_mf  MF\n V..... png  PNG\n'
const signal = new AbortController().signal
function runner(failing: string[]) {
  const calls: string[][] = []
  const run = async (_exe: string, args: readonly string[]) => {
    calls.push([...args])
    if (args.includes('-encoders')) return LIST
    if (failing.some((name) => args.includes(name))) throw new Error('no device')
    return ''
  }
  return { run: run as never, calls }
}

describe('selectVideoEncoder', () => {
  beforeEach(resetVideoEncoderCacheForTests)
  it('is VideoToolbox on macOS with no probing', async () => {
    const { run, calls } = runner([])
    expect(await selectVideoEncoder('/f', signal, run, 'darwin', {})).toMatchObject({ encoder: 'h264_videotoolbox' })
    expect(calls).toEqual([])
  })
  it('prefers NVENC when its test encode works', async () => {
    expect(await selectVideoEncoder('/f', signal, runner([]).run, 'win32', {})).toMatchObject({ encoder: 'h264_nvenc' })
  })
  it('falls back to Media Foundation when NVENC listing is present but the encode fails', async () => {
    expect(await selectVideoEncoder('/f', signal, runner(['h264_nvenc']).run, 'win32', {})).toMatchObject({ encoder: 'h264_mf', tried: ['h264_nvenc'] })
  })
  it('reports when nothing works, and honors the override', async () => {
    expect(await selectVideoEncoder('/f', signal, runner(['h264_nvenc', 'h264_mf']).run, 'win32', {})).toHaveProperty('reason')
    resetVideoEncoderCacheForTests()
    expect(await selectVideoEncoder('/f', signal, runner([]).run, 'win32', { CAPTION_STUDIO_EXPORT_ENCODER: 'h264_mf' })).toMatchObject({ encoder: 'h264_mf' })
    expect(await selectVideoEncoder('/f', signal, runner([]).run, 'win32', { CAPTION_STUDIO_EXPORT_ENCODER: 'bogus' })).toHaveProperty('reason')
  })
})
