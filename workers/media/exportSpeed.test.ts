import { describe, expect, it } from 'vitest'
import { atempoChain, exportFilterGraphV3, retimeFilter, v3Route } from './exportArguments'
import { DEFAULT_CAPTION_STYLE } from '../../src/captions/style'
import { buildExportManifest, exportManifestV3Schema, type ExportManifestV3, type ExportResolver, type ManifestClip } from '../../src/export/plan'
import { sourceToTimelineOffsetUs, timelineLengthUs } from '../../src/core/clipTime'
import type { ClipSpeed, Clip, ProjectAsset, Track } from '../../src/core/edit'
import type { CaptionProject } from '../../src/core/model'

const US = 1_000_000
const constant = (rate: number): ClipSpeed => ({ points: [{ sourceUs: 0, rate }] })
const ramp: ClipSpeed = { points: [{ sourceUs: 0, rate: 1 }, { sourceUs: 4 * US, rate: 4 }, { sourceUs: 8 * US, rate: 0.5 }] }
const format = { width: 320, height: 180, frameRate: { numerator: 30, denominator: 1 } }
const clip = (id: string, extra: Partial<ManifestClip> = {}): ManifestClip =>
  ({ id, inputIndex: 0, assetId: 'v1', kind: 'video', trackIndex: 0, timelineStartUs: 0, sourceStartUs: 2 * US, sourceEndUs: 12 * US, opacity: 1, fit: 'contain', gain: 1, ...extra })
const manifest = (clips: ManifestClip[], sequenceDurationUs: number): ExportManifestV3 => ({
  version: 3, cues: [], style: DEFAULT_CAPTION_STYLE, display: 'line', format, sequenceDurationUs,
  inputs: clips.map((_, index) => ({ path: `/in${index}.mp4`, kind: 'video' as const })), clips,
  overlays: [], blurRegions: [], effects: [], pictureEffects: [], textOverlays: [], shapes: [], captionMasks: {}, captionOpacities: {}, zoomRegions: [], luts: [],
})

/** Evaluates the FFmpeg `setpts` expression the way FFmpeg would, for a given zero-based source offset. */
function evaluateRetime(filter: string, offsetSeconds: number): number {
  const expression = /setpts='?(.*?)'?$/.exec(filter)![1].replace(/\bif\(/g, 'iff(')
  const TB = 1 / 90_000
  const iff = (condition: boolean, a: number, b: number) => condition ? a : b
  const lt = (a: number, b: number) => a < b
  const value = new Function('PTS', 'TB', 'iff', 'lt', 'log', `return ${expression}`)(offsetSeconds / TB, TB, iff, lt, Math.log) as number
  return value * TB
}

describe('speed in the export graph', () => {
  it('retimes a steady clip by dividing PTS and keeps the source length for trim', () => {
    const graph = exportFilterGraphV3(manifest([clip('a', { speed: constant(2) })], 5 * US), [true]).filterComplex
    expect(graph).toContain('trim=duration=10.000000,setpts=PTS-STARTPTS,setpts=PTS/2.000000000,')
  })

  it('leaves a clip without speed exactly as before', () => {
    expect(retimeFilter(clip('a'))).toBe('')
    const graph = exportFilterGraphV3(manifest([clip('a')], 10 * US), [true]).filterComplex
    expect(graph).toContain('trim=duration=10.000000,setpts=PTS-STARTPTS,scale=')
  })

  it('emits a setpts expression for a ramp that matches clipTime at sample points', () => {
    const c = clip('a', { sourceStartUs: 0, sourceEndUs: 10 * US, speed: ramp })
    const filter = retimeFilter(c)
    expect(filter).toContain("setpts='")
    for (const offsetUs of [0, 1.5 * US, 4 * US, 5.2 * US, 8 * US, 9.9 * US]) {
      const expected = sourceToTimelineOffsetUs(c, offsetUs) / US
      expect(evaluateRetime(filter, offsetUs / US)).toBeCloseTo(expected, 5)
    }
  })

  it('offsets curve points by the clip start', () => {
    const c = clip('a', { sourceStartUs: 2 * US, sourceEndUs: 12 * US, speed: { points: [{ sourceUs: 2 * US, rate: 1 }, { sourceUs: 7 * US, rate: 3 }] } })
    for (const offsetUs of [0, 2 * US, 5 * US, 9 * US]) {
      expect(evaluateRetime(retimeFilter(c), offsetUs / US)).toBeCloseTo(sourceToTimelineOffsetUs(c, 2 * US + offsetUs) / US, 5)
    }
  })

  it('splits slow-downs below 0.5× into valid atempo stages', () => {
    expect(atempoChain(2)).toBe('atempo=2.000000000')
    expect(atempoChain(0.5)).toBe('atempo=0.500000000')
    const slow = atempoChain(0.1).split(',')
    expect(slow.length).toBeGreaterThan(1)
    const product = slow.reduce((total, stage) => total * Number(stage.slice(7)), 1)
    expect(product).toBeCloseTo(0.1, 6)
    for (const stage of slow) expect(Number(stage.slice(7))).toBeGreaterThanOrEqual(0.5)
  })

  it('tempo-adjusts a steady clip’s audio and drops a ramp’s audio', () => {
    const steady = exportFilterGraphV3(manifest([clip('a', { speed: constant(2) })], 5 * US), [true])
    expect(steady.hasAudioOut).toBe(true)
    expect(steady.filterComplex).toContain('atrim=duration=10.000000,asetpts=PTS-STARTPTS,atempo=2.000000000,aresample=48000')
    const ramped = exportFilterGraphV3(manifest([clip('a', { speed: ramp })], timelineLengthUs(clip('a', { speed: ramp }))), [true])
    expect(ramped.hasAudioOut).toBe(false)
    expect(ramped.filterComplex).not.toContain('atempo')
  })

  it('judges the flat route by timeline length, so a sped-up clip followed by another stays flat', () => {
    const first = clip('a', { speed: constant(2) })
    const second = clip('b', { inputIndex: 1, timelineStartUs: 5 * US })
    expect(v3Route(manifest([first, second], 15 * US))).toBe('flat')
    expect(v3Route(manifest([first, { ...second, timelineStartUs: 10 * US }], 20 * US))).toBe('stacked')
  })

  it('validates speed in the manifest schema', () => {
    expect(exportManifestV3Schema.safeParse(manifest([clip('a', { speed: ramp })], 10 * US)).success).toBe(true)
    expect(exportManifestV3Schema.safeParse(manifest([clip('a', { speed: { points: [{ sourceUs: 0, rate: 99 }] } })], 10 * US)).success).toBe(false)
  })
})

describe('speed in the export plan', () => {
  const asset = (id: string, kind: ProjectAsset['kind']): ProjectAsset => ({
    id, kind, name: id, reference: { relativePath: null, absolutePath: `/m/${id}` }, fingerprint: null,
    metadata: { durationUs: 20 * US, width: 1920, height: 1080, rotationDegrees: 0, frameRate: { numerator: 25, denominator: 1 }, nominalFrameRate: null, streams: [] },
  })
  const track = (id: string, kind: Track['kind']): Track => ({ id, kind, name: '', muted: false, hidden: false, locked: false })
  const video = (id: string, start: number, s0: number, s1: number, speed?: ClipSpeed): Clip =>
    ({ kind: 'video', id, trackId: 'V1', assetId: 'x', timelineStartUs: start, sourceStartUs: s0, sourceEndUs: s1, opacity: 1, fit: 'contain', gain: 1, ...(speed ? { speed } : {}) })
  const project = (clips: Clip[]): CaptionProject => ({
    schemaVersion: 24, id: 'p', title: 'P', cues: [], assets: [asset('x', 'video')], tracks: [track('V1', 'video'), track('A1', 'audio')], clips, captionTracks: [],
    blurRegions: [], zoomRegions: [], effects: [], textOverlays: [], shapes: [], markers: [], format: { width: 1920, height: 1080, frameRate: { numerator: 25, denominator: 1 } },
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  })
  const resolver: ExportResolver = { assetUrl: (a) => `media://local${a.reference.absolutePath}`, assetPath: (a) => a.reference.absolutePath!, lutCube: () => { throw new Error('no lut in this test') } }

  it('routes a sped-up clip through v3 and sizes the sequence by its retimed length', () => {
    const plain = buildExportManifest(project([video('a', 0, 0, 10 * US)]), resolver)
    expect(plain.manifest.version).toBe(2)
    const built = buildExportManifest(project([video('a', 0, 0, 10 * US, constant(2))]), resolver)
    expect(built.manifest.version).toBe(3)
    if (built.manifest.version !== 3) return
    expect(built.manifest.sequenceDurationUs).toBe(5 * US)
    expect(built.manifest.clips[0].speed).toEqual(constant(2))
    expect(built.plan.range.endUs).toBe(5 * US)
  })

  it('sizes a ramped sequence by the integrated length', () => {
    const c = video('a', 0, 0, 10 * US, ramp)
    const built = buildExportManifest(project([c]), resolver)
    expect(built.manifest.version === 3 && built.manifest.sequenceDurationUs).toBe(timelineLengthUs(c))
  })
})
