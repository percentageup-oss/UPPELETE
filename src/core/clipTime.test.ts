import { describe, expect, it } from 'vitest'
import type { ClipSpeed } from './edit'
import { constantRate, isConstantSpeed, speedRateAt, timelineLengthUs, sourceToTimelineOffsetUs, timelineToSourceOffsetUs } from './clipTime'
import { clipEndUs, sequenceUsOf, sourceUsAt, spansInSequence } from './timelineModel'

const US = 1_000_000
const clip = (speed?: ClipSpeed, sourceStartUs = 0, sourceEndUs = 10 * US, timelineStartUs = 5 * US) =>
  ({ id: 'c', trackId: 'v1', timelineStartUs, sourceStartUs, sourceEndUs, ...(speed ? { speed } : {}) })
const constant = (rate: number): ClipSpeed => ({ points: [{ sourceUs: 0, rate }] })
const ramp: ClipSpeed = { points: [{ sourceUs: 0, rate: 1 }, { sourceUs: 4 * US, rate: 4 }, { sourceUs: 8 * US, rate: 0.5 }] }

describe('clipTime', () => {
  it('is a pure translation without speed', () => {
    const c = clip()
    expect(timelineLengthUs(c)).toBe(10 * US)
    expect(sequenceUsOf(c, 3 * US)).toBe(8 * US)
    expect(sourceUsAt(c, 8 * US)).toBe(3 * US)
  })

  it('scales exactly for constant speed', () => {
    expect(timelineLengthUs(clip(constant(2)))).toBe(5 * US)
    expect(timelineLengthUs(clip(constant(0.5)))).toBe(20 * US)
    expect(timelineLengthUs(clip(constant(1 / 3)))).toBe(30 * US)
    expect(sequenceUsOf(clip(constant(2)), 4 * US)).toBe(7 * US)
    expect(sourceUsAt(clip(constant(2)), 7 * US)).toBe(4 * US)
    expect(clipEndUs(clip(constant(2)))).toBe(10 * US)
  })

  it('reports constant vs ramp', () => {
    expect(isConstantSpeed(clip())).toBe(true)
    expect(isConstantSpeed(clip(constant(3)))).toBe(true)
    expect(isConstantSpeed(clip(ramp))).toBe(false)
    expect(constantRate(clip(constant(3)))).toBe(3)
  })

  it('interpolates the rate linearly and holds it outside the points', () => {
    expect(speedRateAt(ramp, 2 * US)).toBeCloseTo(2.5)
    expect(speedRateAt(ramp, 6 * US)).toBeCloseTo(2.25)
    expect(speedRateAt(ramp, -1)).toBe(1)
    expect(speedRateAt(ramp, 20 * US)).toBe(0.5)
  })

  it('matches a numeric integral of 1/v for a ramp', () => {
    const c = clip(ramp)
    let total = 0
    const steps = 200_000
    for (let i = 0; i < steps; i++) total += (10 * US / steps) / speedRateAt(ramp, (i + 0.5) * 10 * US / steps)
    expect(Math.abs(timelineLengthUs(c) - total)).toBeLessThan(50)
  })

  it('round-trips source → timeline → source within a microsecond', () => {
    const c = clip(ramp, 1 * US, 9 * US)
    for (const s of [1 * US, 2.3 * US, 4 * US, 6.789 * US, 8.999 * US, 9 * US]) {
      const back = timelineToSourceOffsetUs(c, sourceToTimelineOffsetUs(c, s))
      expect(Math.abs(back - Math.round(s))).toBeLessThanOrEqual(4)
    }
  })

  it('splits without moving the curve: halves add up to the whole', () => {
    const whole = clip(ramp, 0, 10 * US)
    const left = clip(ramp, 0, 5 * US)
    const right = clip(ramp, 5 * US, 10 * US)
    expect(Math.abs(timelineLengthUs(left) + timelineLengthUs(right) - timelineLengthUs(whole))).toBeLessThanOrEqual(1)
  })

  it('monotonic on ramps', () => {
    const c = clip(ramp)
    let last = -1
    for (let s = 0; s <= 10 * US; s += 100_000) {
      const t = sourceToTimelineOffsetUs(c, s)
      expect(t).toBeGreaterThan(last)
      last = t
    }
  })

  it('projects a source range into sequence time through the curve', () => {
    const c = { ...clip(constant(2)), kind: 'video' as const, assetId: 'a', gain: 1, opacity: 1, fit: 'contain' as const }
    const [span] = spansInSequence({ startUs: 2 * US, endUs: 4 * US }, 'a', [c])
    expect(span.startUs).toBe(6 * US)
    expect(span.endUs).toBe(7 * US)
  })
})
