/**
 * Primary color-correction controls: exposure, white balance, contrast, highlights/shadows, a
 * lift/gamma/gain three-way corrector and saturation. Unlike `transfer.ts`/`gamut.ts`, none of this
 * is spec'd by a vendor — it is this app's own grading pipeline, so the ordering below is the
 * authority on what each control means, and every step is covered by an identity/monotonicity test
 * in `primaries.test.ts` rather than a reference table.
 *
 * `applyToneShape` (steps 3-7) is display-referred and takes no exposure/white-balance/gamut
 * arguments, so `looks.ts` reuses it verbatim for a film look's own contrast/tint/saturation
 * character instead of re-implementing the same six controls a second time.
 *
 * Pipeline, given scene-linear Rec.709 input (already through `gamutToRec709Matrix` and
 * `highlightRolloff`, see `bake.ts`):
 *   1. exposure   — linear multiply, in stops (2^stops)
 *   2. white balance — per-channel linear multiply from temperature/tint
 *   3. Rec.709 OETF encode → display-referred 0-1 (values can still exceed 1 here; nothing clamps
 *      until the final step, so a later control can still recover a highlight)
 *   4. contrast   — pivoted at display mid-grey (0.5)
 *   5. lift/gamma/gain — ASC-CDL-shaped: (in * gain + lift) ^ gammaExponent, per channel
 *   6. highlights/shadows — tone-weighted lift, independent of the lift/gamma/gain wheels
 *   7. saturation — mix with Rec.709 luma
 *   8. clamp to [0, 1]
 */

import { REC709_EOTF, REC709_OETF } from './rec709'

export type RGB = readonly [number, number, number]

/** Steps 4-7: a display-referred tone/color character with no notion of exposure or gamut. */
export type ToneShape = {
  contrast: number
  highlights: number
  shadows: number
  saturation: number
  lift: RGB
  gamma: RGB
  gain: RGB
}

export type PrimariesGrade = ToneShape & {
  exposureStops: number
  temperature: number
  tint: number
}

export const NEUTRAL_TONE_SHAPE: ToneShape = {
  contrast: 0, highlights: 0, shadows: 0, saturation: 0, lift: [0, 0, 0], gamma: [0, 0, 0], gain: [0, 0, 0],
}

export const NEUTRAL_PRIMARIES: PrimariesGrade = { ...NEUTRAL_TONE_SHAPE, exposureStops: 0, temperature: 0, tint: 0 }

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const REC709_LUMA: RGB = [0.2126, 0.7152, 0.0722]
export const map3 = (rgb: RGB, fn: (v: number, i: number) => number): RGB => [fn(rgb[0], 0), fn(rgb[1], 1), fn(rgb[2], 2)]

/** Simplified von Kries-style channel gains for a ±1 temperature/tint control — not a full CCT
 * model, adequate for a creative white-balance nudge rather than a colorimetric match. `temperature`
 * pushes blue↔amber, `tint` pushes green↔magenta, each ±1 stop at the control's extremes. */
function whiteBalanceGains(temperature: number, tint: number): RGB {
  const warm = 2 ** (temperature * 0.5)
  const cool = 2 ** (-temperature * 0.5)
  const magenta = 2 ** (tint * 0.5)
  const green = 2 ** (-tint * 0.5)
  return [warm, green, cool * magenta]
}

function applyContrast(v: number, contrast: number): number {
  // contrast in [-1, 1]; +1 doubles the slope around mid-grey, -1 halves it.
  const slope = 2 ** contrast
  return 0.5 + (v - 0.5) * slope
}

/** `lift`/`gamma`/`gain` are each in [-1, 1]. Lift is an additive offset (±0.25 at the extremes),
 * gain a multiplicative one (2^gain), gamma an exponent (2^-gamma, so +1 brightens midtones). */
function applyLiftGammaGain(v: number, lift: number, gamma: number, gain: number): number {
  const lifted = v * 2 ** gain + lift * 0.25
  const exponent = 2 ** -gamma
  return lifted <= 0 ? lifted : lifted ** exponent
}

/** Brightens (positive) or darkens (negative) shadows/highlights independently, weighted by how far
 * `v` sits from mid-grey so midtones are left alone. */
function applyToneRegion(v: number, shadows: number, highlights: number): number {
  const shadowWeight = clamp01(0.5 - v) * 2
  const highlightWeight = clamp01(v - 0.5) * 2
  return v + shadows * 0.35 * shadowWeight ** 1.5 + highlights * 0.35 * highlightWeight ** 1.5
}

/** Steps 4-7 of the pipeline above, on an already display-referred pixel. Every step is the
 * identity at `shape`'s neutral value, so `NEUTRAL_TONE_SHAPE` round-trips exactly. */
export function applyToneShape(display: RGB, shape: ToneShape): RGB {
  const contrasted = map3(display, (v) => applyContrast(v, shape.contrast))
  const corrected = map3(contrasted, (v, i) => applyLiftGammaGain(v, shape.lift[i], shape.gamma[i], shape.gain[i]))
  const toned = map3(corrected, (v) => applyToneRegion(v, shape.shadows, shape.highlights))
  const luma = toned[0] * REC709_LUMA[0] + toned[1] * REC709_LUMA[1] + toned[2] * REC709_LUMA[2]
  // Linear, not exponential: -1 reaches exactly 0 (full desaturation), 0 is exactly neutral, +1 doubles
  // chroma distance from luma. Never negative, so saturation can't invert hues past full grey.
  const satMix = Math.max(0, 1 + shape.saturation)
  const saturated = map3(toned, (v) => luma + (v - luma) * satMix)
  return map3(saturated, clamp01)
}

/** Full pipeline: scene-linear Rec.709 in, display-referred [0, 1] Rec.709 out. */
export function applyPrimaries(rgb: RGB, grade: PrimariesGrade): RGB {
  const [wr, wg, wb] = whiteBalanceGains(grade.temperature, grade.tint)
  const exposed = 2 ** grade.exposureStops
  const linear: RGB = [rgb[0] * exposed * wr, rgb[1] * exposed * wg, rgb[2] * exposed * wb]
  const display = map3(linear, REC709_OETF)
  return applyToneShape(display, grade)
}

export { REC709_EOTF, REC709_OETF }
