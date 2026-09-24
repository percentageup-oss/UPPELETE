/**
 * A CSS gradient preview of a look, for its tile in the Color panel — a real sample of what the look
 * actually does (via `evaluateGrade`, the same evaluation `bakeGrade` runs at every lattice point),
 * not a decorative color chosen by hand. Samples a neutral gray ramp so the look's own tone curve,
 * split-toning and saturation show through exactly as they would on a desaturated mid-tone image.
 */

import { evaluateGrade, NEUTRAL_GRADE, type Grade } from './bake'
import type { RGB } from './primaries'

const STOPS = 6

function toCss([r, g, b]: RGB): string {
  const channel = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255)
  return `rgb(${channel(r)}, ${channel(g)}, ${channel(b)})`
}

/** `linear-gradient(90deg, …)` sampling `lookId` at `STOPS` even points along a 0–1 gray ramp. */
export function lookSwatchGradient(lookId: string): string {
  const grade: Grade = { ...NEUTRAL_GRADE, look: { id: lookId, strength: 1 } }
  const stops = Array.from({ length: STOPS }, (_, i) => {
    const v = i / (STOPS - 1)
    const out = evaluateGrade([v, v, v], grade)
    return `${toCss(out)} ${Math.round((i / (STOPS - 1)) * 100)}%`
  })
  return `linear-gradient(90deg, ${stops.join(', ')})`
}
