import { describe, expect, it } from 'vitest'
import { frameEffectsAt, pictureEffectsAt } from './frameEffects'
import type { EffectRegion, FadeEffect, GrainEffect, LetterboxEffect, VhsEffect, VignetteEffect } from './edit'

const US = 1_000_000
const composition16x9 = { width: 1080, height: 607.5 }
const composition9x16 = { width: 1080, height: 1920 }

const vignette = (extra: Partial<VignetteEffect> = {}): VignetteEffect =>
  ({ id: 'v1', kind: 'vignette', startUs: US, endUs: 3 * US, enabled: true, amount: .6, softness: .5, ...extra })
const letterbox = (extra: Partial<LetterboxEffect> = {}): LetterboxEffect =>
  ({ id: 'l1', kind: 'letterbox', startUs: US, endUs: 3 * US, enabled: true, aspect: 2.39, color: '#000000', easeInUs: 300_000, easeOutUs: 300_000, ...extra })
const fade = (extra: Partial<FadeEffect> = {}): FadeEffect =>
  ({ id: 'f1', kind: 'fade', startUs: US, endUs: 2 * US, enabled: true, shape: 'in', color: '#000000', easeInUs: 300_000, easeOutUs: 300_000, ...extra })

describe('frameEffectsAt', () => {
  it('returns nothing outside every region', () => {
    expect(frameEffectsAt([vignette()], 0, composition16x9)).toEqual({})
    expect(frameEffectsAt([vignette()], 3 * US, composition16x9)).toEqual({})
  })

  it('skips a disabled effect entirely', () => {
    expect(frameEffectsAt([vignette({ enabled: false })], 2 * US, composition16x9)).toEqual({})
  })

  it('reports vignette amount/softness verbatim while active — no ramp of its own', () => {
    expect(frameEffectsAt([vignette()], 2 * US, composition16x9)).toEqual({ vignette: { amount: .6, softness: .5 } })
  })

  it('evaluates each kind independently, so different kinds active at once all appear', () => {
    const region: EffectRegion[] = [vignette(), letterbox({ startUs: US, endUs: 3 * US, easeInUs: 0, easeOutUs: 0 })]
    const result = frameEffectsAt(region, 2 * US, composition16x9)
    expect(result.vignette).toBeDefined()
    expect(result.letterbox).toBeDefined()
  })

  describe('letterbox bars', () => {
    it('bars top/bottom when the target is wider than the composition (2.39 on 16:9)', () => {
      const bars = frameEffectsAt([letterbox({ aspect: 2.39, easeInUs: 0, easeOutUs: 0 })], 2 * US, composition16x9).letterbox!
      expect(bars.orientation).toBe('horizontal')
      // Expected height inset: (607.5 - 1080/2.39) / 2
      expect(bars.barPx).toBeCloseTo((composition16x9.height - composition16x9.width / 2.39) / 2, 5)
    })

    it('still bars top/bottom on a 9:16 vertical composition, since 2.39 is wider than that too', () => {
      const bars = frameEffectsAt([letterbox({ aspect: 2.39, easeInUs: 0, easeOutUs: 0 })], 2 * US, composition9x16).letterbox!
      expect(bars.orientation).toBe('horizontal')
      expect(bars.barPx).toBeCloseTo((composition9x16.height - composition9x16.width / 2.39) / 2, 5)
    })

    it('bars left/right (pillarbox) when the target is narrower than the composition', () => {
      const bars = frameEffectsAt([letterbox({ aspect: .3, easeInUs: 0, easeOutUs: 0 })], 2 * US, composition9x16).letterbox!
      expect(bars.orientation).toBe('vertical')
      expect(bars.barPx).toBeCloseTo((composition9x16.width - composition9x16.height * .3) / 2, 5)
    })

    it('is a zero inset when the target aspect exactly matches the composition', () => {
      const currentAspect = composition16x9.width / composition16x9.height
      const bars = frameEffectsAt([letterbox({ aspect: currentAspect, easeInUs: 0, easeOutUs: 0 })], 2 * US, composition16x9).letterbox!
      expect(bars.barPx).toBeCloseTo(0, 5)
    })

    it('slides in from zero and back out, holding the full inset in between', () => {
      const region = letterbox({ startUs: 0, endUs: 2 * US, easeInUs: 500_000, easeOutUs: 500_000, aspect: 2.39 })
      const full = frameEffectsAt([region], US, composition16x9).letterbox!.barPx
      const start = frameEffectsAt([region], 0, composition16x9).letterbox!.barPx
      const almostEnd = frameEffectsAt([region], region.endUs - 1, composition16x9).letterbox!.barPx
      const mid = frameEffectsAt([region], 250_000, composition16x9).letterbox!.barPx
      expect(start).toBeCloseTo(0, 5)
      expect(almostEnd).toBeCloseTo(0, 5)
      expect(mid).toBeGreaterThan(0)
      expect(mid).toBeLessThan(full)
    })
  })

  describe('fade opacity', () => {
    it('"in" ramps from fully covering (1) to clear (0) across the whole region', () => {
      const region = fade({ shape: 'in', startUs: 0, endUs: 2 * US })
      expect(frameEffectsAt([region], 0, composition16x9).fade!.opacity).toBeCloseTo(1, 5)
      expect(frameEffectsAt([region], 2 * US - 1, composition16x9).fade!.opacity).toBeCloseTo(0, 2)
    })

    it('"out" ramps from clear (0) to fully covering (1) across the whole region', () => {
      const region = fade({ shape: 'out', startUs: 0, endUs: 2 * US })
      expect(frameEffectsAt([region], 0, composition16x9).fade).toBeUndefined() // opacity 0 → no layer at all
      expect(frameEffectsAt([region], 2 * US - 1, composition16x9).fade!.opacity).toBeCloseTo(1, 2)
    })

    it('"dip" ramps up, holds at 1, then ramps back down — like a zoom region\'s ease', () => {
      const region = fade({ shape: 'dip', startUs: 0, endUs: 1_000_000, easeInUs: 200_000, easeOutUs: 200_000 })
      expect(frameEffectsAt([region], 0, composition16x9).fade).toBeUndefined()
      expect(frameEffectsAt([region], 500_000, composition16x9).fade!.opacity).toBeCloseTo(1, 5)
      const almostEnd = frameEffectsAt([region], 999_999, composition16x9).fade!.opacity
      expect(almostEnd).toBeLessThan(1)
    })

    it('clamps eases that together exceed the region length to half its duration each, never overlapping', () => {
      // A 200ms dip with two 5s eases: each clamps to 100ms, so the hold point is a single instant.
      const region = fade({ shape: 'dip', startUs: 0, endUs: 200_000, easeInUs: 5_000_000, easeOutUs: 5_000_000 })
      expect(frameEffectsAt([region], 100_000, composition16x9).fade!.opacity).toBeCloseTo(1, 5)
    })
  })

  it('is closed-form: the same timestamp gives the same result regardless of seek direction', () => {
    const region = letterbox({ startUs: 0, endUs: 2 * US, easeInUs: 500_000, easeOutUs: 500_000 })
    const a = frameEffectsAt([region], 250_000, composition16x9)
    const b = frameEffectsAt([region], 250_000, composition16x9)
    expect(a).toEqual(b)
  })
})

describe('texture effects (film grain, VHS)', () => {
  const grain = (extra: Partial<GrainEffect> = {}): GrainEffect =>
    ({ id: 'g1', kind: 'grain', startUs: US, endUs: 5 * US, enabled: true, amount: .4, size: 1.5, ...extra })
  const vhs = (extra: Partial<VhsEffect> = {}): VhsEffect =>
    ({ id: 'h1', kind: 'vhs', startUs: US, endUs: 5 * US, enabled: true, amount: .6, scanlines: .5, tracking: .5, ...extra })

  it('is absent outside the region and when bypassed', () => {
    expect(frameEffectsAt([grain(), vhs()], 0, composition16x9)).toEqual({})
    expect(frameEffectsAt([grain({ enabled: false }), vhs({ enabled: false })], 2 * US, composition16x9)).toEqual({})
  })

  it('is a pure function of absolute time, whatever order frames are asked in', () => {
    const effects = [grain(), vhs()]
    const forward = [2 * US, 2.5 * US, 3 * US].map((t) => frameEffectsAt(effects, t, composition16x9))
    const backward = [3 * US, 2.5 * US, 2 * US].map((t) => frameEffectsAt(effects, t, composition16x9)).reverse()
    expect(backward).toEqual(forward)
  })

  it('re-seeds at 24 Hz: same tick → same noise, next tick → different noise', () => {
    const at = (us: number) => frameEffectsAt([grain(), vhs()], us, composition16x9)
    const tickUs = US / 24
    // Two timestamps inside one 24 Hz tick — e.g. a 30 fps export sampling between ticks.
    expect(at(2 * US + 1000)).toEqual(at(2 * US + tickUs - 1000))
    expect(at(2 * US).grain!.seed).not.toBe(at(2 * US + tickUs).grain!.seed)
    expect(at(2 * US).vhs!.seed).not.toBe(at(2 * US + tickUs).vhs!.seed)
  })

  it('keeps every VHS animated value inside its documented range across a long span', () => {
    for (let us = US; us < 5 * US; us += 37_000) {
      const v = frameEffectsAt([vhs()], us, composition16x9).vhs!
      expect(v.bandY).toBeGreaterThanOrEqual(0); expect(v.bandY).toBeLessThan(1)
      expect(Math.abs(v.jitter)).toBeLessThanOrEqual(1)
      expect(v.flicker).toBeGreaterThanOrEqual(0); expect(v.flicker).toBeLessThan(1)
      expect(Number.isInteger(v.seed) && v.seed >= 0).toBe(true)
    }
  })

  it('rolls the tracking band down the frame over time', () => {
    const early = frameEffectsAt([vhs()], 2 * US, composition16x9).vhs!.bandY
    const later = frameEffectsAt([vhs()], 3 * US, composition16x9).vhs!.bandY
    expect(later).toBeGreaterThan(early)
  })

  it('carries the region settings through unchanged', () => {
    const result = frameEffectsAt([grain(), vhs()], 2 * US, composition16x9)
    expect(result.grain).toMatchObject({ amount: .4, size: 1.5 })
    expect(result.vhs).toMatchObject({ amount: .6, scanlines: .5, tracking: .5 })
  })
})

describe('pictureEffectsAt (dreamy glow)', () => {
  const glow = (extra: Record<string, unknown> = {}): EffectRegion =>
    ({ id: 'g1', kind: 'glow', startUs: US, endUs: 3 * US, enabled: true, amount: .5, radius: 24, threshold: .55, ...extra }) as EffectRegion
  it('is active only inside an enabled region, half-open at the end', () => {
    expect(pictureEffectsAt([glow()], 0)).toEqual({})
    expect(pictureEffectsAt([glow()], 2 * US)).toEqual({ glow: { amount: .5, radius: 24, threshold: .55 } })
    expect(pictureEffectsAt([glow()], 3 * US)).toEqual({})
    expect(pictureEffectsAt([glow({ enabled: false })], 2 * US)).toEqual({})
    expect(pictureEffectsAt([glow({ amount: 0 })], 2 * US)).toEqual({})
  })
  it('never leaks into the host-painted frame effects', () => {
    expect(frameEffectsAt([glow()], 2 * US, composition16x9)).toEqual({})
  })
})
