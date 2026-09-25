import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseProbeJson } from '../../workers/media/probe'
import {
  buildExportManifest, exportBitrate, exportFrameCount, exportFrameCountFor, exportManifestSchema, exportOutputDurationUs, fittedFrameRate, flatSequence, frameRequestAt,
  frameRequestAtSequence, frameSourceUs, normalizeManifest, planFromMedia, usDecimal, type ExportManifestV1, type ExportManifestV2, type ExportManifestV3, type ExportResolver,
} from './plan'
import { loadProject, projectSchemaV4 } from '../core/model'
import { exportArguments } from '../../workers/media/exportArguments'
import { DEFAULT_CAPTION_STYLE } from '../captions/style'
import { activeWordIndex, wordDisplayCue } from '../captions/wordDisplay'
import type { CaptionProject, CaptionWord, Cue } from '../core/model'
import type { Clip, Track } from '../core/edit'
import { defaultTextOverlay } from '../core/textCommands'
import { defaultShape } from '../core/shapeCommands'
import { frameRequestSchema } from './frameRequest'
import { CAPTION_TEMPLATES, titleTemplateChanges } from '../captions/templates'
import { textMotionAt } from '../captions/textMotion'
import { graphicsPasses } from '../core/graphicsPasses'

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
  const manifest: ExportManifestV1 = { version: 1, cues: [cue], style: DEFAULT_CAPTION_STYLE }
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
    const manifest: ExportManifestV1 = { version: 1, cues: [cue], style: DEFAULT_CAPTION_STYLE, display: 'word' }
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
    const lineManifest: ExportManifestV1 = { version: 1, cues: [cue], style: DEFAULT_CAPTION_STYLE, display: 'line' }
    const absentManifest: ExportManifestV1 = { version: 1, cues: [cue], style: DEFAULT_CAPTION_STYLE }
    for (const manifest of [lineManifest, absentManifest]) {
      const { request } = frameRequestAt(manifest, plan, 50)
      expect(request.cue.text).toBe('one two')
      expect(request.cue.words).toEqual(words)
    }
  })

  it('resolves a caption override into the export request without changing the project style', () => {
    const manifest: ExportManifestV1 = { version: 1, cues: [{ ...cue, motionOverride: { motion: 'word-pop', motionSpeed: 2 } }], style: DEFAULT_CAPTION_STYLE }
    const { request } = frameRequestAt(manifest, plan, 50)
    expect(request.style.motion).toBe('word-pop')
    expect(request.style.motionSpeed).toBe(2)
    expect(manifest.style.motion).toBe('static-clean')
  })

  it('resolves a caption placement override into the export request without changing the project style', () => {
    const manifest: ExportManifestV1 = { version: 1, cues: [{ ...cue, placementOverride: { horizontal: .1, rotation: 20 } }], style: DEFAULT_CAPTION_STYLE }
    const { request } = frameRequestAt(manifest, plan, 50)
    expect(request.style.appearance.horizontal).toBe(.1)
    expect(request.style.appearance.rotation).toBe(20)
    // Fields the override left alone still inherit the project style.
    expect(request.style.appearance.vertical).toBe(DEFAULT_CAPTION_STYLE.appearance.vertical)
    expect(request.style.appearance.fontSize).toBe(DEFAULT_CAPTION_STYLE.appearance.fontSize)
    expect(manifest.style.appearance.horizontal).toBe(DEFAULT_CAPTION_STYLE.appearance.horizontal)
  })

  it('uses the project style unchanged when a cue has no placement override', () => {
    const manifest: ExportManifestV1 = { version: 1, cues: [cue], style: DEFAULT_CAPTION_STYLE }
    const { request } = frameRequestAt(manifest, plan, 50)
    expect(request.style.appearance).toEqual(DEFAULT_CAPTION_STYLE.appearance)
  })

  it('parses a manifest with estimated word timing in word display without an offset/schema error', () => {
    const estimated = words.map((word) => ({ ...word, timingSource: 'estimated' as const }))
    const manifest: ExportManifestV1 = { version: 1, cues: [{ ...cue, words: estimated }], style: DEFAULT_CAPTION_STYLE, display: 'word' }
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
  const US = 1_000_000
  const rect = { x: 100, y: 50, width: 320, height: 180 }
  const format = { width: 1920, height: 1080, frameRate: { numerator: 30, denominator: 1 } }
  const meta = (durationUs: number | null) => ({ durationUs, width: 1920, height: 1080, rotationDegrees: 0, frameRate: { numerator: 30, denominator: 1 }, nominalFrameRate: null, streams: [] })
  const asset = (id: string, kind: 'video' | 'image' | 'audio', durationUs: number | null = 10 * US) => ({
    id, kind, name: `${id}.bin`, reference: { relativePath: null, absolutePath: `/m/${id}` }, fingerprint: null, metadata: kind === 'image' ? null : meta(durationUs),
  })
  const track = (id: string, kind: Track['kind'], extra: Partial<Track> = {}): Track => ({ id, kind, name: '', muted: false, hidden: false, locked: false, ...extra })
  const video = (id: string, timelineStartUs: number, sourceStartUs: number, sourceEndUs: number, extra: Partial<Clip> = {}): Clip =>
    ({ kind: 'video', id, trackId: 'V1', assetId: 'x', timelineStartUs, sourceStartUs, sourceEndUs, opacity: 1, fit: 'contain', gain: 1, ...extra } as Clip)
  const image = (id: string, trackId: string, timelineStartUs: number, lengthUs: number, extra: Partial<Clip> = {}): Clip =>
    ({ kind: 'image', id, trackId, assetId: 'img', timelineStartUs, sourceStartUs: 0, sourceEndUs: lengthUs, opacity: 1, fit: 'contain', ...extra } as Clip)
  const audio = (id: string, timelineStartUs: number, sourceStartUs: number, sourceEndUs: number, trackId = 'A1'): Clip =>
    ({ kind: 'audio', id, trackId, assetId: 'snd', timelineStartUs, sourceStartUs, sourceEndUs, gain: 0.8 })
  const cue = (id: string, mediaAssetId: string): Cue => ({ id, mediaAssetId, startUs: 0, endUs: US, text: id, timingSource: 'manual', needsReview: false, textSource: 'user', words: [] })
  const project = (extra: Partial<CaptionProject> = {}): CaptionProject => ({
    schemaVersion: 22, id: 'p', title: 'P', cues: [], assets: [asset('x', 'video'), asset('y', 'video', 6 * US), asset('img', 'image'), asset('snd', 'audio', 5 * US)],
    tracks: [track('V1', 'video'), track('V2', 'video'), track('A1', 'audio')], clips: [video('c1', 0, 0, 10 * US)], captionTracks: [], blurRegions: [], zoomRegions: [], effects: [], textOverlays: [], shapes: [], markers: [], format,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...extra,
  })
  const resolver: ExportResolver = { assetUrl: (a) => `media://local${a.reference.absolutePath}`, assetPath: (a) => a.reference.absolutePath!, lutCube: () => { throw new Error('no lut in this test') } }

  it('emits v2 with no segments for the identity project, planned over the whole file', () => {
    const built = buildExportManifest(project({ captionStyle: DEFAULT_CAPTION_STYLE }), resolver)
    expect(built.manifest).toMatchObject({ version: 2, overlays: [], blurRegions: [], audioClips: [] })
    expect(built.manifest.version === 2 && built.manifest.segments).toBeUndefined()
    expect(built.plan).toEqual({ ...format, range: { startUs: 0, endUs: 10 * US } })
    expect(built.inputPaths).toEqual(['/m/x'])
  })

  it('scales the plan and v3 blur geometry with export settings, and is unchanged without them', () => {
    const settings = { preset: 'custom' as const, resolution: 720 as const, frameRate: 'source' as const, videoBitrateKbps: null }
    const plain = buildExportManifest(project(), resolver)
    expect(buildExportManifest(project(), resolver, undefined, { ...settings, resolution: 'source' })).toEqual(plain)
    const scaled = buildExportManifest(project(), resolver, undefined, settings)
    expect(scaled.plan.height).toBe(720)
    expect(scaled.plan.width / scaled.plan.height).toBeCloseTo(format.width / format.height, 1)
    const v3 = buildExportManifest(project({ clips: [{ ...video('c1', 0, 0, 10 * US), opacity: 0.5 } as Clip] }), resolver, undefined, settings)
    expect(v3.manifest.version === 3 && v3.manifest.format.height).toBe(720)
  })

  it('keeps a migrated schema-4 project on the byte-identical v2 route: same manifest, same encoder argv', () => {
    const v4 = projectSchemaV4.parse({
      schemaVersion: 4, id: 'p', title: 'P', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      assets: [asset('x', 'video')], cues: [{ ...cue('k', 'x'), startUs: 4 * US, endUs: 6 * US }], overlays: [], blurRegions: [], audioClips: [],
      clips: [{ id: 'a', assetId: 'x', startUs: 0, endUs: 3 * US }, { id: 'b', assetId: 'x', startUs: 5 * US, endUs: 9 * US }],
    })
    const loaded = loadProject(v4)
    const built = buildExportManifest(loaded.project, resolver)
    // Exactly what schema 4's builder produced for this project: kept source segments, one input —
    // plus the caption track schema 6's 5 → 6 migration stamps every cue with (there being only one).
    const expected = { version: 2 as const, cues: v4.cues.map((entry) => ({ ...entry, captionTrackId: loaded.project.captionTracks[0].id })), style: DEFAULT_CAPTION_STYLE, display: 'line' as const,
      segments: [{ startUs: 0, endUs: 3 * US }, { startUs: 5 * US, endUs: 9 * US }], overlays: [], blurRegions: [], audioClips: [] }
    expect(built.manifest).toEqual(expected)
    expect(built.plan).toEqual(planFromMedia(meta(10 * US)))
    expect(exportArguments('/m/x', '/out.mp4', built.plan, true, built.manifest as ExportManifestV2)).toEqual(exportArguments('/m/x', '/out.mp4', planFromMedia(meta(10 * US)), true, expected))
  })

  it('keeps images painted by the export host on v2 when the edit is the identity, in source (= sequence) time', () => {
    const built = buildExportManifest(project({ clips: [video('c1', 0, 0, 10 * US), image('i', 'V2', US, 2 * US, { rect, opacity: 0.5, fit: 'cover' } as Partial<Clip>)] }), resolver)
    expect(built.manifest).toMatchObject({ version: 2, overlays: [{ id: 'i', startUs: US, endUs: 3 * US, assetUrl: 'media://local/m/img', rect, opacity: 0.5, fit: 'cover' }] })
  })

  it('carries sound on unmuted audio tracks with an explicit out point, and drops muted ones', () => {
    const built = buildExportManifest(project({ clips: [video('c1', 0, 0, 10 * US), audio('s', 2 * US, 250_000, 1_750_000)] }), resolver)
    expect(built.manifest.version === 2 && built.manifest.audioClips).toEqual([{ id: 's', path: '/m/snd', delayUs: 2 * US, inPointUs: 250_000, durationUs: 1_500_000, gain: 0.8 }])
    const muted = project({ tracks: [track('V1', 'video'), track('V2', 'video'), track('A1', 'audio', { muted: true })], clips: [video('c1', 0, 0, 10 * US), audio('s', 0, 0, US)] })
    expect(buildExportManifest(muted, resolver).manifest).toMatchObject({ version: 2, audioClips: [] })
  })

  describe('linked audio (schema 15)', () => {
    const detached = (extra: Partial<Clip> = {}) => video('c1', 0, 0, 10 * US, { detachedAudio: true, linkId: 'L', ...extra } as Partial<Clip>)
    const linked = (extra: Partial<Clip> = {}): Clip => ({ kind: 'audio', id: 'a1', trackId: 'A1', assetId: 'x', timelineStartUs: 0, sourceStartUs: 0, sourceEndUs: 10 * US, gain: 1, linkId: 'L', ...extra } as Clip)

    it('keeps v2 for an in-sync unity pair: the video’s own sound already is the linked audio', () => {
      const built = buildExportManifest(project({ clips: [detached(), linked()] }), resolver)
      expect(built.manifest).toMatchObject({ version: 2, audioClips: [] })
      expect(built.inputPaths).toEqual(['/m/x'])
    })
    it('goes to v3 with the video silent and one audio input when the audio is not a plain mirror', () => {
      const tracks = [track('V1', 'video'), track('V2', 'video'), track('A1', 'audio', { volume: 0.5 })]
      const built = buildExportManifest(project({ tracks, clips: [detached(), linked()] }), resolver)
      const manifest = built.manifest as ExportManifestV3
      expect(manifest.version).toBe(3)
      expect(manifest.clips.map((clip) => [clip.id, clip.kind, clip.gain])).toEqual([['c1', 'video', 0], ['a1', 'audio', 0.5]])
      expect(manifest.inputs).toEqual([{ path: '/m/x', kind: 'video' }, { path: '/m/x', kind: 'audio' }])
    })
    it('mutes and solos through the audio track, and drops a disabled clip', () => {
      const muted = buildExportManifest(project({ tracks: [track('V1', 'video'), track('V2', 'video'), track('A1', 'audio', { muted: true })], clips: [detached(), linked()] }), resolver).manifest as ExportManifestV3
      expect(muted.version).toBe(3)
      expect(muted.clips.map((clip) => clip.id)).toEqual(['c1'])
      expect(muted.clips[0].gain).toBe(0)
      const soloedElsewhere = project({ tracks: [track('V1', 'video'), track('V2', 'video'), track('A1', 'audio'), track('A2', 'audio', { solo: true })], clips: [detached(), linked()] })
      expect((buildExportManifest(soloedElsewhere, resolver).manifest as ExportManifestV3).clips.map((clip) => clip.id)).toEqual(['c1'])
      const disabled = buildExportManifest(project({ clips: [detached({ enabled: false }), linked({ enabled: false }), video('c2', 0, 0, 5 * US, { assetId: 'y' } as Partial<Clip>)] }), resolver)
      expect(disabled.inputPaths).toEqual(['/m/y'])
    })
    it('a legacy video keeps its own sound unless another track is soloed', () => {
      expect(buildExportManifest(project(), resolver).manifest.version).toBe(2)
      const soloed = project({ tracks: [track('V1', 'video'), track('V2', 'video'), track('A1', 'audio', { solo: true })] })
      const manifest = buildExportManifest(soloed, resolver).manifest as ExportManifestV3
      expect(manifest.version).toBe(3)
      expect(manifest.clips[0].gain).toBe(0)
    })
  })

  it('uses v3 for two videos back to back: one input per clip, captions of both, the sequence as the range', () => {
    const built = buildExportManifest(project({ clips: [video('c1', 0, 0, 10 * US), video('c2', 10 * US, 0, 6 * US, { assetId: 'y' } as Partial<Clip>)],
      cues: [cue('kx', 'x'), cue('ky', 'y')] }), resolver)
    const manifest = built.manifest as ExportManifestV3
    expect(manifest.version).toBe(3)
    expect(manifest.inputs).toEqual([{ path: '/m/x', kind: 'video' }, { path: '/m/y', kind: 'video' }])
    expect(manifest.clips.map((clip) => [clip.id, clip.inputIndex, clip.timelineStartUs])).toEqual([['c1', 0, 0], ['c2', 1, 10 * US]])
    expect(manifest.cues.map((entry) => entry.id)).toEqual(['kx', 'ky'])
    expect(built.plan.range).toEqual({ startUs: 0, endUs: 16 * US })
    // Each caption is seen through its own clip: ky's source 0.5s plays at sequence 10.5s.
    expect(frameRequestAtSequence(manifest, Math.round(10.5 * 30)).active).toBe(true)
    expect(frameRequestAtSequence(manifest, Math.round(10.5 * 30)).request.cue.text).toBe('ky')
  })

  it('forces a zoom project onto v3 and resolves its target into output pixels', () => {
    const zoomRegions = [{ id: 'z1', startUs: US, endUs: 3 * US, rect: { x: 270, y: 151.875, width: 540, height: 303.75 }, easeInUs: 500_000, easeOutUs: 500_000, enabled: true }]
    const built = buildExportManifest(project({ zoomRegions }), resolver)
    expect(built.manifest.version).toBe(3)
    if (built.manifest.version === 3) expect(built.manifest.zoomRegions).toEqual([{
      id: 'z1', sequence: { startUs: US, endUs: 3 * US }, rect: { x: 480, y: 270, width: 960, height: 540 }, easeInUs: 500_000, easeOutUs: 500_000,
    }])
  })

  it('carries a pan start framing into the manifest in output pixels and keeps its full length past the sequence end', () => {
    const rect = { x: 270, y: 151.875, width: 540, height: 303.75 }
    const zoomRegions = [{ id: 'z1', startUs: 8 * US, endUs: 14 * US, rect, fromRect: { x: 0, y: 0, width: 1080, height: 607.5 }, easeInUs: 0, easeOutUs: 0, enabled: true }]
    const built = buildExportManifest(project({ zoomRegions }), resolver)
    expect(built.manifest.version).toBe(3)
    if (built.manifest.version === 3) {
      expect(built.manifest.zoomRegions[0]).toMatchObject({ fromRect: { x: 0, y: 0, width: 1920, height: 1080 }, sequence: { startUs: 8 * US, endUs: 14 * US } })
      expect(exportManifestSchema.safeParse(built.manifest).success).toBe(true)
    }
  })

  it('forces authored text onto v3 and emits only active text actors in deterministic layer order', () => {
    const textOverlays = [
      { ...defaultTextOverlay('above', 0, 3 * US, 'ആപ്പിൾ iPhone'), layerOrder: 2 },
      { ...defaultTextOverlay('below', 0, 3 * US, 'below'), layerOrder: -1 },
      defaultTextOverlay('later', 5 * US, 7 * US, 'not active yet'),
    ]
    const built = buildExportManifest(project({ textOverlays }), resolver)
    expect(built.manifest.version).toBe(3)
    if (built.manifest.version !== 3) return
    expect(built.manifest.textOverlays.map((item) => item.id)).toEqual(['above', 'below', 'later'])
    const { request } = frameRequestAtSequence(built.manifest, 30)
    expect(request.version).toBe(4)
    if (request.version === 4) {
      expect(request.textActors.map((actor) => actor.item.id)).toEqual(['below', 'above'])
      expect(request.textActors[1].cue.words.every((word) => word.timingSource === 'decorative')).toBe(true)
    }
  })

  it('forces shapes onto v3 and puts only active shapes, interleaved with text by layer order, in the frame request', () => {
    const shapes = [{ ...defaultShape('box', 'front', 0, 3 * US), layerOrder: 3 }, { ...defaultShape('highlight', 'under', 0, 3 * US) }, defaultShape('arrow', 'later', 5 * US, 7 * US)]
    const built = buildExportManifest(project({ shapes }), resolver)
    expect(built.manifest.version).toBe(3)
    if (built.manifest.version !== 3) return
    expect(exportManifestSchema.safeParse(built.manifest).success).toBe(true)
    expect(built.manifest.shapes.map((item) => item.id)).toEqual(['front', 'under', 'later'])
    const { request } = frameRequestAtSequence(built.manifest, 30)
    expect(request.version).toBe(4)
    if (request.version === 4) {
      expect(request.shapeActors?.map((actor) => actor.shape.id)).toEqual(['front', 'under'])
      expect(frameRequestSchema.safeParse(request).success).toBe(true)
    }
  })

  it('clips shapes to the sequence length', () => {
    const built = buildExportManifest(project({ shapes: [defaultShape('box', 'long', 8 * US, 30 * US), defaultShape('box', 'gone', 12 * US, 13 * US)] }), resolver)
    if (built.manifest.version !== 3) throw new Error('expected v3')
    expect(built.manifest.shapes.map((item) => [item.id, item.endUs])).toEqual([['long', 10 * US]])
  })

  it('carries all five keynote title treatments into portrait and landscape export frames at matching times', () => {
    for (const template of CAPTION_TEMPLATES.filter((entry) => entry.id.startsWith('keynote-')))
      for (const [width, height] of [[1080, 1920], [1920, 1080]]) {
        const original = defaultTextOverlay('keynote', 0, 3 * US, 'മലയാളം and English')
        const item = { ...original, ...titleTemplateChanges(template, original) }
        const built = buildExportManifest(project({ format: { width, height, frameRate: format.frameRate }, textOverlays: [item] }), resolver)
        expect(built.manifest.version).toBe(3)
        if (built.manifest.version !== 3) continue
        for (const index of [0, 6, 45, 85]) {
          const { request } = frameRequestAtSequence(built.manifest, index)
          expect(request.version).toBe(4)
          if (request.version !== 4) continue
          const actor = request.textActors[0]
          const expected = textMotionAt(item, frameSourceUs(index, 0, format.frameRate))
          expect(actor).toMatchObject({ item, cue: { text: item.text, words: expect.arrayContaining([
            expect.objectContaining({ text: 'മലയാളം', timingSource: 'decorative' }),
          ]) }, opacity: expected.opacity, scale: expected.scale, x: expected.x, y: expected.y })
        }
      }
  })

  it('falls back to v2 when the only zoom region is bypassed', () => {
    const zoomRegions = [{ id: 'z1', startUs: US, endUs: 3 * US, rect: { x: 270, y: 151.875, width: 540, height: 303.75 }, easeInUs: 500_000, easeOutUs: 500_000, enabled: false }]
    const built = buildExportManifest(project({ zoomRegions }), resolver)
    expect(built.manifest.version).toBe(2)
  })

  it('excludes a bypassed blur region from the manifest but keeps an enabled one', () => {
    const kept = { id: 'b1', startUs: 0, endUs: 5 * US, rect: { x: 0, y: 0, width: 100, height: 100 }, radius: 10, enabled: true }
    const bypassed = { id: 'b2', startUs: 5 * US, endUs: 10 * US, rect: { x: 0, y: 0, width: 100, height: 100 }, radius: 10, enabled: false }
    const built = buildExportManifest(project({ blurRegions: [kept, bypassed] }), resolver)
    expect(built.manifest.version).toBe(2)
    expect(built.manifest.blurRegions.map((region) => region.id)).toEqual(['b1'])
  })

  it('forces a frame-paint effect project onto v3, carried in composition units and sequence time — never resolved to output pixels', () => {
    const effects = [{ id: 'e1', kind: 'vignette' as const, startUs: US, endUs: 3 * US, enabled: true, amount: .6, softness: .4 }]
    const built = buildExportManifest(project({ effects }), resolver)
    expect(built.manifest.version).toBe(3)
    if (built.manifest.version === 3) expect(built.manifest.effects).toEqual(effects)
  })

  it('falls back to v2 when the only frame-paint effect is bypassed', () => {
    const effects = [{ id: 'e1', kind: 'vignette' as const, startUs: US, endUs: 3 * US, enabled: false, amount: .6, softness: .4 }]
    const built = buildExportManifest(project({ effects }), resolver)
    expect(built.manifest.version).toBe(2)
  })

  it('evaluates frame-paint effects into a v3 frame request at the right sequence timestamp', () => {
    const effects = [{ id: 'e1', kind: 'vignette' as const, startUs: 0, endUs: 20 * US, enabled: true, amount: .6, softness: .4 }]
    const built = buildExportManifest(project({ effects }), resolver)
    const manifest = built.manifest as ExportManifestV3
    const { request } = frameRequestAtSequence(manifest, Math.round(2 * 30))
    expect(request.version).toBe(3)
    if (request.version === 3) expect(request.frameEffects.vignette).toEqual({ amount: .6, softness: .4 })
  })

  it('carries film grain and VHS through the v3 manifest into the frame request, re-seeded per 24 Hz tick', () => {
    const effects = [
      { id: 'g1', kind: 'grain' as const, startUs: 0, endUs: 10 * US, enabled: true, amount: .4, size: 1.5 },
      { id: 'h1', kind: 'vhs' as const, startUs: 0, endUs: 10 * US, enabled: true, amount: .6, scanlines: .5, tracking: .5 },
    ]
    const manifest = buildExportManifest(project({ effects }), resolver).manifest as ExportManifestV3
    expect(manifest.version).toBe(3)
    expect(manifest.effects).toEqual(effects)
    const at = (frame: number) => frameRequestAtSequence(manifest, frame).request
    const first = at(30 * 2), sameSecond = at(30 * 2), later = at(30 * 2 + 2)
    expect(first.version).toBe(3)
    if (first.version !== 3 || sameSecond.version !== 3 || later.version !== 3) return
    expect(first.frameEffects.grain).toMatchObject({ amount: .4, size: 1.5 })
    expect(first.frameEffects.vhs).toMatchObject({ amount: .6, scanlines: .5, tracking: .5 })
    expect(sameSecond.frameEffects).toEqual(first.frameEffects)
    // 30 fps export: frame 62 lands on a later 24 Hz tick than frame 60 (frame 61 shares its tick), so the noise must differ.
    expect(later.frameEffects.grain!.seed).not.toBe(first.frameEffects.grain!.seed)
  })

  it('resolves glow to output pixels in pictureEffects and omits it when bypassed', () => {
    const glow = { id: 'gl', kind: 'glow' as const, startUs: 0, endUs: 10 * US, enabled: true, amount: .5, radius: 20, threshold: .55 }
    const manifest = buildExportManifest(project({ effects: [glow] }), resolver).manifest as ExportManifestV3
    expect(manifest.version).toBe(3)
    expect(manifest.pictureEffects).toHaveLength(1)
    expect(manifest.pictureEffects[0]).toMatchObject({ id: 'gl', kind: 'glow', amount: .5, threshold: .55 })
    expect(manifest.pictureEffects[0].sigmaPx).toBeGreaterThan(0)
    const bypassed = buildExportManifest(project({ effects: [{ ...glow, enabled: false }] }), resolver).manifest as ExportManifestV3
    expect((bypassed as ExportManifestV3).pictureEffects ?? []).toEqual([])
    const built = buildExportManifest(project({ effects: [glow] }), resolver).manifest as ExportManifestV3
    const { request } = frameRequestAtSequence(built, 30)
    if (request.version === 3) expect(request.frameEffects).toEqual({})
  })

  it('resolves a v3 caption placement override into the export request without changing the project style', () => {
    const built = buildExportManifest(project({ clips: [video('c1', 0, 0, 10 * US), video('c2', 10 * US, 0, 6 * US, { assetId: 'y' } as Partial<Clip>)],
      cues: [cue('kx', 'x'), { ...cue('ky', 'y'), placementOverride: { fontSize: 90 } }] }), resolver)
    const manifest = built.manifest as ExportManifestV3
    const { request } = frameRequestAtSequence(manifest, Math.round(10.5 * 30))
    expect(request.cue.text).toBe('ky')
    expect(request.style.appearance.fontSize).toBe(90)
    expect(request.style.appearance.horizontal).toBe(DEFAULT_CAPTION_STYLE.appearance.horizontal)
    expect(manifest.style.appearance.fontSize).toBe(DEFAULT_CAPTION_STYLE.appearance.fontSize)
  })

  it('stacks: picture-in-picture rects become output pixels, hidden tracks vanish, muted video keeps its picture', () => {
    const base = project({
      tracks: [track('V1', 'video', { muted: true }), track('V2', 'video'), track('V3', 'video', { hidden: true }), track('A1', 'audio')],
      clips: [video('c1', 0, 0, 10 * US), video('pip', 2 * US, 0, 4 * US, { trackId: 'V2', assetId: 'y', rect: { x: 540, y: 0, width: 540, height: 303.75 } } as Partial<Clip>),
        image('ghost', 'V3', 0, US)],
    })
    const manifest = buildExportManifest(base, resolver).manifest as ExportManifestV3
    expect(manifest.clips.map((clip) => [clip.id, clip.trackIndex, clip.gain])).toEqual([['c1', 0, 0], ['pip', 1, 1]])
    expect(manifest.clips[1].rect).toEqual({ x: 960, y: 0, width: 960, height: 540 })
  })

  it('host-paints images above every video, but composites them in FFmpeg when one sits under a video', () => {
    const above = buildExportManifest(project({ clips: [video('c1', 0, 0, 10 * US), video('b', 0, 0, 2 * US, { trackId: 'V2', assetId: 'y', rect } as Partial<Clip>),
      image('i', 'V3', 0, US)], tracks: [track('V1', 'video'), track('V2', 'video'), track('V3', 'video'), track('A1', 'audio')] }), resolver).manifest as ExportManifestV3
    expect(above.overlays.map((overlay) => overlay.id)).toEqual(['i'])
    expect(above.inputs.map((input) => input.kind)).toEqual(['video', 'video'])
    const under = buildExportManifest(project({ clips: [video('c1', 0, 0, 10 * US), image('i', 'V1', 10 * US, US), video('top', 0, 0, 2 * US, { trackId: 'V2', assetId: 'y' } as Partial<Clip>)] }), resolver).manifest as ExportManifestV3
    expect(under.overlays).toEqual([])
    expect(under.inputs.map((input) => input.kind)).toEqual(['video', 'image', 'video'])
  })

  it('carries a non-normal blend mode to the manifest, forces v3 and sends a blending image through FFmpeg', () => {
    const tracks = [track('V1', 'video'), track('V2', 'video'), track('A1', 'audio')]
    expect(flatSequence(project({ clips: [{ ...video('c1', 0, 0, 10 * US), blendMode: 'multiply' } as Clip] }))).toBeNull()
    const normal = buildExportManifest(project({ clips: [video('c1', 0, 0, 10 * US), { ...video('pip', 0, 0, 2 * US, { trackId: 'V2', assetId: 'y', rect } as Partial<Clip>), blendMode: 'normal' } as Clip] }), resolver).manifest as ExportManifestV3
    expect(normal.clips.some((clip) => 'blendMode' in clip)).toBe(false)
    const blended = buildExportManifest(project({ tracks, clips: [video('c1', 0, 0, 10 * US), { ...video('pip', 0, 0, 2 * US, { trackId: 'V2', assetId: 'y', rect } as Partial<Clip>), blendMode: 'multiply' } as Clip] }), resolver).manifest as ExportManifestV3
    expect(blended.clips.map((clip) => [clip.id, clip.blendMode])).toEqual([['c1', undefined], ['pip', 'multiply']])
    // An image above every video is host-painted, which cannot blend: a blending one is composited by FFmpeg instead.
    const screen = buildExportManifest(project({ tracks: [...tracks, track('V3', 'video')], clips: [video('c1', 0, 0, 10 * US), { ...image('i', 'V3', 0, US), blendMode: 'screen' } as Clip] }), resolver).manifest as ExportManifestV3
    expect(screen.overlays).toEqual([])
    expect(screen.clips.find((clip) => clip.id === 'i')).toMatchObject({ kind: 'image', blendMode: 'screen' })
  })

  it('splits a blending shape into its own export pass rather than refusing (docs/plans/shape-blend/02)', () => {
    const blending = { ...defaultShape('box', 's1', 0, 3 * US), layerOrder: 1, blendMode: 'multiply' as const }
    const built = buildExportManifest(project({ shapes: [blending] }), resolver)
    expect(built.manifest.version).toBe(3)
    if (built.manifest.version !== 3) return
    expect(built.manifest.shapes.map((item) => [item.id, item.blendMode])).toEqual([['s1', 'multiply']])
    const passes = graphicsPasses(built.manifest.shapes)
    expect(passes.count).toBe(3)
    // Band 0: pinned content and the caption plane (the blend shape sorts above `layerOrder: 0`).
    const band0 = frameRequestAtSequence(built.manifest, 30, undefined, 0).request
    expect(band0.hideCaption).toBeUndefined()
    // Band 1: exactly the blend shape, caption hidden.
    const band1 = frameRequestAtSequence(built.manifest, 30, undefined, 1).request
    expect(band1.version).toBe(4)
    if (band1.version === 4) {
      expect(band1.shapeActors?.map((actor) => actor.shape.id)).toEqual(['s1'])
      expect(band1.textActors).toEqual([])
    }
    expect(band1.hideCaption).toBe(true)
    expect(frameRequestSchema.safeParse(band1).success).toBe(true)
    // Band 1 outside the shape's own time range carries no shape actor at all.
    const band1Later = frameRequestAtSequence(built.manifest, 400, undefined, 1).request
    expect(band1Later.version === 4 ? band1Later.shapeActors ?? [] : []).toEqual([])
  })

  it('refuses before the job starts when a file is not registered, naming it', () => {
    const strict: ExportResolver = { ...resolver, assetPath: (a) => { if (a.id === 'snd') throw new Error(`"${a.name}" is missing`); return a.reference.absolutePath! } }
    expect(() => buildExportManifest(project({ clips: [video('c1', 0, 0, 10 * US), audio('s', 0, 0, US)] }), strict)).toThrow('"snd.bin" is missing')
  })

  it('says which sequences are flat', () => {
    expect(flatSequence(project())).not.toBeNull()
    expect(flatSequence(project({ clips: [video('c1', US, 0, 9 * US)] }))).toBeNull() // starts with a gap
    expect(flatSequence(project({ clips: [video('c1', 0, 0, 5 * US), audio('s', 4 * US, 0, 2 * US)] }))).toBeNull() // sound runs past the picture
    expect(flatSequence(project({ zoomRegions: [{ id: 'z1', startUs: 0, endUs: US, rect: { x: 0, y: 0, width: 540, height: 303.75 }, easeInUs: 0, easeOutUs: 0, enabled: true }] }))).toBeNull()
    expect(flatSequence(project({ effects: [{ id: 'e1', kind: 'vignette', startUs: 0, endUs: US, enabled: true, amount: .5, softness: .5 }] }))).toBeNull()
  })

  it('routes any active mask through v3 and carries it to the host request and FFmpeg inputs', () => {
    const mask = { enabled: true, invert: false, feather: 4, density: 1, shape: { kind: 'ellipse' as const, rect: { x: 100, y: 50, width: 300, height: 200 } } }
    expect(flatSequence(project({ clips: [{ ...video('c1', 0, 0, 10 * US), mask } as Clip] }))).toBeNull()
    expect(flatSequence(project({ clips: [{ ...video('c1', 0, 0, 10 * US), mask: { ...mask, enabled: false } } as Clip] }))).not.toBeNull()
    expect(flatSequence(project({ captionTracks: [{ id: 'ct', name: '', locked: false, mask }] }))).toBeNull()
    expect(flatSequence(project({ blurRegions: [{ id: 'b', startUs: 0, endUs: US, rect, radius: 5, enabled: true, mask }] }))).toBeNull()

    const built = buildExportManifest(project({
      clips: [{ ...video('c1', 0, 0, 10 * US), mask } as Clip, image('i', 'V2', 0, 3 * US, { mask } as Partial<Clip>)],
      cues: [{ ...cue('k', 'x'), captionTrackId: 'ct' }], captionTracks: [{ id: 'ct', name: '', locked: false, mask }],
    }), resolver)
    expect(built.manifest.version).toBe(3)
    if (built.manifest.version !== 3) return
    expect(built.manifest.clips[0].mask).toEqual(mask)
    expect(built.manifest.overlays[0].mask).toEqual(mask)
    const { request } = frameRequestAtSequence(built.manifest, 3)
    expect(request.captionMask).toEqual(mask)
    if (request.version !== 1 && request.version !== 5) expect(request.overlays[0].mask).toEqual(mask)
    expect(exportManifestSchema.parse(JSON.parse(JSON.stringify(built.manifest)))).toEqual(built.manifest)
  })

  it('carries caption track opacity only when below 1, and routes it through v3', () => {
    const track = { id: 'ct', name: '', locked: false }
    const cues = [{ ...cue('k', 'x'), captionTrackId: 'ct' }]
    expect(flatSequence(project({ captionTracks: [{ ...track, opacity: 0.5 }] }))).toBeNull()
    expect(flatSequence(project({ captionTracks: [{ ...track, opacity: 1 }] }))).not.toBeNull()
    const dim = buildExportManifest(project({ clips: [video('c1', 0, 0, 10 * US)], cues, captionTracks: [{ ...track, opacity: 0.5 }] }), resolver)
    expect(dim.manifest.version).toBe(3)
    if (dim.manifest.version !== 3) return
    expect(dim.manifest.captionOpacities).toEqual({ ct: 0.5 })
    expect(frameRequestAtSequence(dim.manifest, 3).request.captionOpacity).toBe(0.5)
    const plain = buildExportManifest(project({ clips: [video('c1', 0, 0, 10 * US)], cues, captionTracks: [{ ...track, opacity: 1 }] }), resolver)
    expect(plain.manifest.version).toBe(2) // nothing dimmed: the flat v2 path, unchanged
  })

  it('round-trips v3 through the wire schema, so what main writes is what the worker accepts', () => {
    const built = buildExportManifest(project({ clips: [video('c1', 0, 0, 10 * US), video('c2', 12 * US, 0, US)] }), resolver)
    expect(exportManifestSchema.parse(JSON.parse(JSON.stringify(built.manifest)))).toEqual(built.manifest)
  })

  it('accepts a v1 manifest unchanged and normalizes it to an edit-free v2', () => {
    const v1 = { version: 1 as const, cues: [], style: DEFAULT_CAPTION_STYLE }
    expect(exportManifestSchema.parse(v1)).toEqual(v1)
    expect(normalizeManifest(v1)).toEqual({ version: 2, cues: [], style: DEFAULT_CAPTION_STYLE, overlays: [], blurRegions: [], audioClips: [] })
  })
})
