import { describe, expect, it } from 'vitest'
import type { ColorClip } from './edit'
import { motionApplies, scrollPhase, angleVector, colorClipLabel, driftOffset, easedPhase, easedPhaseExpression, elapsedUs, fillCss, gradientLine, isAnimated, paintAt, swatchCss, DRIFT_OVERSIZE, DRIFT_TRAVEL } from './fill'

const US = 1_000_000
const clip = (extra: Partial<ColorClip> = {}): ColorClip => ({
  kind: 'color', id: 'bg', trackId: 'V1', timelineStartUs: 0, sourceStartUs: 0, sourceEndUs: 10 * US, opacity: 1, fit: 'contain',
  fill: { type: 'gradient', from: '#000000', to: '#ffffff', angle: 90 }, ...extra,
})

describe('fill math', () => {
  it('follows CSS angles: 0° up, 90° right, 180° down', () => {
    const up = angleVector(0), right = angleVector(90), down = angleVector(180)
    expect([up.x, up.y]).toEqual([0, -1])
    expect(right.x).toBeCloseTo(1); expect(right.y).toBeCloseTo(0)
    expect(down.y).toBeCloseTo(1)
  })

  it('puts the corners of the box on 0 and 1, like a CSS gradient line', () => {
    const t = (angle: number, w: number, h: number, x: number, y: number) => { const g = gradientLine(angle, w, h); return g.ax * x + g.ay * y + g.c }
    expect(t(90, 200, 100, 0, 50)).toBeCloseTo(0)
    expect(t(90, 200, 100, 200, 50)).toBeCloseTo(1)
    expect(t(180, 200, 100, 100, 0)).toBeCloseTo(0)
    expect(t(180, 200, 100, 100, 100)).toBeCloseTo(1)
    // 135° (toward bottom-right): the corners themselves are the ends, whatever the aspect.
    expect(t(135, 200, 100, 0, 0)).toBeCloseTo(0)
    expect(t(135, 200, 100, 200, 100)).toBeCloseTo(1)
    expect(t(135, 200, 100, 100, 50)).toBeCloseTo(0.5)
  })

  it('renders a solid as its color and a gradient as a CSS linear-gradient', () => {
    expect(fillCss({ type: 'solid', color: '#112233' })).toBe('#112233')
    expect(fillCss({ type: 'gradient', from: '#000000', to: '#ffffff', angle: 45 })).toBe('linear-gradient(45deg, #000000, #ffffff)')
  })

  it('eases 0 → 1 → 0 over one period, staying exactly periodic', () => {
    expect(easedPhase(4 * US, 0)).toBeCloseTo(0)
    expect(easedPhase(4 * US, 2 * US)).toBeCloseTo(1)
    expect(easedPhase(4 * US, 4 * US)).toBeCloseTo(0)
    expect(easedPhase(4 * US, 1 * US)).toBeCloseTo(0.5)
    expect(easedPhase(4 * US, 9 * US)).toBeCloseTo(easedPhase(4 * US, 1 * US))
  })

  it('emits the same phase as an FFmpeg expression in T', () => {
    expect(easedPhaseExpression(4 * US, 0)).toBe('(0.5-0.5*cos(2*PI*(T+0.000000)/4.000000))')
    expect(easedPhaseExpression(6 * US, 1.5 * US)).toBe('(0.5-0.5*cos(2*PI*(T+1.500000)/6.000000))')
  })

  it('counts elapsed time from the clip source start, so moves keep the phase and a split continues it', () => {
    const whole = clip({ timelineStartUs: 0, sourceStartUs: 0, sourceEndUs: 10 * US, motion: { type: 'shift', to: { type: 'solid', color: '#ff0000' }, periodUs: 4 * US } })
    const left = whole
    const right = { ...whole, id: 'bg2', timelineStartUs: 3 * US, sourceStartUs: 3 * US }
    expect(elapsedUs(right, 5 * US)).toBe(5 * US)
    expect(paintAt(right, 5 * US).overlay?.opacity).toBeCloseTo(paintAt(left, 5 * US).overlay?.opacity ?? -1)
    // Moving the clip later on the timeline keeps its own phase at its own start.
    const moved = { ...whole, timelineStartUs: 20 * US }
    expect(paintAt(moved, 22 * US).overlay?.opacity).toBeCloseTo(paintAt(whole, 2 * US).overlay?.opacity ?? -1)
  })
})

describe('paintAt', () => {
  it('paints a still when there is no motion', () => {
    expect(paintAt(clip(), 3 * US)).toEqual({ fill: clip().fill, base: { left: 0, top: 0, width: 1, height: 1 }, overlay: null, scroll: null })
  })

  it('shift blends toward the second fill by the eased phase', () => {
    const shifting = clip({ motion: { type: 'shift', to: { type: 'solid', color: '#ff0000' }, periodUs: 4 * US } })
    expect(paintAt(shifting, 0).overlay?.opacity).toBeCloseTo(0)
    expect(paintAt(shifting, 2 * US).overlay).toEqual({ fill: { type: 'solid', color: '#ff0000' }, opacity: 1 })
  })

  it('pulse blends toward black or white scaled by depth', () => {
    const pulsing = clip({ motion: { type: 'pulse', toward: 'white', depth: 0.5, periodUs: 4 * US } })
    expect(paintAt(pulsing, 2 * US).overlay).toEqual({ fill: { type: 'solid', color: '#ffffff' }, opacity: 0.5 })
  })

  it('drift pans an oversized picture and never reveals an edge', () => {
    const drifting = clip({ motion: { type: 'drift', direction: 90, periodUs: 4 * US } })
    for (let t = 0; t <= 4 * US; t += 250_000) {
      const { base } = paintAt(drifting, t)
      expect(base.width).toBe(DRIFT_OVERSIZE)
      expect(base.left).toBeLessThanOrEqual(1e-9)
      expect(base.left + base.width).toBeGreaterThanOrEqual(1 - 1e-9)
      expect(base.top).toBeLessThanOrEqual(1e-9)
    }
    const at0 = driftOffset({ type: 'drift', direction: 90, periodUs: 4 * US }, 0)
    expect(at0.x).toBeCloseTo(-DRIFT_TRAVEL)
  })

  it('drift on a solid is a no-op and not counted as animated', () => {
    const solid = clip({ fill: { type: 'solid', color: '#123456' }, motion: { type: 'drift', direction: 0, periodUs: 4 * US } })
    expect(paintAt(solid, 1 * US).base).toEqual({ left: 0, top: 0, width: 1, height: 1 })
    expect(isAnimated(solid)).toBe(false)
    expect(isAnimated(clip({ motion: { type: 'drift', direction: 0, periodUs: 4 * US } }))).toBe(true)
  })
})

describe('labels', () => {
  it('names a background by its fill and motion', () => {
    expect(colorClipLabel(clip({ fill: { type: 'solid', color: '#000000' } }))).toBe('Color')
    expect(colorClipLabel(clip())).toBe('Gradient')
    expect(colorClipLabel(clip({ motion: { type: 'pulse', toward: 'black', depth: 1, periodUs: 4 * US } }))).toBe('Gradient · pulse')
  })

  it('never nests a gradient inside a gradient for a shifting swatch', () => {
    const swatch = swatchCss(clip({ motion: { type: 'shift', to: { type: 'gradient', from: '#111111', to: '#222222', angle: 0 }, periodUs: 4 * US } }))
    expect(swatch).toBe('linear-gradient(90deg, #000000, #111111)')
  })
})

describe('grid fills', () => {
  const grid = (extra: Partial<Extract<ColorClip['fill'], { type: 'grid' }>> = {}): ColorClip['fill'] => ({ type: 'grid', pattern: 'lines', background: '#000000', line: '#ffffff', cell: 80, thickness: 2, ...extra })

  it('scrolls one cell per period toward the direction, with no seam and no return', () => {
    const scrolling = clip({ fill: grid(), motion: { type: 'scroll', direction: 90, periodUs: 2 * US } })
    expect(paintAt(scrolling, 0).scroll).toEqual({ x: 0, y: 0 })
    expect(paintAt(scrolling, 1 * US).scroll?.x).toBeCloseTo(0.5)
    expect(paintAt(scrolling, 5 * US).scroll?.x).toBeCloseTo(2.5)
    const down = clip({ fill: grid(), motion: { type: 'scroll', direction: 180, periodUs: 2 * US } })
    expect(paintAt(down, 2 * US).scroll?.y).toBeCloseTo(1)
    expect(paintAt(down, 2 * US).scroll?.x).toBeCloseTo(0)
  })

  it('keeps its phase when the clip moves or is split, like the other motions', () => {
    const whole = clip({ fill: grid(), motion: { type: 'scroll', direction: 90, periodUs: 2 * US } })
    const right = { ...whole, id: 'bg2', timelineStartUs: 3 * US, sourceStartUs: 3 * US }
    expect(paintAt(right, 5 * US).scroll?.x).toBeCloseTo(paintAt(whole, 5 * US).scroll?.x ?? -1)
    expect(scrollPhase({ type: 'scroll', direction: 90, periodUs: 2 * US }, 4 * US).x).toBeCloseTo(2)
  })

  it('applies a scroll only to a grid and a drift only to a gradient; anything else is a still', () => {
    const scroll = { type: 'scroll' as const, direction: 0, periodUs: 2 * US }
    const drift = { type: 'drift' as const, direction: 0, periodUs: 2 * US }
    expect(motionApplies(grid(), scroll)).toBe(true)
    expect(motionApplies(grid(), drift)).toBe(false)
    expect(motionApplies({ type: 'gradient', from: '#000000', to: '#ffffff', angle: 0 }, scroll)).toBe(false)
    expect(motionApplies({ type: 'solid', color: '#000000' }, scroll)).toBe(false)
    expect(paintAt(clip({ fill: { type: 'gradient', from: '#000000', to: '#ffffff', angle: 0 }, motion: scroll }), 1 * US).scroll).toBeNull()
    expect(isAnimated(clip({ fill: grid(), motion: drift }))).toBe(false)
    expect(isAnimated(clip({ fill: grid(), motion: scroll }))).toBe(true)
    // A grid can still shift to another fill and pulse.
    expect(motionApplies(grid(), { type: 'pulse', toward: 'black', depth: 0.5, periodUs: 2 * US })).toBe(true)
  })

  it('names and swatches the patterns', () => {
    expect(colorClipLabel(clip({ fill: grid() }))).toBe('Grid')
    expect(colorClipLabel(clip({ fill: grid({ pattern: 'dots' }), motion: { type: 'scroll', direction: 0, periodUs: 2 * US } }))).toBe('Dot grid · scroll')
    expect(colorClipLabel(clip({ fill: grid({ pattern: 'perspective' }) }))).toBe('Perspective grid')
    expect(swatchCss(clip({ fill: grid() }))).toContain('#ffffff')
    expect(fillCss(grid())).toBe('#000000')
  })
})
