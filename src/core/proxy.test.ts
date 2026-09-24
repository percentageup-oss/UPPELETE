import { describe, expect, it } from 'vitest'
import { playbackUrlFor, proxySupportFromConfiguration, shouldRequestPlaybackProxy, type PlaybackProxyStatus } from './proxy'

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

const fingerprint = { algorithm: 'sha256-sampled-v1' as const, value: 'a'.repeat(64), sizeBytes: 1000, sampledBytes: 1000 }
const readyProxy: PlaybackProxyStatus = { fingerprint, state: 'ready', url: 'media://local/proxy.webm', reason: null }
const generatingProxy: PlaybackProxyStatus = { fingerprint, state: 'generating', url: null, reason: null }
const failedProxy: PlaybackProxyStatus = { fingerprint, state: 'failed', url: null, reason: 'boom' }

describe('shouldRequestPlaybackProxy', () => {
  it('never requests one when the mode is off, regardless of size', () => {
    expect(shouldRequestPlaybackProxy('off', { width: 3840, height: 2160 })).toBe(false)
  })
  it('always requests one when the mode is always, even for a small source', () => {
    expect(shouldRequestPlaybackProxy('always', { width: 640, height: 360 })).toBe(true)
  })
  it('under auto, requests one only once the short edge exceeds the threshold', () => {
    expect(shouldRequestPlaybackProxy('auto', { width: 1920, height: 1080 })).toBe(false)
    expect(shouldRequestPlaybackProxy('auto', { width: 3840, height: 2160 })).toBe(true)
    // Portrait: the short edge is width, not height.
    expect(shouldRequestPlaybackProxy('auto', { width: 1080, height: 1920 })).toBe(false)
    expect(shouldRequestPlaybackProxy('auto', { width: 2160, height: 3840 })).toBe(true)
  })
  it('never requests one when dimensions are not yet known', () => {
    expect(shouldRequestPlaybackProxy('always', { width: null, height: null })).toBe(false)
    expect(shouldRequestPlaybackProxy('always', null)).toBe(false)
  })
})

describe('playbackUrlFor', () => {
  const original = 'media://local/source.mp4'
  it('uses the original when the mode is off, even with a ready proxy', () => {
    expect(playbackUrlFor(original, readyProxy, 'off', null)).toBe(original)
  })
  it('uses the ready proxy under auto/always', () => {
    expect(playbackUrlFor(original, readyProxy, 'auto', null)).toBe(readyProxy.url)
    expect(playbackUrlFor(original, readyProxy, 'always', null)).toBe(readyProxy.url)
  })
  it('falls back to the original while a proxy is only queued, generating or has failed', () => {
    expect(playbackUrlFor(original, generatingProxy, 'auto', null)).toBe(original)
    expect(playbackUrlFor(original, failedProxy, 'auto', null)).toBe(original)
    expect(playbackUrlFor(original, undefined, 'auto', null)).toBe(original)
  })
  it('the viewer "original" override always wins, even with a ready proxy', () => {
    expect(playbackUrlFor(original, readyProxy, 'always', 'original')).toBe(original)
  })
  it('the viewer "proxy" override uses a ready proxy even when the mode is off', () => {
    expect(playbackUrlFor(original, readyProxy, 'off', 'proxy')).toBe(readyProxy.url)
  })
  it('the viewer "proxy" override still falls back to the original when none is ready', () => {
    expect(playbackUrlFor(original, generatingProxy, 'always', 'proxy')).toBe(original)
  })
})
