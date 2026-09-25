import { describe, expect, it } from 'vitest'
import { agentRequestSchema, summarizeProject, styleFieldRanges, listStyleOptions, summarizeCue } from './agentProtocol'
import type { CaptionProject, Cue } from './model'
import type { Clip, ProjectAsset, Track } from './edit'
import { DEFAULT_CAPTION_STYLE, captionAppearanceSchema } from '../captions/style'

const US = 1_000_000
const dates = { createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }
const asset = (id: string, kind: ProjectAsset['kind'] = 'video'): ProjectAsset =>
  ({ id, kind, name: `${id}.mp4`, reference: { relativePath: null, absolutePath: `/media/${id}` }, fingerprint: null, metadata: null })
const track = (id: string, kind: Track['kind'] = 'video'): Track => ({ id, kind, name: '', muted: false, hidden: false, locked: false })
const video = (id: string, trackId: string, timelineStartUs: number, sourceStartUs: number, sourceEndUs: number, assetId = 'x'): Clip =>
  ({ kind: 'video', id, trackId, assetId, timelineStartUs, sourceStartUs, sourceEndUs, opacity: 1, fit: 'contain', gain: 1 })
const cue = (id: string, extra: Partial<Cue> = {}): Cue =>
  ({ id, mediaAssetId: 'x', startUs: 0, endUs: 2 * US, text: 'ഇത് React ആണ്', timingSource: 'imported', needsReview: false, textSource: 'imported', words: [], ...extra })
const project = (extra: Partial<CaptionProject> = {}): CaptionProject => ({
  schemaVersion: 23, id: 'project', title: 'Test', cues: [cue('c1')],
  assets: [asset('x')], tracks: [track('V1')], clips: [video('clip1', 'V1', 0, 0, 20 * US)],
  captionTracks: [], blurRegions: [], zoomRegions: [], effects: [], textOverlays: [], shapes: [], markers: [], format: { width: 1080, height: 1920, frameRate: { numerator: 25, denominator: 1 } },
  ...dates, ...extra,
})

describe('summarizeProject', () => {
  it('reports duration, playhead and the video under the playhead', () => {
    const summary = summarizeProject(project(), '/tmp/x.cstudio', 5 * US, null, [])
    expect(summary.durationUs).toBe(20 * US)
    expect(summary.path).toBe('/tmp/x.cstudio')
    expect(summary.underPlayhead).toEqual({ assetId: 'x', clipId: 'clip1' })
    expect(summary.cueCount).toBe(1)
    expect(summary.assets).toEqual([{ id: 'x', kind: 'video', name: 'x.mp4' }])
  })

  it('reports no video under the playhead when the playhead is past every clip', () => {
    const summary = summarizeProject(project(), null, 30 * US, null, [])
    expect(summary.underPlayhead).toBeNull()
    expect(summary.path).toBeNull()
  })

  it('carries the selection and warnings through unchanged', () => {
    const warning = { kind: 'overlap' as const, cueIds: ['c1'], message: 'test' }
    const summary = summarizeProject(project(), null, 0, { kind: 'cue', id: 'c1' }, [warning])
    expect(summary.selection).toEqual({ kind: 'cue', id: 'c1' })
    expect(summary.warnings).toEqual([warning])
  })
})

describe('summarizeCue', () => {
  it('omits words by default and includes them on request', () => {
    const withWord = cue('c1', { words: [{ id: 'w1', text: 'ഇത്', startUs: 0, endUs: 500_000, timingSource: 'model', needsReview: false }] })
    expect(summarizeCue(withWord, false).words).toBeUndefined()
    expect(summarizeCue(withWord, true).words).toEqual([{ id: 'w1', text: 'ഇത്', startUs: 0, endUs: 500_000, timingSource: 'model' }])
  })
})

describe('styleFieldRanges', () => {
  it('covers every captionAppearanceSchema field', () => {
    const ranges = styleFieldRanges()
    expect(Object.keys(ranges).sort()).toEqual(Object.keys(captionAppearanceSchema.shape).sort())
  })

  it('reports the real min/max for a bounded number field', () => {
    const ranges = styleFieldRanges()
    expect(ranges.fontSize).toEqual({ kind: 'number', min: 20, max: 120 })
    expect(ranges.maxLines).toEqual({ kind: 'number', min: 1, max: 6 })
  })

  it('reports enum options and detects color/boolean fields', () => {
    const ranges = styleFieldRanges()
    expect(ranges.alignment).toEqual({ kind: 'enum', options: ['left', 'center', 'right'] })
    expect(ranges.shadowEnabled).toEqual({ kind: 'boolean' })
    expect(ranges.primaryColor).toEqual({ kind: 'color' })
  })

  it('every default style value satisfies its own reported range', () => {
    const ranges = styleFieldRanges()
    for (const [key, range] of Object.entries(ranges)) {
      const value = (DEFAULT_CAPTION_STYLE.appearance as Record<string, unknown>)[key]
      if (range.kind === 'number' && typeof value === 'number') {
        if (range.min !== null) expect(value).toBeGreaterThanOrEqual(range.min)
        if (range.max !== null) expect(value).toBeLessThanOrEqual(range.max)
      }
      if (range.kind === 'enum') expect(range.options).toContain(value)
    }
  })
})

describe('listStyleOptions', () => {
  it('includes built-in templates and field ranges', () => {
    const options = listStyleOptions()
    expect(options.templates.length).toBeGreaterThan(0)
    expect(options.templates[0]).toHaveProperty('id')
    expect(options.appearanceFieldRanges.fontSize).toEqual({ kind: 'number', min: 20, max: 120 })
    expect(options.motions.some((motion) => motion.id === 'word-pop')).toBe(true)
  })
})

describe('agentRequestSchema', () => {
  it('accepts every request kind with its own fields', () => {
    const cases: unknown[] = [
      { id: '1', kind: 'get-state' },
      { id: '1', kind: 'get-captions', range: { startUs: 0, endUs: US }, words: true },
      { id: '1', kind: 'get-captions' },
      { id: '1', kind: 'run-commands', commands: [{ type: 'merge-next', cueId: 'c1' }] },
      { id: '1', kind: 'seek', sequenceUs: 0 },
      { id: '1', kind: 'select', selection: { kind: 'cue', id: 'c1' } },
      { id: '1', kind: 'select', selection: null },
      { id: '1', kind: 'undo' },
      { id: '1', kind: 'redo' },
      { id: '1', kind: 'prepare-snapshot', sequenceUs: 0 },
    ]
    for (const request of cases) expect(agentRequestSchema.safeParse(request).success, JSON.stringify(request)).toBe(true)
  })

  it('rejects an empty run-commands batch and an unknown kind', () => {
    expect(agentRequestSchema.safeParse({ id: '1', kind: 'run-commands', commands: [] }).success).toBe(false)
    expect(agentRequestSchema.safeParse({ id: '1', kind: 'nonsense' }).success).toBe(false)
  })

  it('rejects extra fields (strict boundary)', () => {
    expect(agentRequestSchema.safeParse({ id: '1', kind: 'get-state', evil: true }).success).toBe(false)
  })
})
