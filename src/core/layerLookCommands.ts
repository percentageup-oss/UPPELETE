import { BLEND_MODES, type BlendMode } from './edit'
import type { CaptionProject } from './model'
import { failItem, replaceById, type ItemFailure, type ItemStep } from './itemStep'
import { MAX_BLENDING_SHAPES, MAX_PASS_SHAPES, blendingShapes, passShapes } from './graphicsPasses'
import type { MaskTarget } from './maskCommands'

export type LayerLookCommand =
  /** Sets a layer's opacity and/or blend mode. Only the fields present change; `blendMode: null` (or
   * `'normal'`) clears the blend. One command is one undo step, so a slider commit is one history entry. */
  | { type: 'layer-look-set'; target: MaskTarget; opacity?: number; blendMode?: BlendMode | null }

/** Absent = the default, so a default value removes the field instead of storing it. */
const withOptional = <T extends object, K extends string>(item: T, key: K, value: unknown, isDefault: boolean): T => {
  const { [key]: _previous, ...rest } = item as T & Record<K, unknown>
  return (isDefault ? rest : { ...rest, [key]: value }) as T
}

export function applyLayerLookCommand(project: CaptionProject, command: LayerLookCommand): ItemStep | ItemFailure {
  const { target, opacity, blendMode } = command
  const missing = failItem('asset-missing', [target.id], 'That layer no longer exists.')
  if (opacity !== undefined && !(Number.isFinite(opacity) && opacity >= 0 && opacity <= 1)) {
    return failItem('value-range', [target.id], 'Opacity must be between 0 and 1.')
  }
  if (blendMode != null && !BLEND_MODES.includes(blendMode)) return failItem('value-range', [target.id], `Unknown blend mode “${blendMode}”.`)
  if (target.kind === 'blur' || target.kind === 'effect') return failItem('asset-kind', [target.id], 'Blur areas and effects have no opacity or blend mode.')
  if (blendMode !== undefined && target.kind !== 'clip' && target.kind !== 'shape') return failItem('asset-kind', [target.id], 'Only picture clips and shapes have a blend mode.')
  if (blendMode != null && blendMode !== 'normal' && target.kind === 'shape') {
    const current = project.shapes.find((item) => item.id === target.id)
    if (current?.glass) return failItem('value-range', [target.id], 'A glass shape cannot have a blend mode.')
    if (current && current.blendMode === undefined && blendingShapes(project.shapes).length >= MAX_BLENDING_SHAPES) {
      return failItem('value-range', [target.id], `A project can blend at most ${MAX_BLENDING_SHAPES} shapes.`)
    }
    if (current && current.blendMode === undefined && passShapes(project.shapes).length >= MAX_PASS_SHAPES) {
      return failItem('value-range', [target.id], `A project can hold at most ${MAX_PASS_SHAPES} blending and glass shapes together.`)
    }
  }

  const applyLook = <T extends object>(item: T, alwaysStoreOpacity: boolean): T => {
    let next = item
    if (opacity !== undefined) next = alwaysStoreOpacity ? { ...next, opacity } : withOptional(next, 'opacity', opacity, opacity === 1)
    if (blendMode !== undefined) next = withOptional(next, 'blendMode', blendMode, blendMode === null || blendMode === 'normal')
    return next
  }

  switch (target.kind) {
    case 'clip': {
      const clip = project.clips.find((item) => item.id === target.id)
      if (!clip) return missing
      if (clip.kind === 'audio' || clip.kind === 'adjustment') return failItem('asset-kind', [target.id], 'Only picture clips have an opacity or blend mode.')
      const clips = replaceById(project.clips, target.id, (item) => applyLook(item, true))!
      return { project: { ...project, clips }, selection: { kind: 'clip', id: target.id } }
    }
    case 'text': {
      const textOverlays = replaceById(project.textOverlays, target.id, (item) => applyLook(item, false))
      return textOverlays ? { project: { ...project, textOverlays }, selection: { kind: 'text', id: target.id } } : missing
    }
    case 'shape': {
      const shapes = replaceById(project.shapes, target.id, (item) => applyLook(item, true))
      return shapes ? { project: { ...project, shapes }, selection: { kind: 'shape', id: target.id } } : missing
    }
    case 'captionTrack': {
      const captionTracks = replaceById(project.captionTracks, target.id, (item) => applyLook(item, false))
      return captionTracks ? { project: { ...project, captionTracks } } : missing
    }
  }
}
