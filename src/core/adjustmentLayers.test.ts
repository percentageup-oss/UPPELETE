import { describe, expect, it } from 'vitest'
import { applyEditCommand } from './commands'
import { createProject, loadProject, projectSchema, projectSchemaV15, type CaptionProject } from './model'
import { summarizeProject } from './agentProtocol'
import { editCommandSchema } from './editCommandSchema'
import type { AdjustmentClip, Clip, Grade, PrimariesGrade, ProjectAsset, Track } from './edit'

const US = 1_000_000
const NEUTRAL_PRIMARIES: PrimariesGrade = {
  contrast: 0, highlights: 0, shadows: 0, saturation: 0, lift: [0, 0, 0], gamma: [0, 0, 0], gain: [0, 0, 0], exposureStops: 0, temperature: 0, tint: 0,
}
const NEUTRAL_GRADE: Grade = { input: { type: 'none' }, primaries: NEUTRAL_PRIMARIES, look: null, intensity: 1 }
const track = (id: string, kind: Track['kind'] = 'video', extra: Partial<Track> = {}): Track => ({ id, kind, name: '', muted: false, hidden: false, locked: false, ...extra })
const adjustment = (extra: Partial<AdjustmentClip> = {}): AdjustmentClip => ({
  kind: 'adjustment', id: 'adj', trackId: 'V1', timelineStartUs: 0, sourceStartUs: 0, sourceEndUs: 5 * US, grade: NEUTRAL_GRADE, ...extra,
})
const video = (id: string, trackId: string, lengthUs = 10 * US): Clip =>
  ({ kind: 'video', id, trackId, assetId: 'vid', timelineStartUs: 0, sourceStartUs: 0, sourceEndUs: lengthUs, opacity: 1, fit: 'contain', gain: 1 })
const lutAsset = (id: string): ProjectAsset =>
  ({ id, kind: 'lut', name: `${id}.cube`, reference: { relativePath: null, absolutePath: `/luts/${id}.cube` }, fingerprint: null, metadata: null })
const withClips = (clips: Clip[], tracks: Track[] = [track('V1'), track('V2'), track('A1', 'audio')], assets: ProjectAsset[] = []): CaptionProject => ({
  ...createProject(), format: { width: 1080, height: 1920, frameRate: { numerator: 30, denominator: 1 } },
  assets: [{ id: 'vid', kind: 'video', name: 'v.mp4', reference: { relativePath: null, absolutePath: '/media/v.mp4' }, fingerprint: null,
    metadata: { durationUs: 10 * US, width: 1080, height: 1920, rotationDegrees: 0, frameRate: { numerator: 30, denominator: 1 }, nominalFrameRate: null, streams: [] } }, ...assets],
  tracks, clips,
})
const run = (project: CaptionProject, command: Parameters<typeof applyEditCommand>[1]) => {
  const result = applyEditCommand(project, command, { compositionHeight: 1920 })
  if (!result.ok) throw new Error(result.errors.map((error) => error.message).join(' '))
  return result.project
}

describe('schema 16: adjustment clips', () => {
  it('accepts an adjustment clip with no asset on a video track and rejects it on an audio track', () => {
    expect(projectSchema.safeParse(withClips([adjustment()])).success).toBe(true)
    expect(projectSchema.safeParse(withClips([adjustment({ trackId: 'A1' })])).success).toBe(false)
    expect(projectSchema.safeParse(withClips([{ ...adjustment(), assetId: 'vid' } as unknown as Clip])).success).toBe(false)
  })

  it('rejects a grade whose primaries or look are out of range', () => {
    const bad = (grade: Partial<Grade>) => projectSchema.safeParse(withClips([adjustment({ grade: { ...NEUTRAL_GRADE, ...grade } as Grade })])).success
    expect(bad({ primaries: { ...NEUTRAL_PRIMARIES, exposureStops: 99 } })).toBe(false)
    expect(bad({ intensity: 2 })).toBe(false)
    expect(bad({ look: { id: 'not-a-real-look', strength: 1 } })).toBe(false)
    expect(bad({ input: { type: 'log', profile: 'not-a-real-profile' as never } })).toBe(false)
  })

  it('accepts every built-in look id and every log profile', () => {
    expect(projectSchema.safeParse(withClips([adjustment({ grade: { ...NEUTRAL_GRADE, look: { id: 'slide-vivid', strength: 0.5 } } })])).success).toBe(true)
    for (const profile of ['f-log', 'f-log2', 's-log3', 'apple-log', 'v-log', 'c-log3'] as const) {
      expect(projectSchema.safeParse(withClips([adjustment({ grade: { ...NEUTRAL_GRADE, input: { type: 'log', profile } } })])).success).toBe(true)
    }
  })

  it('requires a lut-input adjustment clip to name a real lut asset', () => {
    const grade: Grade = { ...NEUTRAL_GRADE, input: { type: 'lut', assetId: 'lut-1' } }
    expect(projectSchema.safeParse(withClips([adjustment({ grade })], undefined, [])).success).toBe(false)
    expect(projectSchema.safeParse(withClips([adjustment({ grade })], undefined, [lutAsset('lut-1')])).success).toBe(true)
    // Naming a video asset instead of a lut asset is still refused.
    expect(projectSchema.safeParse(withClips([adjustment({ grade: { ...NEUTRAL_GRADE, input: { type: 'lut', assetId: 'vid' } } })])).success).toBe(false)
  })

  it('widens the asset kind enum to include lut', () => {
    expect(projectSchema.safeParse(withClips([], undefined, [lutAsset('lut-1')])).success).toBe(true)
  })

  it('migrates a schema-15 project unchanged apart from the version', () => {
    const v15 = { ...withClips([video('c', 'V1')]), schemaVersion: 15 as const }
    expect(projectSchemaV15.safeParse(v15).success).toBe(true)
    const loaded = loadProject(v15)
    expect(loaded.migratedFrom).toBe(15)
    expect(loaded.project.schemaVersion).toBe(20)
    expect({ ...loaded.project, schemaVersion: 15 }).toEqual(v15)
  })

  it('round-trips an adjustment clip through load', () => {
    const project = withClips([adjustment({ grade: { ...NEUTRAL_GRADE, intensity: 0.4, look: { id: 'mono-deep', strength: 0.7 } } })])
    expect(loadProject(JSON.parse(JSON.stringify(project))).project.clips[0]).toEqual(project.clips[0])
  })
})

describe('adjustment layer commands', () => {
  it('adds an adjustment layer with no asset, and a new bottom track when asked', () => {
    const base = withClips([video('c', 'V1')])
    const next = run(base, { type: 'clip-add', clip: adjustment({ trackId: 'V0' }), track: track('V0'), trackIndex: 0 })
    expect(next.tracks.map((entry) => entry.id)).toEqual(['V0', 'V1', 'V2', 'A1'])
    expect(next.clips.find((clip) => clip.id === 'adj')?.kind).toBe('adjustment')
    expect(next.assets).toHaveLength(base.assets.length)
  })

  it('refuses an adjustment layer on an audio track', () => {
    const result = applyEditCommand(withClips([]), { type: 'clip-add', clip: adjustment({ trackId: 'A1' }) }, { compositionHeight: 1920 })
    expect(result.ok).toBe(false)
  })

  it('updates the grade, and refuses a grade on other clips', () => {
    const graded: Grade = { ...NEUTRAL_GRADE, intensity: 0.6, primaries: { ...NEUTRAL_PRIMARIES, exposureStops: 1 } }
    const project = run(withClips([adjustment()]), { type: 'clip-update', clipId: 'adj', changes: { grade: graded } })
    expect((project.clips[0] as AdjustmentClip).grade).toEqual(graded)
    const refused = applyEditCommand(withClips([video('c', 'V1')]), { type: 'clip-update', clipId: 'c', changes: { grade: graded } }, { compositionHeight: 1920 })
    expect(refused.ok).toBe(false)
  })

  it('refuses rect, opacity, fit and gain on an adjustment layer', () => {
    const base = withClips([adjustment()])
    expect(applyEditCommand(base, { type: 'clip-update', clipId: 'adj', changes: { opacity: 0.5 } }, { compositionHeight: 1920 }).ok).toBe(false)
    expect(applyEditCommand(base, { type: 'clip-update', clipId: 'adj', changes: { fit: 'cover' } }, { compositionHeight: 1920 }).ok).toBe(false)
    expect(applyEditCommand(base, { type: 'clip-update', clipId: 'adj', changes: { gain: 2 } }, { compositionHeight: 1920 }).ok).toBe(false)
    expect(applyEditCommand(base, { type: 'clip-update', clipId: 'adj', changes: { rect: { x: 0, y: 0, width: 100, height: 100 } } }, { compositionHeight: 1920 }).ok).toBe(false)
  })

  it('splits an adjustment layer, each half keeping its own grade', () => {
    const graded = { ...NEUTRAL_GRADE, intensity: 0.3 }
    const split = run(withClips([adjustment({ sourceEndUs: 8 * US, grade: graded })]), { type: 'clip-split', atUs: 3 * US, idPrefix: 's' })
    const [left, right] = split.clips as AdjustmentClip[]
    expect(left.sourceEndUs).toBe(3 * US)
    expect(right.timelineStartUs).toBe(3 * US)
    expect(left.grade).toEqual(graded)
    expect(right.grade).toEqual(graded)
  })

  it('the enabled toggle bypasses an adjustment layer like any other clip', () => {
    const project = run(withClips([adjustment()]), { type: 'clip-update', clipId: 'adj', changes: { enabled: false } })
    expect(project.clips[0].enabled).toBe(false)
  })

  it('validates over the MCP command schema', () => {
    expect(editCommandSchema.safeParse({ type: 'clip-add', clip: adjustment(), trackIndex: 0, track: track('V0') }).success).toBe(true)
    expect(editCommandSchema.safeParse({ type: 'clip-update', clipId: 'adj', changes: { grade: NEUTRAL_GRADE } }).success).toBe(true)
    expect(editCommandSchema.safeParse({ type: 'clip-update', clipId: 'adj', changes: { grade: { ...NEUTRAL_GRADE, intensity: 5 } } }).success).toBe(false)
  })

  it('summarises an adjustment layer with no asset id', () => {
    const summary = summarizeProject(withClips([adjustment()]), null, 0, null, [])
    expect(summary.clips[0]).toMatchObject({ kind: 'adjustment', assetId: null })
  })
})
