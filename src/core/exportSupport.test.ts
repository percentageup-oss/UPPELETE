import { describe, expect, it } from 'vitest'
import { exportSupportFromConfiguration } from './exportSupport'

const PINNED = 'ffmpeg version 9.0.1 Copyright (c) 2000-2026 the FFmpeg developers\n'
  + 'built with Apple clang version 21.0.0\n'
  + 'configuration: --disable-gpl --disable-version3 --disable-nonfree --disable-autodetect --disable-network --disable-doc --disable-debug --disable-ffplay --enable-videotoolbox --enable-zlib --enable-libvpx --enable-libopus\n'

describe('exportSupportFromConfiguration', () => {
  it('supports the exact pinned macOS profile', () => {
    expect(exportSupportFromConfiguration(PINNED, 'darwin')).toEqual({ supported: true, reason: null })
  })
  it('never treats a non-mac platform as supported without an encoder list', () => {
    expect(exportSupportFromConfiguration(PINNED, 'win32').supported).toBe(false)
  })
  it('supports a Windows build (any license, >= 7) that lists NVENC or Media Foundation', () => {
    const gplWin = 'ffmpeg version 8.0-full_build-www.gyan.dev Copyright (c) 2000-2025\nconfiguration: --enable-gpl --enable-version3 --enable-nvenc\n'
    const nvenc = ` V....D h264_nvenc           NVIDIA NVENC H.264 encoder\n V..... png                 PNG image\n`
    const mf = ` V....D h264_mf              H264 via MediaFoundation\n V..... png                 PNG image\n`
    expect(exportSupportFromConfiguration(gplWin, 'win32', nvenc)).toEqual({ supported: true, reason: null })
    expect(exportSupportFromConfiguration(gplWin, 'win32', mf)).toEqual({ supported: true, reason: null })
  })
  it('rejects Windows builds without PNG, without a candidate encoder, or older than 7', () => {
    const win = 'ffmpeg version 8.0 Copyright\n'
    expect(exportSupportFromConfiguration(win, 'win32', ' V....D h264_nvenc   NVENC\n').reason).toMatch(/PNG/)
    expect(exportSupportFromConfiguration(win, 'win32', ' V..... png  PNG\n V....D libx264  x264\n').reason).toMatch(/H\.264 hardware encoder/)
    expect(exportSupportFromConfiguration('ffmpeg version 6.1.1 Copyright\n', 'win32', ' V....D h264_nvenc  N\n V..... png  P\n').supported).toBe(false)
  })
  it('does not offer VideoToolbox on Windows or NVENC on macOS candidates', () => {
    expect(exportSupportFromConfiguration('ffmpeg version 8.0\n', 'win32', ' V....D h264_videotoolbox  V\n V..... png  P\n').supported).toBe(false)
  })
  it('rejects a build missing the required flags', () => {
    const noZlib = PINNED.replace(' --enable-zlib', '')
    expect(exportSupportFromConfiguration(noZlib, 'darwin').supported).toBe(false)
    const noVideotoolbox = PINNED.replace(' --enable-videotoolbox', '')
    expect(exportSupportFromConfiguration(noVideotoolbox, 'darwin').supported).toBe(false)
  })
  it('rejects a GPL/nonfree build even if it happens to report the required flags too', () => {
    const gpl = PINNED.replace('--disable-gpl', '--enable-gpl').replace('--disable-nonfree', '--enable-nonfree')
    expect(exportSupportFromConfiguration(gpl, 'darwin').supported).toBe(false)
  })
  it('rejects a mismatched FFmpeg version', () => {
    const other = PINNED.replace('9.0.1', '7.1.0')
    expect(exportSupportFromConfiguration(other, 'darwin').supported).toBe(false)
  })
})
