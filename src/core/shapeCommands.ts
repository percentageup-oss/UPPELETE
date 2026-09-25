import type { Glass, Shape } from './edit'
import type { CaptionProject } from './model'
import { MAX_BLENDING_SHAPES, MAX_PASS_SHAPES, blendingShapes, passShapes } from './graphicsPasses'
import { glassProblem } from './glassRules'
import { normalizeShapeGeometry } from './shapePath'
import { sequenceDurationUs } from './timelineModel'
import { pruneGroups } from './groupCommands'
import { failItem, replaceById, type ItemFailure, type ItemStep } from './itemStep'

/** `glass: null` removes the glass look. */
export type ShapeChanges = Partial<Omit<Shape, 'id' | 'startUs' | 'endUs' | 'glass'>> & { glass?: Glass | null }
export type ShapeCommand =
  | { type: 'shape-add'; shape: Shape }
  | { type: 'shape-update'; shapeId: string; changes: ShapeChanges }
  | { type: 'shape-move'; shapeId: string; startUs: number }
  | { type: 'shape-trim'; shapeId: string; edge: 'start' | 'end'; deltaUs: number }
  | { type: 'shape-duplicate'; shapeId: string; duplicateId: string }
  | { type: 'shape-delete'; shapeId: string }
  | { type: 'shape-reorder'; shapeId: string; direction: 'forward' | 'backward' | 'above-captions' | 'below-captions' }

export const SHAPE_PRESETS = ['box', 'circle', 'arrow', 'dotted-arrow', 'underline', 'highlight'] as const
export type ShapePreset = (typeof SHAPE_PRESETS)[number]

const RED = '#E63946', INK = '#111111', MARKER = '#D4F53C'
const draw = (durationUs = 500_000) => ({ kind: 'draw' as const, durationUs })
const fade = { kind: 'fade' as const, durationUs: 250_000 }

/**
 * A ready-to-place shape for one preset, centred in a composition `compositionHeight` units tall.
 * Presets are only starting values: every field stays editable afterwards.
 */
export function defaultShape(preset: ShapePreset, id: string, startUs: number, endUs: number, compositionHeight = 608): Shape {
  const cx = 540, cy = compositionHeight / 2
  const base = { id, startUs, endUs, arrowStart: 'none' as const, arrowEnd: 'none' as const, opacity: 1, layerOrder: 1, exit: fade }
  switch (preset) {
    case 'box': return { ...base, name: 'Box', geometry: { kind: 'rect', rect: { x: cx - 220, y: cy - 130, width: 440, height: 260 }, cornerRadius: 12, rotation: 0 },
      stroke: { color: RED, width: 8, dash: 'solid', cap: 'round' }, fill: null, enter: draw() }
    case 'circle': return { ...base, name: 'Circle', geometry: { kind: 'ellipse', rect: { x: cx - 170, y: cy - 150, width: 340, height: 300 }, rotation: 0 },
      stroke: { color: RED, width: 8, dash: 'solid', cap: 'round' }, fill: null, enter: draw() }
    case 'arrow': return { ...base, name: 'Arrow', geometry: { kind: 'line', from: { x: cx - 220, y: cy + 90 }, to: { x: cx + 200, y: cy - 90 } },
      stroke: { color: INK, width: 8, dash: 'solid', cap: 'round' }, fill: null, arrowEnd: 'triangle', enter: draw() }
    case 'dotted-arrow': return { ...base, name: 'Dotted arrow', geometry: { kind: 'line', from: { x: cx - 240, y: cy - 70 }, to: { x: cx + 200, y: cy + 110 }, control: { x: cx + 40, y: cy - 170 } },
      stroke: { color: INK, width: 6, dash: 'dotted', cap: 'round' }, fill: null, arrowEnd: 'open', enter: draw(700_000) }
    case 'underline': return { ...base, name: 'Underline', geometry: { kind: 'line', from: { x: cx - 300, y: cy }, to: { x: cx + 300, y: cy } },
      stroke: { color: RED, width: 10, dash: 'solid', cap: 'round' }, fill: null, enter: draw(400_000) }
    case 'highlight': return { ...base, name: 'Highlight', layerOrder: -1, geometry: { kind: 'highlight', rect: { x: cx - 260, y: cy - 32, width: 520, height: 64 }, rotation: 0 },
      stroke: null, fill: { color: MARKER, opacity: .85 }, enter: { kind: 'sweep', durationUs: 500_000 } }
  }
}

const passCapMessage = `A project can hold at most ${MAX_PASS_SHAPES} blending and glass shapes together.`

function ordered(items: readonly Shape[]) {
  return [...items].sort((a, b) => a.startUs - b.startUs || a.layerOrder - b.layerOrder || a.id.localeCompare(b.id))
}
function clampToDuration(shape: Shape, durationUs: number): Shape | null {
  if (durationUs <= 0) return null
  const length = Math.max(1, Math.min(shape.endUs - shape.startUs, durationUs))
  const startUs = Math.max(0, Math.min(shape.startUs, durationUs - length))
  return { ...shape, startUs, endUs: startUs + length }
}

export function applyShapeCommand(project: CaptionProject, command: ShapeCommand): ItemStep | ItemFailure {
  const durationUs = sequenceDurationUs(project.clips) || Math.max(0, ...project.cues.map((cue) => cue.endUs))
  const inUse = (id: string) => project.shapes.some((item) => item.id === id) || project.textOverlays.some((item) => item.id === id)
  if (command.type === 'shape-add') {
    if (inUse(command.shape.id)) return failItem('asset-missing', [command.shape.id], 'That shape ID is already in use.')
    if (command.shape.blendMode !== undefined && blendingShapes(project.shapes).length >= MAX_BLENDING_SHAPES) return failItem('value-range', [command.shape.id], `A project can blend at most ${MAX_BLENDING_SHAPES} shapes.`)
    if (command.shape.glass !== undefined) {
      const problem = glassProblem(command.shape)
      if (problem) return failItem('value-range', [command.shape.id], problem)
    }
    if ((command.shape.glass !== undefined || command.shape.blendMode !== undefined) && passShapes(project.shapes).length >= MAX_PASS_SHAPES) return failItem('value-range', [command.shape.id], passCapMessage)
    const shape = clampToDuration({ ...command.shape, geometry: normalizeShapeGeometry(command.shape.geometry) }, durationUs)
    if (!shape) return failItem('invalid-duration', [command.shape.id], 'Add video to the timeline before adding a shape.')
    return { project: { ...project, shapes: ordered([...project.shapes, shape]) }, selection: { kind: 'shape', id: shape.id } }
  }
  const current = project.shapes.find((item) => item.id === command.shapeId)
  if (!current) return failItem('asset-missing', [command.shapeId], 'That shape no longer exists.')
  if (command.type === 'shape-delete') return { project: pruneGroups({ ...project, shapes: project.shapes.filter((item) => item.id !== current.id) }), selection: null }
  if (command.type === 'shape-duplicate') {
    if (inUse(command.duplicateId)) return failItem('asset-missing', [command.duplicateId], 'That shape ID is already in use.')
    const { blendMode: _blendMode, glass: _glass, groupId: _groupId, fitTo: _plainFit, fitPadding: _plainPadding, ...plain } = current
    const isPass = current.blendMode !== undefined || current.glass !== undefined
    const keepBlend = !isPass || (current.blendMode === undefined ? true : blendingShapes(project.shapes).length < MAX_BLENDING_SHAPES) && passShapes(project.shapes).length < MAX_PASS_SHAPES
    const { groupId: _leftGroup, fitTo: _fitTo, fitPadding: _fitPadding, ...ungrouped } = current
    const duplicate = clampToDuration({ ...(keepBlend ? ungrouped : plain), id: command.duplicateId, startUs: current.startUs + Math.min(250_000, Math.max(0, durationUs - current.endUs)) }, durationUs)
    if (!duplicate) return failItem('invalid-duration', [current.id], 'There is no room to duplicate this shape.')
    return { project: { ...project, shapes: ordered([...project.shapes, duplicate]) }, selection: { kind: 'shape', id: duplicate.id } }
  }
  if (command.type === 'shape-reorder') {
    const others = project.shapes.filter((item) => item.id !== current.id)
    let layerOrder = current.layerOrder
    if (command.direction === 'above-captions') layerOrder = Math.max(1, ...others.filter((item) => item.layerOrder > 0).map((item) => item.layerOrder))
    else if (command.direction === 'below-captions') layerOrder = Math.min(-1, ...others.filter((item) => item.layerOrder < 0).map((item) => item.layerOrder))
    else {
      const samePlane = others.filter((item) => Math.sign(item.layerOrder) === Math.sign(current.layerOrder)).sort((a, b) => a.layerOrder - b.layerOrder)
      const peer = command.direction === 'forward' ? samePlane.find((item) => item.layerOrder > current.layerOrder) : [...samePlane].reverse().find((item) => item.layerOrder < current.layerOrder)
      layerOrder = Math.max(-10000, Math.min(10000, current.layerOrder + (command.direction === 'forward' ? 1 : -1)))
      if (peer) layerOrder = command.direction === 'forward' ? Math.max(layerOrder, peer.layerOrder + 1) : Math.min(layerOrder, peer.layerOrder - 1)
    }
    return { project: { ...project, shapes: ordered(replaceById(project.shapes, current.id, (item) => ({ ...item, layerOrder }))!) }, selection: { kind: 'shape', id: current.id } }
  }
  let next = current
  if (command.type === 'shape-update') {
    const { glass, ...changes } = command.changes
    next = { ...current, ...changes, ...(changes.geometry ? { geometry: normalizeShapeGeometry(changes.geometry) } : {}) }
    if (glass === null) { const { glass: _removed, ...unglazed } = next; next = unglazed }
    else if (glass !== undefined) next = { ...next, glass }
    if (next.glass) {
      const problem = glassProblem(next)
      if (problem) return failItem('value-range', [current.id], problem)
      if (!current.glass && passShapes(project.shapes).length >= MAX_PASS_SHAPES) return failItem('value-range', [current.id], passCapMessage)
    }
  }
  if (command.type === 'shape-move') next = { ...current, startUs: command.startUs, endUs: command.startUs + current.endUs - current.startUs }
  if (command.type === 'shape-trim') next = command.edge === 'start'
    ? { ...current, startUs: Math.min(current.endUs - 1, Math.max(0, current.startUs + command.deltaUs)) }
    : { ...current, endUs: Math.max(current.startUs + 1, Math.min(durationUs || Number.MAX_SAFE_INTEGER, current.endUs + command.deltaUs)) }
  const clamped = clampToDuration(next, durationUs)
  if (!clamped) return failItem('invalid-duration', [current.id], 'A shape needs a non-zero sequence duration.')
  const shapes = replaceById(project.shapes, current.id, () => clamped)
  if (!shapes) return failItem('asset-missing', [current.id], 'That shape no longer exists.')
  return { project: { ...project, shapes: ordered(shapes) }, selection: { kind: 'shape', id: current.id } }
}
