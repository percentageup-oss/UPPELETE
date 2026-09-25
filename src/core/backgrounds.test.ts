import { describe, expect, it } from 'vitest'
import { applyEditCommand } from './commands'
import { backgroundTrackFor } from './clipEdits'
import { DEFAULT_BACKGROUND_CLIP_US } from './timelineDrop'
import { createProject, loadProject, projectSchema, projectSchemaV12, type CaptionProject } from './model'
import { summarizeProject } from './agentProtocol'
import { editCommandSchema } from './editCommandSchema'
import type { Clip, ColorClip, Track } from './edit'
import { buildExportManifest, exportManifestV3Schema, flatSequence, type ExportResolver } from '../export/plan'

const US = 1_000_000
const track = (id: string, kind: Track['kind'] = 'video', extra: Partial<Track> = {}): Track => ({ id, kind, name: '', muted: false, hidden: false, locked: false, ...extra })
const background = (extra: Partial<ColorClip> = {}): ColorClip => ({
  kind: 'color', id: 'bg', trackId: 'V1', timelineStartUs: 0, sourceStartUs: 0, sourceEndUs: 5 * US, opacity: 1, fit: 'contain',
  fill: { type: 'solid', color: '#112233' }, ...extra,
})
const video = (id: string, trackId: string, lengthUs = 10 * US): Clip =>
  ({ kind: 'video', id, trackId, assetId: 'vid', timelineStartUs: 0, sourceStartUs: 0, sourceEndUs: lengthUs, opacity: 1, fit: 'contain', gain: 1 })
const withClips = (clips: Clip[], tracks: Track[] = [track('V1'), track('V2'), track('A1', 'audio')]): CaptionProject => ({
  ...createProject(), format: { width: 1080, height: 1920, frameRate: { numerator: 30, denominator: 1 } },
  assets: [{ id: 'vid', kind: 'video', name: 'v.mp4', reference: { relativePath: null, absolutePath: '/media/v.mp4' }, fingerprint: null,
    metadata: { durationUs: 10 * US, width: 1080, height: 1920, rotationDegrees: 0, frameRate: { numerator: 30, denominator: 1 }, nominalFrameRate: null, streams: [] } }],
  tracks, clips,
})
const run = (project: CaptionProject, command: Parameters<typeof applyEditCommand>[1]) => {
  const result = applyEditCommand(project, command, { compositionHeight: 1920 })
  if (!result.ok) throw new Error(result.errors.map((error) => error.message).join(' '))
  return result.project
}

describe('schema 13', () => {
  it('accepts a color clip with no asset on a video track and rejects it on an audio track', () => {
    expect(projectSchema.safeParse(withClips([background()])).success).toBe(true)
    expect(projectSchema.safeParse(withClips([background({ trackId: 'A1' })])).success).toBe(false)
    expect(projectSchema.safeParse(withClips([{ ...background(), assetId: 'vid' } as unknown as Clip])).success).toBe(false)
  })

  it('rejects malformed fills and motions', () => {
    expect(projectSchema.safeParse(withClips([background({ fill: { type: 'solid', color: 'red' } })])).success).toBe(false)
    expect(projectSchema.safeParse(withClips([background({ fill: { type: 'gradient', from: '#000000', to: '#ffffff', angle: 400 } })])).success).toBe(false)
    expect(projectSchema.safeParse(withClips([background({ motion: { type: 'pulse', toward: 'black', depth: 2, periodUs: 4 * US } })])).success).toBe(false)
    expect(projectSchema.safeParse(withClips([background({ motion: { type: 'drift', direction: 0, periodUs: 10 } })])).success).toBe(false)
  })

  it('migrates a schema-12 project unchanged apart from the version', () => {
    const v12 = { ...withClips([video('c', 'V1')]), schemaVersion: 12 as const }
    expect(projectSchemaV12.safeParse(v12).success).toBe(true)
    const loaded = loadProject(v12)
    expect(loaded.migratedFrom).toBe(12)
    expect(loaded.project.schemaVersion).toBe(20)
    expect({ ...loaded.project, schemaVersion: 12 }).toEqual(v12)
  })

  it('round-trips a background through load', () => {
    const project = withClips([background({ motion: { type: 'shift', to: { type: 'solid', color: '#ff0000' }, periodUs: 4 * US } })])
    expect(loadProject(JSON.parse(JSON.stringify(project))).project.clips[0]).toEqual(project.clips[0])
  })
})

describe('background commands', () => {
  it('adds a background with no asset, and a new bottom track when asked', () => {
    const base = withClips([video('c', 'V1')])
    const next = run(base, { type: 'clip-add', clip: background({ trackId: 'V0' }), track: track('V0'), trackIndex: 0 })
    expect(next.tracks.map((entry) => entry.id)).toEqual(['V0', 'V1', 'V2', 'A1'])
    expect(next.clips.find((clip) => clip.id === 'bg')?.kind).toBe('color')
    expect(next.assets).toHaveLength(base.assets.length)
  })

  it('refuses a background on an audio track and reports no missing-asset error for a valid one', () => {
    const result = applyEditCommand(withClips([]), { type: 'clip-add', clip: background({ trackId: 'A1' }) }, { compositionHeight: 1920 })
    expect(result.ok).toBe(false)
    expect(applyEditCommand(withClips([]), { type: 'clip-add', clip: background() }, { compositionHeight: 1920 }).ok).toBe(true)
  })

  it('updates the fill and motion, stops the motion with null, and refuses them on other clips', () => {
    let project = run(withClips([background()]), { type: 'clip-update', clipId: 'bg', changes: { fill: { type: 'gradient', from: '#000000', to: '#ffffff', angle: 45 } } })
    expect((project.clips[0] as ColorClip).fill).toEqual({ type: 'gradient', from: '#000000', to: '#ffffff', angle: 45 })
    project = run(project, { type: 'clip-update', clipId: 'bg', changes: { motion: { type: 'drift', direction: 90, periodUs: 4 * US } } })
    expect((project.clips[0] as ColorClip).motion?.type).toBe('drift')
    project = run(project, { type: 'clip-update', clipId: 'bg', changes: { motion: null } })
    expect((project.clips[0] as ColorClip).motion).toBeUndefined()
    const refused = applyEditCommand(withClips([video('c', 'V1')]), { type: 'clip-update', clipId: 'c', changes: { fill: { type: 'solid', color: '#000000' } } }, { compositionHeight: 1920 })
    expect(refused.ok).toBe(false)
    const noSound = applyEditCommand(withClips([background()]), { type: 'clip-update', clipId: 'bg', changes: { gain: 1 } }, { compositionHeight: 1920 })
    expect(noSound.ok).toBe(false)
  })

  it('splits a background so the second half continues the first half’s loop', () => {
    const split = run(withClips([background({ sourceEndUs: 8 * US })]), { type: 'clip-split', atUs: 3 * US, idPrefix: 's' })
    const [left, right] = split.clips as ColorClip[]
    expect(left.sourceEndUs).toBe(3 * US)
    expect(right.timelineStartUs).toBe(3 * US)
    expect(right.sourceStartUs).toBe(3 * US)
  })

  it('validates over the MCP command schema', () => {
    expect(editCommandSchema.safeParse({ type: 'clip-add', clip: background(), trackIndex: 0, track: track('V0') }).success).toBe(true)
    expect(editCommandSchema.safeParse({ type: 'clip-update', clipId: 'bg', changes: { fill: { type: 'solid', color: '#00ff00' }, motion: null } }).success).toBe(true)
    expect(editCommandSchema.safeParse({ type: 'clip-update', clipId: 'bg', changes: { fill: { type: 'solid', color: 'green' } } }).success).toBe(false)
  })

  it('summarises a background with its fill instead of an asset id', () => {
    const summary = summarizeProject(withClips([background()]), null, 0, null, [])
    expect(summary.clips[0]).toMatchObject({ kind: 'color', assetId: null, fill: { type: 'solid', color: '#112233' } })
  })
})

describe('background placement', () => {
  it('lands under the picture: below every track that holds video, else a new bottom track', () => {
    const tracks = [track('V0'), track('V1'), track('V2')]
    const clips: Clip[] = [video('c', 'V1')]
    expect(backgroundTrackFor(tracks, clips, { startUs: 0, endUs: 5 * US })).toBe('V0')
    expect(backgroundTrackFor(tracks.slice(1), clips, { startUs: 0, endUs: 5 * US })).toBeNull()
  })

  it('never picks a track above the video, even when it is free', () => {
    expect(backgroundTrackFor([track('V1'), track('V2')], [video('c', 'V1')], { startUs: 0, endUs: 5 * US })).toBeNull()
  })

  it('honours the track it was dropped on when it is free, and skips locked ones', () => {
    const tracks = [track('V0'), track('V1'), track('V2')]
    expect(backgroundTrackFor(tracks, [video('c', 'V1')], { startUs: 0, endUs: US }, 'V2')).toBe('V2')
    expect(backgroundTrackFor([track('V0', 'video', { locked: true }), track('V1')], [video('c', 'V1')], { startUs: 0, endUs: US })).toBeNull()
  })

  it('takes any free video track when nothing on the timeline is a picture yet', () => {
    expect(backgroundTrackFor([track('V1'), track('V2')], [], { startUs: 0, endUs: US })).toBe('V1')
  })

  it('defaults to a short clip rather than the whole timeline', () => {
    expect(DEFAULT_BACKGROUND_CLIP_US).toBe(2 * US)
  })
})

describe('background export manifest', () => {
  const resolver: ExportResolver = { assetUrl: (asset) => `media://${asset.id}`, assetPath: (asset) => `/media/${asset.id}.mp4`, lutCube: () => { throw new Error('no lut in this test') } }
  const stacked = withClips([background({ id: 'bg', trackId: 'V0', sourceEndUs: 10 * US, motion: { type: 'drift', direction: 90, periodUs: 4 * US }, fill: { type: 'gradient', from: '#000000', to: '#ffffff', angle: 90 } }), video('c', 'V1')],
    [track('V0'), track('V1'), track('A1', 'audio')])

  it('forces the stacked v3 route and gives the background no input', () => {
    expect(flatSequence(stacked)).toBeNull()
    const { manifest, inputPaths } = buildExportManifest(stacked, resolver)
    const parsed = exportManifestV3Schema.parse(manifest)
    expect(parsed.inputs).toEqual([{ path: '/media/vid.mp4', kind: 'video' }])
    expect(inputPaths).toEqual(['/media/vid.mp4'])
    const [bg, vid] = [...parsed.clips].sort((a, b) => a.trackIndex - b.trackIndex)
    expect(bg).toMatchObject({ kind: 'color', trackIndex: 0, fill: { type: 'gradient' }, motion: { type: 'drift' }, gain: 0 })
    expect(bg.inputIndex).toBeUndefined()
    expect(vid).toMatchObject({ kind: 'video', inputIndex: 0, trackIndex: 1 })
  })

  it('exports a background-only timeline (no media file at all)', () => {
    const only = withClips([background()], [track('V1'), track('A1', 'audio')])
    const { manifest, inputPaths } = buildExportManifest(only, resolver)
    const parsed = exportManifestV3Schema.parse(manifest)
    expect(parsed.inputs).toEqual([])
    expect(inputPaths).toEqual([])
    expect(parsed.sequenceDurationUs).toBe(5 * US)
  })

  it('rejects a manifest whose color clip names an input or lacks a fill', () => {
    const { manifest } = buildExportManifest(stacked, resolver)
    const bad = (patch: object) => exportManifestV3Schema.safeParse({ ...manifest, clips: (manifest as { clips: object[] }).clips.map((clip) => ('fill' in clip ? { ...clip, ...patch } : clip)) }).success
    expect(bad({ inputIndex: 0 })).toBe(false)
    expect(bad({ fill: undefined })).toBe(false)
  })
})
