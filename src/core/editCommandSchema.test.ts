import { describe, expect, it } from 'vitest'
import { editCommandSchema, captionCommandSchema, itemCommandSchema } from './editCommandSchema'
import { ITEM_COMMAND_TYPES } from './itemCommands'
import { defaultShape } from './shapeCommands'
import type { CaptionProject, Cue } from './model'
import type { Clip, ProjectAsset, Track, BlurRegion, Marker } from './edit'

const US = 1_000_000
const FINGERPRINT = { algorithm: 'sha256-sampled-v1' as const, value: 'a'.repeat(64), sizeBytes: 1, sampledBytes: 1 }
const meta = (durationUs: number | null) =>
  ({ durationUs, width: 1920, height: 1080, rotationDegrees: 0, frameRate: { numerator: 25, denominator: 1 }, nominalFrameRate: null, streams: [] })
const asset = (id: string, kind: ProjectAsset['kind'] = 'video'): ProjectAsset =>
  ({ id, kind, name: `${id}.mp4`, reference: { relativePath: null, absolutePath: `/media/${id}` }, fingerprint: FINGERPRINT, metadata: meta(10 * US) })
const track = (id: string, kind: Track['kind'] = 'video'): Track => ({ id, kind, name: '', muted: false, hidden: false, locked: false })
const clip = (id: string): Clip => ({ kind: 'video', id, trackId: 'V1', assetId: 'x', timelineStartUs: 0, sourceStartUs: 0, sourceEndUs: 5 * US, opacity: 1, fit: 'contain', gain: 1 })
const region = (id: string): BlurRegion => ({ id, startUs: 0, endUs: 2 * US, rect: { x: 0, y: 0, width: 100, height: 100 }, radius: 10, enabled: true })
const marker = (id: string): Marker => ({ id, atUs: US, text: 'insert logo here' })
const cue = (id: string): Cue => ({ id, mediaAssetId: 'x', startUs: 0, endUs: 2 * US, text: 'ഇത് React ആണ്', timingSource: 'imported', needsReview: false, textSource: 'imported', words: [] })

/** Every `CaptionCommand['type']` literal from `captionCommands.ts`, kept here as a literal list so
 * a new command variant that is added there but not mirrored in `editCommandSchema.ts` fails this
 * test instead of silently reaching the MCP agent bridge unvalidated. */
const CAPTION_COMMAND_TYPES = [
  'toggle-emphasis', 'estimate-words', 'update-text', 'update-time', 'shift-time', 'add', 'duplicate', 'delete', 'delete-word',
  'split', 'merge-next', 'regroup', 'regroup-many', 'set-timeline-display', 'set-display', 'set-caption-display',
  'apply-template', 'set-motion-override', 'reset-motion-overrides', 'set-placement-override', 'reset-placement-overrides',
  'line-break-before-word', 'split-before-word', 'move-from-word-to-next', 'move-through-word-to-previous',
] as const

describe('editCommandSchema coverage', () => {
  it('captionCommandSchema covers exactly every CaptionCommand type', () => {
    const schemaTypes = captionCommandSchema.options.map((option) => option.shape.type.value).sort()
    expect(schemaTypes).toEqual([...CAPTION_COMMAND_TYPES].sort())
  })

  it('itemCommandSchema covers exactly ITEM_COMMAND_TYPES', () => {
    const schemaTypes = itemCommandSchema.options.map((option) => option.shape.type.value).sort()
    expect(schemaTypes).toEqual([...ITEM_COMMAND_TYPES].sort())
  })

  it('editCommandSchema is the union of both, with no overlap', () => {
    const captionTypes = new Set(CAPTION_COMMAND_TYPES)
    const itemTypes = new Set(ITEM_COMMAND_TYPES)
    expect([...captionTypes].some((type) => itemTypes.has(type as never))).toBe(false)
    const schemaTypes = editCommandSchema.options.map((option) => option.shape.type.value).sort()
    expect(schemaTypes).toEqual([...captionTypes, ...itemTypes].sort())
  })
})

describe('editCommandSchema round trips real commands', () => {
  const cases: { name: string; command: unknown }[] = [
    { name: 'toggle-emphasis', command: { type: 'toggle-emphasis', cueId: 'c1', textStart: 0 } },
    { name: 'estimate-words', command: { type: 'estimate-words', cueId: 'c1', idPrefix: 'w', missingOnly: true } },
    { name: 'update-text', command: { type: 'update-text', cueId: 'c1', text: 'പുതിയ വാചകം' } },
    { name: 'update-text (estimateIfUntimed)', command: { type: 'update-text', cueId: 'c1', text: 'പുതിയ വാചകം', estimateIfUntimed: 'w' } },
    { name: 'update-time', command: { type: 'update-time', cueId: 'c1', startUs: 0, endUs: 2 * US } },
    { name: 'shift-time', command: { type: 'shift-time', cueId: 'c1', deltaUs: -500_000 } },
    { name: 'add', command: { type: 'add', cue: cue('c-new') } },
    { name: 'duplicate', command: { type: 'duplicate', cueId: 'c1', duplicateId: 'c1-copy' } },
    { name: 'delete', command: { type: 'delete', cueId: 'c1' } },
    { name: 'delete-word (wordId)', command: { type: 'delete-word', cueId: 'c1', target: { wordId: 'w1' } } },
    { name: 'delete-word (textStart)', command: { type: 'delete-word', cueId: 'c1', target: { textStart: 3 } } },
    { name: 'split', command: { type: 'split', cueId: 'c1', atUs: US, rightCueId: 'c2' } },
    { name: 'merge-next', command: { type: 'merge-next', cueId: 'c1' } },
    { name: 'regroup', command: { type: 'regroup', cueId: 'c1', idPrefix: 'g', estimateMissing: true } },
    { name: 'regroup-many', command: { type: 'regroup-many', cueIds: ['c1', 'c2'], idPrefix: 'g', estimateMissing: false } },
    { name: 'set-timeline-display', command: { type: 'set-timeline-display', display: 'word' } },
    { name: 'set-display', command: { type: 'set-display', display: 'line' } },
    { name: 'set-caption-display', command: { type: 'set-caption-display', display: 'word' } },
    { name: 'set-motion-override', command: { type: 'set-motion-override', cueId: 'c1', override: { motion: 'word-pop', motionSpeed: 1.5 } } },
    { name: 'reset-motion-overrides', command: { type: 'reset-motion-overrides' } },
    { name: 'set-placement-override', command: { type: 'set-placement-override', cueId: 'c1', override: { horizontal: .2, rotation: 15 } } },
    { name: 'reset-placement-overrides', command: { type: 'reset-placement-overrides' } },
    { name: 'line-break-before-word', command: { type: 'line-break-before-word', cueId: 'c1', target: { wordId: 'w1' } } },
    { name: 'split-before-word', command: { type: 'split-before-word', cueId: 'c1', wordId: 'w1', rightCueId: 'c2' } },
    { name: 'move-from-word-to-next', command: { type: 'move-from-word-to-next', cueId: 'c1', wordId: 'w1' } },
    { name: 'move-through-word-to-previous', command: { type: 'move-through-word-to-previous', cueId: 'c1', wordId: 'w1' } },
    { name: 'asset-add', command: { type: 'asset-add', asset: asset('y') } },
    { name: 'asset-remove', command: { type: 'asset-remove', assetId: 'y' } },
    { name: 'asset-update', command: { type: 'asset-update', assetId: 'y', changes: { name: 'renamed.mp4' } } },
    { name: 'track-add', command: { type: 'track-add', track: track('V2') } },
    { name: 'track-remove', command: { type: 'track-remove', trackId: 'V2' } },
    { name: 'track-update', command: { type: 'track-update', trackId: 'V1', changes: { muted: true } } },
    { name: 'track-reorder', command: { type: 'track-reorder', trackId: 'V1', direction: 'forward' } },
    { name: 'caption-track-add', command: { type: 'caption-track-add', track: { id: 'C2', name: '', locked: false } } },
    { name: 'caption-track-remove', command: { type: 'caption-track-remove', trackId: 'C2' } },
    { name: 'caption-track-update', command: { type: 'caption-track-update', trackId: 'C1', changes: { locked: true } } },
    { name: 'caption-track-reorder', command: { type: 'caption-track-reorder', trackId: 'C1', direction: 'forward' } },
    { name: 'caption-track-move-cue', command: { type: 'caption-track-move-cue', cueId: 'c1', trackId: 'C1' } },
    { name: 'clip-add', command: { type: 'clip-add', clip: clip('c-new'), mode: 'overwrite', idPrefix: 'p' } },
    { name: 'clip-move', command: { type: 'clip-move', clipId: 'c1', trackId: 'V1', startUs: US, mode: 'ripple', idPrefix: 'p' } },
    { name: 'clip-trim', command: { type: 'clip-trim', clipId: 'c1', edge: 'end', deltaUs: -1000, mode: 'overwrite' } },
    { name: 'clip-update (rect null)', command: { type: 'clip-update', clipId: 'c1', changes: { rect: null, opacity: 0.5 } } },
    { name: 'clip-trim-to', command: { type: 'clip-trim-to', atUs: US, edge: 'start', mode: 'ripple' } },
    { name: 'clip-split', command: { type: 'clip-split', atUs: US, idPrefix: 'p' } },
    { name: 'clip-delete', command: { type: 'clip-delete', clipId: 'c1', mode: 'ripple' } },
    { name: 'gap-close', command: { type: 'gap-close', trackId: 'V1', atUs: 0 } },
    { name: 'clips-set', command: { type: 'clips-set', keptByAsset: [{ assetId: 'x', ranges: [{ startUs: 0, endUs: US }] }], idPrefix: 'p' } },
    { name: 'clips-restore', command: { type: 'clips-restore' } },
    { name: 'format-set', command: { type: 'format-set', format: { width: 1080, height: 1920, frameRate: { numerator: 30, denominator: 1 } } } },
    { name: 'blur-add', command: { type: 'blur-add', region: region('b1') } },
    { name: 'blur-update', command: { type: 'blur-update', blurId: 'b1', changes: { radius: 20 } } },
    { name: 'blur-delete', command: { type: 'blur-delete', blurId: 'b1' } },
    { name: 'marker-add', command: { type: 'marker-add', marker: marker('m1') } },
    { name: 'marker-update', command: { type: 'marker-update', markerId: 'm1', changes: { text: 'moved note', color: '#ff8800' } } },
    { name: 'mask-set', command: { type: 'mask-set', target: { kind: 'clip', id: 'c1' }, mask: { enabled: true, invert: false, feather: 0, density: 1, shape: { kind: 'ellipse', rect: { x: 0, y: 0, width: 100, height: 100 } } } } },
    { name: 'layer-look-set', command: { type: 'layer-look-set', target: { kind: 'clip', id: 'c1' }, opacity: .5, blendMode: 'multiply' } },
    { name: 'layer-look-clear-blend', command: { type: 'layer-look-set', target: { kind: 'clip', id: 'c1' }, blendMode: null } },
    { name: 'layer-look-set (shape)', command: { type: 'layer-look-set', target: { kind: 'shape', id: 's1' }, blendMode: 'screen' } },
    { name: 'shape-add', command: { type: 'shape-add', shape: defaultShape('dotted-arrow', 's1', 0, 1_000_000) } },
    { name: 'shape-update', command: { type: 'shape-update', shapeId: 's1', changes: { opacity: .5, arrowEnd: 'triangle' } } },
    { name: 'shape-move', command: { type: 'shape-move', shapeId: 's1', startUs: 500_000 } },
    { name: 'shape-trim', command: { type: 'shape-trim', shapeId: 's1', edge: 'end', deltaUs: -100_000 } },
    { name: 'shape-duplicate', command: { type: 'shape-duplicate', shapeId: 's1', duplicateId: 's2' } },
    { name: 'shape-delete', command: { type: 'shape-delete', shapeId: 's1' } },
    { name: 'shape-reorder', command: { type: 'shape-reorder', shapeId: 's1', direction: 'above-captions' } },
    { name: 'mask-shape', command: { type: 'mask-set', target: { kind: 'shape', id: 's1' }, mask: null } },
    { name: 'mask-clear', command: { type: 'mask-set', target: { kind: 'captionTrack', id: 'ct' }, mask: null } },
    { name: 'marker-delete', command: { type: 'marker-delete', markerId: 'm1' } },
  ]

  for (const { name, command } of cases) {
    it(`accepts ${name}`, () => {
      const result = editCommandSchema.safeParse(command)
      expect(result.success, result.success ? undefined : JSON.stringify(result.error.issues)).toBe(true)
    })
  }

  it('rejects an unknown command type', () => {
    expect(editCommandSchema.safeParse({ type: 'delete-everything', cueId: 'c1' }).success).toBe(false)
  })

  it('rejects a command with an extra unknown field (strict)', () => {
    expect(editCommandSchema.safeParse({ type: 'merge-next', cueId: 'c1', evil: true }).success).toBe(false)
  })

  it('rejects negative durations that the type alone would allow through', () => {
    expect(editCommandSchema.safeParse({ type: 'shift-time', cueId: 'c1', deltaUs: 1.5 }).success).toBe(false)
  })
})

/** The command schema never touches `CaptionProject` directly, but this keeps the fixtures above
 * honest about the shape a real project's cues/assets/tracks/clips take. */
const _fixtureProjectShapeCheck: Pick<CaptionProject, 'cues' | 'assets' | 'tracks'> = { cues: [cue('c1')], assets: [asset('x')], tracks: [track('V1')] }
void _fixtureProjectShapeCheck
