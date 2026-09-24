/**
 * Bundled film looks: a fixed library of procedural, parametric grades built from this app's own
 * `applyToneShape` (`primaries.ts`) plus an optional subtle channel mix for character. These are
 * original work — no camera or film-stock LUT is copied or reverse-engineered, and no brand name
 * appears anywhere in the id, name or description (see docs/DEPENDENCIES.md). `applyLook` blends the
 * look's result back toward the untouched input by `strength`, so every look is the identity at
 * `strength = 0` regardless of its own parameters.
 */

import type { Matrix3 } from './gamut'
import { applyMatrix3, REC709_IDENTITY } from './gamut'
import { applyToneShape, map3, NEUTRAL_TONE_SHAPE, type RGB, type ToneShape } from './primaries'

export type Look = {
  id: string
  name: string
  /** Shown in the Color panel under the swatch; never mentions a camera or film brand. */
  description: string
  mix: Matrix3
  shape: ToneShape
}

const shape = (overrides: Partial<ToneShape>): ToneShape => ({ ...NEUTRAL_TONE_SHAPE, ...overrides })

export const LOOKS: readonly Look[] = [
  {
    id: 'reportage', name: 'Reportage',
    description: 'Muted saturation and hard, slightly crushed shadows — a documentary, print-press feel.',
    mix: REC709_IDENTITY,
    shape: shape({ contrast: 0.15, shadows: -0.12, saturation: -0.3, lift: [0.02, 0.01, -0.01] }),
  },
  {
    id: 'slide-vivid', name: 'Slide Vivid',
    description: 'Punchy contrast and saturated, slightly cool color — a projected-transparency look.',
    mix: REC709_IDENTITY,
    shape: shape({ contrast: 0.35, saturation: 0.4, gain: [-0.02, 0, 0.03] }),
  },
  {
    id: 'soft-negative', name: 'Soft Negative',
    description: 'Lower contrast with warm highlights and a faint magenta in the shadows.',
    mix: REC709_IDENTITY,
    shape: shape({ contrast: -0.2, gain: [0.04, 0.01, -0.03], lift: [0.02, 0, 0.02], saturation: -0.1 }),
  },
  {
    id: 'street-negative', name: 'Street Negative',
    description: 'Higher grain-era contrast, desaturated midtones, a cool shadow tint.',
    mix: REC709_IDENTITY,
    shape: shape({ contrast: 0.25, shadows: -0.08, saturation: -0.2, lift: [-0.02, 0, 0.02] }),
  },
  {
    id: 'pastel-print', name: 'Pastel Print',
    description: 'Lifted blacks and soft, pale color — nothing reads as pure black.',
    mix: REC709_IDENTITY,
    shape: shape({ contrast: -0.15, shadows: 0.18, saturation: -0.25 }),
  },
  {
    id: 'cinema-soft', name: 'Cinema Soft',
    description: 'A gentle S-curve with teal-leaning shadows and warm highlights.',
    mix: [1, 0, 0, 0, 1, 0, 0.01, -0.01, 1],
    shape: shape({ contrast: 0.12, lift: [-0.01, 0, 0.02], gain: [0.02, 0, -0.02] }),
  },
  {
    id: 'bleach-skip', name: 'Bleach Skip',
    description: 'Heavy contrast and desaturation, as if the color layer were partly pulled.',
    mix: REC709_IDENTITY,
    shape: shape({ contrast: 0.45, saturation: -0.55, shadows: 0.06 }),
  },
  {
    id: 'classic-contrast', name: 'Classic Contrast',
    description: 'A clean, moderate contrast boost with no color shift — a neutral punch-up.',
    mix: REC709_IDENTITY,
    shape: shape({ contrast: 0.22 }),
  },
  {
    id: 'warm-chrome', name: 'Warm Chrome',
    description: 'Rich, warm highlights and saturated midtones — a golden-hour still-film feel.',
    mix: REC709_IDENTITY,
    shape: shape({ contrast: 0.18, gain: [0.05, 0.02, -0.04], saturation: 0.2 }),
  },
  {
    id: 'mono-deep', name: 'Mono Deep',
    description: 'Full desaturation with deep, contrasty blacks.',
    mix: REC709_IDENTITY,
    shape: shape({ contrast: 0.3, saturation: -1 }),
  },
  {
    id: 'mono-selenium', name: 'Mono Selenium',
    description: 'Desaturated with a faint cool tint in the shadows and warm in the highlights, like a toned print.',
    mix: REC709_IDENTITY,
    shape: shape({ contrast: 0.2, saturation: -1, lift: [-0.01, 0, 0.015], gain: [0.015, 0, -0.01] }),
  },
]

export function lookById(id: string): Look | undefined {
  return LOOKS.find((look) => look.id === id)
}

/** `display` is a display-referred Rec.709 pixel (the same space `applyPrimaries` returns). Returns
 * the identity at `strength <= 0`; `strength` is expected in [0, 1] but not clamped here so a caller
 * (`bake.ts`) can validate it once, up front. */
export function applyLook(display: RGB, look: Look, strength: number): RGB {
  if (strength <= 0) return display
  const mixed = applyMatrix3(look.mix, display[0], display[1], display[2])
  const graded = applyToneShape(mixed, look.shape)
  return map3(display, (v, i) => v + (graded[i] - v) * strength)
}
