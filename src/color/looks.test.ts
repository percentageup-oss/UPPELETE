import { describe, expect, it } from 'vitest'
import { applyLook, LOOKS, lookById } from './looks'
import type { RGB } from './primaries'

describe('LOOKS', () => {
  it('has no duplicate ids', () => {
    expect(new Set(LOOKS.map((look) => look.id)).size).toBe(LOOKS.length)
  })

  it('names and descriptions mention no camera or film brand (docs/DEPENDENCIES.md: original work only)', () => {
    const banned = /fuji|fujifilm|leica|kodak|canon|sony|panasonic|arri|red\b/i
    for (const look of LOOKS) {
      expect(look.name).not.toMatch(banned)
      expect(look.description).not.toMatch(banned)
      expect(look.id).not.toMatch(banned)
    }
  })

  it('lookById finds a real look and returns undefined for an unknown id', () => {
    expect(lookById(LOOKS[0].id)).toBe(LOOKS[0])
    expect(lookById('not-a-real-look')).toBeUndefined()
  })
})

describe('applyLook', () => {
  const pixel: RGB = [0.6, 0.4, 0.3]

  it('is the identity at strength 0 for every bundled look', () => {
    for (const look of LOOKS) {
      const [r, g, b] = applyLook(pixel, look, 0)
      expect(r).toBeCloseTo(pixel[0], 9)
      expect(g).toBeCloseTo(pixel[1], 9)
      expect(b).toBeCloseTo(pixel[2], 9)
    }
  })

  it('moves the pixel at strength 1 for every look with a non-neutral shape', () => {
    for (const look of LOOKS) {
      const [r, g, b] = applyLook(pixel, look, 1)
      const moved = Math.abs(r - pixel[0]) + Math.abs(g - pixel[1]) + Math.abs(b - pixel[2])
      expect(moved).toBeGreaterThan(0)
    }
  })

  it('interpolates linearly between strength 0 and 1', () => {
    const look = lookById('slide-vivid')!
    const half = applyLook(pixel, look, 0.5)
    const full = applyLook(pixel, look, 1)
    const expectedHalf = pixel.map((v, i) => v + (full[i] - v) * 0.5)
    half.forEach((v, i) => expect(v).toBeCloseTo(expectedHalf[i], 6))
  })

  it('stays within [0, 1] for an in-range input at full strength', () => {
    for (const look of LOOKS) {
      const [r, g, b] = applyLook([0.5, 0.5, 0.5], look, 1)
      for (const v of [r, g, b]) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1) }
    }
  })
})
