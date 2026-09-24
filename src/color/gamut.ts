/**
 * Camera-gamut → Rec.709 primaries, and a highlight roll-off for scene-linear values that land above
 * 1.0 (a log profile's whole point is capturing highlights a display can't show).
 *
 * Every gamut's primaries and white point below are the vendor's own published chromaticity
 * coordinates — never a hand-fitted matrix — cross-checked against the vendor's white paper or
 * reference manual (cited per gamut). All white points are CIE 1931 2° D65 (x=0.3127, y=0.3290), the
 * same white as Rec.709, so no chromatic adaptation step is needed between them.
 */

export type CameraGamut = 'rec2020' | 'f-gamut-c' | 's-gamut3-cine' | 'v-gamut' | 'cinema-gamut'

/** xy chromaticity of each primary, in R, G, B order. */
type Primaries = readonly [readonly [number, number], readonly [number, number], readonly [number, number]]

const D65: readonly [number, number] = [0.3127, 0.3290]

const REC709_PRIMARIES: Primaries = [[0.640, 0.330], [0.300, 0.600], [0.150, 0.060]]
/** Also Fujifilm F-Gamut (F-Log) and the gamut Apple's own IDT decodes Apple Log into. */
const REC2020_PRIMARIES: Primaries = [[0.708, 0.292], [0.170, 0.797], [0.131, 0.046]]
/** Fujifilm F-Gamut C (F-Log2 Data Sheet Ver.1.1). */
const F_GAMUT_C_PRIMARIES: Primaries = [[0.73470, 0.26530], [0.02630, 0.97370], [0.11730, -0.02240]]
/** Sony S-Gamut3.Cine (Technical Summary for S-Gamut3.Cine/S-Log3). */
const S_GAMUT3_CINE_PRIMARIES: Primaries = [[0.76600, 0.27500], [0.22500, 0.80000], [0.08900, -0.08700]]
/** Panasonic V-Gamut (VARICAM V-Log/V-Gamut Reference Manual). */
const V_GAMUT_PRIMARIES: Primaries = [[0.7300, 0.2800], [0.1650, 0.8400], [0.1000, -0.0300]]
/** Canon Cinema Gamut (White Paper: Canon Log Gamma Curves). */
const CINEMA_GAMUT_PRIMARIES: Primaries = [[0.7400, 0.2700], [0.1700, 1.1400], [0.0800, -0.1000]]

const GAMUT_PRIMARIES: Record<CameraGamut, Primaries> = {
  rec2020: REC2020_PRIMARIES,
  'f-gamut-c': F_GAMUT_C_PRIMARIES,
  's-gamut3-cine': S_GAMUT3_CINE_PRIMARIES,
  'v-gamut': V_GAMUT_PRIMARIES,
  'cinema-gamut': CINEMA_GAMUT_PRIMARIES,
}

export type Matrix3 = readonly [number, number, number, number, number, number, number, number, number]
const IDENTITY_3: Matrix3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]

function multiply3(a: Matrix3, b: Matrix3): Matrix3 {
  const r = new Array<number>(9)
  for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
    r[row * 3 + col] = a[row * 3] * b[col] + a[row * 3 + 1] * b[3 + col] + a[row * 3 + 2] * b[6 + col]
  }
  return r as unknown as Matrix3
}

function invert3(m: Matrix3): Matrix3 {
  const [a, b, c, d, e, f, g, h, i] = m
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g
  const D = -(b * i - c * h), E = a * i - c * g, F = -(a * h - b * g)
  const G = b * f - c * e, H = -(a * f - c * d), I = a * e - b * d
  const det = a * A + b * B + c * C
  if (Math.abs(det) < 1e-12) throw new Error('Singular color matrix')
  const inv = 1 / det
  return [A * inv, D * inv, G * inv, B * inv, E * inv, H * inv, C * inv, F * inv, I * inv]
}

/**
 * The standard "normalized primary matrix" construction (Bruce Lindbloom's derivation, the same one
 * `colour-science` uses): given the xy chromaticities of three primaries and a white point, the
 * unique RGB→XYZ matrix that maps (1,1,1) to that white's XYZ and each primary's (1,0,0)/(0,1,0)/
 * (0,0,1) to its own XYZ.
 */
function primariesToXyz(primaries: Primaries, white: readonly [number, number]): Matrix3 {
  const xyz = (x: number, y: number): [number, number, number] => [x / y, 1, (1 - x - y) / y]
  const [rx, gx, bx] = primaries.map(([x, y]) => xyz(x, y)) as [number, number, number][]
  const m: Matrix3 = [rx[0], gx[0], bx[0], rx[1], gx[1], bx[1], rx[2], gx[2], bx[2]]
  const whiteXyz = xyz(white[0], white[1])
  const mInv = invert3(m)
  const sr = mInv[0] * whiteXyz[0] + mInv[1] * whiteXyz[1] + mInv[2] * whiteXyz[2]
  const sg = mInv[3] * whiteXyz[0] + mInv[4] * whiteXyz[1] + mInv[5] * whiteXyz[2]
  const sb = mInv[6] * whiteXyz[0] + mInv[7] * whiteXyz[1] + mInv[8] * whiteXyz[2]
  return [m[0] * sr, m[1] * sg, m[2] * sb, m[3] * sr, m[4] * sg, m[5] * sb, m[6] * sr, m[7] * sg, m[8] * sb]
}

const REC709_TO_XYZ = primariesToXyz(REC709_PRIMARIES, D65)
const XYZ_TO_REC709 = invert3(REC709_TO_XYZ)

/** Scene-linear camera-gamut RGB → scene-linear Rec.709/D65 RGB. Rec.2020 (F-Log's own gamut) is the
 * identity's near neighbour but still goes through the same matrix chain for one code path. */
export function gamutToRec709Matrix(gamut: CameraGamut): Matrix3 {
  return multiply3(XYZ_TO_REC709, primariesToXyz(GAMUT_PRIMARIES[gamut], D65))
}

export function applyMatrix3(m: Matrix3, r: number, g: number, b: number): [number, number, number] {
  return [m[0] * r + m[1] * g + m[2] * b, m[3] * r + m[4] * g + m[5] * b, m[6] * r + m[7] * g + m[8] * b]
}

/**
 * Compresses scene-linear values above 1.0 toward 1.0 instead of hard-clipping them, so a
 * correctly-exposed log highlight (which routinely reads well above 1.0 in Rec.709 linear light)
 * rolls off instead of posterizing. Below `knee` (a fraction of 1.0) it is the identity; above it, a
 * Reinhard-style asymptote that approaches 1/knee. `knee = 1` disables the roll-off (identity for all
 * non-negative input), which is the default so `bakeGrade` never applies one unasked.
 */
export function highlightRolloff(value: number, knee: number): number {
  if (knee >= 1 || value <= knee) return value
  const excess = value - knee
  const ceiling = 1 - knee
  return knee + ceiling * (excess / (excess + ceiling))
}

export const REC709_IDENTITY = IDENTITY_3
