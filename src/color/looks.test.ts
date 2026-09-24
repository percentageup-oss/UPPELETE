import { describe, expect, it } from 'vitest'
import { applyLook, LOOKS, lookById } from './looks'
import type { RGB } from './primaries'

describe('LOOKS', () => {
  it('has no duplicate ids', () => {
    expect(new Set(LOOKS.map((look) => look.id)).size).toBe(LOOKS.length)
  })

  it('names and descriptions mention no camera or film brand (docs/DEPENDENCIES.md: original work only)', () => {
    const banned = /fuji|fujifilm|leica|kodak|canon|sony|panasonic|arri|red\b|wick|kolder|mckinnon|keanu|netflix/i
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

describe('hue-band looks', () => {
  const bands = LOOKS.filter((look) => look.hues?.length || look.fade)

  it('ships the signature looks', () => {
    for (const id of ['cartel-dusk', 'neon-assassin', 'wanderlust', 'moody-matte', 'cold-forest', 'golden-drift']) {
      expect(lookById(id)).toBeDefined()
    }
  })

  it('is the identity at strength 0', () => {
    const px: RGB = [0.7, 0.4, 0.3]
    for (const look of bands) expect(applyLook(px, look, 0)).toEqual(px)
  })

  it('keeps a mid grey neutral for looks without split-toning or matte', () => {
    const look = lookById('wanderlust')!
    const [r, g, b] = applyLook([0.5, 0.5, 0.5], look, 1)
    expect(Math.abs(r - g)).toBeLessThan(0.02)
    expect(Math.abs(g - b)).toBeLessThan(0.02)
  })

  it('wanderlust pushes sky blue toward teal and skin toward orange', () => {
    const look = lookById('wanderlust')!
    const sky = applyLook([0.35, 0.55, 0.9], look, 1)
    expect(sky[1]).toBeGreaterThan(sky[0]) // cyan-ish: green above red
    expect(sky[1] / sky[2]).toBeGreaterThan(0.55 / 0.9)
    const skin = applyLook([0.85, 0.62, 0.5], look, 1)
    expect(skin[0]).toBeGreaterThan(skin[2] + 0.25)
  })

  it('a matte look lifts pure black', () => {
    const look = lookById('moody-matte')!
    const [r, g, b] = applyLook([0, 0, 0], look, 1)
    expect(Math.min(r, g, b)).toBeGreaterThan(0.02)
  })

  it('stays inside 0-1 for every look over a color grid', () => {
    for (const look of LOOKS) for (const r of [0, 0.5, 1]) for (const g of [0, 0.5, 1]) for (const b of [0, 0.5, 1]) {
      for (const v of applyLook([r, g, b], look, 1)) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1) }
    }
  })
})
