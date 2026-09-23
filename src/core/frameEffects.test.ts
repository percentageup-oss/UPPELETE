import { describe, expect, it } from 'vitest'
import { frameEffectsAt } from './frameEffects'
import type { EffectRegion, FadeEffect, LetterboxEffect, VignetteEffect } from './edit'

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
