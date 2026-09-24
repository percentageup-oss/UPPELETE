/**
 * Bundled film looks: a fixed library of procedural, parametric grades built from this app's own
 * `applyToneShape` (`primaries.ts`) plus an optional subtle channel mix for character. These are
 * original work — no camera or film-stock LUT is copied or reverse-engineered, and no brand name
 * appears anywhere in the id, name or description (see docs/DEPENDENCIES.md). A few are named to
 * evoke a genre of grade (neon noir, travel teal-and-orange, moody matte) without naming a film or
 * creator. `applyLook` blends the
 * look's result back toward the untouched input by `strength`, so every look is the identity at
 * `strength = 0` regardless of its own parameters.
 */

import type { Matrix3 } from './gamut'
import { applyMatrix3, REC709_IDENTITY } from './gamut'
import { hueDelta, oklabHue, oklabToRgb, rgbToOklab } from './oklab'
import { applyToneShape, map3, NEUTRAL_TONE_SHAPE, type RGB, type ToneShape } from './primaries'

/** A hue-selective push, in OkLCh (`oklab.ts`): pixels whose hue lies within `width`° of `center`°
 * (raised-cosine falloff) are rotated by `shift`°, have their chroma scaled by `1 + sat`, and their
 * lightness moved by `lum * 0.1`. Weights fade out below a small chroma so neutrals stay neutral —
 * how a teal/orange look moves skin and sky in opposite directions, which a global tone shape can't.
 * Oklab hues: red ~30°, orange ~55°, yellow ~110°, green ~145°, cyan ~195°, blue ~265°, magenta ~330°. */
export type HueBand = { center: number; width: number; shift: number; sat: number; lum?: number }

export type Look = {
  id: string
  name: string
  /** Shown in the Color panel under the swatch; never mentions a camera or film brand. */
  description: string
  mix: Matrix3
  shape: ToneShape
  /** Optional hue-selective pushes, applied after `shape`. Absent = none. */
  hues?: readonly HueBand[]
  /** Optional matte: lifts the black point by this fraction of full scale (0 = none). */
  fade?: number
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
  {
    id: 'cartel-dusk', name: 'Cartel Dusk',
    description: 'Low-key and desaturated, warm amber skin against olive-teal shadows — a tense, dim interior drama.',
    mix: REC709_IDENTITY,
    shape: shape({ contrast: 0.2, shadows: -0.06, highlights: -0.05, saturation: -0.35, lift: [-0.012, 0.01, 0.008], gain: [0.03, 0.01, -0.03] }),
    hues: [
      { center: 52, width: 70, shift: -5, sat: 0.12 },
      { center: 140, width: 80, shift: 25, sat: -0.3, lum: -0.3 },
    ],
  },
  {
    id: 'neon-assassin', name: 'Neon Assassin',
    description: 'Crushed cyan-tinted blacks, hard contrast and glowing magenta and cyan — a rain-soaked neon night.',
    mix: REC709_IDENTITY,
    shape: shape({ contrast: 0.42, shadows: -0.16, saturation: 0.05, lift: [-0.02, 0, 0.03], gain: [0.02, -0.01, 0.03] }),
    hues: [
      { center: 332, width: 80, shift: 12, sat: 0.55 },
      { center: 200, width: 80, shift: 0, sat: 0.4 },
      { center: 52, width: 55, shift: 0, sat: -0.25 },
    ],
  },
  {
    id: 'wanderlust', name: 'Wanderlust Teal & Orange',
    description: 'Vivid travel grade: warm tones pushed to orange, cool tones and skies pushed to teal.',
    mix: REC709_IDENTITY,
    shape: shape({ contrast: 0.25, saturation: 0.15, shadows: 0.03 }),
    hues: [
      { center: 55, width: 100, shift: -10, sat: 0.3 },
      { center: 255, width: 120, shift: -55, sat: 0.25 },
      { center: 140, width: 60, shift: 30, sat: -0.15 },
    ],
  },
  {
    id: 'moody-matte', name: 'Moody Matte',
    description: 'Faded blacks, muted greens and blues and brown-warm midtones — a soft, brooding matte finish.',
    mix: REC709_IDENTITY,
    shape: shape({ contrast: 0.1, saturation: -0.15, gain: [0.03, 0.01, -0.02] }),
    fade: 0.05,
    hues: [
      { center: 140, width: 80, shift: -12, sat: -0.4 },
      { center: 265, width: 90, shift: -30, sat: -0.3 },
    ],
  },
  {
    id: 'cold-forest', name: 'Cold Forest',
    description: 'Cool, subdued and deep — greens pulled toward teal-olive, shadows leaning blue.',
    mix: REC709_IDENTITY,
    shape: shape({ contrast: 0.18, saturation: -0.15, lift: [-0.015, 0, 0.02], gain: [-0.02, 0, 0.03] }),
    hues: [
      { center: 140, width: 80, shift: 20, sat: -0.25, lum: -0.3 },
      { center: 52, width: 55, shift: 0, sat: -0.15 },
    ],
  },
  {
    id: 'golden-drift', name: 'Golden Drift',
    description: 'Warm glowing highlights, teal skies and a gentle matte — a late-afternoon road-trip feel.',
    mix: REC709_IDENTITY,
    shape: shape({ contrast: 0.15, gain: [0.05, 0.02, -0.05] }),
    fade: 0.03,
    hues: [
      { center: 255, width: 110, shift: -50, sat: 0.1 },
      { center: 100, width: 70, shift: -10, sat: 0.2 },
    ],
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
  const shaped = applyToneShape(mixed, look.shape)
  const graded = look.hues?.length || look.fade ? applyHuesAndFade(shaped, look) : shaped
  return map3(display, (v, i) => v + (graded[i] - v) * strength)
}

/** Chroma below which a pixel is treated as neutral and left alone by hue bands. */
const NEUTRAL_CHROMA = 0.02
const FULL_CHROMA = 0.07
const smoothstep = (lo: number, hi: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - lo) / (hi - lo)))
  return t * t * (3 - 2 * t)
}

function applyHuesAndFade(display: RGB, look: Look): RGB {
  let out = display
  if (look.hues?.length) {
    const [L, a, b] = rgbToOklab(display)
    const chroma = Math.hypot(a, b)
    const hue = oklabHue(a, b)
    const gate = smoothstep(NEUTRAL_CHROMA, FULL_CHROMA, chroma)
    let shift = 0, chromaGain = 1, lightness = 0
    for (const band of look.hues) {
      const distance = Math.abs(hueDelta(band.center, hue))
      const half = band.width / 2
      if (distance >= half) continue
      const weight = (0.5 + 0.5 * Math.cos((Math.PI * distance) / half)) * gate
      shift += band.shift * weight
      chromaGain *= 1 + band.sat * weight
      lightness += (band.lum ?? 0) * 0.1 * weight
    }
    const angle = ((hue + shift) * Math.PI) / 180
    const c = chroma * chromaGain
    out = oklabToRgb([L + lightness, c * Math.cos(angle), c * Math.sin(angle)])
  }
  const fade = look.fade ?? 0
  return fade > 0 ? map3(out, (v) => fade + v * (1 - fade)) : out
}
