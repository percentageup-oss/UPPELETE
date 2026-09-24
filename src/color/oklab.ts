/**
 * Oklab / OkLCh conversions (Björn Ottosson, 2020, public domain) for perceptual hue and chroma
 * edits in `looks.ts` and `referenceMatch.ts`. Input/output are display-referred, gamma-encoded
 * 0-1 RGB; the piecewise sRGB curve stands in for the display transfer, which is close enough to
 * BT.1886 for a creative hue push (nothing here claims colorimetric accuracy).
 */

import type { RGB } from './primaries'

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
const fromLinear = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055)

/** Gamma-encoded RGB → [L, a, b]. L is 0-1; a and b are roughly ±0.4. */
export function rgbToOklab([r, g, b]: RGB): RGB {
  const lr = toLinear(r), lg = toLinear(g), lb = toLinear(b)
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

/** [L, a, b] → gamma-encoded RGB, clamped to 0-1. */
export function oklabToRgb([L, a, b]: RGB): RGB {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const clamp = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
  return [
    clamp(fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)),
    clamp(fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)),
    clamp(fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)),
  ]
}

/** Hue in degrees [0, 360). */
export const oklabHue = (a: number, b: number) => ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360

/** Smallest signed angle from `from` to `to`, in (-180, 180]. */
export const hueDelta = (from: number, to: number) => ((to - from + 540) % 360) - 180
