import { describe, expect, it } from 'vitest'
import type { ShapeGeometry } from './edit'
import { arrowheadPath, arrowheadSize, fitCornerRadii, lineEnds, normalizeShapeGeometry, resolveCornerRadii, shapeBox, shapePathD, shapeRotation } from './shapePath'

const rect = { x: 100, y: 50, width: 200, height: 100 }
const line: ShapeGeometry = { kind: 'line', from: { x: 0, y: 0 }, to: { x: 100, y: 0 } }

describe('shapePathD', () => {
  it('serialises every geometry kind deterministically', () => {
    const geometries: ShapeGeometry[] = [
      { kind: 'rect', rect, cornerRadius: 10, rotation: 0 }, { kind: 'ellipse', rect, rotation: 0 }, { kind: 'highlight', rect, rotation: 0 },
      line, { kind: 'line', from: { x: 0, y: 0 }, to: { x: 100, y: 0 }, control: { x: 50, y: -40 } },
      { kind: 'path', closed: true, points: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }] },
    ]
    for (const geometry of geometries) {
      const d = shapePathD(geometry)
      expect(d).toMatch(/^M/)
      expect(d).not.toMatch(/NaN|undefined/)
      expect(shapePathD(geometry)).toBe(d)
    }
  })

  it('draws a straight line as one segment and a curved one with a quadratic', () => {
    expect(shapePathD(line)).toBe('M 0 0 L 100 0')
    expect(shapePathD({ ...line, control: { x: 50, y: -40 } } as ShapeGeometry)).toMatch(/Q 50 -40/)
  })
})

describe('geometry helpers', () => {
  it('rotates rects around their centre and leaves lines unrotated', () => {
    expect(shapeRotation({ kind: 'rect', rect, cornerRadius: 0, rotation: 30 })).toEqual({ angle: 30, cx: 200, cy: 100 })
    expect(shapeRotation(line).angle).toBe(0)
  })

  it('boxes a line by its endpoints and control point', () => {
    expect(shapeBox({ kind: 'line', from: { x: 10, y: 20 }, to: { x: 110, y: 20 }, control: { x: 60, y: -80 } })).toMatchObject({ x: 10, y: -80 })
    expect(shapeBox({ kind: 'ellipse', rect, rotation: 0 })).toEqual(rect)
  })

  it('finds a line end tangent, and none for a rect', () => {
    expect(lineEnds({ kind: 'rect', rect, cornerRadius: 0, rotation: 0 })).toBeNull()
    const ends = lineEnds(line)!
    expect(ends.end).toEqual({ x: 100, y: 0 }); expect(ends.endDir).toEqual({ x: 1, y: 0 }); expect(ends.startDir).toEqual({ x: -1, y: 0 })
  })

  it('sizes arrowheads with the stroke and fills triangles and dots but not the open chevron', () => {
    expect(arrowheadSize(2)).toBe(16); expect(arrowheadSize(10)).toBe(45)
    const tip = { x: 100, y: 0 }, dir = { x: 1, y: 0 }
    expect(arrowheadPath('triangle', tip, dir, 20).filled).toBe(true)
    expect(arrowheadPath('dot', tip, dir, 20).filled).toBe(true)
    expect(arrowheadPath('open', tip, dir, 20).filled).toBe(false)
  })
})

describe('per-corner radii', () => {
  const box = (cornerRadius: number, cornerRadii?: { tl: number; tr: number; br: number; bl: number }): ShapeGeometry => ({ kind: 'rect', rect, cornerRadius, ...(cornerRadii ? { cornerRadii } : {}), rotation: 0 })

  it('draws a uniform radius exactly as before, whether given as cornerRadius or four equal radii', () => {
    const before = 'M 110 50 H 290 A 10 10 0 0 1 300 60 V 140 A 10 10 0 0 1 290 150 H 110 A 10 10 0 0 1 100 140 V 60 A 10 10 0 0 1 110 50 Z'
    expect(shapePathD(box(10))).toBe(before)
    expect(shapePathD(box(10, { tl: 10, tr: 10, br: 10, bl: 10 }))).toBe(before)
  })

  it('draws four distinct radii, one arc per rounded corner', () => {
    expect(shapePathD(box(0, { tl: 0, tr: 20, br: 0, bl: 30 }))).toBe(
      'M 100 50 H 280 A 20 20 0 0 1 300 70 V 150 H 130 A 30 30 0 0 1 100 120 V 50 Z')
  })

  it('scales all four radii together when neighbours exceed a side (CSS overlap rule)', () => {
    expect(fitCornerRadii({ tl: 150, tr: 150, br: 0, bl: 0 }, 200, 100)).toEqual({ tl: 100, tr: 100, br: 0, bl: 0 })
    expect(fitCornerRadii({ tl: 10, tr: 20, br: 30, bl: 40 }, 200, 100)).toEqual({ tl: 10, tr: 20, br: 30, bl: 40 })
  })

  it('draws a plain rectangle when every radius is zero', () => {
    expect(shapePathD(box(0, { tl: 0, tr: 0, br: 0, bl: 0 }))).toBe('M 100 50 H 300 V 150 H 100 Z')
  })

  it('resolves and normalises', () => {
    expect(resolveCornerRadii({ cornerRadius: 7 })).toEqual({ tl: 7, tr: 7, br: 7, bl: 7 })
    expect(normalizeShapeGeometry(box(3, { tl: 8, tr: 8, br: 8, bl: 8 }))).toEqual(box(8))
    expect(normalizeShapeGeometry(box(0, { tl: 0, tr: 40, br: 0, bl: 40 }))).toEqual(box(20, { tl: 0, tr: 40, br: 0, bl: 40 }))
  })
})
