import { describe, expect, it } from 'vitest'
import { parseCube, writeCube } from './cube'
import { rgbToOklab } from './oklab'
import { applyMatch, bakeMatch, deriveMatch, type PixelImage } from './referenceMatch'
import type { RGB } from './primaries'

/** A deterministic gradient image: luma ramps left→right, with `tint` added per channel. */
function ramp(width: number, height: number, tint: RGB = [0, 0, 0], scale = 1): PixelImage {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const v = (x / (width - 1)) * scale, i = (y * width + x) * 4
    data[i] = (v + tint[0]) * 255; data[i + 1] = (v + tint[1]) * 255; data[i + 2] = (v + tint[2]) * 255; data[i + 3] = 255
  }
  return { data, width, height }
}

/** A colourful noise-free image: hue varies with x, brightness with y. */
function colorful(width: number, height: number): PixelImage {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4, h = (x / width) * 6, l = 0.2 + 0.6 * (y / height)
    const c = (n: number) => l * (0.6 + 0.4 * Math.cos(h + n))
    data[i] = c(0) * 255; data[i + 1] = c(2.1) * 255; data[i + 2] = c(4.2) * 255; data[i + 3] = 255
  }
  return { data, width, height }
}

const close = (a: RGB, b: RGB, tol: number) => a.every((v, i) => Math.abs(v - b[i]) <= tol)

describe('deriveMatch', () => {
  it('is near-identity when the source and reference are the same image', () => {
    const image = colorful(64, 48)
    const model = deriveMatch(image, image)
    for (const px of [[0.2, 0.3, 0.4], [0.7, 0.5, 0.3], [0.5, 0.5, 0.5], [0.9, 0.9, 0.9]] as RGB[]) {
      expect(close(applyMatch(model, px), px, 0.04)).toBe(true)
    }
  })

  it('builds a monotone, slope-limited tone curve', () => {
    const model = deriveMatch(ramp(64, 8), ramp(64, 8, [0, 0, 0], 0.4))
    for (let i = 1; i < model.targetL.length; i++) expect(model.targetL[i]).toBeGreaterThanOrEqual(model.targetL[i - 1])
    let last = -1
    for (let v = 0; v <= 1; v += 0.05) {
      const out = rgbToOklab(applyMatch(model, [v, v, v]))[0]
      expect(out).toBeGreaterThanOrEqual(last - 1e-6)
      last = out
    }
  })

  it('darkens toward a darker reference', () => {
    const model = deriveMatch(ramp(64, 8), ramp(64, 8, [0, 0, 0], 0.5))
    expect(rgbToOklab(applyMatch(model, [0.8, 0.8, 0.8]))[0]).toBeLessThan(rgbToOklab([0.8, 0.8, 0.8])[0] - 0.1)
  })

  it('transfers a color cast: a warm reference warms a neutral source', () => {
    const model = deriveMatch(ramp(64, 8), ramp(64, 8, [0.08, 0.02, -0.06]))
    const [r, , b] = applyMatch(model, [0.5, 0.5, 0.5])
    expect(r).toBeGreaterThan(b + 0.05)
  })

  it('carries split toning: cool shadows and warm highlights stay separate', () => {
    const reference = ramp(64, 8)
    for (let x = 0; x < 64; x++) for (let y = 0; y < 8; y++) {
      const i = (y * 64 + x) * 4, warm = x / 63 - 0.5
      ;(reference.data as Uint8ClampedArray)[i] = Math.min(255, Math.max(0, reference.data[i] + warm * 60))
      ;(reference.data as Uint8ClampedArray)[i + 2] = Math.min(255, Math.max(0, reference.data[i + 2] - warm * 60))
    }
    const model = deriveMatch(ramp(64, 8), reference)
    const shadow = applyMatch(model, [0.15, 0.15, 0.15])
    const highlight = applyMatch(model, [0.85, 0.85, 0.85])
    expect(shadow[2]).toBeGreaterThan(shadow[0])
    expect(highlight[0]).toBeGreaterThan(highlight[2])
  })

  it('is the identity at strength 0 and blends in between', () => {
    const model = deriveMatch(ramp(64, 8), ramp(64, 8, [0.08, 0, -0.08], 0.6))
    const px: RGB = [0.6, 0.5, 0.4]
    expect(applyMatch(model, px, 0)).toEqual(px)
    const full = applyMatch(model, px, 1), half = applyMatch(model, px, 0.5)
    expect(half[0]).toBeCloseTo((px[0] + full[0]) / 2, 5)
  })

  it('rejects an image with no visible pixels', () => {
    const empty: PixelImage = { data: new Uint8ClampedArray(16), width: 2, height: 2 }
    expect(() => deriveMatch(empty, colorful(8, 8))).toThrow(/no visible pixels/)
  })
})

describe('bakeMatch', () => {
  it('bakes a size^3 cube that survives a writeCube/parseCube round trip with values in range', () => {
    const cube = bakeMatch(deriveMatch(colorful(48, 32), ramp(48, 32, [0.05, 0, -0.05], 0.7)), 1, 17, 'Match – test')
    const parsed = parseCube(writeCube(cube))
    expect(parsed.size).toBe(17)
    expect(parsed.title).toBe('Match – test')
    expect(parsed.data.length).toBe(17 ** 3 * 3)
    for (const v of parsed.data) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1) }
  })

  it('strength 0 bakes to the identity lattice', () => {
    const cube = bakeMatch(deriveMatch(colorful(32, 32), ramp(32, 32, [0.1, 0, 0])), 0, 5)
    expect(cube.data[0]).toBe(0)
    const last = cube.data.length - 3
    expect([cube.data[last], cube.data[last + 1], cube.data[last + 2]]).toEqual([1, 1, 1])
  })
})
