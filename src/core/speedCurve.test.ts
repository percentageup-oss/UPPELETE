import { describe, expect, it } from 'vitest'
import { addPoint, editablePoints, fractionToRate, movePoint, rateToFraction, removePoint } from './speedCurve'

const US = 1_000_000
const range = { startUs: 2 * US, endUs: 12 * US }

describe('speed curve editing', () => {
  it('draws rates on a log axis with 1× in the middle', () => {
    expect(rateToFraction(1)).toBeCloseTo(0.5)
    expect(rateToFraction(0.1)).toBeCloseTo(0)
    expect(rateToFraction(10)).toBeCloseTo(1)
    expect(fractionToRate(rateToFraction(3.7))).toBeCloseTo(3.7)
    expect(fractionToRate(5)).toBe(10)
  })

  it('shows no speed and a steady speed as a flat line across the range', () => {
    expect(editablePoints(undefined, range)).toEqual([{ sourceUs: 2 * US, rate: 1 }, { sourceUs: 12 * US, rate: 1 }])
    expect(editablePoints({ points: [{ sourceUs: 0, rate: 3 }] }, range)).toEqual([{ sourceUs: 2 * US, rate: 3 }, { sourceUs: 12 * US, rate: 3 }])
  })

  it('adds a point on the existing curve, so nothing changes until it is dragged', () => {
    const flat = editablePoints({ points: [{ sourceUs: 0, rate: 2 }] }, range)
    const added = addPoint(flat, 7 * US, range)!
    expect(added).toHaveLength(3)
    expect(added[1]).toEqual({ sourceUs: 7 * US, rate: 2 })
    expect(addPoint(added, 7 * US + 10, range)).toBeNull()
  })

  it('keeps a dragged point between its neighbours and inside the rate bounds', () => {
    const points = [{ sourceUs: 2 * US, rate: 1 }, { sourceUs: 6 * US, rate: 1 }, { sourceUs: 12 * US, rate: 1 }]
    const moved = movePoint(points, 1, { sourceUs: 99 * US, rate: 500 }, range)
    expect(moved[1].sourceUs).toBeLessThan(12 * US)
    expect(moved[1].sourceUs).toBeGreaterThan(2 * US)
    expect(moved[1].rate).toBe(10)
    const first = movePoint(points, 0, { sourceUs: -5, rate: 0.001 }, range)
    expect(first[0]).toEqual({ sourceUs: 2 * US, rate: 0.1 })
  })

  it('never removes below two points', () => {
    const three = [{ sourceUs: 0, rate: 1 }, { sourceUs: 5, rate: 2 }, { sourceUs: 10, rate: 1 }]
    expect(removePoint(three, 1)).toHaveLength(2)
    expect(removePoint(three.slice(0, 2), 0)).toBeNull()
  })
})
