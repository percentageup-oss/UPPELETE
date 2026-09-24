import type { MaskPathPoint } from './edit'

/**
 * Pure geometry for the pen mask tool (docs/EDITING.md "Layer masks"). Points are anchors with
 * optional absolute bezier handles; a side with no handle is a corner. Everything here is in
 * composition units and never touches the DOM, so the gesture code stays a thin shell over it.
 */
type Vec = { x: number; y: number }
export const MIN_PATH_POINTS = 3
export const MAX_PATH_POINTS = 256

export type PenHit = { part: 'anchor' | 'in' | 'out'; index: number }

const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y)
const round = (value: number) => Math.round(value * 100) / 100
const roundVec = (v: Vec): Vec => ({ x: round(v.x), y: round(v.y) })

/** The topmost control under `at`: handles win over anchors so a handle sitting on its anchor stays reachable. */
export function hitTestPath(points: readonly MaskPathPoint[], at: Vec, tolerance: number): PenHit | null {
  for (let index = points.length - 1; index >= 0; index--) {
    const point = points[index]
    if (point.in && dist(point.in, at) <= tolerance) return { part: 'in', index }
    if (point.out && dist(point.out, at) <= tolerance) return { part: 'out', index }
  }
  for (let index = points.length - 1; index >= 0; index--) if (dist(points[index], at) <= tolerance) return { part: 'anchor', index }
  return null
}

/** True when clicking `at` while drawing would close the path (first anchor, with enough points). */
export const closesPath = (points: readonly MaskPathPoint[], at: Vec, tolerance: number): boolean =>
  points.length >= MIN_PATH_POINTS && dist(points[0], at) <= tolerance

export function appendPoint(points: readonly MaskPathPoint[], at: Vec): MaskPathPoint[] {
  return points.length >= MAX_PATH_POINTS ? [...points] : [...points, roundVec(at)]
}

/** Dragging out of a fresh anchor pulls a symmetric pair of handles, like every pen tool. */
export function pullHandles(point: MaskPathPoint, to: Vec): MaskPathPoint {
  const { in: _in, out: _out, ...anchor } = point
  if (dist(anchor, to) < 1) return anchor
  return { ...anchor, out: roundVec(to), in: roundVec({ x: 2 * anchor.x - to.x, y: 2 * anchor.y - to.y }) }
}

/** Moves one anchor with both its handles. */
export function moveAnchor(points: readonly MaskPathPoint[], index: number, dx: number, dy: number): MaskPathPoint[] {
  return points.map((point, at) => {
    if (at !== index) return point
    const shift = (v: Vec | undefined) => v && roundVec({ x: v.x + dx, y: v.y + dy })
    const { in: handleIn, out: handleOut, ...anchor } = point
    const next: MaskPathPoint = { ...roundVec({ x: anchor.x + dx, y: anchor.y + dy }) }
    if (handleIn) next.in = shift(handleIn)
    if (handleOut) next.out = shift(handleOut)
    return next
  })
}

/** Moves one handle; a smooth anchor (both handles present) keeps the other handle mirrored. */
export function moveHandle(points: readonly MaskPathPoint[], index: number, part: 'in' | 'out', to: Vec): MaskPathPoint[] {
  return points.map((point, at) => {
    if (at !== index) return point
    const other = part === 'in' ? 'out' : 'in'
    const next: MaskPathPoint = { ...point, [part]: roundVec(to) }
    if (point[other]) next[other] = roundVec({ x: 2 * point.x - to.x, y: 2 * point.y - to.y })
    return next
  })
}

/** Alt-click: a smooth anchor becomes a corner; a corner becomes smooth along its neighbours' direction. */
export function toggleSmooth(points: readonly MaskPathPoint[], index: number): MaskPathPoint[] {
  return points.map((point, at) => {
    if (at !== index) return point
    if (point.in || point.out) { const { in: _in, out: _out, ...corner } = point; return corner }
    const prev = points[(index - 1 + points.length) % points.length], next = points[(index + 1) % points.length]
    const direction = { x: next.x - prev.x, y: next.y - prev.y }
    const length = Math.hypot(direction.x, direction.y) || 1
    const reach = Math.min(dist(point, prev), dist(point, next)) / 3
    const unit = { x: direction.x / length * reach, y: direction.y / length * reach }
    return { ...point, in: roundVec({ x: point.x - unit.x, y: point.y - unit.y }), out: roundVec({ x: point.x + unit.x, y: point.y + unit.y }) }
  })
}

/** Removes an anchor, never dropping below the 3 a closed shape needs. */
export function removePoint(points: readonly MaskPathPoint[], index: number): MaskPathPoint[] {
  return points.length <= MIN_PATH_POINTS ? [...points] : points.filter((_, at) => at !== index)
}

const cubic = (p0: Vec, p1: Vec, p2: Vec, p3: Vec, t: number): Vec => {
  const u = 1 - t
  return { x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x, y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y }
}
const mid = (a: Vec, b: Vec, t: number): Vec => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })

/** Inserts an anchor on the outline nearest `at` (within `tolerance`), splitting that segment with de Casteljau so the shape does not change. */
export function insertPointNear(points: readonly MaskPathPoint[], at: Vec, tolerance: number): { points: MaskPathPoint[]; index: number } | null {
  if (points.length >= MAX_PATH_POINTS) return null
  let best: { segment: number; t: number; distance: number } | null = null
  for (let segment = 0; segment < points.length; segment++) {
    const from = points[segment], to = points[(segment + 1) % points.length]
    for (let step = 0; step <= 40; step++) {
      const t = step / 40, distance = dist(cubic(from, from.out ?? from, to.in ?? to, to, t), at)
      if (!best || distance < best.distance) best = { segment, t, distance }
    }
  }
  if (!best || best.distance > tolerance || best.t <= 0.02 || best.t >= 0.98) return null
  const from = points[best.segment], to = points[(best.segment + 1) % points.length], t = best.t
  const p0 = from, p1 = from.out ?? from, p2 = to.in ?? to, p3 = to
  const a = mid(p0, p1, t), b = mid(p1, p2, t), c = mid(p2, p3, t), d = mid(a, b, t), e = mid(b, c, t), split = mid(d, e, t)
  const curved = Boolean(from.out || to.in)
  const inserted: MaskPathPoint = curved ? { ...roundVec(split), in: roundVec(d), out: roundVec(e) } : roundVec(split)
  const next = points.map((point, at2) => at2 === best!.segment && curved ? { ...point, out: roundVec(a) }
    : at2 === (best!.segment + 1) % points.length && curved ? { ...point, in: roundVec(c) } : point)
  next.splice(best.segment + 1, 0, inserted)
  return { points: next, index: best.segment + 1 }
}
