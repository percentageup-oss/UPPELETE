import { describe, expect, it } from 'vitest'
import { clampZoomRegion, DEFAULT_ZOOM_REGION_US, defaultZoomRect, fullFrameRect, MIN_ZOOM_REGION_US, rectAtZoomFactor, zoomFactorOf, zoomRectAt, zoomScaleCropExpressions } from './zoomRegion'
import type { ZoomRegion } from './edit'

const US = 1_000_000
const composition = { width: 1080, height: 607.5 }
const rect = { x: 100, y: 50, width: 800, height: 450 }
const region = (extra: Partial<ZoomRegion> = {}): ZoomRegion => ({ id: 'z1', startUs: US, endUs: 3 * US, rect, easeInUs: 500_000, easeOutUs: 500_000, enabled: true, ...extra })

describe('zoomRectAt', () => {
  it('returns null outside every region — the full frame', () => {
    expect(zoomRectAt([region()], 0, composition)).toBeNull()
    expect(zoomRectAt([region()], 3 * US, composition)).toBeNull()
    expect(zoomRectAt([], US + 1, composition)).toBeNull()
  })

  it('reaches the exact target rect at the region start plus the ease-in, and holds it', () => {
    const r = region()
    expect(zoomRectAt([r], r.startUs + r.easeInUs, composition)).toEqual(rect)
    expect(zoomRectAt([r], (r.startUs + r.endUs) / 2, composition)).toEqual(rect)
  })

  it('is the full frame at the region\'s own start and just short of its own end (zero-length ramp edges)', () => {
    const r = region({ easeInUs: 0, easeOutUs: 0 })
    expect(zoomRectAt([r], r.startUs, composition)).toEqual(rect)
    expect(zoomRectAt([r], r.endUs - 1, composition)).toEqual(rect)
  })

  it('eases smoothly between the full frame and the target — midpoint of the ramp is partway there', () => {
    const r = region({ easeInUs: 1_000_000 })
    const mid = zoomRectAt([r], r.startUs + 500_000, composition)!
    const full = fullFrameRect(composition)
    expect(mid.x).toBeGreaterThan(Math.min(full.x, rect.x))
    expect(mid.x).toBeLessThan(Math.max(full.x, rect.x))
    expect(mid.width).toBeGreaterThan(Math.min(full.width, rect.width))
    expect(mid.width).toBeLessThan(Math.max(full.width, rect.width))
  })

  it('clamps ease-in/out that together exceed the region length to half its duration each, never overlapping', () => {
    // A 200ms region with two 5s ramps: each clamps to 100ms, so the hold point is a single instant.
    const r = region({ startUs: 0, endUs: 200_000, easeInUs: 5_000_000, easeOutUs: 5_000_000 })
    const atHold = zoomRectAt([r], 100_000, composition)
    expect(atHold).not.toBeNull()
  })

  it('is a pure function of absolute sequence time: shuffled and sorted evaluation order agree', () => {
    const r = region({ easeInUs: 300_000, easeOutUs: 300_000 })
    const timestamps = [r.startUs, r.startUs + 100_000, r.startUs + 300_000, (r.startUs + r.endUs) / 2, r.endUs - 300_000, r.endUs - 100_000, r.endUs - 1]
    const forward = timestamps.map((t) => zoomRectAt([r], t, composition))
    const shuffled = [...timestamps].reverse().map((t) => zoomRectAt([r], t, composition))
    expect(shuffled.reverse()).toEqual(forward)
  })

  it('picks the region actually containing the timestamp when several are given (no overlap in practice)', () => {
    const early = region({ id: 'a', startUs: 0, endUs: US, easeInUs: 0, easeOutUs: 0, rect: { x: 0, y: 0, width: 400, height: 225 } })
    const late = region({ id: 'b', startUs: 2 * US, endUs: 3 * US, easeInUs: 0, easeOutUs: 0, rect })
    expect(zoomRectAt([early, late], 500_000, composition)).toEqual(early.rect)
    expect(zoomRectAt([early, late], 2_500_000, composition)).toEqual(late.rect)
    expect(zoomRectAt([early, late], 1_500_000, composition)).toBeNull()
  })
})

describe('clampZoomRegion', () => {
  it('leaves a candidate untouched when the lane is empty', () => {
    const candidate = { startUs: US, endUs: 2 * US }
    expect(clampZoomRegion(candidate, [])).toEqual(candidate)
  })

  it('clamps into the gap with the most overlap, shrinking to fit when the gap is smaller than requested', () => {
    // A 500_000µs gap between two regions, at [US, US + 500_000).
    const others = [{ startUs: 0, endUs: US }, { startUs: US + 500_000, endUs: 2 * US }]
    // Requested mostly inside that gap but 650_000µs long — longer than the gap holds.
    const clamped = clampZoomRegion({ startUs: US + 50_000, endUs: US + 1_200_000 }, others)!
    expect(clamped).toEqual({ startUs: US, endUs: US + 500_000 })
  })

  it('returns null when even the minimum region length has no room', () => {
    const others = [{ startUs: 0, endUs: US }, { startUs: US + 100_000, endUs: 2 * US }]
    expect(clampZoomRegion({ startUs: US + 20_000, endUs: US + 80_000 }, others)).toBeNull()
  })

  it('never returns a region shorter than MIN_ZOOM_REGION_US when it succeeds', () => {
    const others = [{ startUs: 0, endUs: US }]
    const clamped = clampZoomRegion({ startUs: US - 50_000, endUs: US + 50_000 }, others)!
    expect(clamped.endUs - clamped.startUs).toBeGreaterThanOrEqual(MIN_ZOOM_REGION_US)
  })
})

describe('constants', () => {
  it('keeps the default preset length comfortably above the minimum', () => {
    expect(DEFAULT_ZOOM_REGION_US).toBeGreaterThan(MIN_ZOOM_REGION_US)
  })
})

describe('defaultZoomRect', () => {
  it('centers a rect at the composition aspect, scaled by the given factor', () => {
    const rect = defaultZoomRect(composition, 0.5)
    expect(rect.width).toBeCloseTo(composition.width * 0.5)
    expect(rect.height).toBeCloseTo(composition.height * 0.5)
    expect(rect.x).toBeCloseTo((composition.width - rect.width) / 2)
    expect(rect.y).toBeCloseTo((composition.height - rect.height) / 2)
    expect(rect.width / rect.height).toBeCloseTo(composition.width / composition.height)
  })
})

describe('rectAtZoomFactor / zoomFactorOf', () => {
  it('round-trips: rectAtZoomFactor at zoomFactorOf(rect) recovers the same rect', () => {
    const back = rectAtZoomFactor(rect, zoomFactorOf(rect), composition)
    expect(back.width).toBeCloseTo(rect.width)
    expect(back.height).toBeCloseTo(rect.height)
  })

  it('keeps the composition aspect ratio and the rect\'s own center', () => {
    const centerX = rect.x + rect.width / 2
    const centerY = rect.y + rect.height / 2
    const zoomed = rectAtZoomFactor(rect, 3, composition)
    expect(zoomed.width / zoomed.height).toBeCloseTo(composition.width / composition.height)
    expect(zoomed.x + zoomed.width / 2).toBeCloseTo(centerX)
    expect(zoomed.y + zoomed.height / 2).toBeCloseTo(centerY)
  })

  it('clamps below 1x up to the full frame and above MAX_ZOOM_FACTOR down to the minimum', () => {
    expect(rectAtZoomFactor(rect, 0.2, composition).width).toBeCloseTo(1080)
    expect(rectAtZoomFactor(rect, 999, composition).width).toBeCloseTo(1080 / 10)
  })

  it('clamps the target back inside the frame when its center sits near an edge', () => {
    const nearEdge = { x: 0, y: 0, width: 100, height: 56.25 }
    const zoomed = rectAtZoomFactor(nearEdge, 2, composition)
    expect(zoomed.x).toBeGreaterThanOrEqual(0)
    expect(zoomed.y).toBeGreaterThanOrEqual(0)
    expect(zoomed.x + zoomed.width).toBeLessThanOrEqual(composition.width + 0.01)
    expect(zoomed.y + zoomed.height).toBeLessThanOrEqual(composition.height + 0.01)
  })
})

describe('zoomScaleCropExpressions', () => {
  it('generates a deterministic absolute-time dynamic-scale/fixed-crop transform', () => {
    const regions = [{ startUs: 500_000, endUs: 2_500_000, rect: { x: 80, y: 45, width: 160, height: 90 }, easeInUs: 500_000, easeOutUs: 500_000 }]
    const first = zoomScaleCropExpressions(regions, { width: 320, height: 180 })
    const second = zoomScaleCropExpressions([...regions].reverse(), { width: 320, height: 180 })
    expect(first).toEqual(second)
    expect(first?.scale).toContain('320.000000')
    expect(first?.scale).toContain('lt(t,2.500000)')
    expect(first?.x).toContain('80.000000')
    expect(first?.y).toContain('45.000000')
  })
  it('omits the transform entirely for no regions', () => {
    expect(zoomScaleCropExpressions([], { width: 320, height: 180 })).toBeNull()
  })
})

describe('pan / Ken Burns (fromRect)', () => {
  const from = { x: 0, y: 0, width: 1080, height: 607.5 }
  const to = { x: 200, y: 100, width: 720, height: 405 }
  const pan = (extra: Partial<ZoomRegion> = {}) => region({ fromRect: from, rect: to, easeInUs: 0, easeOutUs: 0, ...extra })

  it('starts at fromRect, ends at rect, with no hold and no return to the full frame', () => {
    const r = pan()
    expect(zoomRectAt([r], r.startUs, composition)).toEqual(from)
    const nearEnd = zoomRectAt([r], r.endUs - 1, composition)!
    expect(nearEnd.x).toBeCloseTo(to.x, 3)
    expect(nearEnd.width).toBeCloseTo(to.width, 3)
    expect(zoomRectAt([r], r.endUs, composition)).toBeNull()
  })

  it('ignores the ease fields and is halfway (smoothstep 0.5) at the midpoint', () => {
    const mid = (r: ZoomRegion) => zoomRectAt([r], (r.startUs + r.endUs) / 2, composition)!
    expect(mid(pan({ easeInUs: 900_000, easeOutUs: 900_000 }))).toEqual(mid(pan()))
    expect(mid(pan()).x).toBeCloseTo(100, 6)
  })

  it('is a pure function of absolute time', () => {
    const r = pan()
    const times = [1.2, 1.9, 1.5, 2.7, 1.2].map((s) => s * US)
    const forward = times.map((t) => zoomRectAt([r], t, composition))
    const backward = [...times].reverse().map((t) => zoomRectAt([r], t, composition)).reverse()
    expect(forward).toEqual(backward)
  })

  it('FFmpeg expressions agree with zoomRectAt at sampled timestamps', () => {
    const output = { width: 1080, height: 607.5 }
    const r = pan()
    const exp = zoomScaleCropExpressions([{ startUs: r.startUs, endUs: r.endUs, rect: to, fromRect: from, easeInUs: 0, easeOutUs: 0 }], output)!
    const evalAt = (source: string, t: number) => new Function('t', 'iff', 'gte', 'lt', `return ${source.replace(/\bif\(/g, 'iff(')}`)(t, (c: number, a: number, b: number) => (c ? a : b), (a: number, b: number) => (a >= b ? 1 : 0), (a: number, b: number) => (a < b ? 1 : 0)) as number
    for (const us of [r.startUs, r.startUs + 400_000, 2 * US, 2.6 * US, r.endUs - 1_000]) {
      const expected = zoomRectAt([r], us, composition)!
      const scale = evalAt(exp.scale, us / US)
      expect(scale).toBeCloseTo(output.width / expected.width, 4)
      expect(evalAt(exp.x, us / US)).toBeCloseTo(expected.x * scale, 3)
      expect(evalAt(exp.y, us / US)).toBeCloseTo(expected.y * scale, 3)
    }
  })

  it('outside the region the expression is the full frame (scale 1, origin 0)', () => {
    const r = pan()
    const exp = zoomScaleCropExpressions([{ startUs: r.startUs, endUs: r.endUs, rect: to, fromRect: from, easeInUs: 0, easeOutUs: 0 }], { width: 1080, height: 607.5 })!
    const evalAt = (source: string, t: number) => new Function('t', 'iff', 'gte', 'lt', `return ${source.replace(/\bif\(/g, 'iff(')}`)(t, (c: number, a: number, b: number) => (c ? a : b), (a: number, b: number) => (a >= b ? 1 : 0), (a: number, b: number) => (a < b ? 1 : 0)) as number
    expect(evalAt(exp.scale, 0.2)).toBeCloseTo(1, 6)
    expect(evalAt(exp.x, 0.2)).toBeCloseTo(0, 6)
  })
})
