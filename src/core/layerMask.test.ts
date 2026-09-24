import { describe, expect, it } from 'vitest'
import type { LayerMask } from './edit'
import { activeMask, convertMaskShape, defaultMask, maskBounds, maskImageUrl, maskSvg, pathD, translateMask } from './layerMask'

const size = { width: 1080, height: 608 }
const box = { x: 100, y: 50, width: 400, height: 200 }
const base = { enabled: true, invert: false, feather: 0, density: 1 }

describe('layer mask geometry', () => {
  it('draws rect, rounded rect and ellipse shapes as opaque alpha on transparent', () => {
    expect(maskSvg({ ...base, shape: { kind: 'rect', rect: box, cornerRadius: 0 } }, size)).toContain('<rect x="100" y="50" width="400" height="200"')
    expect(maskSvg({ ...base, shape: { kind: 'rect', rect: box, cornerRadius: 999 } }, size)).toContain('rx="100"')
    expect(maskSvg({ ...base, shape: { kind: 'ellipse', rect: box } }, size)).toContain('<ellipse cx="300" cy="150" rx="200" ry="100"')
  })

  it('feathers with a Gaussian σ of half the feather, over a margin, and only when asked', () => {
    const feathered = maskSvg({ ...base, feather: 20, shape: { kind: 'ellipse', rect: box } }, size)
    expect(feathered).toContain('stdDeviation="10"')
    expect(feathered).toContain('filter="url(#f)"')
    expect(maskSvg({ ...base, shape: { kind: 'ellipse', rect: box } }, size)).not.toContain('feGaussianBlur')
  })

  it('inverts by cutting the shape out of a full-frame fill, and scales by density', () => {
    const inverted = maskSvg({ ...base, invert: true, density: .5, shape: { kind: 'ellipse', rect: box } }, size)
    expect(inverted).toContain('<mask id="m"')
    expect(inverted).toContain('fill-opacity="0.5" mask="url(#m)"')
  })

  it('builds a closed cubic path, using a point itself for a corner side', () => {
    const d = pathD([{ x: 0, y: 0 }, { x: 100, y: 0, out: { x: 120, y: 30 } }, { x: 50, y: 90, in: { x: 70, y: 100 } }])
    expect(d).toBe('M0 0 C0 0 100 0 100 0 C120 30 70 100 50 90 C50 90 0 0 0 0 Z')
  })

  it('exposes the mask as a data-URL image and skips disabled masks', () => {
    const mask: LayerMask = { ...base, shape: { kind: 'ellipse', rect: box } }
    expect(maskImageUrl(mask, size).startsWith('url("data:image/svg+xml,%3Csvg')).toBe(true)
    expect(activeMask({ ...mask, enabled: false })).toBeNull()
    expect(activeMask(undefined)).toBeNull()
    expect(activeMask(mask)).toBe(mask)
  })

  it('translates every kind of shape, handles included, and reports path bounds', () => {
    expect(translateMask({ ...base, shape: { kind: 'ellipse', rect: box } }, 10, -5).shape).toEqual({ kind: 'ellipse', rect: { ...box, x: 110, y: 45 } })
    const path = defaultMask('path', box)
    const moved = translateMask({ ...path, shape: { kind: 'path', points: [{ x: 0, y: 0, out: { x: 5, y: 5 } }, { x: 10, y: 0 }, { x: 5, y: 10 }] } }, 1, 2)
    expect(moved.shape).toEqual({ kind: 'path', points: [{ x: 1, y: 2, out: { x: 6, y: 7 } }, { x: 11, y: 2 }, { x: 6, y: 12 }] })
    expect(maskBounds(path.shape)).toEqual(box)
  })

  it('converts between shape kinds, keeping the footprint', () => {
    const ellipse: LayerMask = { ...base, shape: { kind: 'ellipse', rect: box } }
    const path = convertMaskShape(ellipse, 'path')
    expect(path.shape.kind === 'path' && path.shape.points).toHaveLength(4)
    expect(maskBounds(path.shape).x).toBeCloseTo(box.x)
    expect(maskBounds(path.shape).width).toBeCloseTo(box.width)
    expect(convertMaskShape(path, 'rect').shape).toEqual({ kind: 'rect', rect: expect.objectContaining({ x: box.x, width: box.width }), cornerRadius: 0 })
    expect(convertMaskShape(ellipse, 'ellipse')).toBe(ellipse)
    expect(convertMaskShape({ ...base, shape: { kind: 'rect', rect: box, cornerRadius: 9 } }, 'path').shape).toMatchObject({ kind: 'path', points: [{ x: 100, y: 50 }, { x: 500, y: 50 }, { x: 500, y: 250 }, { x: 100, y: 250 }] })
  })
})
