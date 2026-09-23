import type { EffectRegion, FadeEffect, LetterboxEffect, VignetteEffect } from './edit'
import { smoothstep } from './zoomRegion'
import type { Size } from './composition'

export type LetterboxBars = { orientation: 'horizontal' | 'vertical'; barPx: number; color: string }
export type FrameEffects = {
  vignette?: { amount: number; softness: number }
  letterbox?: LetterboxBars
  fade?: { color: string; opacity: number }
}

/**
 * Pure evaluator for frame-paint effects (docs/EDITING.md "Frame-paint effects"): the same
 * closed-form-in-absolute-time contract `zoomRectAt` follows, so seeking to the same sequence
 * timestamp from any direction gives the same result. Preview (`App.tsx`'s `CaptionStage`) and the
 * export host (`frameHarness.tsx`, via `frameRequestAtSequence`) both call this — there is exactly
 * one definition of what a frame-paint effect does, and `CompositionLayers.tsx` paints its result
 * with no FFmpeg filter on either side, so preview/export parity is exact rather than a measured
 * tolerance.
 */
function activeOf<T extends EffectRegion>(effects: readonly EffectRegion[], kind: T['kind'], sequenceUs: number): T | null {
  const region = effects.find((candidate) => candidate.kind === kind && candidate.enabled && sequenceUs >= candidate.startUs && sequenceUs < candidate.endUs)
  return (region as T | undefined) ?? null
}

/** How much of a ramped effect is showing at `sequenceUs`: eased in over `easeInUs`, held at 1,
 * eased back out over `easeOutUs` — the same shape `zoomRectAt` ramps a target rect on. */
function rampAmount(startUs: number, endUs: number, easeInUs: number, easeOutUs: number, sequenceUs: number): number {
  const half = (endUs - startUs) / 2
  const clampedIn = Math.min(easeInUs, half)
  const clampedOut = Math.min(easeOutUs, half)
  const holdStartUs = startUs + clampedIn
  const holdEndUs = endUs - clampedOut
  if (sequenceUs < holdStartUs) return smoothstep(clampedIn > 0 ? (sequenceUs - startUs) / clampedIn : 1)
  if (sequenceUs >= holdEndUs) return 1 - smoothstep(clampedOut > 0 ? (sequenceUs - holdEndUs) / clampedOut : 1)
  return 1
}

/**
 * Bars land top/bottom (horizontal) when the target is *wider* than the composition's own aspect
 * (e.g. "Letterbox 2.39" on a 16:9 export) — the visible height shrinks to `width / aspect`. They
 * land left/right (vertical, pillarbox) when the target is *narrower* — the visible width shrinks
 * to `height * aspect` instead (e.g. the same 2.39 target on a 9:16 vertical export). Equal aspects
 * produce a zero inset either way.
 */
function letterboxBars(effect: LetterboxEffect, sequenceUs: number, composition: Size): LetterboxBars {
  const currentAspect = composition.width / composition.height
  const horizontal = effect.aspect >= currentAspect
  const targetInset = horizontal
    ? (composition.height - composition.width / effect.aspect) / 2
    : (composition.width - composition.height * effect.aspect) / 2
  const amount = rampAmount(effect.startUs, effect.endUs, effect.easeInUs, effect.easeOutUs, sequenceUs)
  return { orientation: horizontal ? 'horizontal' : 'vertical', barPx: Math.max(0, targetInset) * amount, color: effect.color }
}

/** `in`/`out` ramp once across the region's whole length; `dip` (including the Flash preset) uses
 * both eases with a hold at full opacity in between. */
function fadeOpacity(effect: FadeEffect, sequenceUs: number): number {
  if (effect.shape === 'dip') return rampAmount(effect.startUs, effect.endUs, effect.easeInUs, effect.easeOutUs, sequenceUs)
  const phase = smoothstep((sequenceUs - effect.startUs) / (effect.endUs - effect.startUs))
  return effect.shape === 'in' ? 1 - phase : phase
}

export function frameEffectsAt(effects: readonly EffectRegion[], sequenceUs: number, composition: Size): FrameEffects {
  const result: FrameEffects = {}
  const vignette = activeOf<VignetteEffect>(effects, 'vignette', sequenceUs)
  if (vignette) result.vignette = { amount: vignette.amount, softness: vignette.softness }
  const letterbox = activeOf<LetterboxEffect>(effects, 'letterbox', sequenceUs)
  if (letterbox) result.letterbox = letterboxBars(letterbox, sequenceUs, composition)
  const fade = activeOf<FadeEffect>(effects, 'fade', sequenceUs)
  if (fade) {
    const opacity = fadeOpacity(fade, sequenceUs)
    if (opacity > 0) result.fade = { color: fade.color, opacity }
  }
  return result
}
