import { describe, expect, it } from 'vitest'
import { proxySupportFromConfiguration } from './proxy'

const withBoth = 'configuration: --disable-gpl --disable-version3 --disable-nonfree --disable-autodetect --disable-network --enable-libvpx --enable-libopus'
const withoutVideo = 'configuration: --disable-gpl --disable-version3 --disable-nonfree --disable-autodetect --disable-network --enable-libopus'
const withoutAudio = 'configuration: --disable-gpl --disable-version3 --disable-nonfree --disable-autodetect --disable-network --enable-libvpx'
const withNeither = 'configuration: --disable-gpl --disable-version3 --disable-nonfree --disable-autodetect --disable-network'

describe('proxy support from the real configured tool', () => {
  it('reports functional only when both required encoder libraries are actually configured', () => {
    expect(proxySupportFromConfiguration(withBoth)).toEqual({ supported: true, reason: null })
  })

  it('names the specific missing encoder libraries rather than a generic failure', () => {
    expect(proxySupportFromConfiguration(withoutVideo)).toMatchObject({ supported: false, reason: expect.stringContaining('VP8/VP9') })
    expect(proxySupportFromConfiguration(withoutAudio)).toMatchObject({ supported: false, reason: expect.stringContaining('Opus') })
    const both = proxySupportFromConfiguration(withNeither)
    expect(both.supported).toBe(false)
    expect(both.reason).toContain('VP8/VP9')
    expect(both.reason).toContain('Opus')
  })
})
