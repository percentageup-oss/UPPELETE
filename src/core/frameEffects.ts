import type { EffectRegion, LayerMask, FadeEffect, GlowEffect, GrainEffect, LetterboxEffect, ParticlesEffect, VhsEffect, VignetteEffect } from './edit'
import { smoothstep } from './zoomRegion'
import type { Size } from './composition'
import { activeMask } from './layerMask'

type Masked = { mask?: LayerMask }
export type LetterboxBars = { orientation: 'horizontal' | 'vertical'; barPx: number; color: string } & Masked
/** Each entry carries its region's layer mask (schema 12) when one is active, so the host paints it with the same component. */
export type FrameEffects = {
  vignette?: { amount: number; softness: number } & Masked
  letterbox?: LetterboxBars
  fade?: { color: string; opacity: number } & Masked
  grain?: { amount: number; size: number; seed: number } & Masked
  vhs?: { amount: number; scanlines: number; tracking: number; bandY: number; jitter: number; flicker: number; seed: number } & Masked
  particles?: { id: string; amount: number; size: number; speed: number; color: string; tick: number; opacity: number; seed: number } & Masked
}
const maskOf = (region: { mask?: LayerMask }): Masked => { const mask = activeMask(region.mask); return mask ? { mask } : {} }

/** Grain and VHS re-seed at this fixed rate in absolute sequence time — a film-like 24 Hz,
 * independent of the project's frame rate, so seeking, preview and export all show the same noise
 * at the same timestamp and the export planner can still deduplicate identical frames. Particles
 * use their own 60 Hz tick below. */
export const TEXTURE_TICKS_PER_SECOND = 24
export const PARTICLE_TICKS_PER_SECOND = 60
const TEXTURE_SEED_RANGE = 997

/** Integer hash → [0, 1). Deterministic and stateless, so no effect depends on frame order. */
function hash01(n: number): number {
  let x = (Math.imul(n | 0, 0x9e3779b1) + 0x7f4a7c15) | 0
  x = Math.imul(x ^ (x >>> 15), 0x85ebca6b)
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35)
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296
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
  return { orientation: horizontal ? 'horizontal' : 'vertical', barPx: Math.max(0, targetInset) * amount, color: effect.color, ...maskOf(effect) }
}

/** `in`/`out` ramp once across the region's whole length; `dip` (including the Flash preset) uses
 * both eases with a hold at full opacity in between. */
function fadeOpacity(effect: FadeEffect, sequenceUs: number): number {
  if (effect.shape === 'dip') return rampAmount(effect.startUs, effect.endUs, effect.easeInUs, effect.easeOutUs, sequenceUs)
  const phase = smoothstep((sequenceUs - effect.startUs) / (effect.endUs - effect.startUs))
  return effect.shape === 'in' ? 1 - phase : phase
}

function textureTick(sequenceUs: number): number {
  return Math.floor(sequenceUs * TEXTURE_TICKS_PER_SECOND / 1_000_000)
}

function stableStringSeed(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619)
  return hash >>> 0
}

function particlesAt(effect: ParticlesEffect, sequenceUs: number): NonNullable<FrameEffects['particles']> {
  const tick = Math.floor(sequenceUs * PARTICLE_TICKS_PER_SECOND / 1_000_000)
  const edge = 200_000
  const edgeProgress = Math.min(1, (sequenceUs - effect.startUs) / edge, (effect.endUs - sequenceUs) / edge)
  return {
    ...maskOf(effect), id: effect.id, amount: effect.amount, size: effect.size, speed: effect.speed, color: effect.color,
    tick, opacity: smoothstep(Math.max(0, edgeProgress)), seed: stableStringSeed(effect.id),
  }
}

function vhsAt(effect: VhsEffect, sequenceUs: number): NonNullable<FrameEffects['vhs']> {
  const tick = textureTick(sequenceUs)
  const seconds = tick / TEXTURE_TICKS_PER_SECOND
  return {
    ...maskOf(effect),
    amount: effect.amount, scanlines: effect.scanlines, tracking: effect.tracking,
    // The tracking band rolls down the frame once every ~7 s, wrapping.
    bandY: (seconds / 7) % 1,
    // Horizontal wobble of the band, in [-1, 1]; the painter scales it to the composition width.
    jitter: hash01(tick * 3 + 1) * 2 - 1,
    flicker: hash01(tick * 3 + 2),
    seed: tick % TEXTURE_SEED_RANGE,
  }
}

export function frameEffectsAt(effects: readonly EffectRegion[], sequenceUs: number, composition: Size): FrameEffects {
  const result: FrameEffects = {}
  const vignette = activeOf<VignetteEffect>(effects, 'vignette', sequenceUs)
  if (vignette) result.vignette = { amount: vignette.amount, softness: vignette.softness, ...maskOf(vignette) }
  const letterbox = activeOf<LetterboxEffect>(effects, 'letterbox', sequenceUs)
  if (letterbox) result.letterbox = letterboxBars(letterbox, sequenceUs, composition)
  const fade = activeOf<FadeEffect>(effects, 'fade', sequenceUs)
  if (fade) {
    const opacity = fadeOpacity(fade, sequenceUs)
    if (opacity > 0) result.fade = { color: fade.color, opacity, ...maskOf(fade) }
  }
  const grain = activeOf<GrainEffect>(effects, 'grain', sequenceUs)
  if (grain) result.grain = { amount: grain.amount, size: grain.size, seed: textureTick(sequenceUs) % TEXTURE_SEED_RANGE, ...maskOf(grain) }
  const vhs = activeOf<VhsEffect>(effects, 'vhs', sequenceUs)
  if (vhs) result.vhs = vhsAt(vhs, sequenceUs)
  const particles = activeOf<ParticlesEffect>(effects, 'particles', sequenceUs)
  if (particles) result.particles = particlesAt(particles, sequenceUs)
  return result
}

/** Picture effects read the picture's own pixels, so they are *not* part of `FrameEffects` (the
 * host-painted layer the export harness receives): preview filters the picture with them and export
 * applies them in FFmpeg after zoom (docs/EDITING.md "Picture effects: Dreamy glow"). Radius stays in
 * composition units here; each side scales it to its own pixels. */
export type PictureEffects = { glow?: { amount: number; radius: number; threshold: number } }

export function pictureEffectsAt(effects: readonly EffectRegion[], sequenceUs: number): PictureEffects {
  const result: PictureEffects = {}
  const glow = activeOf<GlowEffect>(effects, 'glow', sequenceUs)
  if (glow && glow.amount > 0) result.glow = { amount: glow.amount, radius: glow.radius, threshold: glow.threshold }
  return result
}
