import { describe, expect, it } from 'vitest'
import { DEFAULT_CAPTION_STYLE } from '../captions/style'
import { shapeSchema } from './edit'
import { applyItemCommand, type ItemCommand } from './itemCommands'
import { commitHistory, createHistory, undoHistory } from './history'
import type { CaptionProject } from './model'
import { defaultShape, SHAPE_PRESETS } from './shapeCommands'
import { defaultTextOverlay } from './textCommands'

const US = 1_000_000
const dates = { createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }
const meta = { durationUs: 20 * US, width: 1920, height: 1080, rotationDegrees: 0, frameRate: { numerator: 25, denominator: 1 }, nominalFrameRate: null, streams: [] }
const base = (extra: Partial<CaptionProject> = {}): CaptionProject => ({
  schemaVersion: 21, id: 'project', title: 'Test', cues: [],
  assets: [{ id: 'x', kind: 'video', name: 'x.mp4', reference: { relativePath: null, absolutePath: '/media/x' }, fingerprint: null, metadata: meta }],
  tracks: [{ id: 'V1', kind: 'video', name: '', muted: false, hidden: false, locked: false }],
  clips: [{ kind: 'video', id: 'c1', trackId: 'V1', assetId: 'x', timelineStartUs: 0, sourceStartUs: 0, sourceEndUs: 20 * US, opacity: 1, fit: 'contain', gain: 1 }],
  captionTracks: [], blurRegions: [], zoomRegions: [], effects: [], textOverlays: [], shapes: [], markers: [],
  format: { width: 1920, height: 1080, frameRate: { numerator: 25, denominator: 1 } }, captionStyle: DEFAULT_CAPTION_STYLE, ...dates, ...extra,
} as CaptionProject)
const run = (project: CaptionProject, command: ItemCommand) => {
  const result = applyItemCommand(project, command)
  if (!result.ok) throw new Error(result.errors.map((error) => error.message).join(' '))
  return result.project
}
const refuse = (project: CaptionProject, command: ItemCommand) => {
  const result = applyItemCommand(project, command)
  expect(result.ok).toBe(false)
}
const withShape = (id = 's1', preset: (typeof SHAPE_PRESETS)[number] = 'box', start = 2 * US, end = 5 * US) => run(base(), { type: 'shape-add', shape: defaultShape(preset, id, start, end) })

describe('defaultShape', () => {
  it('builds a valid schema-17 shape for every preset', () => {
    for (const preset of SHAPE_PRESETS) expect(shapeSchema.safeParse(defaultShape(preset, preset, 0, US)).success, preset).toBe(true)
  })

  it('puts the highlighter below the captions and everything else above them', () => {
    expect(defaultShape('highlight', 'h', 0, US).layerOrder).toBeLessThan(0)
    for (const preset of SHAPE_PRESETS.filter((name) => name !== 'highlight')) expect(defaultShape(preset, 'a', 0, US).layerOrder).toBeGreaterThan(0)
  })

  it('centres on the composition height it is given', () => {
    const tall = defaultShape('circle', 'c', 0, US, 1920)
    const wide = defaultShape('circle', 'c', 0, US, 608)
    if (tall.geometry.kind !== 'ellipse' || wide.geometry.kind !== 'ellipse') throw new Error('expected ellipse')
    expect(tall.geometry.rect.y).toBeGreaterThan(wide.geometry.rect.y)
  })
})

describe('shape commands', () => {
  it('adds, selects and keeps shapes ordered by start time', () => {
    const project = run(withShape('late', 'box', 8 * US, 9 * US), { type: 'shape-add', shape: defaultShape('circle', 'early', US, 2 * US) })
    expect(project.shapes.map((item) => item.id)).toEqual(['early', 'late'])
  })

  it('clamps a shape that runs past the sequence and refuses one with no sequence', () => {
    const clamped = run(base(), { type: 'shape-add', shape: defaultShape('box', 's', 18 * US, 30 * US) })
    expect(clamped.shapes[0].endUs).toBe(20 * US)
    refuse(base({ clips: [] }), { type: 'shape-add', shape: defaultShape('box', 's', 0, US) })
  })

  it('refuses an id already used by a shape or by text', () => {
    refuse(withShape('s1'), { type: 'shape-add', shape: defaultShape('box', 's1', 0, US) })
    const withText = base({ textOverlays: [defaultTextOverlay('t1', 0, US, 'Hi')] })
    refuse(withText, { type: 'shape-add', shape: defaultShape('box', 't1', 0, US) })
  })

  it('moves keeping length, and trims either edge without inverting', () => {
    const moved = run(withShape(), { type: 'shape-move', shapeId: 's1', startUs: 10 * US })
    expect([moved.shapes[0].startUs, moved.shapes[0].endUs]).toEqual([10 * US, 13 * US])
    const trimmedEnd = run(withShape(), { type: 'shape-trim', shapeId: 's1', edge: 'end', deltaUs: -US })
    expect(trimmedEnd.shapes[0].endUs).toBe(4 * US)
    const trimmedStart = run(withShape(), { type: 'shape-trim', shapeId: 's1', edge: 'start', deltaUs: 100 * US })
    expect(trimmedStart.shapes[0].startUs).toBeLessThan(trimmedStart.shapes[0].endUs)
  })

  it('updates fields and validates them through the schema', () => {
    const updated = run(withShape(), { type: 'shape-update', shapeId: 's1', changes: { opacity: .5, arrowEnd: 'dot' } })
    expect(updated.shapes[0]).toMatchObject({ opacity: .5, arrowEnd: 'dot' })
    refuse(withShape(), { type: 'shape-update', shapeId: 's1', changes: { stroke: null, fill: null } })
  })

  it('duplicates onto a new id and deletes', () => {
    const duplicated = run(withShape(), { type: 'shape-duplicate', shapeId: 's1', duplicateId: 's2' })
    expect(duplicated.shapes.map((item) => item.id).sort()).toEqual(['s1', 's2'])
    expect(run(duplicated, { type: 'shape-delete', shapeId: 's1' }).shapes.map((item) => item.id)).toEqual(['s2'])
    refuse(withShape(), { type: 'shape-delete', shapeId: 'nope' })
  })

  it('reorders above and below the captions', () => {
    const below = run(withShape(), { type: 'shape-reorder', shapeId: 's1', direction: 'below-captions' })
    expect(below.shapes[0].layerOrder).toBeLessThan(0)
    expect(run(below, { type: 'shape-reorder', shapeId: 's1', direction: 'above-captions' }).shapes[0].layerOrder).toBeGreaterThan(0)
  })

  it('undoes and redoes through the shared project history', () => {
    const start = base()
    const after = run(start, { type: 'shape-add', shape: defaultShape('box', 's1', 0, US) })
    const history = commitHistory(createHistory(start), after)
    expect(undoHistory(history).present.shapes).toEqual([])
  })

  it('collapses equal corner radii to the master and keeps the mean for distinct ones; undo restores', () => {
    const start = withShape()
    const box = start.shapes[0].geometry as Extract<typeof start.shapes[0]['geometry'], { kind: 'rect' }>
    const equal = run(start, { type: 'shape-update', shapeId: 's1', changes: { geometry: { ...box, cornerRadii: { tl: 30, tr: 30, br: 30, bl: 30 } } } })
    expect(equal.shapes[0].geometry).toMatchObject({ cornerRadius: 30 })
    expect(equal.shapes[0].geometry).not.toHaveProperty('cornerRadii')
    const distinct = run(start, { type: 'shape-update', shapeId: 's1', changes: { geometry: { ...box, cornerRadii: { tl: 0, tr: 40, br: 0, bl: 40 } } } })
    expect(distinct.shapes[0].geometry).toMatchObject({ cornerRadius: 20, cornerRadii: { tl: 0, tr: 40, br: 0, bl: 40 } })
    expect(undoHistory(commitHistory(createHistory(start), distinct)).present.shapes[0].geometry).toEqual(box)
  })

  it('masks a shape through mask-set', () => {
    const masked = run(withShape(), { type: 'mask-set', target: { kind: 'shape', id: 's1' }, mask: { enabled: true, invert: false, feather: 0, density: 1, shape: { kind: 'ellipse', rect: { x: 0, y: 0, width: 100, height: 100 } } } })
    expect(masked.shapes[0].mask).toBeDefined()
  })
})
