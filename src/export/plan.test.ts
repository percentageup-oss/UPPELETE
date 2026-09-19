import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseProbeJson } from '../../workers/media/probe'
import { buildExportManifest, exportBitrate, exportFrameCount, exportFrameCountFor, exportManifestSchema, exportOutputDurationUs, fittedFrameRate, frameRequestAt, frameSourceUs, normalizeManifest, planFromMedia, usDecimal, type ExportManifest } from './plan'
import { DEFAULT_CAPTION_STYLE } from '../captions/style'
import { activeWordIndex, wordDisplayCue } from '../captions/wordDisplay'
import type { CaptionProject, CaptionWord, Cue } from '../core/model'

const fixture = (name: string) => readFile(path.join(__dirname, '../../tests/fixtures', name), 'utf8')

describe('frameSourceUs', () => {
  it('matches the exact BigInt formula at 30000/1001 for indices 0, 1 and 10000, with no drift', () => {
    const rate = { numerator: 30000, denominator: 1001 }
    expect(frameSourceUs(0, 3_600_000_000, rate)).toBe(3_600_000_000)
    expect(frameSourceUs(1, 3_600_000_000, rate)).toBe(3_600_033_366)
    expect(frameSourceUs(10000, 3_600_000_000, rate)).toBe(3_933_666_666)
  })
  it('rejects a fractional or negative frame index', () => {
    const rate = { numerator: 30, denominator: 1 }
    expect(() => frameSourceUs(0.5, 0, rate)).toThrow()
    expect(() => frameSourceUs(-1, 0, rate)).toThrow()
  })
})

describe('exportFrameCount', () => {
  it('ceils at the range edges instead of truncating a partial final frame', () => {
    // 1,000,001 µs at 30/1 fps is 30.00003 frames — one more than a plain floor(duration*rate).
    expect(exportFrameCount({ width: 16, height: 16, frameRate: { numerator: 30, denominator: 1 },
      range: { startUs: 0, endUs: 1_000_001 } })).toBe(31)
    // An exact multiple needs no extra frame.
    expect(exportFrameCount({ width: 16, height: 16, frameRate: { numerator: 30, denominator: 1 },
      range: { startUs: 0, endUs: 1_000_000 } })).toBe(30)
  })
})

describe('exportOutputDurationUs', () => {
  const plan = { width: 16, height: 16, frameRate: { numerator: 30, denominator: 1 }, range: { startUs: 0, endUs: 1_000_000 } }
  it('is the planned range length with no manifest, or a manifest with no segments (the identity edit)', () => {
    expect(exportOutputDurationUs(plan)).toBe(1_000_000)
    expect(exportOutputDurationUs(plan, { version: 2, cues: [], style: DEFAULT_CAPTION_STYLE, overlays: [], blurRegions: [], audioClips: [] })).toBe(1_000_000)
  })
  it('sums the kept segments once cuts exist, regardless of the planned range length', () => {
    const segments = [{ startUs: 100_000, endUs: 300_000 }, { startUs: 600_000, endUs: 900_000 }]
    expect(exportOutputDurationUs(plan, { version: 2, cues: [], style: DEFAULT_CAPTION_STYLE, overlays: [], blurRegions: [], audioClips: [], segments })).toBe(500_000)
  })
})

describe('exportFrameCountFor', () => {
  it('matches exportFrameCount for the same duration and rate (exportFrameCount is a thin wrapper)', () => {
    expect(exportFrameCountFor(1_000_001, { numerator: 30, denominator: 1 })).toBe(31)
    expect(exportFrameCountFor(1_000_000, { numerator: 30, denominator: 1 }))
      .toBe(exportFrameCount({ width: 16, height: 16, frameRate: { numerator: 30, denominator: 1 }, range: { startUs: 0, endUs: 1_000_000 } }))
  })
})

describe('fittedFrameRate', () => {
  it('keeps an exact rational rate already inside the 1-60 fps band untouched', () => {
    expect(fittedFrameRate({ numerator: 30000, denominator: 1001 })).toEqual({ numerator: 30000, denominator: 1001 })
  })
  it('halves a rate above 60 fps, preserving exact rational equality rather than rounding', () => {
    expect(fittedFrameRate({ numerator: 120, denominator: 1 })).toEqual({ numerator: 120, denominator: 2 })
    expect(fittedFrameRate({ numerator: 240, denominator: 1 })).toEqual({ numerator: 240, denominator: 4 })
  })
  it('falls back to 30/1 for a rate that cannot be fitted into the band', () => {
    expect(fittedFrameRate({ numerator: 1, denominator: 100 })).toEqual({ numerator: 30, denominator: 1 })
  })
})

describe('exportBitrate', () => {
  it('is a deterministic function of pixel count', () => {
    expect(exportBitrate(1280, 720)).toBe('5M')
    expect(exportBitrate(1920, 1080)).toBe('8M')
    expect(exportBitrate(3840, 2160)).toBe('16M')
  })
})

describe('planFromMedia', () => {
  it('swaps output dimensions for a 90-degree-rotated source and keeps its exact rational rate', async () => {
    const metadata = parseProbeJson(await fixture('ffprobe-rotated.json'))
    const plan = planFromMedia(metadata)
    expect(plan.width).toBe(1080)
    expect(plan.height).toBe(1920)
    expect(plan.frameRate).toEqual({ numerator: 24000, denominator: 1001 })
  })
  it('prefers the nominal rational rate over the average for VFR media', async () => {
    const metadata = parseProbeJson(await fixture('ffprobe-vfr.json'))
    const plan = planFromMedia(metadata)
    expect(plan.frameRate).toEqual({ numerator: 30, denominator: 1 })
    expect(plan.width).toBe(1080)
    expect(plan.height).toBe(1920)
  })
  it('caps dimensions at 3840 on the longest side and keeps both sides even', () => {
    const plan = planFromMedia({ width: 7680, height: 4320, durationUs: 1_000_000, rotationDegrees: 0,
      frameRate: { numerator: 30, denominator: 1 }, nominalFrameRate: null, streams: [] })
    expect(Math.max(plan.width, plan.height)).toBe(3840)
    expect(plan.width % 2).toBe(0)
    expect(plan.height % 2).toBe(0)
  })
})

describe('frameRequestAt', () => {
  const cue: Cue = { id: 'c1', startUs: 1_000_000, endUs: 2_000_000, text: 'hi', timingSource: 'manual', needsReview: false, textSource: 'user', words: [] }
  const manifest: ExportManifest = { version: 1, cues: [cue], style: DEFAULT_CAPTION_STYLE }
  const plan = { width: 1080, height: 1920, frameRate: { numerator: 1, denominator: 1 }, range: { startUs: 0, endUs: 3_000_000 } }

  it('is inactive before, at-and-after start, and at the half-open end of the cue', () => {
    expect(frameRequestAt(manifest, plan, 0).active).toBe(false) // t=0, before the cue
    expect(frameRequestAt(manifest, plan, 1).active).toBe(true) // t=1_000_000, cue start (inclusive)
    expect(frameRequestAt(manifest, plan, 2).active).toBe(false) // t=2_000_000, cue end (exclusive)
  })
  it('gives an inactive frame a placeholder cue that is always already expired, so it is safe to reuse verbatim', () => {
    const gap = frameRequestAt(manifest, plan, 2) // t=2,000,000 µs: after the cue ends
    expect(gap.active).toBe(false)
    expect(gap.request.cue.endUs).toBeLessThanOrEqual(1)
    expect(gap.request.timestampUs).toBeGreaterThan(gap.request.cue.endUs)
  })
})

describe('frameRequestAt word display', () => {
  const words: CaptionWord[] = [
    { id: 'w0', text: 'one', textStart: 0, textEnd: 3, startUs: 1_000_000, endUs: 1_400_000, timingSource: 'model', needsReview: false },
    { id: 'w1', text: 'two', textStart: 4, textEnd: 7, startUs: 1_500_000, endUs: 1_900_000, timingSource: 'model', needsReview: false },
  ]
  const cue: Cue = { id: 'c1', startUs: 1_000_000, endUs: 2_000_000, text: 'one two', timingSource: 'model', needsReview: false, textSource: 'model', words }
  const plan = { width: 1080, height: 1920, frameRate: { numerator: 100, denominator: 1 }, range: { startUs: 1_000_000, endUs: 2_000_000 } }

  it('matches the preview’s word-display choice for every frame across the cue', () => {
    const manifest: ExportManifest = { version: 1, cues: [cue], style: DEFAULT_CAPTION_STYLE, display: 'word' }
    for (let index = 0; index < 100; index++) {
      const { request, active } = frameRequestAt(manifest, plan, index)
      expect(active).toBe(true)
      const timestampUs = 1_000_000 + index * 10_000
      const wordIndex = activeWordIndex(cue, timestampUs)!
      const expected = wordDisplayCue(cue, wordIndex)
      expect(request.cue.text).toBe(expected.text)
      expect(request.cue.startUs).toBe(expected.startUs)
      expect(request.cue.endUs).toBe(expected.endUs)
      expect(request.cue.words).toEqual(expected.words)
    }
  })

  it('leaves the full line unchanged when display is line or absent', () => {
    const lineManifest: ExportManifest = { version: 1, cues: [cue], style: DEFAULT_CAPTION_STYLE, display: 'line' }
    const absentManifest: ExportManifest = { version: 1, cues: [cue], style: DEFAULT_CAPTION_STYLE }
    for (const manifest of [lineManifest, absentManifest]) {
      const { request } = frameRequestAt(manifest, plan, 50)
      expect(request.cue.text).toBe('one two')
      expect(request.cue.words).toEqual(words)
    }
  })

  it('resolves a caption override into the export request without changing the project style', () => {
    const manifest: ExportManifest = { version: 1, cues: [{ ...cue, motionOverride: { motion: 'word-pop', motionSpeed: 2 } }], style: DEFAULT_CAPTION_STYLE }
    const { request } = frameRequestAt(manifest, plan, 50)
    expect(request.style.motion).toBe('word-pop')
    expect(request.style.motionSpeed).toBe(2)
    expect(manifest.style.motion).toBe('static-clean')
  })

  it('parses a manifest with estimated word timing in word display without an offset/schema error', () => {
    const estimated = words.map((word) => ({ ...word, timingSource: 'estimated' as const }))
    const manifest: ExportManifest = { version: 1, cues: [{ ...cue, words: estimated }], style: DEFAULT_CAPTION_STYLE, display: 'word' }
    expect(() => frameRequestAt(manifest, plan, 0)).not.toThrow()
  })
})

describe('usDecimal', () => {
  it('formats source microseconds as zero-padded FFmpeg decimal seconds', () => {
    expect(usDecimal(0)).toBe('0.000000')
    expect(usDecimal(1_500_007)).toBe('1.500007')
  })
})

describe('buildExportManifest', () => {
  const rect = { x: 100, y: 50, width: 320, height: 180 }
  const plan = { width: 1080, height: 1920, frameRate: { numerator: 30, denominator: 1 }, range: { startUs: 0, endUs: 10_000_000 } }
  const asset = (id: string, kind: 'image' | 'audio') => ({
    id, kind, name: `${id}.bin`, reference: { relativePath: null, absolutePath: `/assets/${id}.bin` }, fingerprint: null, metadata: null,
  })
  // The project's one video, exactly as long as the planned range — so a single clip over all of it is the identity edit.
  const video = {
    id: 'video', kind: 'video' as const, name: 'clip.mp4', reference: { relativePath: null, absolutePath: '/media/clip.mp4' }, fingerprint: null,
    metadata: { durationUs: 10_000_000, width: 1920, height: 1080, rotationDegrees: null, frameRate: null, nominalFrameRate: null, streams: [] },
  }
  const clip = (id: string, startUs: number, endUs: number) => ({ id, assetId: 'video', startUs, endUs })
  const project = (extra: Partial<CaptionProject> = {}): CaptionProject => ({
    schemaVersion: 4, id: 'p', title: 'P', cues: [], assets: [video], overlays: [], blurRegions: [], audioClips: [], clips: [],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...extra,
  })
  const url = (a: { reference: { absolutePath: string | null } }) => `media://local/${a.reference.absolutePath}`

  it('emits a v2 manifest with empty edit lists and no segments for an unedited project', () => {
    const manifest = buildExportManifest(project({ captionStyle: DEFAULT_CAPTION_STYLE }), plan, url)
    expect(manifest).toMatchObject({ version: 2, overlays: [], blurRegions: [], audioClips: [] })
    expect(manifest.segments).toBeUndefined()
  })

  it('maps the identity project — one clip over the whole video — to no segments, so its export is unchanged', () => {
    const manifest = buildExportManifest(project({ clips: [clip('c1', 0, 10_000_000)] }), plan, url)
    expect(manifest.segments).toBeUndefined()
  })

  it('carries kept clips through as segments in source time', () => {
    const manifest = buildExportManifest(project({ clips: [clip('c1', 0, 3_000_000), clip('c2', 5_000_000, 9_000_000)] }), plan, url)
    expect(manifest.segments).toEqual([{ startUs: 0, endUs: 3_000_000 }, { startUs: 5_000_000, endUs: 9_000_000 }])
  })

  it('resolves blur geometry to output pixels and its window to sequence time', () => {
    const manifest = buildExportManifest(project({
      clips: [clip('c1', 0, 2_000_000), clip('c2', 4_000_000, 9_000_000)],
      blurRegions: [{ id: 'b1', startUs: 5_000_000, endUs: 6_000_000, rect, radius: 12 }],
    }), plan, url)
    // 1080-wide output is 1:1 with composition units, so the rect and sigma pass through unscaled...
    expect(manifest.blurRegions[0]).toMatchObject({ id: 'b1', rect: { x: 100, y: 50, width: 320, height: 180 }, sigmaPx: 12 })
    // ...and the 2s removed range shifts the enable window earlier by exactly that much.
    expect(manifest.blurRegions[0].sequence).toEqual({ startUs: 3_000_000, endUs: 4_000_000 })
  })

  it('scales blur geometry for a smaller output', () => {
    const manifest = buildExportManifest(project({ blurRegions: [{ id: 'b1', startUs: 0, endUs: 1_000_000, rect, radius: 12 }] }),
      { ...plan, width: 540, height: 960 }, url)
    expect(manifest.blurRegions[0]).toMatchObject({ rect: { x: 50, y: 25, width: 160, height: 90 }, sigmaPx: 6 })
  })

  it('resolves overlay and sound-effect assets, dropping items whose asset is gone', () => {
    const manifest = buildExportManifest(project({
      assets: [asset('img-1', 'image'), asset('snd-1', 'audio')],
      overlays: [{ id: 'ov-1', startUs: 0, endUs: 1_000_000, assetId: 'img-1', rect, opacity: .5, fit: 'cover' }],
      audioClips: [{ id: 'clip-1', assetId: 'snd-1', atUs: 2_000_000, inPointUs: 250_000, durationUs: 1_500_000, gain: .8 }],
    }), plan, url)
    expect(manifest.overlays[0]).toMatchObject({ id: 'ov-1', assetUrl: 'media://local//assets/img-1.bin', opacity: .5, fit: 'cover' })
    expect(manifest.audioClips[0]).toMatchObject({ id: 'clip-1', path: '/assets/snd-1.bin', delayUs: 2_000_000, inPointUs: 250_000, durationUs: 1_500_000, gain: .8 })
  })

  it('round-trips through the wire schema, so what main writes is what the worker accepts', () => {
    const manifest = buildExportManifest(project({ clips: [clip('c1', 0, 9_000_000)] }), plan, url)
    expect(exportManifestSchema.parse(JSON.parse(JSON.stringify(manifest)))).toEqual(manifest)
  })

  it('accepts a v1 manifest unchanged and normalizes it to an edit-free v2', () => {
    const v1 = { version: 1 as const, cues: [], style: DEFAULT_CAPTION_STYLE }
    expect(exportManifestSchema.parse(v1)).toEqual(v1)
    expect(normalizeManifest(v1)).toEqual({ version: 2, cues: [], style: DEFAULT_CAPTION_STYLE, overlays: [], blurRegions: [], audioClips: [] })
  })
})
