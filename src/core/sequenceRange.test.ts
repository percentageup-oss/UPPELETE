import { describe, expect, it } from 'vitest'
import type { Clip, ProjectAsset, Track } from './edit'
import { projectSchema, type CaptionProject, type Cue } from './model'
import { isValidRange, projectInRange } from './sequenceRange'
import { serializeSrt } from './srt'
import { cuesInSequence } from './timelineModel'
import { buildExportManifest, exportOutputDurationUs, type ExportResolver } from '../export/plan'
import { defaultTextOverlay } from './textCommands'

const US = 1_000_000
const dates = { createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }
const meta = { durationUs: 20 * US, width: 1920, height: 1080, rotationDegrees: 0, frameRate: { numerator: 25, denominator: 1 }, nominalFrameRate: null, streams: [] }
const asset = (id: string, kind: ProjectAsset['kind']): ProjectAsset => ({ id, kind, name: `${id}.bin`, reference: { relativePath: null, absolutePath: `/m/${id}` }, fingerprint: null, metadata: kind === 'image' ? { ...meta, durationUs: null } : meta })
const track = (id: string, kind: Track['kind']): Track => ({ id, kind, name: '', muted: false, hidden: false, locked: false })
const video = (id: string, start: number, from: number, to: number, extra: Partial<Clip> = {}): Clip =>
  ({ kind: 'video', id, trackId: 'V1', assetId: 'x', timelineStartUs: start, sourceStartUs: from, sourceEndUs: to, opacity: 1, fit: 'contain', gain: 1, ...extra }) as Clip
const cue = (id: string, startUs: number, endUs: number, extra: Partial<Cue> = {}): Cue =>
  ({ id, mediaAssetId: 'x', startUs, endUs, text: 'ഇത് React ആണ്', timingSource: 'imported', needsReview: false, textSource: 'imported', words: [], ...extra })
const project = (extra: Partial<CaptionProject> = {}): CaptionProject => ({
  schemaVersion: 21, id: 'p', title: 'T', cues: [], assets: [asset('x', 'video'), asset('img', 'image')],
  tracks: [track('V1', 'video'), track('V2', 'video'), track('A1', 'audio')], clips: [video('c1', 0, 0, 20 * US)],
  captionTracks: [], blurRegions: [], zoomRegions: [], effects: [], textOverlays: [], shapes: [], markers: [],
  format: { width: 1920, height: 1080, frameRate: { numerator: 25, denominator: 1 } }, ...dates, ...extra,
} as CaptionProject)
const range = { startUs: 4 * US, endUs: 10 * US }
const rect = { x: 100, y: 50, width: 540, height: 304 }

describe('projectInRange', () => {
  it('crops clips at both ends, drops outsiders and stays a valid project', () => {
    const base = project({ clips: [video('a', 0, 0, 6 * US), video('b', 6 * US, 0, 8 * US), video('c', 14 * US, 0, 2 * US), video('d', 10 * US, 0, 2 * US)] })
    const out = projectInRange(base, range)
    expect(out.clips.map((clip) => [clip.id, clip.timelineStartUs, clip.sourceStartUs, clip.sourceEndUs])).toEqual([
      ['a', 0, 4 * US, 6 * US], ['b', 2 * US, 0, 4 * US],
    ])
    expect(projectSchema.safeParse(out).success).toBe(true)
  })

  it('maps a speed-changed clip through its curve instead of assuming 1x', () => {
    const fast = video('a', 0, 0, 20 * US, { speed: { points: [{ sourceUs: 0, rate: 2 }] } } as Partial<Clip>)
    const out = projectInRange(project({ clips: [fast] }), { startUs: 2 * US, endUs: 5 * US })
    expect(out.clips[0]).toMatchObject({ timelineStartUs: 0, sourceStartUs: 4 * US, sourceEndUs: 10 * US })
  })

  it('crops images to a synthetic 0-anchored source range', () => {
    const still: Clip = { kind: 'image', id: 'i', trackId: 'V2', assetId: 'img', timelineStartUs: 2 * US, sourceStartUs: 0, sourceEndUs: 6 * US, opacity: 1, fit: 'contain' } as Clip
    const [cropped] = projectInRange(project({ clips: [video('c1', 0, 0, 20 * US), still] }), range).clips.filter((clip) => clip.kind === 'image')
    expect(cropped).toMatchObject({ timelineStartUs: 0, sourceStartUs: 0, sourceEndUs: 4 * US })
  })

  it('exports an SRT that starts at zero, drops outside cues and clips a straddling one, keeping Malayalam intact', () => {
    const base = project({ cues: [cue('before', 0, 3 * US), cue('straddle', 3 * US, 6 * US, { text: 'ഇത് React ആണ്' }), cue('inside', 7 * US, 9 * US), cue('after', 12 * US, 14 * US)] })
    const cropped = projectInRange(base, range)
    const srt = serializeSrt(cuesInSequence(cropped.cues, cropped.clips))
    expect(srt).toContain('00:00:00,000 --> 00:00:02,000')
    expect(srt).toContain('00:00:03,000 --> 00:00:05,000')
    expect(srt.match(/ഇത് React ആണ്/g)).toHaveLength(2)
    expect(srt).not.toContain('before')
    expect(cuesInSequence(cropped.cues, cropped.clips)).toHaveLength(2)
  })

  it('shifts and crops every sequence-time item, and an unbound cue with its words', () => {
    const overlay = defaultTextOverlay('title', 2 * US, 8 * US, 'Hi')
    const base = project({
      clips: [], assets: [],
      cues: [cue('u', 3 * US, 7 * US, { mediaAssetId: undefined, words: [{ id: 'w1', text: 'a', startUs: 3 * US, endUs: 5 * US, timingSource: 'estimated' }, { id: 'w2', text: 'b', startUs: 6 * US, endUs: 7 * US, timingSource: 'estimated' }] } as Partial<Cue>)],
      blurRegions: [{ id: 'bl', startUs: 5 * US, endUs: 12 * US, rect, radius: 10, enabled: true } as never],
      textOverlays: [overlay], markers: [{ id: 'm1', atUs: 3 * US, text: '' }, { id: 'm2', atUs: 6 * US, text: '' }],
    })
    const out = projectInRange(base, range)
    expect(out.cues[0]).toMatchObject({ startUs: 0, endUs: 3 * US })
    expect(out.cues[0].words.map((word) => [word.startUs, word.endUs])).toEqual([[0, US], [2 * US, 3 * US]])
    expect(out.blurRegions[0]).toMatchObject({ startUs: US, endUs: 6 * US })
    expect(out.textOverlays[0]).toMatchObject({ startUs: 0, endUs: 4 * US })
    expect(out.markers).toEqual([{ id: 'm2', atUs: 2 * US, text: '' }])
  })

  it('continues a pan from the frame it had reached and keeps its true end', () => {
    const pan = { id: 'z', startUs: 0, endUs: 12 * US, rect, fromRect: { x: 0, y: 0, width: 1080, height: 607 }, easeInUs: 0, easeOutUs: 0, enabled: true }
    const [out] = projectInRange(project({ zoomRegions: [pan] }), range).zoomRegions
    expect(out.startUs).toBe(0)
    expect(out.endUs).toBe(8 * US)
    expect(out.fromRect).not.toEqual(pan.fromRect)
    expect(out.fromRect!.width).toBeLessThan(1080)
    expect(out.fromRect!.width).toBeGreaterThan(rect.width)
  })

  it('leaves the whole timeline unchanged for the identity range', () => {
    const base = project({ clips: [video('a', 0, 0, 6 * US), video('b', 6 * US, 0, 8 * US)], cues: [cue('c', US, 3 * US)], markers: [{ id: 'm', atUs: US, text: '' }] })
    expect(projectInRange(base, { startUs: 0, endUs: 14 * US })).toEqual(base)
  })

  it('builds a manifest whose output is exactly Out − In, and leaves the whole-timeline manifest untouched', () => {
    const resolver: ExportResolver = { assetUrl: (a) => `media://local${a.reference.absolutePath}`, assetPath: (a) => a.reference.absolutePath!, lutCube: () => { throw new Error('no lut in this test') } }
    const base = project({ cues: [cue('a', 5 * US, 8 * US)] })
    const whole = buildExportManifest(base, resolver)
    expect(exportOutputDurationUs(whole.plan, whole.manifest as never)).toBe(20 * US)
    const part = buildExportManifest(projectInRange(base, range), resolver)
    expect(exportOutputDurationUs(part.plan, part.manifest as never)).toBe(6 * US)
    expect(buildExportManifest(projectInRange(base, { startUs: 0, endUs: 20 * US }), resolver)).toEqual(whole)
  })

  it('validates ranges against the sequence', () => {
    expect(isValidRange(range, 12 * US)).toBe(true)
    expect(isValidRange({ startUs: 5, endUs: 5 }, 12 * US)).toBe(false)
    expect(isValidRange({ startUs: 0, endUs: 13 * US }, 12 * US)).toBe(false)
    expect(isValidRange({ startUs: -1, endUs: US }, 12 * US)).toBe(false)
  })

  // Guard: a project field that carries times must be handled by projectInRange. When the schema
  // gains an array, decide here whether it needs cropping and add it to one of the two lists.
  it('accounts for every array field of the project schema', () => {
    const handled = ['cues', 'clips', 'blurRegions', 'zoomRegions', 'effects', 'textOverlays', 'shapes', 'markers']
    const timeless = ['assets', 'tracks', 'captionTracks', 'transcriptionRuns', 'alignmentRuns', 'presets', 'stylePresets', 'savedPresets']
    const arrays = Object.entries(projectSchema.shape).filter(([, schema]) => /ZodArray/.test(schema.constructor.name) || /ZodDefault/.test(schema.constructor.name) && /ZodArray/.test((schema as { _def: { innerType: { constructor: { name: string } } } })._def.innerType.constructor.name)).map(([key]) => key)
    expect(arrays.filter((key) => !handled.includes(key) && !timeless.includes(key))).toEqual([])
  })
})
