import type { CompositionRect, ZoomRegion } from './edit'
import type { CaptionProject } from './model'
import { clampZoomRegion, MIN_ZOOM_REGION_US } from './zoomRegion'
import { failItem, replaceById, type ItemFailure, type ItemStep } from './itemStep'

/** Inspector edits: the target framing, the ease durations and the bypass flag. Never the timing —
 * that goes through `zoom-region-move`/`zoom-region-trim`, the same split clips use. */
export type ZoomRegionChanges = Partial<Pick<ZoomRegion, 'rect' | 'easeInUs' | 'easeOutUs' | 'enabled'>> & {
  /** Pan start framing: a rect sets/replaces it, `null` clears it (back to a plain zoom). */
  fromRect?: CompositionRect | null
}

export type ZoomRegionCommand =
  // Dropped from the Zoom panel or added at the playhead. Clamped into the free gap around every
  // other zoom region — there is one lane, so two can never overlap (`clampZoomRegion`).
  | { type: 'zoom-region-add'; region: ZoomRegion }
  | { type: 'zoom-region-move'; zoomId: string; startUs: number }
  | { type: 'zoom-region-trim'; zoomId: string; edge: 'start' | 'end'; deltaUs: number }
  | { type: 'zoom-region-update'; zoomId: string; changes: ZoomRegionChanges }
  | { type: 'zoom-region-delete'; zoomId: string }

/** Merges inspector changes into a region; `fromRect: null` drops the pan start framing. Shared with
 * the live draft preview (`App.tsx`) so a draft and its commit always produce the same region. */
export function applyZoomChanges(region: ZoomRegion, changes: ZoomRegionChanges): ZoomRegion {
  const { fromRect, ...rest } = changes
  const { fromRect: previous, ...base } = region
  const next = fromRect === undefined ? previous : fromRect
  return { ...base, ...rest, ...(next ? { fromRect: next } : {}) }
}

function sortRegions(regions: readonly ZoomRegion[]): ZoomRegion[] {
  return [...regions].sort((a, b) => a.startUs - b.startUs || a.id.localeCompare(b.id))
}

export function applyZoomRegionCommand(project: CaptionProject, command: ZoomRegionCommand): ItemStep | ItemFailure {
  if (command.type === 'zoom-region-add') {
    const others = project.zoomRegions.filter((region) => region.id !== command.region.id)
    const region = clampZoomRegion(command.region, others)
    if (!region) return failItem('rect-bounds', [command.region.id], 'There is no room for a zoom region there.')
    return { project: { ...project, zoomRegions: sortRegions([...others, region]) }, selection: { kind: 'zoomRegion', id: region.id } }
  }

  const existing = project.zoomRegions.find((region) => region.id === command.zoomId)
  if (command.type !== 'zoom-region-delete' && !existing) return failItem('asset-missing', [command.zoomId], 'That zoom region no longer exists.')

  if (command.type === 'zoom-region-move') {
    const lengthUs = existing!.endUs - existing!.startUs
    const others = project.zoomRegions.filter((region) => region.id !== command.zoomId)
    const startUs = Math.max(0, command.startUs)
    const moved = clampZoomRegion({ ...existing!, startUs, endUs: startUs + lengthUs }, others)
    if (!moved) return failItem('rect-bounds', [command.zoomId], 'There is no room for that zoom region there.')
    return { project: { ...project, zoomRegions: sortRegions([...others, moved]) }, selection: { kind: 'zoomRegion', id: moved.id } }
  }
  if (command.type === 'zoom-region-trim') {
    const others = project.zoomRegions.filter((region) => region.id !== command.zoomId)
    const startUs = Math.max(0, command.edge === 'start' ? existing!.startUs + command.deltaUs : existing!.startUs)
    const endUs = Math.max(startUs + MIN_ZOOM_REGION_US, command.edge === 'end' ? existing!.endUs + command.deltaUs : existing!.endUs)
    const trimmed = clampZoomRegion({ ...existing!, startUs, endUs }, others)
    if (!trimmed) return failItem('rect-bounds', [command.zoomId], 'That trim leaves no room for the zoom region.')
    return { project: { ...project, zoomRegions: sortRegions([...others, trimmed]) }, selection: { kind: 'zoomRegion', id: trimmed.id } }
  }
  if (command.type === 'zoom-region-update') {
    const zoomRegions = replaceById(project.zoomRegions, command.zoomId, (region) => applyZoomChanges(region, command.changes))
    if (!zoomRegions) return failItem('asset-missing', [command.zoomId], 'That zoom region no longer exists.')
    return { project: { ...project, zoomRegions }, selection: { kind: 'zoomRegion', id: command.zoomId } }
  }
  const zoomRegions = project.zoomRegions.filter((region) => region.id !== command.zoomId)
  if (zoomRegions.length === project.zoomRegions.length) return failItem('asset-missing', [command.zoomId], 'That zoom region no longer exists.')
  return { project: { ...project, zoomRegions }, selection: null }
}
