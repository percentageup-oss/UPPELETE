import { describe, expect, it } from 'vitest'
import { boundsToPlacement, movePlacement, nudgePlacement, pointerScaleFactor, rotationAt, scaleFontSize } from './captionPlacement'
import type { Rect } from '../captions/renderer'

const safeRect: Rect = { x: 108, y: 86.4, width: 864, height: 691.2 }

/** A block placed exactly as `layoutCaption` would place it, so round-tripping through
 * `boundsToPlacement` recovers the same fraction it was built from. */
function boundsFor(placement: { horizontal: number; vertical: number }, size: { width: number; height: number }): Rect {
  return {
    x: safeRect.x + (safeRect.width - size.width) * placement.horizontal,
    y: safeRect.y + (safeRect.height - size.height) * placement.vertical,
    width: size.width, height: size.height,
  }
}

describe('boundsToPlacement', () => {
  it('round-trips a bounds rect back to the fraction that produced it', () => {
    const size = { width: 400, height: 120 }
    for (const placement of [{ horizontal: 0, vertical: 0 }, { horizontal: .5, vertical: 1 }, { horizontal: .27, vertical: .81 }]) {
      const bounds = boundsFor(placement, size)
      const result = boundsToPlacement(bounds, safeRect, { horizontal: -1, vertical: -1 })
      expect(result.horizontal).toBeCloseTo(placement.horizontal, 9)
      expect(result.vertical).toBeCloseTo(placement.vertical, 9)
    }
  })

  it('clamps out-of-range bounds to 0..1', () => {
    const bounds: Rect = { x: safeRect.x - 500, y: safeRect.y + safeRect.height + 500, width: 200, height: 100 }
    const result = boundsToPlacement(bounds, safeRect, { horizontal: .5, vertical: .5 })
    expect(result.horizontal).toBe(0)
    expect(result.vertical).toBe(1)
  })

  it('falls back rather than dividing by zero when the block fills the safe area on an axis', () => {
    const bounds: Rect = { x: safeRect.x, y: safeRect.y + 10, width: safeRect.width, height: 50 }
    const result = boundsToPlacement(bounds, safeRect, { horizontal: .3, vertical: .3 })
    // No free width: horizontal is undefined, so the caller's previous value is kept.
    expect(result.horizontal).toBe(.3)
    // Free height exists: vertical is still computed normally.
    expect(result.vertical).toBeCloseTo(10 / (safeRect.height - 50), 9)
  })
})

describe('movePlacement / nudgePlacement', () => {
  const bounds: Rect = { x: safeRect.x + 200, y: safeRect.y + 100, width: 400, height: 120 }

  it('moves proportionally to the free space on each axis', () => {
    const freeWidth = safeRect.width - bounds.width, freeHeight = safeRect.height - bounds.height
    const result = movePlacement({ horizontal: .5, vertical: .5 }, freeWidth / 4, freeHeight / 4, safeRect, bounds)
    expect(result.horizontal).toBeCloseTo(.75, 9)
    expect(result.vertical).toBeCloseTo(.75, 9)
  })

  it('clamps at the edges of the safe area', () => {
    const result = movePlacement({ horizontal: .9, vertical: .1 }, 100_000, -100_000, safeRect, bounds)
    expect(result.horizontal).toBe(1)
    expect(result.vertical).toBe(0)
  })

  it('nudge is a move by a fixed composition-unit step', () => {
    const a = nudgePlacement({ horizontal: .5, vertical: .5 }, 10, 0, safeRect, bounds)
    const b = movePlacement({ horizontal: .5, vertical: .5 }, 10, 0, safeRect, bounds)
    expect(a).toEqual(b)
  })

  it('leaves an axis alone when the block fills the safe area on it', () => {
    const fullWidth: Rect = { ...bounds, width: safeRect.width }
    const result = movePlacement({ horizontal: .42, vertical: .5 }, 50, 0, safeRect, fullWidth)
    expect(result.horizontal).toBe(.42)
  })
})

describe('pointerScaleFactor', () => {
  const center = { x: 500, y: 400 }

  it('is 1 for no movement', () => {
    expect(pointerScaleFactor(center, { x: 600, y: 400 }, { x: 600, y: 400 })).toBe(1)
  })

  it('grows when the pointer moves farther from center', () => {
    expect(pointerScaleFactor(center, { x: 600, y: 400 }, { x: 700, y: 400 })).toBeCloseTo(2, 9)
  })

  it('shrinks when the pointer moves closer to center', () => {
    expect(pointerScaleFactor(center, { x: 600, y: 400 }, { x: 550, y: 400 })).toBeCloseTo(.5, 9)
  })

  it('guards a zero-length start distance instead of producing Infinity', () => {
    expect(pointerScaleFactor(center, center, { x: 700, y: 400 })).toBe(1)
  })
})

describe('scaleFontSize', () => {
  it('scales by the factor', () => {
    expect(scaleFontSize(60, 1.5)).toBeCloseTo(90, 9)
  })

  it('clamps to the appearance schema bounds', () => {
    expect(scaleFontSize(60, 0.1)).toBe(20)
    expect(scaleFontSize(60, 10)).toBe(120)
  })

  it('ignores a non-finite or non-positive factor', () => {
    expect(scaleFontSize(60, 0)).toBe(60)
    expect(scaleFontSize(60, -1)).toBe(60)
    expect(scaleFontSize(60, NaN)).toBe(60)
  })
})

describe('rotationAt', () => {
  const center = { x: 0, y: 0 }

  it('adds the pointer angle delta to the base rotation', () => {
    // Start pointing right (0deg), move to pointing down (90deg): a +90deg delta.
    const result = rotationAt(center, { x: 100, y: 0 }, { x: 0, y: 100 }, 0, false)
    expect(result).toBeCloseTo(90, 6)
  })

  it('wraps into -180..180', () => {
    const result = rotationAt(center, { x: 100, y: 0 }, { x: -100, y: -1 }, 170, false)
    expect(result).toBeGreaterThanOrEqual(-180)
    expect(result).toBeLessThanOrEqual(180)
  })

  it('snaps to the nearest 15 degrees when requested', () => {
    // A small delta from a 0 base should snap to 0.
    const result = rotationAt(center, { x: 100, y: 0 }, { x: 100, y: 5 }, 0, true)
    expect(result % 15).toBeCloseTo(0, 6)
  })
})
