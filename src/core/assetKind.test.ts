import { describe, expect, it } from 'vitest'
import { classifyAsset, classifyMedia, isSubtitleFileName } from './assetKind'
import type { MediaMetadata, MediaStream } from './media'

const stream = (overrides: Partial<MediaStream>): MediaStream => ({
  index: 0,
  kind: 'video',
  codec: { name: 'h264', longName: null, profile: null, level: null, tag: null },
  timeBase: null,
  startUs: 0,
  durationUs: 2_000_000,
  width: 1920,
  height: 1080,
  averageFrameRate: null,
  nominalFrameRate: null,
  rotationDegrees: 0,
  sampleRate: null,
  channels: null,
  ...overrides,
})

const metadata = (streams: MediaStream[]): MediaMetadata => ({
  durationUs: 2_000_000, width: 1920, height: 1080, rotationDegrees: 0,
  frameRate: null, nominalFrameRate: null, streams,
})

describe('classifyMedia', () => {
  it('classifies a real video codec as video', () => {
    expect(classifyMedia(metadata([stream({ codec: { name: 'h264', longName: null, profile: null, level: null, tag: null } })]))).toBe('video')
  })

  it('classifies a single image-codec video stream with no audio as image', () => {
    expect(classifyMedia(metadata([stream({ codec: { name: 'png', longName: null, profile: null, level: null, tag: null } })]))).toBe('image')
  })

  it('classifies an audio stream with embedded cover art as audio', () => {
    expect(classifyMedia(metadata([
      stream({ kind: 'audio', codec: { name: 'mp3', longName: null, profile: null, level: null, tag: null } }),
      stream({ codec: { name: 'mjpeg', longName: null, profile: null, level: null, tag: null } }),
    ]))).toBe('audio')
  })

  it('refuses a file with no usable streams', () => {
    expect(classifyMedia(metadata([]))).toBeNull()
  })
})

describe('classifyAsset', () => {
  it('still refuses real video, unchanged from before classifyMedia existed', () => {
    expect(classifyAsset(metadata([stream({ codec: { name: 'h264', longName: null, profile: null, level: null, tag: null } })]))).toBeNull()
  })

  it('still classifies image and audio as before', () => {
    expect(classifyAsset(metadata([stream({ codec: { name: 'png', longName: null, profile: null, level: null, tag: null } })]))).toBe('image')
    expect(classifyAsset(metadata([stream({ kind: 'audio', codec: { name: 'mp3', longName: null, profile: null, level: null, tag: null } })]))).toBe('audio')
  })
})

describe('isSubtitleFileName', () => {
  it('recognizes .srt case-insensitively', () => {
    expect(isSubtitleFileName('captions.srt')).toBe(true)
    expect(isSubtitleFileName('captions.SRT')).toBe(true)
    expect(isSubtitleFileName('captions.vtt')).toBe(false)
    expect(isSubtitleFileName('captions')).toBe(false)
  })
})
