/**
 * Turns a `Grade` (an input transform, a primaries grade and an optional look) into a single baked
 * 3D LUT — the one artifact both the WebGL2 preview and the FFmpeg `lut3d` export sample, with the
 * same trilinear interpolation on both sides (`sampleLut`), so they read the same data the same way.
 * See docs/EDITING.md "Color: adjustment layers" for the full preview/export recipe.
 *
 * A lattice point's domain value (`i / (size - 1)` per channel) is the *input* code value — the raw
 * log-encoded or display-referred pixel the grade would see, not a scene-linear one. `intensity`
 * therefore blends between that untouched domain value and the fully graded result, so an intensity
 * of 0 bakes to the identity LUT regardless of what the rest of the grade is set to.
 */

import type { Cube3D } from './cube'
import { applyMatrix3, gamutToRec709Matrix, highlightRolloff, type CameraGamut } from './gamut'
import { applyLook, lookById } from './looks'
import { applyPrimaries, map3, NEUTRAL_PRIMARIES, REC709_EOTF, type PrimariesGrade, type RGB } from './primaries'
import { decodeSceneLinear, type LogProfile } from './transfer'

/** Each log profile's own camera gamut (see gamut.ts for the cited primaries). Apple Log's IDT
 * decodes into Rec.2020/BT.2020 primaries, the same gamut F-Log's F-Gamut uses. */
const LOG_GAMUT: Record<LogProfile, CameraGamut> = {
  'f-log': 'rec2020', 'f-log2': 'f-gamut-c', 's-log3': 's-gamut3-cine', 'apple-log': 'rec2020', 'v-log': 'v-gamut', 'c-log3': 'cinema-gamut',
}

/** How far into scene-linear highlights (as a fraction of 1.0) the roll-off starts for a log input.
 * Un-tunable in v1; SDR ('none') and a user LUT get no roll-off, since their own curve already
 * defines what happens above 1.0. */
const LOG_HIGHLIGHT_KNEE = 0.85

export type GradeInput = { type: 'none' } | { type: 'log'; profile: LogProfile } | { type: 'lut'; cube: Cube3D }

export type Grade = {
  input: GradeInput
  primaries: PrimariesGrade
  look: { id: string; strength: number } | null
  /** 0 disables the whole grade (bakes to the identity LUT); 1 is the full effect. */
  intensity: number
}

export const NEUTRAL_GRADE: Grade = { input: { type: 'none' }, primaries: NEUTRAL_PRIMARIES, look: null, intensity: 1 }

/** Nearest-lattice-cell trilinear sample, matching FFmpeg's `lut3d=interp=trilinear` so preview and
 * export read identical values off the same data. `rgb` is in the LUT's own domain (normalized to
 * [0, 1] first via `domainMin`/`domainMax`); out-of-range input is clamped to the lattice edge. */
export function sampleLut(cube: Cube3D, rgb: RGB): RGB {
  const size = cube.size
  const coord = map3(rgb, (v, i) => {
    const span = cube.domainMax[i] - cube.domainMin[i]
    const normalized = span === 0 ? 0 : (v - cube.domainMin[i]) / span
    return clamp(normalized, 0, 1) * (size - 1)
  })
  const [cr, cg, cb] = coord
  const r0 = Math.floor(cr), g0 = Math.floor(cg), b0 = Math.floor(cb)
  const r1 = Math.min(r0 + 1, size - 1), g1 = Math.min(g0 + 1, size - 1), b1 = Math.min(b0 + 1, size - 1)
  const fr = cr - r0, fg = cg - g0, fb = cb - b0

  const at = (r: number, g: number, b: number, channel: number) => cube.data[idx(size, r, g, b) + channel]
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t
  const channel = (c: number): number => {
    const c00 = lerp(at(r0, g0, b0, c), at(r1, g0, b0, c), fr)
    const c10 = lerp(at(r0, g1, b0, c), at(r1, g1, b0, c), fr)
    const c01 = lerp(at(r0, g0, b1, c), at(r1, g0, b1, c), fr)
    const c11 = lerp(at(r0, g1, b1, c), at(r1, g1, b1, c), fr)
    const c0 = lerp(c00, c10, fg)
    const c1 = lerp(c01, c11, fg)
    return lerp(c0, c1, fb)
  }
  return [channel(0), channel(1), channel(2)]
}

function idx(size: number, r: number, g: number, b: number): number {
  return ((b * size + g) * size + r) * 3
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)

/** The untouched-input → scene-linear Rec.709 half of the pipeline (everything before
 * `applyPrimaries`), split out so `bakeGrade` and its tests can exercise it on its own. */
function toLinearRec709(domain: RGB, input: GradeInput): RGB {
  if (input.type === 'none') return map3(domain, REC709_EOTF)
  if (input.type === 'lut') return map3(sampleLut(input.cube, domain), REC709_EOTF)
  const gamut = LOG_GAMUT[input.profile]
  const cameraLinear = map3(domain, (v) => decodeSceneLinear(input.profile, v))
  const [r, g, b] = applyMatrix3(gamutToRec709Matrix(gamut), cameraLinear[0], cameraLinear[1], cameraLinear[2])
  return map3([r, g, b], (v) => highlightRolloff(v, LOG_HIGHLIGHT_KNEE))
}

/** One lattice point's full grade, from its raw input-domain value to the final output-domain value
 * (still blended by `grade.intensity` against that same raw value). */
export function evaluateGrade(domain: RGB, grade: Grade): RGB {
  if (grade.intensity <= 0) return domain
  const linear = toLinearRec709(domain, grade.input)
  const display = applyPrimaries(linear, grade.primaries)
  const look = grade.look ? lookById(grade.look.id) : null
  const looked = look ? applyLook(display, look, clamp(grade.look!.strength, 0, 1)) : display
  return map3(domain, (v, i) => v + (looked[i] - v) * clamp(grade.intensity, 0, 1))
}

/** Evaluates `grade` at every point of a `size`^3 lattice. 65 rather than the usual 33: a log input
 * curve is so steep in the shadows that 33 points trilinear-interpolate into visible blocky color
 * patches. Preview and export both bake through here, so they keep sampling identical data. */
export function bakeGrade(grade: Grade, size = 65): Cube3D {
  const data = new Float32Array(size ** 3 * 3)
  const step = 1 / (size - 1)
  for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) {
    const out = evaluateGrade([r * step, g * step, b * step], grade)
    const i = idx(size, r, g, b)
    data[i] = out[0]; data[i + 1] = out[1]; data[i + 2] = out[2]
  }
  return { size, title: 'Baked grade', domainMin: [0, 0, 0], domainMax: [1, 1, 1], data }
}

/** Composes two already-baked LUTs into one that applies `first` then `second` — how two stacked
 * adjustment layers combine (`docs/EDITING.md`), sampling `second` through the same trilinear
 * `sampleLut` used everywhere else so the composed LUT stays exact to within lattice resolution. */
export function composeLuts(first: Cube3D, second: Cube3D, size = first.size): Cube3D {
  const data = new Float32Array(size ** 3 * 3)
  const step = 1 / (size - 1)
  for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) {
    const through = sampleLut(first, [r * step, g * step, b * step])
    const out = sampleLut(second, through)
    const i = idx(size, r, g, b)
    data[i] = out[0]; data[i + 1] = out[1]; data[i + 2] = out[2]
  }
  return { size, title: 'Composed grade', domainMin: [0, 0, 0], domainMax: [1, 1, 1], data }
}
