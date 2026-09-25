import { describe, expect, it } from 'vitest'
import { shapeFrameAt } from './shapeMotion'

const US = 1_000_000
const none = { kind: 'none' as const, durationUs: 0 }
const shape = (extra: Partial<Parameters<typeof shapeFrameAt>[0]> = {}) => ({ startUs: 2 * US, endUs: 6 * US, enter: none, exit: none, ...extra })

describe('shapeFrameAt', () => {
  it('is hidden outside [start, end) and visible at rest inside', () => {
    expect(shapeFrameAt(shape(), 2 * US - 1).visible).toBe(false)
    expect(shapeFrameAt(shape(), 6 * US).visible).toBe(false)
    expect(shapeFrameAt(shape(), 2 * US)).toMatchObject({ visible: true, opacity: 1, scale: 1, draw: 1, sweep: 1, x: 0, y: 0 })
  })

  it('draws on from nothing to complete over the enter duration', () => {
    const drawn = shape({ enter: { kind: 'draw', durationUs: US } })
    expect(shapeFrameAt(drawn, 2 * US).draw).toBe(0)
    const half = shapeFrameAt(drawn, 2 * US + US / 2).draw
    expect(half).toBeGreaterThan(0); expect(half).toBeLessThan(1)
    expect(shapeFrameAt(drawn, 3 * US).draw).toBe(1)
    expect(shapeFrameAt(drawn, 5 * US).draw).toBe(1)
  })

  it('sweeps, fades, pops and slides on entry and reverses on exit', () => {
    expect(shapeFrameAt(shape({ enter: { kind: 'sweep', durationUs: US } }), 2 * US).sweep).toBe(0)
    expect(shapeFrameAt(shape({ enter: { kind: 'fade', durationUs: US } }), 2 * US).opacity).toBe(0)
    const pop = shapeFrameAt(shape({ enter: { kind: 'pop', durationUs: US } }), 2 * US)
    expect(pop.scale).toBeLessThan(1); expect(pop.opacity).toBe(0)
    const slide = shapeFrameAt(shape({ enter: { kind: 'slide', direction: 'left', durationUs: US } }), 2 * US)
    expect(slide.x).toBeLessThan(0); expect(slide.y).toBe(0)
    const up = shapeFrameAt(shape({ enter: { kind: 'slide', direction: 'down', durationUs: US } }), 2 * US)
    expect(up.y).toBeGreaterThan(0)
    const out = shape({ exit: { kind: 'fade', durationUs: US } })
    expect(shapeFrameAt(out, 5 * US - 1).opacity).toBe(1)
    expect(shapeFrameAt(out, 6 * US - 1).opacity).toBeLessThan(.01)
  })

  it('grows from zero to full width on entry and back on exit', () => {
    const grown = shape({ enter: { kind: 'grow', durationUs: US }, exit: { kind: 'grow', durationUs: US } })
    expect(shapeFrameAt(grown, 2 * US).grow).toBe(0)
    const half = shapeFrameAt(grown, 2 * US + US / 2).grow
    expect(half).toBeGreaterThan(0); expect(half).toBeLessThan(1)
    expect(shapeFrameAt(grown, 4 * US).grow).toBe(1)
    expect(shapeFrameAt(grown, 6 * US - 1).grow).toBeLessThan(.01)
    expect(shapeFrameAt(grown, 2 * US + US / 2)).toMatchObject({ opacity: 1, scale: 1, x: 0 })
  })

  it('shrinks both ramps proportionally when they exceed the shape length', () => {
    const short = { startUs: 0, endUs: US, enter: { kind: 'fade' as const, durationUs: US }, exit: { kind: 'fade' as const, durationUs: US } }
    expect(shapeFrameAt(short, 0).opacity).toBe(0)
    // Each ramp gets half the shape, so the midpoint is fully in and about to go out.
    expect(shapeFrameAt(short, US / 2 - 1).opacity).toBeGreaterThan(.99)
    expect(shapeFrameAt(short, US - 1).opacity).toBeLessThan(.01)
  })

  it('is a pure function of time, so reverse seeks agree with forward ones', () => {
    const drawn = shape({ enter: { kind: 'draw', durationUs: US } })
    const forward = [2.1, 2.5, 2.9].map((s) => shapeFrameAt(drawn, s * US))
    const backward = [2.9, 2.5, 2.1].map((s) => shapeFrameAt(drawn, s * US)).reverse()
    expect(backward).toEqual(forward)
  })
})
