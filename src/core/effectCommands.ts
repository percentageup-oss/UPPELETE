import type { EffectRegion, FadeEffect, LetterboxEffect, VignetteEffect } from './edit'
import type { CaptionProject } from './model'
import { clampZoomRegion, MIN_ZOOM_REGION_US } from './zoomRegion'
import { dragRangeBy, itemDragBounds, type CueDragMode } from './timeline'
import { failItem, replaceById, type ItemFailure, type ItemStep } from './itemStep'

export type VignetteChanges = Partial<Pick<VignetteEffect, 'amount' | 'softness' | 'enabled'>>
export type LetterboxChanges = Partial<Pick<LetterboxEffect, 'aspect' | 'color' | 'easeInUs' | 'easeOutUs' | 'enabled'>>
export type FadeChanges = Partial<Pick<FadeEffect, 'shape' | 'color' | 'easeInUs' | 'easeOutUs' | 'enabled'>>
/** Never `startUs`/`endUs`/`kind` — those go through `effect-move`/`effect-trim`, the same split
 * clips and zoom regions use. A caller always knows the selected effect's own kind. */
export type EffectChanges = VignetteChanges | LetterboxChanges | FadeChanges

export type EffectCommand =
  // Dropped from the Effects panel or added at the playhead. Clamped into the free gap around every
  // other effect **of the same kind** — a vignette and a letterbox may overlap, but two vignettes
  // may not (`model.ts`'s schema enforces the same rule).
  | { type: 'effect-add'; effect: EffectRegion }
  | { type: 'effect-move'; effectId: string; startUs: number }
  | { type: 'effect-trim'; effectId: string; edge: 'start' | 'end'; deltaUs: number }
  | { type: 'effect-update'; effectId: string; changes: EffectChanges }
  | { type: 'effect-delete'; effectId: string }

export type EffectDragMode = CueDragMode

/** Live drag preview (`Timeline.tsx`), the same two-step shape `previewZoomDrag` uses: a free
 * translation/resize clamped into the gap around every other effect **of the same kind** — a
 * vignette dragged past a letterbox is not blocked by it. */
export function previewEffectDrag(effect: EffectRegion, mode: EffectDragMode, deltaUs: number, others: readonly EffectRegion[]): EffectRegion {
  const free = dragRangeBy(effect, mode, deltaUs, itemDragBounds(effect, null, MIN_ZOOM_REGION_US))
  return clampZoomRegion({ ...effect, ...free }, others) ?? effect
}

function sortEffects(effects: readonly EffectRegion[]): EffectRegion[] {
  return [...effects].sort((a, b) => a.startUs - b.startUs || a.id.localeCompare(b.id))
}

function sameKindOthers(effects: readonly EffectRegion[], id: string, kind: EffectRegion['kind']): EffectRegion[] {
  return effects.filter((effect) => effect.id !== id && effect.kind === kind)
}

export function applyEffectCommand(project: CaptionProject, command: EffectCommand): ItemStep | ItemFailure {
  if (command.type === 'effect-add') {
    const others = sameKindOthers(project.effects, command.effect.id, command.effect.kind)
    const effect = clampZoomRegion(command.effect, others)
    if (!effect) return failItem('rect-bounds', [command.effect.id], 'There is no room for that effect there.')
    const rest = project.effects.filter((candidate) => candidate.id !== effect.id)
    return { project: { ...project, effects: sortEffects([...rest, effect]) }, selection: { kind: 'effect', id: effect.id } }
  }

  const existing = project.effects.find((effect) => effect.id === command.effectId)
  if (command.type !== 'effect-delete' && !existing) return failItem('asset-missing', [command.effectId], 'That effect no longer exists.')

  if (command.type === 'effect-move') {
    const lengthUs = existing!.endUs - existing!.startUs
    const others = sameKindOthers(project.effects, command.effectId, existing!.kind)
    const startUs = Math.max(0, command.startUs)
    const moved = clampZoomRegion({ ...existing!, startUs, endUs: startUs + lengthUs }, others)
    if (!moved) return failItem('rect-bounds', [command.effectId], 'There is no room for that effect there.')
    const rest = project.effects.filter((candidate) => candidate.id !== command.effectId)
    return { project: { ...project, effects: sortEffects([...rest, moved]) }, selection: { kind: 'effect', id: moved.id } }
  }
  if (command.type === 'effect-trim') {
    const others = sameKindOthers(project.effects, command.effectId, existing!.kind)
    const startUs = Math.max(0, command.edge === 'start' ? existing!.startUs + command.deltaUs : existing!.startUs)
    const endUs = Math.max(startUs + MIN_ZOOM_REGION_US, command.edge === 'end' ? existing!.endUs + command.deltaUs : existing!.endUs)
    const trimmed = clampZoomRegion({ ...existing!, startUs, endUs }, others)
    if (!trimmed) return failItem('rect-bounds', [command.effectId], 'That trim leaves no room for the effect.')
    const rest = project.effects.filter((candidate) => candidate.id !== command.effectId)
    return { project: { ...project, effects: sortEffects([...rest, trimmed]) }, selection: { kind: 'effect', id: trimmed.id } }
  }
  if (command.type === 'effect-update') {
    const effects = replaceById(project.effects, command.effectId, (effect) => ({ ...effect, ...command.changes } as EffectRegion))
    if (!effects) return failItem('asset-missing', [command.effectId], 'That effect no longer exists.')
    return { project: { ...project, effects }, selection: { kind: 'effect', id: command.effectId } }
  }
  const effects = project.effects.filter((effect) => effect.id !== command.effectId)
  if (effects.length === project.effects.length) return failItem('asset-missing', [command.effectId], 'That effect no longer exists.')
  return { project: { ...project, effects }, selection: null }
}

/** The length a dropped preset starts at, before the user trims it. Vignette/letterbox are usually
 * held over a few seconds; fades are brief by nature, and a dip/flash briefer still. */
export const DEFAULT_LOOK_EFFECT_US = 3_000_000
export const DEFAULT_FADE_EFFECT_US = 1_000_000
export const DEFAULT_DIP_EFFECT_US = 1_500_000
export const FLASH_EFFECT_US = 300_000

export function defaultVignette(id: string, atUs: number): VignetteEffect {
  return { id, startUs: atUs, endUs: atUs + DEFAULT_LOOK_EFFECT_US, enabled: true, kind: 'vignette', amount: 0.5, softness: 0.6 }
}
export function defaultLetterbox(id: string, atUs: number, aspect: number): LetterboxEffect {
  return { id, startUs: atUs, endUs: atUs + DEFAULT_LOOK_EFFECT_US, enabled: true, kind: 'letterbox', aspect, color: '#000000', easeInUs: 300_000, easeOutUs: 300_000 }
}
export function defaultFade(id: string, atUs: number, shape: FadeEffect['shape']): FadeEffect {
  const durationUs = shape === 'dip' ? DEFAULT_DIP_EFFECT_US : DEFAULT_FADE_EFFECT_US
  return { id, startUs: atUs, endUs: atUs + durationUs, enabled: true, kind: 'fade', shape, color: '#000000', easeInUs: 400_000, easeOutUs: 400_000 }
}
/** Flash is a preset, not its own kind: a brief white dip (docs/EDITING.md "Frame-paint effects"). */
export function defaultFlash(id: string, atUs: number): FadeEffect {
  return { id, startUs: atUs, endUs: atUs + FLASH_EFFECT_US, enabled: true, kind: 'fade', shape: 'dip', color: '#ffffff', easeInUs: 100_000, easeOutUs: 100_000 }
}
