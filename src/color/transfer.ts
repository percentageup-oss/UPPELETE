/**
 * Log-encoding transfer functions: `decodeSceneLinear` turns a camera's log-encoded, normalized
 * (0-1) code value back into scene-linear reflectance (0.18 == 18% grey), the space every other
 * grading step in `src/color/` works in. `encodeLog` is its inverse, used only by tests to check
 * round trips and to synthesize log-encoded test patterns (docs/PRODUCT.md forbids faking real
 * camera data, so export/preview never call it on user footage).
 *
 * Every curve's constants are copied verbatim from the vendor's own published data sheet or white
 * paper (cited per curve below) — never fitted or estimated. Each is cross-checked in
 * `transfer.test.ts` against that document's own worked example (18% grey and, where published, 90%
 * white), so a transcription mistake fails a test rather than shipping.
 */

export type LogProfile = 'f-log' | 'f-log2' | 's-log3' | 'apple-log' | 'v-log' | 'c-log3'

type Curve = { decode: (code: number) => number; encode: (linear: number) => number }

/**
 * Fujifilm F-Log / F-Log2 (F-Log Data Sheet Ver.1.2, F-Log2 Data Sheet Ver.1.1, dl.fujifilm-x.com):
 * a linear toe below `cut1` and a log10 curve above it, sharing one shape with different constants.
 */
function fujiFLog(k: { cut1: number; cut2: number; a: number; b: number; c: number; d: number; e: number; f: number }): Curve {
  return {
    decode: (code) => (code < k.cut2 ? (code - k.f) / k.e : 10 ** ((code - k.d) / k.c) / k.a - k.b / k.a),
    encode: (linear) => (linear < k.cut1 ? k.e * linear + k.f : k.c * Math.log10(k.a * linear + k.b) + k.d),
  }
}
const F_LOG = fujiFLog({ cut1: 0.00089, cut2: 0.100537775223865, a: 0.555556, b: 0.009468, c: 0.344676, d: 0.790453, e: 8.735631, f: 0.092864 })
const F_LOG2 = fujiFLog({ cut1: 0.000889, cut2: 0.100686685370811, a: 5.555556, b: 0.064829, c: 0.245281, d: 0.384316, e: 8.799461, f: 0.092864 })

/**
 * Sony S-Log3 (Technical Summary for S-Gamut3.Cine/S-Log3, pro.sony), reflection-referred (0.18 ==
 * 18% grey), 10-bit normalized code values folded into the 0-1 range the curve is defined over.
 */
const S_LOG3: Curve = {
  decode: (code) => (code >= 171.2102946929 / 1023
    ? 10 ** ((code * 1023 - 420) / 261.5) * (0.18 + 0.01) - 0.01
    : (code * 1023 - 95) * 0.01125 / (171.2102946929 - 95)),
  encode: (linear) => (linear >= 0.01125
    ? (420 + Math.log10((linear + 0.01) / (0.18 + 0.01)) * 261.5) / 1023
    : (linear * (171.2102946929 - 95) / 0.01125 + 95) / 1023),
}

/**
 * Apple Log Profile (Apple Log Profile White Paper, 2023): a quadratic toe below `R_t`, clamped to 0
 * below `R_0`, and a log2 curve above `R_t`.
 */
const APPLE_LOG_K = { R_0: -0.05641088, R_t: 0.01, sigma: 47.28711236, beta: 0.00964052, gamma: 0.08550479, delta: 0.69336945 }
const APPLE_LOG_P_T = APPLE_LOG_K.sigma * (APPLE_LOG_K.R_t - APPLE_LOG_K.R_0) ** 2
const APPLE_LOG: Curve = {
  decode: (code) => (code >= APPLE_LOG_P_T
    ? 2 ** ((code - APPLE_LOG_K.delta) / APPLE_LOG_K.gamma) - APPLE_LOG_K.beta
    : code >= 0 ? Math.sqrt(code / APPLE_LOG_K.sigma) + APPLE_LOG_K.R_0 : APPLE_LOG_K.R_0),
  encode: (linear) => (linear >= APPLE_LOG_K.R_t
    ? APPLE_LOG_K.gamma * Math.log2(linear + APPLE_LOG_K.beta) + APPLE_LOG_K.delta
    : linear >= APPLE_LOG_K.R_0 ? APPLE_LOG_K.sigma * (linear - APPLE_LOG_K.R_0) ** 2 : 0),
}

/**
 * Panasonic V-Log (VARICAM V-Log/V-Gamut Reference Manual, pro-av.panasonic.net): a linear toe below
 * `cut1`/`cut2`, log10 above it.
 */
const V_LOG_K = { cut1: 0.01, cut2: 0.181, b: 0.00873, c: 0.241514, d: 0.598206 }
const V_LOG: Curve = {
  decode: (code) => (code < V_LOG_K.cut2 ? (code - 0.125) / 5.6 : 10 ** ((code - V_LOG_K.d) / V_LOG_K.c) - V_LOG_K.b),
  encode: (linear) => (linear < V_LOG_K.cut1 ? 5.6 * linear + 0.125 : V_LOG_K.c * Math.log10(linear + V_LOG_K.b) + V_LOG_K.d),
}

/**
 * Canon Log 3, revision 1.2 (Input Transform Version 202007 for EOS C300 Mark II, usa.canon.com): a
 * log10 toe, a linear midtone segment and a log10 shoulder, each matched at the joins. Revision 1.2's
 * constants (unlike 1.0/1.1's) are natively normalized code values, with no separate legal/full-range
 * rescale — the same convention every other curve in this file uses.
 *
 * Canon's own formula is defined in "linear where 100 IRE == 1.0", not reflectance (90% reflectance
 * == 100 IRE by convention) — hence the `* 0.9` / `/ 0.9` below, matching Canon's own
 * `in_reflection`/`out_reflection` conversion, so `decodeSceneLinear`'s contract (0.18 == 18% grey)
 * still holds for this curve like every other one in this file.
 */
const C_LOG3_K = { toe: 0.097465473, mid: 0.15277891, a: -0.36726845, k: 14.98325, toeOffset: 0.12783901, midSlope: 1.9754798, midOffset: 0.12512219, shoulderOffset: 0.12240537 }
const cLog3RawDecode = (code: number): number => (code < C_LOG3_K.toe
  ? -(10 ** ((C_LOG3_K.toeOffset - code) / -C_LOG3_K.a) - 1) / C_LOG3_K.k
  : code <= C_LOG3_K.mid ? (code - C_LOG3_K.midOffset) / C_LOG3_K.midSlope
  : (10 ** ((code - C_LOG3_K.shoulderOffset) / -C_LOG3_K.a) - 1) / C_LOG3_K.k)
const C_LOG3_TOE_IRE = cLog3RawDecode(C_LOG3_K.toe) * 0.9
const C_LOG3_MID_IRE = cLog3RawDecode(C_LOG3_K.mid) * 0.9
const C_LOG3: Curve = {
  decode: (code) => cLog3RawDecode(code) * 0.9,
  encode: (linear) => {
    const ire = linear / 0.9
    if (linear < C_LOG3_TOE_IRE) return C_LOG3_K.a * Math.log10(-ire * C_LOG3_K.k + 1) + C_LOG3_K.toeOffset
    if (linear <= C_LOG3_MID_IRE) return C_LOG3_K.midSlope * ire + C_LOG3_K.midOffset
    return -C_LOG3_K.a * Math.log10(ire * C_LOG3_K.k + 1) + C_LOG3_K.shoulderOffset
  },
}

const CURVES: Record<LogProfile, Curve> = { 'f-log': F_LOG, 'f-log2': F_LOG2, 's-log3': S_LOG3, 'apple-log': APPLE_LOG, 'v-log': V_LOG, 'c-log3': C_LOG3 }

/** A camera's normalized log code value (0-1) → scene-linear reflectance (0.18 == 18% grey). */
export function decodeSceneLinear(profile: LogProfile, code: number): number {
  return CURVES[profile].decode(code)
}

/** The inverse of `decodeSceneLinear` — test-only (see file header). */
export function encodeLog(profile: LogProfile, linear: number): number {
  return CURVES[profile].encode(linear)
}
