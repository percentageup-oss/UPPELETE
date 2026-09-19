import { describe, expect, it } from 'vitest'
import { inspectFileForBin, MAX_SUBTITLE_BYTES, type AssetInspectDeps } from './assetInspect'
import type { MediaCandidate } from './projectMedia'
import type { MediaMetadata } from '../src/core/media'

const videoMetadata: MediaMetadata = {
  durationUs: 2_000_000, width: 1920, height: 1080, rotationDegrees: 0, frameRate: null, nominalFrameRate: null,
  streams: [{
    index: 0, kind: 'video', codec: { name: 'h264', longName: null, profile: null, level: null, tag: null },
    timeBase: null, startUs: 0, durationUs: 2_000_000, width: 1920, height: 1080,
    averageFrameRate: null, nominalFrameRate: null, rotationDegrees: 0, sampleRate: null, channels: null,
  }],
}

function candidate(metadata: MediaMetadata | null): MediaCandidate {
  return {
    path: '/media/clip.mp4', url: 'media://local/clip.mp4',
    media: { name: 'clip.mp4', reference: { relativePath: null, absolutePath: '/media/clip.mp4' }, fingerprint: null, metadata },
    mismatches: [],
  }
}

describe('inspectFileForBin', () => {
  it('never probes a .srt, reading it as text instead', async () => {
    let inspected = false
    const deps: AssetInspectDeps = {
      inspect: async () => { inspected = true; throw new Error('should not be called') },
      readText: async () => ({ content: '1\n00:00:00,000 --> 00:00:01,000\nHi\n', sizeBytes: 40 }),
    }
    const result = await inspectFileForBin('/project/captions.srt', deps)
    expect(inspected).toBe(false)
    expect(result).toEqual({ ok: true, kind: 'subtitle', name: 'captions.srt', content: '1\n00:00:00,000 --> 00:00:01,000\nHi\n' })
  })

  it('refuses an oversize subtitle file', async () => {
    const deps: AssetInspectDeps = {
      inspect: async () => candidate(videoMetadata),
      readText: async () => ({ content: '', sizeBytes: MAX_SUBTITLE_BYTES + 1 }),
    }
    const result = await inspectFileForBin('/project/huge.srt', deps)
    expect(result).toEqual({ ok: false, name: 'huge.srt', message: 'huge.srt is too large to import as subtitles.' })
  })

  it('classifies a probed video file', async () => {
    const deps: AssetInspectDeps = { inspect: async () => candidate(videoMetadata), readText: async () => ({ content: '', sizeBytes: 0 }) }
    const result = await inspectFileForBin('/project/clip.mp4', deps)
    expect(result).toEqual({ ok: true, kind: 'video', media: candidate(videoMetadata).media, url: 'media://local/clip.mp4' })
  })

  it('refuses an unclassifiable file by name', async () => {
    const deps: AssetInspectDeps = { inspect: async () => candidate(null), readText: async () => ({ content: '', sizeBytes: 0 }) }
    const result = await inspectFileForBin('/project/mystery.bin', deps)
    expect(result).toEqual({ ok: false, name: 'mystery.bin', message: 'mystery.bin could not be recognized as a usable image, audio or video file.' })
  })

  it('surfaces a probe failure as a named refusal', async () => {
    const deps: AssetInspectDeps = { inspect: async () => { throw new Error('ffprobe exited with code 1') }, readText: async () => ({ content: '', sizeBytes: 0 }) }
    const result = await inspectFileForBin('/project/broken.mp4', deps)
    expect(result).toEqual({ ok: false, name: 'broken.mp4', message: 'ffprobe exited with code 1' })
  })
})
