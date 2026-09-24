import { describe, expect, it } from 'vitest'
import type { MaskPathPoint } from './edit'
import { appendPoint, closesPath, hitTestPath, insertPointNear, moveAnchor, moveHandle, pullHandles, removePoint, toggleSmooth } from './penPath'

const tri: MaskPathPoint[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 80 }]

describe('pen path geometry', () => {
  it('pulls symmetric handles out of a new anchor, and none for a plain click', () => {
    expect(pullHandles({ x: 10, y: 10 }, { x: 30, y: 10 })).toEqual({ x: 10, y: 10, out: { x: 30, y: 10 }, in: { x: -10, y: 10 } })
    expect(pullHandles({ x: 10, y: 10 }, { x: 10.2, y: 10 })).toEqual({ x: 10, y: 10 })
  })

  it('hits handles before anchors, and closes on the first anchor only with enough points', () => {
    const smooth = [{ ...tri[0], out: { x: 5, y: 5 } }, tri[1], tri[2]]
    expect(hitTestPath(smooth, { x: 5, y: 5 }, 4)).toEqual({ part: 'out', index: 0 })
    expect(hitTestPath(smooth, { x: 100, y: 1 }, 4)).toEqual({ part: 'anchor', index: 1 })
    expect(hitTestPath(smooth, { x: 300, y: 300 }, 4)).toBeNull()
    expect(closesPath(tri, { x: 2, y: 2 }, 6)).toBe(true)
    expect(closesPath(tri.slice(0, 2), { x: 2, y: 2 }, 6)).toBe(false)
  })

  it('moves an anchor with its handles, and mirrors the opposite handle of a smooth point', () => {
    const smooth = [{ x: 0, y: 0, in: { x: -10, y: 0 }, out: { x: 10, y: 0 } }, tri[1], tri[2]]
    expect(moveAnchor(smooth, 0, 5, 5)[0]).toEqual({ x: 5, y: 5, in: { x: -5, y: 5 }, out: { x: 15, y: 5 } })
    expect(moveHandle(smooth, 0, 'out', { x: 10, y: 10 })[0]).toEqual({ x: 0, y: 0, out: { x: 10, y: 10 }, in: { x: -10, y: -10 } })
    expect(moveHandle(tri, 1, 'out', { x: 120, y: 10 })[1]).toEqual({ x: 100, y: 0, out: { x: 120, y: 10 } })
  })

  it('toggles between corner and smooth, and never removes below three points', () => {
    const smooth = toggleSmooth(tri, 1)
    expect(smooth[1].in && smooth[1].out).toBeTruthy()
    expect(toggleSmooth(smooth, 1)[1]).toEqual({ x: 100, y: 0 })
    expect(removePoint(tri, 0)).toEqual(tri)
    expect(removePoint([...tri, { x: 50, y: -40 }], 3)).toEqual(tri)
    expect(appendPoint(tri, { x: 1.234, y: 5.678 }).at(-1)).toEqual({ x: 1.23, y: 5.68 })
  })

  it('inserts a point on the outline without changing a straight edge, or a curve\'s midpoint', () => {
    const inserted = insertPointNear(tri, { x: 50, y: 0.5 }, 5)!
    expect(inserted.index).toBe(1)
    expect(inserted.points).toHaveLength(4)
    expect(inserted.points[1].x).toBeCloseTo(50, 0)
    expect(insertPointNear(tri, { x: 500, y: 500 }, 5)).toBeNull()
    const curved = [{ x: 0, y: 0, out: { x: 0, y: 60 } }, { x: 100, y: 0, in: { x: 100, y: 60 } }, tri[2]]
    const split = insertPointNear(curved, { x: 50, y: 45 }, 8)!
    expect(split.points[1]).toMatchObject({ in: expect.anything(), out: expect.anything() })
    expect(split.points[1].x).toBeCloseTo(50, 0)
  })
})
