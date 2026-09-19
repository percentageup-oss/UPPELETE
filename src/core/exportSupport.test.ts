import { describe, expect, it } from 'vitest'
import { exportSupportFromConfiguration } from './exportSupport'

const PINNED = 'ffmpeg version 9.0.1 Copyright (c) 2000-2026 the FFmpeg developers\n'
  + 'built with Apple clang version 21.0.0\n'
  + 'configuration: --disable-gpl --disable-version3 --disable-nonfree --disable-autodetect --disable-network --disable-doc --disable-debug --disable-ffplay --enable-videotoolbox --enable-zlib --enable-libvpx --enable-libopus\n'

describe('exportSupportFromConfiguration', () => {
  it('supports the exact pinned macOS profile', () => {
    expect(exportSupportFromConfiguration(PINNED, 'darwin')).toEqual({ supported: true, reason: null })
  })
  it('rejects every other platform with an honest reason, even with the right build', () => {
    for (const platform of ['win32', 'linux'] as const) {
      const result = exportSupportFromConfiguration(PINNED, platform)
      expect(result.supported).toBe(false)
      expect(result.reason).toMatch(/macOS/)
    }
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
