import { describe, expect, it } from 'vitest'
import { encoderCandidates, encoderProbeArguments, listedVideoEncoders, videoEncoderArguments, videoEncoderPixelFormat } from './exportEncoder'

describe('exportEncoder', () => {
  it('orders candidates per platform', () => {
    expect(encoderCandidates('darwin')).toEqual(['h264_videotoolbox'])
    expect(encoderCandidates('win32')).toEqual(['h264_nvenc', 'h264_mf'])
  })
  it('keeps the VideoToolbox arguments byte-identical to the previous hardcoded block', () => {
    expect(videoEncoderArguments('h264_videotoolbox', '8M')).toEqual(['-c:v', 'h264_videotoolbox', '-allow_sw', '1', '-profile:v', 'high', '-b:v', '8M'])
  })
  it('builds exact NVENC and Media Foundation arguments', () => {
    expect(videoEncoderArguments('h264_nvenc', '8M')).toEqual(['-c:v', 'h264_nvenc', '-preset', 'p5', '-tune', 'hq', '-rc', 'vbr', '-profile:v', 'high', '-b:v', '8M', '-maxrate', '12M', '-bufsize', '16M'])
    expect(videoEncoderArguments('h264_nvenc', '5M').slice(-4)).toEqual(['-maxrate', '7.5M', '-bufsize', '10M'])
    expect(videoEncoderArguments('h264_mf', '5M')).toEqual(['-c:v', 'h264_mf', '-hw_encoding', '1', '-rate_control', 'cbr', '-b:v', '5M'])
  })
  it('lists only known encoders present in ffmpeg -encoders output', () => {
    const out = ' V....D h264_nvenc           NVIDIA NVENC H.264 encoder (codec h264)\n V....D hevc_nvenc  x\n V....D h264_mf   M\n'
    expect(listedVideoEncoders(out)).toEqual(['h264_nvenc', 'h264_mf'])
  })
  it('probes with a tiny null encode', () => {
    expect(encoderProbeArguments('h264_nvenc')).toContain('h264_nvenc')
    expect(encoderProbeArguments('h264_nvenc').slice(-2)).toEqual(['null', '-'])
  })
  it('feeds hardware Media Foundation NV12 and keeps yuv420p elsewhere', () => {
    expect(videoEncoderPixelFormat('h264_mf')).toBe('nv12')
    expect(videoEncoderPixelFormat('h264_videotoolbox')).toBe('yuv420p')
    expect(videoEncoderPixelFormat('h264_nvenc')).toBe('yuv420p')
  })
  it('probes with the same encoder flags and pixel format as a real export', () => {
    const probe = encoderProbeArguments('h264_mf').join(' ')
    expect(probe).toContain(videoEncoderArguments('h264_mf', '2M').join(' '))
    expect(probe).toContain('-pix_fmt nv12')
  })
})
