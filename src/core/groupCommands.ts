import { COMPOSITION_WIDTH, type Shape, type TextOverlay } from './edit'
import type { CaptionProject } from './model'
import { MAX_BLENDING_SHAPES, MAX_PASS_SHAPES, blendingShapes, passShapes } from './graphicsPasses'
import { scaleShapeGeometry, translateShapeGeometry } from './shapePath'
import { sequenceDurationUs } from './timelineModel'
import { failItem, type ItemFailure, type ItemStep } from './itemStep'

export type GroupCommand =
  | { type: 'group-create'; groupId: string; name?: string; itemIds: string[] }
  | { type: 'group-ungroup'; groupId: string }
  | { type: 'group-rename'; groupId: string; name: string }
  | { type: 'group-move'; groupId: string; startUs: number }
  | { type: 'group-translate'; groupId: string; dx: number; dy: number }
  | { type: 'group-scale'; groupId: string; factor: number; anchor: { x: number; y: number } }
  /** `idMap` maps the group's own id and every member id to the new id for its copy. */
  | { type: 'group-duplicate'; groupId: string; idMap: Record<string, string> }
  | { type: 'group-delete'; groupId: string }

export type GroupMember = { kind: 'shape'; item: Shape } | { kind: 'text'; item: TextOverlay }

/** The shapes and text overlays that belong to a group, in project order (shapes first). */
export function groupMembers(project: CaptionProject, groupId: string): GroupMember[] {
  return [
    ...project.shapes.filter((item) => item.groupId === groupId).map((item): GroupMember => ({ kind: 'shape', item })),
    ...project.textOverlays.filter((item) => item.groupId === groupId).map((item): GroupMember => ({ kind: 'text', item })),
  ]
}

/** A stable accent hue (0..359) for a group, so its members and rows share one colour on the timeline and Layers tab. */
export function groupHue(groupId: string): number {
  let hash = 0
  for (let index = 0; index < groupId.length; index++) hash = (hash * 31 + groupId.charCodeAt(index)) >>> 0
  return hash % 360
}

/** The time range every member of a group covers together, or null for an unknown or empty group. */
export function groupSpan(project: CaptionProject, groupId: string): { startUs: number; endUs: number; count: number } | null {
  const members = groupMembers(project, groupId)
  if (members.length === 0) return null
  return { startUs: Math.min(...members.map((member) => member.item.startUs)), endUs: Math.max(...members.map((member) => member.item.endUs)), count: members.length }
}

/** Deletes every group with fewer than two members and clears the `groupId` of any member left behind. Returns the same project when nothing changed. */
export function pruneGroups(project: CaptionProject): CaptionProject {
  const counts = new Map<string, number>()
  for (const item of [...project.shapes, ...project.textOverlays]) if (item.groupId) counts.set(item.groupId, (counts.get(item.groupId) ?? 0) + 1)
  const small = new Set((project.groups ?? []).filter((group) => (counts.get(group.id) ?? 0) < 2).map((group) => group.id))
  if (small.size === 0) return project
  const clear = <T extends { groupId?: string }>(item: T): T => {
    if (!item.groupId || !small.has(item.groupId)) return item
    const { groupId: _groupId, ...rest } = item
    return rest as T
  }
  return {
    ...project,
    groups: (project.groups ?? []).filter((group) => !small.has(group.id)),
    shapes: project.shapes.map(clear),
    textOverlays: project.textOverlays.map(clear),
  }
}

const orderKey = (a: { startUs: number; layerOrder: number; id: string }, b: { startUs: number; layerOrder: number; id: string }) =>
  a.startUs - b.startUs || a.layerOrder - b.layerOrder || a.id.localeCompare(b.id)
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/** `compositionHeight` is the composition's height in composition units (width is always 1080); it maps text positions, which are stored as 0..1 of the frame. */
export function applyGroupCommand(project: CaptionProject, command: GroupCommand, compositionHeight?: number | null): ItemStep | ItemFailure {
  const durationUs = sequenceDurationUs(project.clips) || Math.max(0, ...project.cues.map((cue) => cue.endUs))
  const height = compositionHeight && compositionHeight > 0 ? compositionHeight
    : project.format ? COMPOSITION_WIDTH * project.format.height / project.format.width : 608

  if (command.type === 'group-create') {
    if ((project.groups ?? []).some((group) => group.id === command.groupId)) return failItem('asset-missing', [command.groupId], 'That group ID is already in use.')
    const ids = [...new Set(command.itemIds)]
    if (ids.length < 2) return failItem('value-range', ids, 'A group needs at least two different items.')
    const known = new Map<string, { groupId?: string }>([...project.shapes, ...project.textOverlays].map((item) => [item.id, item]))
    const missing = ids.filter((id) => !known.has(id))
    if (missing.length) return failItem('asset-missing', missing, 'Only existing shapes and text items can be grouped.')
    const taken = ids.filter((id) => known.get(id)!.groupId !== undefined)
    if (taken.length) return failItem('value-range', taken, 'Those items already belong to a group; ungroup them first.')
    if ((project.groups ?? []).length >= 200) return failItem('value-range', [command.groupId], 'A project can hold at most 200 groups.')
    const chosen = new Set(ids)
    const join = <T extends { id: string }>(item: T): T => (chosen.has(item.id) ? { ...item, groupId: command.groupId } : item)
    return { project: { ...project, groups: [...(project.groups ?? []), { id: command.groupId, name: command.name ?? '' }], shapes: project.shapes.map(join), textOverlays: project.textOverlays.map(join) } }
  }

  const group = (project.groups ?? []).find((item) => item.id === command.groupId)
  if (!group) return failItem('asset-missing', [command.groupId], 'That group no longer exists.')
  const members = groupMembers(project, group.id)

  if (command.type === 'group-rename') return { project: { ...project, groups: (project.groups ?? []).map((item) => (item.id === group.id ? { ...item, name: command.name } : item)) } }

  if (command.type === 'group-ungroup') {
    const leave = <T extends { groupId?: string }>(item: T): T => {
      if (item.groupId !== group.id) return item
      const { groupId: _groupId, ...rest } = item
      return rest as T
    }
    return { project: { ...project, groups: (project.groups ?? []).filter((item) => item.id !== group.id), shapes: project.shapes.map(leave), textOverlays: project.textOverlays.map(leave) } }
  }

  if (command.type === 'group-delete') {
    return {
      project: {
        ...project,
        groups: (project.groups ?? []).filter((item) => item.id !== group.id),
        shapes: project.shapes.filter((item) => item.groupId !== group.id),
        textOverlays: project.textOverlays.filter((item) => item.groupId !== group.id),
      },
      selection: null,
    }
  }

  const inGroup = <T extends { groupId?: string }>(item: T) => item.groupId === group.id
  const mapShapes = (update: (shape: Shape) => Shape) => project.shapes.map((item) => (inGroup(item) ? update(item) : item)).sort(orderKey)
  const mapTexts = (update: (text: TextOverlay) => TextOverlay) => project.textOverlays.map((item) => (inGroup(item) ? update(item) : item)).sort(orderKey)

  if (command.type === 'group-move') {
    if (durationUs <= 0) return failItem('invalid-duration', [group.id], 'A group needs a non-zero sequence duration.')
    const spans = members.map((member) => member.item)
    const earliest = Math.min(...spans.map((item) => item.startUs)), latest = Math.max(...spans.map((item) => item.endUs))
    const lowest = -earliest
    const delta = clamp(command.startUs - earliest, lowest, Math.max(lowest, durationUs - latest))
    if (delta === 0) return { project }
    const shift = <T extends { startUs: number; endUs: number }>(item: T): T => ({ ...item, startUs: item.startUs + delta, endUs: item.endUs + delta })
    return { project: { ...project, shapes: mapShapes(shift), textOverlays: mapTexts(shift) } }
  }

  if (command.type === 'group-translate') {
    const { dx, dy } = command
    return {
      project: {
        ...project,
        shapes: mapShapes((shape) => ({ ...shape, geometry: translateShapeGeometry(shape.geometry, dx, dy) })),
        textOverlays: mapTexts((text) => ({ ...text, style: { ...text.style, appearance: {
          ...text.style.appearance,
          horizontal: clamp(text.style.appearance.horizontal + dx / COMPOSITION_WIDTH, 0, 1),
          vertical: clamp(text.style.appearance.vertical + dy / height, 0, 1),
        } } })),
      },
    }
  }

  if (command.type === 'group-scale') {
    const { factor, anchor } = command
    if (!(factor > 0)) return failItem('value-range', [group.id], 'A group scale factor must be greater than zero.')
    return {
      project: {
        ...project,
        shapes: mapShapes((shape) => ({
          ...shape,
          geometry: scaleShapeGeometry(shape.geometry, factor, anchor),
          stroke: shape.stroke ? { ...shape.stroke, width: clamp(shape.stroke.width * factor, 0, 80) } : null,
          ...(shape.fitPadding ? { fitPadding: [clamp(shape.fitPadding[0] * factor, 0, 2000), clamp(shape.fitPadding[1] * factor, 0, 2000)] as [number, number] } : {}),
        })),
        textOverlays: mapTexts((text) => {
          const { appearance } = text.style
          const x = anchor.x + (appearance.horizontal * COMPOSITION_WIDTH - anchor.x) * factor
          const y = anchor.y + (appearance.vertical * height - anchor.y) * factor
          return { ...text, style: { ...text.style, appearance: {
            ...appearance,
            fontSize: clamp(appearance.fontSize * factor, 20, 120),
            horizontal: clamp(x / COMPOSITION_WIDTH, 0, 1),
            vertical: clamp(y / height, 0, 1),
          } } }
        }),
      },
    }
  }

  // group-duplicate
  const sources = [group.id, ...members.map((member) => member.item.id)]
  const copies = sources.map((id) => command.idMap[id])
  if (copies.some((id) => !id)) return failItem('asset-missing', sources.filter((id) => !command.idMap[id]), 'idMap needs a new ID for the group and for each of its members.')
  const inUse = new Set([...project.shapes, ...project.textOverlays].map((item) => item.id))
  const clash = copies.filter((id) => inUse.has(id) || (id === group.id))
  if (clash.length || new Set(copies).size !== copies.length) return failItem('asset-missing', copies, 'Every copy needs a new, distinct ID.')
  if ((project.groups ?? []).length >= 200) return failItem('value-range', [group.id], 'A project can hold at most 200 groups.')
  const spans = members.map((member) => member.item)
  const latest = Math.max(...spans.map((item) => item.endUs))
  const offset = Math.min(250_000, Math.max(0, durationUs - latest))
  const newGroupId = command.idMap[group.id]
  const shapeCopies = members.flatMap((member): Shape[] => member.kind === 'shape'
    ? [{ ...member.item, id: command.idMap[member.item.id], groupId: newGroupId, startUs: member.item.startUs + offset, endUs: member.item.endUs + offset,
      ...(member.item.fitTo ? { fitTo: command.idMap[member.item.fitTo] ?? member.item.fitTo } : {}) }] : [])
  const textCopies = members.flatMap((member): TextOverlay[] => member.kind === 'text'
    ? [{ ...member.item, id: command.idMap[member.item.id], groupId: newGroupId, startUs: member.item.startUs + offset, endUs: member.item.endUs + offset }] : [])
  const allShapes = [...project.shapes, ...shapeCopies]
  if (blendingShapes(allShapes).length > MAX_BLENDING_SHAPES) return failItem('value-range', [group.id], `A project can blend at most ${MAX_BLENDING_SHAPES} shapes.`)
  if (passShapes(allShapes).length > MAX_PASS_SHAPES) return failItem('value-range', [group.id], `A project can hold at most ${MAX_PASS_SHAPES} blending and glass shapes together.`)
  return {
    project: {
      ...project,
      groups: [...(project.groups ?? []), { id: newGroupId, name: group.name }],
      shapes: allShapes.sort(orderKey),
      textOverlays: [...project.textOverlays, ...textCopies].sort(orderKey),
    },
  }
}
