import type { TextOverlay } from './edit'
import type { CaptionProject } from './model'
import { sequenceDurationUs } from './timelineModel'
import { pruneGroups } from './groupCommands'
import { failItem, replaceById, type ItemFailure, type ItemStep } from './itemStep'
import { DEFAULT_CAPTION_STYLE, type CaptionStyle } from '../captions/style'

export type TextOverlayChanges = Partial<Pick<TextOverlay, 'text' | 'style' | 'enter' | 'exit' | 'titleMotion' | 'layerOrder'>>
export type TextCommand =
  | { type: 'text-add'; overlay: TextOverlay }
  | { type: 'text-update'; textId: string; changes: TextOverlayChanges }
  | { type: 'text-move'; textId: string; startUs: number }
  | { type: 'text-trim'; textId: string; edge: 'start' | 'end'; deltaUs: number }
  | { type: 'text-duplicate'; textId: string; duplicateId: string }
  | { type: 'text-delete'; textId: string }
  | { type: 'text-reorder'; textId: string; direction: 'forward' | 'backward' | 'above-captions' | 'below-captions' }

/** A first-ever text carries no effects; later texts reuse `style` (the previously used text style). */
const PLAIN_TEXT_STYLE: CaptionStyle = {
  ...DEFAULT_CAPTION_STYLE, appearance: { ...DEFAULT_CAPTION_STYLE.appearance, shadowEnabled: false, strokeEnabled: false, glowEnabled: false },
}

export function defaultTextOverlay(id: string, startUs: number, endUs: number, text = 'Your text', style: CaptionStyle = PLAIN_TEXT_STYLE): TextOverlay {
  return { id, text, startUs, endUs, style,
    enter: { kind: 'fade', durationUs: 250_000 }, exit: { kind: 'fade', durationUs: 250_000 }, layerOrder: 1 }
}

function ordered(items: readonly TextOverlay[]) {
  return [...items].sort((a, b) => a.startUs - b.startUs || a.layerOrder - b.layerOrder || a.id.localeCompare(b.id))
}
function clampToDuration(overlay: TextOverlay, durationUs: number): TextOverlay | null {
  if (durationUs <= 0) return null
  const length = Math.max(1, Math.min(overlay.endUs - overlay.startUs, durationUs))
  const startUs = Math.max(0, Math.min(overlay.startUs, durationUs - length))
  return { ...overlay, startUs, endUs: startUs + length }
}

export function applyTextCommand(project: CaptionProject, command: TextCommand): ItemStep | ItemFailure {
  const durationUs = sequenceDurationUs(project.clips) || Math.max(0, ...project.cues.map((cue) => cue.endUs))
  if (command.type === 'text-add') {
    if (project.textOverlays.some((item) => item.id === command.overlay.id)) return failItem('asset-missing', [command.overlay.id], 'That text ID is already in use.')
    const overlay = clampToDuration(command.overlay, durationUs)
    if (!overlay) return failItem('invalid-duration', [command.overlay.id], 'Add video to the timeline before adding text.')
    return { project: { ...project, textOverlays: ordered([...project.textOverlays, overlay]) }, selection: { kind: 'text', id: overlay.id } }
  }
  const current = project.textOverlays.find((item) => item.id === command.textId)
  if (!current) return failItem('asset-missing', [command.textId], 'That text item no longer exists.')
  if (command.type === 'text-delete') return { project: pruneGroups({ ...project, textOverlays: project.textOverlays.filter((item) => item.id !== current.id) }), selection: null }
  if (command.type === 'text-duplicate') {
    if (project.textOverlays.some((item) => item.id === command.duplicateId)) return failItem('asset-missing', [command.duplicateId], 'That text ID is already in use.')
    const length = current.endUs - current.startUs
    const { groupId: _groupId, ...ungrouped } = current
    const duplicate = clampToDuration({ ...ungrouped, id: command.duplicateId, startUs: current.startUs + Math.min(250_000, Math.max(0, durationUs - current.endUs)) }, durationUs)
    if (!duplicate || duplicate.id === current.id || duplicate.startUs === current.startUs && length === durationUs) return failItem('invalid-duration', [current.id], 'There is no room to duplicate this text item.')
    return { project: { ...project, textOverlays: ordered([...project.textOverlays, duplicate]) }, selection: { kind: 'text', id: duplicate.id } }
  }
  if (command.type === 'text-reorder') {
    const others = project.textOverlays.filter((item) => item.id !== current.id)
    let layerOrder = current.layerOrder
    if (command.direction === 'above-captions') layerOrder = Math.max(1, ...others.filter((item) => item.layerOrder > 0).map((item) => item.layerOrder))
    else if (command.direction === 'below-captions') layerOrder = Math.min(-1, ...others.filter((item) => item.layerOrder < 0).map((item) => item.layerOrder))
    else {
      const samePlane = others.filter((item) => Math.sign(item.layerOrder) === Math.sign(current.layerOrder)).sort((a, b) => a.layerOrder - b.layerOrder)
      const index = samePlane.findIndex((item) => command.direction === 'forward' ? item.layerOrder > current.layerOrder : item.layerOrder < current.layerOrder)
      const peer = index < 0 ? samePlane.at(-1) : samePlane[index]
      layerOrder = Math.max(-10000, Math.min(10000, current.layerOrder + (command.direction === 'forward' ? 1 : -1)))
      if (peer) layerOrder = command.direction === 'forward' ? Math.max(layerOrder, peer.layerOrder + 1) : Math.min(layerOrder, peer.layerOrder - 1)
    }
    return { project: { ...project, textOverlays: ordered(replaceById(project.textOverlays, current.id, (item) => ({ ...item, layerOrder }))!) }, selection: { kind: 'text', id: current.id } }
  }
  let next = current
  if (command.type === 'text-update') next = { ...current, ...command.changes }
  if (command.type === 'text-move') next = { ...current, startUs: command.startUs, endUs: command.startUs + current.endUs - current.startUs }
  if (command.type === 'text-trim') next = command.edge === 'start'
    ? { ...current, startUs: Math.min(current.endUs - 1, Math.max(0, current.startUs + command.deltaUs)) }
    : { ...current, endUs: Math.max(current.startUs + 1, Math.min(durationUs || Number.MAX_SAFE_INTEGER, current.endUs + command.deltaUs)) }
  const clamped = clampToDuration(next, durationUs)
  if (!clamped) return failItem('invalid-duration', [current.id], 'Text needs a non-zero sequence duration.')
  const textOverlays = replaceById(project.textOverlays, current.id, () => clamped)
  if (!textOverlays) return failItem('asset-missing', [current.id], 'That text item no longer exists.')
  return { project: { ...project, textOverlays: ordered(textOverlays) }, selection: { kind: 'text', id: current.id } }
}
