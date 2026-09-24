/**
 * "Match reference image": derives a display-referred color grade that moves a source frame's tone
 * and color character toward a reference still, and bakes it to a 3D LUT (`bakeMatch`) that goes
 * through the same `.cube` import path as any user LUT, so preview and export sample identical data.
 *
 * This is a statistical transfer, not scene understanding — it matches distributions, not content,
 * so it works best when both images are of comparable subjects and it is exposed with a strength
 * slider. All work is in Oklab (`oklab.ts`):
 *   - Lightness: a monotone tone curve from quantile matching (source L quantile → reference L at
 *     the same quantile), slope-limited so it cannot band or invert.
 *   - Chroma (a, b): a per-luma-band mean shift plus one shared chroma gain, blended smoothly across
 *     shadows / mids / highlights by source lightness. That is what carries split-toning (cool
 *     shadows under warm highlights) rather than a single global cast.
 */

import type { Cube3D } from './cube'
import { oklabToRgb, rgbToOklab } from './oklab'
import type { RGB } from './primaries'

/** Structural subset of the DOM `ImageData` (RGBA, 8-bit, gamma-encoded), so this stays testable in Node. */
export type PixelImage = { data: ArrayLike<number>; width: number; height: number }

const QUANTILES = 64
const BAND_COUNT = 3
const MAX_SAMPLES = 24000
const SLOPE_MIN = 0.35
const SLOPE_MAX = 3
const CHROMA_GAIN_MIN = 0.5
const CHROMA_GAIN_MAX = 1.8

export type MatchModel = {
  /** Source L quantiles and the reference L each maps to (both length QUANTILES + 1, nondecreasing). */
  sourceL: readonly number[]
  targetL: readonly number[]
  /** Luma-band centres in source lightness, and per-band a/b offset and shared chroma gain. */
  bandCenters: readonly number[]
  bandOffset: readonly (readonly [number, number])[]
  bandGain: readonly number[]
}

type Sample = { L: number; a: number; b: number }

function samplePixels(image: PixelImage): Sample[] {
  const total = image.width * image.height
  const stride = Math.max(1, Math.floor(total / MAX_SAMPLES))
  const samples: Sample[] = []
  for (let p = 0; p < total; p += stride) {
    const i = p * 4
    if (image.data[i + 3] === 0) continue
    const [L, a, b] = rgbToOklab([image.data[i] / 255, image.data[i + 1] / 255, image.data[i + 2] / 255])
    samples.push({ L, a, b })
  }
  return samples
}

function quantiles(values: number[]): number[] {
  const sorted = [...values].sort((x, y) => x - y)
  return Array.from({ length: QUANTILES + 1 }, (_, i) => sorted[Math.min(sorted.length - 1, Math.round((i / QUANTILES) * (sorted.length - 1)))])
}

const smooth = (lo: number, hi: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - lo) / (hi - lo)))
  return t * t * (3 - 2 * t)
}

/** Soft weights for `BAND_COUNT` bands centred at `centers`, summing to 1 at any lightness. */
function bandWeights(L: number, centers: readonly number[]): number[] {
  const raw = centers.map((c, i) => {
    const left = i === 0 ? c - 1 : centers[i - 1]
    const right = i === centers.length - 1 ? c + 1 : centers[i + 1]
    return L <= c ? smooth(left, c, L) : 1 - smooth(c, right, L)
  })
  // The outermost bands hold their value past their own centre.
  if (L < centers[0]) raw[0] = 1
  if (L > centers[centers.length - 1]) raw[centers.length - 1] = 1
  const sum = raw.reduce((s, v) => s + v, 0) || 1
  return raw.map((v) => v / sum)
}

function bandStats(samples: Sample[], centers: readonly number[]) {
  const acc = centers.map(() => ({ w: 0, a: 0, b: 0, aa: 0, bb: 0 }))
  for (const s of samples) {
    const weights = bandWeights(s.L, centers)
    weights.forEach((w, k) => {
      acc[k].w += w; acc[k].a += w * s.a; acc[k].b += w * s.b; acc[k].aa += w * s.a * s.a; acc[k].bb += w * s.b * s.b
    })
  }
  return acc.map((band) => {
    const w = band.w || 1
    const meanA = band.a / w, meanB = band.b / w
    const variance = Math.max(0, band.aa / w - meanA * meanA) + Math.max(0, band.bb / w - meanB * meanB)
    return { meanA, meanB, spread: Math.sqrt(variance), weight: band.w }
  })
}

/** Limits the tone curve's local slope to `[SLOPE_MIN, SLOPE_MAX]` by re-integrating it, so a
 * reference with a very different contrast can't produce a flat spot (banding) or a cliff. */
function limitSlopes(sourceL: readonly number[], targetL: readonly number[]): number[] {
  const out = [targetL[0]]
  for (let i = 1; i < sourceL.length; i++) {
    const run = sourceL[i] - sourceL[i - 1]
    const rise = targetL[i] - targetL[i - 1]
    const limited = run > 1e-6 ? Math.min(SLOPE_MAX * run, Math.max(SLOPE_MIN * run, rise)) : Math.max(0, rise)
    out.push(out[i - 1] + limited)
  }
  return out
}

/** Throws if either image has no opaque pixels. */
export function deriveMatch(source: PixelImage, reference: PixelImage): MatchModel {
  const src = samplePixels(source)
  const ref = samplePixels(reference)
  if (!src.length || !ref.length) throw new Error('Match reference: an image has no visible pixels.')

  const sourceL = quantiles(src.map((s) => s.L))
  const refL = quantiles(ref.map((s) => s.L))
  const monotone = refL.map((_, i) => Math.max(...refL.slice(0, i + 1)))
  const targetL = limitSlopes(sourceL, monotone)

  const bandCenters = [0.2, 0.5, 0.8].map((p) => sourceL[Math.round(p * QUANTILES)])
  const refCenters = [0.2, 0.5, 0.8].map((p) => refL[Math.round(p * QUANTILES)])
  const srcStats = bandStats(src, bandCenters)
  const refStats = bandStats(ref, refCenters)

  const bandGain = srcStats.map((s, k) => {
    const ratio = s.spread > 1e-4 ? refStats[k].spread / s.spread : 1
    return Math.min(CHROMA_GAIN_MAX, Math.max(CHROMA_GAIN_MIN, ratio))
  })
  const bandOffset = srcStats.map((s, k): readonly [number, number] => [
    refStats[k].meanA - bandGain[k] * s.meanA,
    refStats[k].meanB - bandGain[k] * s.meanB,
  ])
  return { sourceL, targetL, bandCenters, bandOffset, bandGain }
}

function mapLightness(model: MatchModel, L: number): number {
  const { sourceL, targetL } = model
  const last = sourceL.length - 1
  if (L <= sourceL[0]) return targetL[0] + (L - sourceL[0])
  if (L >= sourceL[last]) return targetL[last] + (L - sourceL[last])
  let lo = 0, hi = last
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (sourceL[mid] <= L) lo = mid; else hi = mid
  }
  const span = sourceL[hi] - sourceL[lo]
  return span < 1e-9 ? targetL[lo] : targetL[lo] + ((L - sourceL[lo]) / span) * (targetL[hi] - targetL[lo])
}

/** One display-referred pixel through the model; `strength` in [0, 1] blends toward the input. */
export function applyMatch(model: MatchModel, rgb: RGB, strength = 1): RGB {
  const [L, a, b] = rgbToOklab(rgb)
  const weights = bandWeights(L, model.bandCenters)
  let gain = 0, offA = 0, offB = 0
  weights.forEach((w, k) => { gain += w * model.bandGain[k]; offA += w * model.bandOffset[k][0]; offB += w * model.bandOffset[k][1] })
  const matched = oklabToRgb([mapLightness(model, L), a * gain + offA, b * gain + offB])
  return [rgb[0] + (matched[0] - rgb[0]) * strength, rgb[1] + (matched[1] - rgb[1]) * strength, rgb[2] + (matched[2] - rgb[2]) * strength]
}

/** Bakes the match to a `size`^3 lattice in the same layout as `bake.ts` (red fastest). 33 is plenty
 * for a smooth statistical grade — no steep log toe to resolve. */
export function bakeMatch(model: MatchModel, strength = 1, size = 33, title = 'Reference match'): Cube3D {
  if (BAND_COUNT !== model.bandCenters.length) throw new Error('Match model has an unexpected band count.')
  const data = new Float32Array(size ** 3 * 3)
  const step = 1 / (size - 1)
  let i = 0
  for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) {
    const out = applyMatch(model, [r * step, g * step, b * step], strength)
    data[i++] = out[0]; data[i++] = out[1]; data[i++] = out[2]
  }
  return { size, title, domainMin: [0, 0, 0], domainMax: [1, 1, 1], data }
}
