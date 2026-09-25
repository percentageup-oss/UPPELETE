import { describe, expect, it } from 'vitest'
import { buildExportManifest, exportManifestV3Schema, type ExportManifestV3, type ExportResolver } from './plan'
import { sampleLut } from '../color/bake'
import { decodeCubeData, type Cube3D } from '../color/cube'
import { DEFAULT_CAPTION_STYLE } from '../captions/style'
import type { AdjustmentClip, Clip, Grade, PrimariesGrade, ProjectAsset, Track } from '../core/edit'
import type { CaptionProject } from '../core/model'

const US = 1_000_000
const NEUTRAL_PRIMARIES: PrimariesGrade = {
  contrast: 0, highlights: 0, shadows: 0, saturation: 0, lift: [0, 0, 0], gamma: [0, 0, 0], gain: [0, 0, 0], exposureStops: 0, temperature: 0, tint: 0,
}
const NEUTRAL_GRADE: Grade = { input: { type: 'none' }, primaries: NEUTRAL_PRIMARIES, look: null, intensity: 1 }
const graded = (exposureStops: number): Grade => ({ ...NEUTRAL_GRADE, primaries: { ...NEUTRAL_PRIMARIES, exposureStops } })

const format = { width: 1920, height: 1080, frameRate: { numerator: 30, denominator: 1 } }
const meta = (durationUs: number) => ({ durationUs, width: 1920, height: 1080, rotationDegrees: 0, frameRate: { numerator: 30, denominator: 1 }, nominalFrameRate: null, streams: [] })
const track = (id: string, kind: Track['kind'] = 'video'): Track => ({ id, kind, name: '', muted: false, hidden: false, locked: false })
const video = (id: string, trackId: string, timelineStartUs: number, lengthUs: number): Clip =>
  ({ kind: 'video', id, trackId, assetId: 'x', timelineStartUs, sourceStartUs: 0, sourceEndUs: lengthUs, opacity: 1, fit: 'contain', gain: 1 })
const image = (id: string, trackId: string, timelineStartUs: number, lengthUs: number): Clip =>
  ({ kind: 'image', id, trackId, assetId: 'image', timelineStartUs, sourceStartUs: 0, sourceEndUs: lengthUs, opacity: 1, fit: 'contain' })
const color = (id: string, trackId: string, timelineStartUs: number, lengthUs: number): Clip =>
  ({ kind: 'color', id, trackId, timelineStartUs, sourceStartUs: 0, sourceEndUs: lengthUs, opacity: 1, fit: 'contain', fill: { type: 'solid', color: '#112233' } })
const adjustment = (id: string, trackId: string, timelineStartUs: number, endUs: number, grade: Grade): AdjustmentClip =>
  ({ kind: 'adjustment', id, trackId, timelineStartUs, sourceStartUs: 0, sourceEndUs: endUs - timelineStartUs, grade })
const lutAsset = (id: string): ProjectAsset =>
  ({ id, kind: 'lut', name: `${id}.cube`, reference: { relativePath: null, absolutePath: `/luts/${id}.cube` }, fingerprint: null, metadata: null })
const project = (clips: Clip[], tracks: Track[] = [track('V1'), track('V2'), track('A1', 'audio')], assets: ProjectAsset[] = []): CaptionProject => ({
  schemaVersion: 22, id: 'p', title: 'P', cues: [],
  assets: [{ id: 'x', kind: 'video', name: 'x.mp4', reference: { relativePath: null, absolutePath: '/m/x.mp4' }, fingerprint: null, metadata: meta(10 * US) }, ...assets],
  tracks, clips, captionTracks: [], blurRegions: [], zoomRegions: [], effects: [], textOverlays: [], shapes: [], markers: [], format,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
})
const resolver = (luts: Record<string, Cube3D> = {}): ExportResolver => ({
  assetUrl: (a) => `media://local${a.reference.absolutePath}`, assetPath: (a) => a.reference.absolutePath!,
  lutCube: (a) => { const cube = luts[a.id]; if (!cube) throw new Error(`no fixture LUT for ${a.id}`); return cube },
})
const v3 = (built: ReturnType<typeof buildExportManifest>): ExportManifestV3 => {
  if (built.manifest.version !== 3) throw new Error('expected a v3 manifest')
  return built.manifest
}
/** A LUT's baked content at a point, decoding its base64 transport back to a `Cube3D` first. */
const sampleAt = (manifest: ExportManifestV3, lutId: string, rgb: readonly [number, number, number]) => {
  const lut = manifest.luts.find((entry) => entry.id === lutId)!
  const cube: Cube3D = { size: lut.size, title: '', domainMin: [0, 0, 0], domainMax: [1, 1, 1], data: decodeCubeData(lut.data, lut.size ** 3 * 3) }
  return sampleLut(cube, rgb)
}

describe('buildExportManifest: grading', () => {
  it('a grade-free project carries no luts and no clip names one', () => {
    const built = v3(buildExportManifest(project([video('a', 'V1', 0, 10 * US), { ...video('b', 'V2', 0, 10 * US) }]), resolver()))
    expect(built.luts).toEqual([])
    expect(built.clips.every((clip) => clip.lutId === undefined)).toBe(true)
  })

  it('grades a video clip fully under one adjustment layer with a single baked LUT', () => {
    const built = v3(buildExportManifest(project([video('a', 'V1', 0, 10 * US), adjustment('adj', 'V2', 0, 10 * US, graded(1))]), resolver()))
    expect(built.clips).toHaveLength(1)
    const [clip] = built.clips
    expect(clip.id).toBe('a')
    expect(clip.lutId).toBeDefined()
    expect(clip.timelineStartUs).toBe(0)
    expect(clip.sourceStartUs).toBe(0)
    expect(clip.sourceEndUs).toBe(10 * US)
    expect(built.luts).toHaveLength(1)
    // +1 stop roughly doubles a mid-grey input; the identity input domain value at 0.5 should end up
    // brighter than 0.5 once baked and sampled back.
    const [r] = sampleAt(built, clip.lutId!, [0.5, 0.5, 0.5])
    expect(r).toBeGreaterThan(0.5)
  })

  it('never grades a color (background) clip, even under an adjustment layer', () => {
    const built = v3(buildExportManifest(project([color('bg', 'V1', 0, 10 * US), adjustment('adj', 'V2', 0, 10 * US, graded(2))]), resolver()))
    expect(built.clips).toHaveLength(1)
    expect(built.clips[0].kind).toBe('color')
    expect(built.clips[0].lutId).toBeUndefined()
    expect(built.luts).toEqual([])
  })

  it('sends an image on an upper track through FFmpeg when an adjustment layer grades it', () => {
    const asset: ProjectAsset = { id: 'image', kind: 'image', name: 'image.png', reference: { relativePath: null, absolutePath: '/m/image.png' }, fingerprint: null, metadata: null }
    const built = v3(buildExportManifest(project([
      video('a', 'V1', 0, 10 * US), image('still', 'V2', 0, 10 * US), adjustment('adj', 'V3', 0, 10 * US, graded(1)),
    ], [track('V1'), track('V2'), track('V3'), track('A1', 'audio')], [asset]), resolver()))
    expect(built.overlays).toEqual([])
    expect(built.clips.find((clip) => clip.id === 'still')?.lutId).toBeDefined()
  })

  it('ignores adjustment layers on hidden tracks', () => {
    const hidden = { ...track('V2'), hidden: true }
    const built = v3(buildExportManifest(project([video('a', 'V1', 0, 10 * US), adjustment('adj', 'V2', 0, 10 * US, graded(1))], [track('V1'), hidden]), resolver()))
    expect(built.clips[0].lutId).toBeUndefined()
    expect(built.luts).toEqual([])
  })

  it('splits a clip at the adjustment layer boundary: only the covered piece is graded', () => {
    const built = v3(buildExportManifest(project([video('a', 'V1', 0, 10 * US), adjustment('adj', 'V2', 4 * US, 10 * US, graded(1))]), resolver()))
    const pieces = built.clips.sort((a, b) => a.timelineStartUs - b.timelineStartUs)
    expect(pieces).toHaveLength(2)
    expect(pieces[0]).toMatchObject({ timelineStartUs: 0, sourceStartUs: 0, sourceEndUs: 4 * US })
    expect(pieces[0].lutId).toBeUndefined()
    expect(pieces[1]).toMatchObject({ timelineStartUs: 4 * US, sourceStartUs: 4 * US, sourceEndUs: 10 * US })
    expect(pieces[1].lutId).toBeDefined()
    // Each split piece is its own FFmpeg input reading the same file at its own sub-range.
    expect(built.inputs).toHaveLength(2)
    expect(new Set(built.inputs.map((input) => input.path))).toEqual(new Set(['/m/x.mp4']))
  })

  it('composes two stacked adjustment layers bottom-up into one baked LUT', () => {
    const built = v3(buildExportManifest(project([
      video('a', 'V1', 0, 10 * US),
      adjustment('lower', 'V2', 0, 10 * US, graded(1)),
      adjustment('upper', 'V3', 0, 10 * US, graded(1)),
    ], [track('V1'), track('V2'), track('V3'), track('A1', 'audio')]), resolver()))
    expect(built.clips).toHaveLength(1)
    expect(built.luts).toHaveLength(1)
    // Two stacked +1 stops compose to roughly +2 stops — strictly brighter than either alone.
    const [rBoth] = sampleAt(built, built.clips[0].lutId!, [0.3, 0.3, 0.3])
    const singleLayer = v3(buildExportManifest(project([video('a', 'V1', 0, 10 * US), adjustment('lower', 'V2', 0, 10 * US, graded(1))]), resolver()))
    const [rOne] = sampleAt(singleLayer, singleLayer.clips[0].lutId!, [0.3, 0.3, 0.3])
    expect(rBoth).toBeGreaterThan(rOne)
  })

  it('dedupes two adjustment layers with identical grades to one baked LUT', () => {
    const built = v3(buildExportManifest(project([
      video('a', 'V1', 0, 5 * US), video('b', 'V1', 5 * US, 5 * US),
      adjustment('adj1', 'V2', 0, 5 * US, graded(1)), adjustment('adj2', 'V2', 5 * US, 10 * US, graded(1)),
    ]), resolver()))
    expect(built.luts).toHaveLength(1)
    expect(built.clips.find((clip) => clip.id === 'a')!.lutId).toBe(built.clips.find((clip) => clip.id === 'b')!.lutId)
  })

  it('resolves a lut-type grade input through the resolver and bakes it in', () => {
    const identity: Cube3D = { size: 2, title: '', domainMin: [0, 0, 0], domainMax: [1, 1, 1], data: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1, 1, 1, 1]) }
    const lutGrade: Grade = { ...NEUTRAL_GRADE, input: { type: 'lut', assetId: 'user-lut' } }
    const built = v3(buildExportManifest(
      project([video('a', 'V1', 0, 10 * US), adjustment('adj', 'V2', 0, 10 * US, lutGrade)], undefined, [lutAsset('user-lut')]),
      resolver({ 'user-lut': identity }),
    ))
    expect(built.luts).toHaveLength(1)
    const [r, g, b] = sampleAt(built, built.clips[0].lutId!, [0.18, 0.18, 0.18])
    expect(Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)).toBe(true)
  })
})

describe('exportManifestV3Schema: lutId cross-reference', () => {
  const base = {
    version: 3 as const, cues: [], style: DEFAULT_CAPTION_STYLE, format, sequenceDurationUs: 5 * US,
    inputs: [{ path: '/m/x.mp4', kind: 'video' as const }],
  }
  it('rejects a clip naming a lut that does not exist, and accepts one that does', () => {
    const clip = { id: 'a', inputIndex: 0, assetId: 'x', kind: 'video' as const, trackIndex: 0, timelineStartUs: 0, sourceStartUs: 0, sourceEndUs: 5 * US, opacity: 1, fit: 'contain' as const, gain: 1, lutId: 'missing' }
    expect(exportManifestV3Schema.safeParse({ ...base, clips: [clip], luts: [] }).success).toBe(false)
    const real = { id: 'lut-1', size: 2, data: 'AAAAAAAAAAA=' }
    expect(exportManifestV3Schema.safeParse({ ...base, clips: [{ ...clip, lutId: 'lut-1' }], luts: [real] }).success).toBe(true)
  })

  it('a background never carries a lutId', () => {
    const bg = { id: 'bg', kind: 'color' as const, trackIndex: 0, timelineStartUs: 0, sourceStartUs: 0, sourceEndUs: 5 * US, opacity: 1, fit: 'contain' as const, gain: 0, fill: { type: 'solid' as const, color: '#000000' }, lutId: 'x' }
    expect(exportManifestV3Schema.safeParse({ ...base, clips: [bg], luts: [{ id: 'x', size: 2, data: 'AAAAAAAAAAA=' }] }).success).toBe(false)
  })
})
