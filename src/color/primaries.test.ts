import { describe, expect, it } from 'vitest'
import { applyPrimaries, applyToneShape, NEUTRAL_PRIMARIES, NEUTRAL_TONE_SHAPE, REC709_EOTF, REC709_OETF, type RGB } from './primaries'

describe('REC709_OETF / REC709_EOTF', () => {
  it('round-trip', () => {
    for (const v of [0, 0.005, 0.018, 0.18, 0.5, 1, 2]) expect(REC709_EOTF(REC709_OETF(v))).toBeCloseTo(v, 5)
  })
  it('is the identity-ish near 0 (both pass through 0)', () => {
    expect(REC709_OETF(0)).toBe(0)
    expect(REC709_EOTF(0)).toBe(0)
  })
})

describe('applyToneShape', () => {
  const grey: RGB = [0.4, 0.4, 0.4]

  it('is the identity at NEUTRAL_TONE_SHAPE for an already in-range pixel', () => {
    const closeTriple = (actual: RGB, expected: RGB) => expected.forEach((v, i) => expect(actual[i]).toBeCloseTo(v, 9))
    closeTriple(applyToneShape(grey, NEUTRAL_TONE_SHAPE), grey)
    closeTriple(applyToneShape([0, 1, 0.73], NEUTRAL_TONE_SHAPE), [0, 1, 0.73])
  })

  it('clamps to [0, 1] even under the neutral shape', () => {
    const [r, g, b] = applyToneShape([1.4, -0.2, 0.5], NEUTRAL_TONE_SHAPE)
    expect(r).toBeCloseTo(1, 9)
    expect(g).toBeCloseTo(0, 9)
    expect(b).toBeCloseTo(0.5, 9)
  })

  it('positive contrast pushes a below-mid value further from mid-grey', () => {
    const [r] = applyToneShape([0.3, 0.3, 0.3], { ...NEUTRAL_TONE_SHAPE, contrast: 0.5 })
    expect(r).toBeLessThan(0.3)
  })

  it('saturation -1 fully desaturates to luma', () => {
    const [r, g, b] = applyToneShape([0.8, 0.2, 0.2], { ...NEUTRAL_TONE_SHAPE, saturation: -1 })
    expect(r).toBeCloseTo(g, 6)
    expect(g).toBeCloseTo(b, 6)
  })

  it('positive shadows brightens a dark pixel more than a mid one', () => {
    const shape = { ...NEUTRAL_TONE_SHAPE, shadows: 0.6 }
    const darkDelta = applyToneShape([0.1, 0.1, 0.1], shape)[0] - 0.1
    const midDelta = applyToneShape([0.5, 0.5, 0.5], shape)[0] - 0.5
    expect(darkDelta).toBeGreaterThan(midDelta)
  })

  it('lift/gamma/gain are each the identity at 0', () => {
    const shape = { ...NEUTRAL_TONE_SHAPE, lift: [0, 0, 0] as RGB, gamma: [0, 0, 0] as RGB, gain: [0, 0, 0] as RGB }
    applyToneShape(grey, shape).forEach((v) => expect(v).toBeCloseTo(0.4, 9))
  })
})

describe('applyPrimaries', () => {
  it('is the identity at NEUTRAL_PRIMARIES for an in-gamut, in-range scene-linear pixel', () => {
    const linear: RGB = [0.18, 0.18, 0.18]
    const [r, g, b] = applyPrimaries(linear, NEUTRAL_PRIMARIES)
    const expected = REC709_OETF(0.18)
    expect(r).toBeCloseTo(expected, 6)
    expect(g).toBeCloseTo(expected, 6)
    expect(b).toBeCloseTo(expected, 6)
  })

  it('+1 stop of exposure roughly doubles scene-linear brightness before display encoding', () => {
    const base = applyPrimaries([0.09, 0.09, 0.09], NEUTRAL_PRIMARIES)
    const plusOne = applyPrimaries([0.09, 0.09, 0.09], { ...NEUTRAL_PRIMARIES, exposureStops: 1 })
    // 0.09 * 2^1 == 0.18, so +1 stop on 0.09 should land on the same display value as 0.18 at 0 stops.
    const reference = applyPrimaries([0.18, 0.18, 0.18], NEUTRAL_PRIMARIES)
    expect(plusOne[0]).toBeCloseTo(reference[0], 5)
    expect(plusOne[0]).toBeGreaterThan(base[0])
  })

  it('warming the temperature raises red relative to blue', () => {
    const [r, , b] = applyPrimaries([0.18, 0.18, 0.18], { ...NEUTRAL_PRIMARIES, temperature: 1 })
    expect(r).toBeGreaterThan(b)
  })

  it('clamps the final output to [0, 1]', () => {
    const [r, g, b] = applyPrimaries([2, 2, 2], { ...NEUTRAL_PRIMARIES, exposureStops: 3 })
    for (const v of [r, g, b]) { expect(v).toBeLessThanOrEqual(1); expect(v).toBeGreaterThanOrEqual(0) }
  })
})
