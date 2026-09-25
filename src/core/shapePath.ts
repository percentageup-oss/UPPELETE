import type { Arrowhead, BubbleTail, CornerRadii, MaskPathPoint, ShapeGeometry } from './edit'

export type Vec = { x: number; y: number }

/** Numbers are rounded so the same shape always serialises to the same string. */
const n = (value: number) => Number(value.toFixed(3))
const pt = (p: Vec) => `${n(p.x)} ${n(p.y)}`

type RectGeometry = Extract<ShapeGeometry, { kind: 'rect' | 'bubble' }>

/** The four radii a rect draws with: `cornerRadii` when set, else `cornerRadius` for every corner. */
export function resolveCornerRadii(geometry: Pick<RectGeometry, 'cornerRadius' | 'cornerRadii'>): CornerRadii {
  const { cornerRadius, cornerRadii } = geometry
  return cornerRadii ? { ...cornerRadii } : { tl: cornerRadius, tr: cornerRadius, br: cornerRadius, bl: cornerRadius }
}

/** Canonical storage form: equal radii collapse to `cornerRadius`; distinct radii keep `cornerRadius` as their rounded mean. */
export function normalizeShapeGeometry<G extends ShapeGeometry>(geometry: G): G {
  if (geometry.kind !== 'rect' && geometry.kind !== 'bubble') return geometry
  const { cornerRadii, ...rest } = geometry
  if (!cornerRadii) return geometry
  const { tl, tr, br, bl } = cornerRadii
  if (tl === tr && tr === br && br === bl) return { ...rest, cornerRadius: tl } as G
  return { ...rest, cornerRadius: Math.round((tl + tr + br + bl) / 4), cornerRadii } as G
}

/** CSS overlap rule: when neighbouring radii exceed a side, all four scale down by the same factor. */
export function fitCornerRadii(radii: CornerRadii, width: number, height: number): CornerRadii {
  const ratio = (side: number, sum: number) => (sum > 0 ? side / sum : 1)
  const f = Math.min(1, ratio(width, radii.tl + radii.tr), ratio(width, radii.bl + radii.br), ratio(height, radii.tl + radii.bl), ratio(height, radii.tr + radii.br))
  return { tl: radii.tl * f, tr: radii.tr * f, br: radii.br * f, bl: radii.bl * f }
}

type Box = { x: number; y: number; width: number; height: number }

/** Where the tail's base sits on its side, in the side's own coordinate (x for top/bottom, y for left/right),
 * clamped to the straight stretch between the corner arcs so the tail never overlaps a corner. Null = no room. */
function tailBase(box: Box, radii: CornerRadii, tail: BubbleTail): { from: number; to: number; center: number } | null {
  const horizontal = tail.side === 'top' || tail.side === 'bottom'
  const start = horizontal ? box.x : box.y
  const length = horizontal ? box.width : box.height
  const before = tail.side === 'top' ? radii.tl : tail.side === 'right' ? radii.tr : tail.side === 'bottom' ? radii.bl : radii.tl
  const after = tail.side === 'top' ? radii.tr : tail.side === 'right' ? radii.br : tail.side === 'bottom' ? radii.br : radii.bl
  const low = start + before, high = start + length - after
  const room = high - low
  const width = Math.min(tail.width, room)
  if (width < 1 || tail.length <= 0) return null
  const from = Math.min(Math.max(low + (room - width) * tail.offset, low), high - width)
  return { from, to: from + width, center: from + width / 2 }
}

/** The path commands for one tail, travelling from `a` to `b` along the side (either direction). */
function tailPath(box: Box, side: BubbleTail['side'], a: number, b: number, tail: BubbleTail): string {
  const outward = side === 'top' ? { x: 0, y: -1 } : side === 'bottom' ? { x: 0, y: 1 } : side === 'left' ? { x: -1, y: 0 } : { x: 1, y: 0 }
  const horizontal = side === 'top' || side === 'bottom'
  const edge = horizontal ? (side === 'top' ? box.y : box.y + box.height) : (side === 'left' ? box.x : box.x + box.width)
  const at = (u: number, v: number): Vec => horizontal ? { x: u, y: edge + outward.y * v } : { x: edge + outward.x * v, y: u }
  const c = (a + b) / 2
  const bend = tail.curve * Math.abs(b - a) * 0.3
  const toward = (from: number) => (c > from ? 1 : -1)
  const first = at((a + c) / 2 + toward(a) * bend, tail.length / 2)
  const second = at((c + b) / 2 + toward(b) * bend, tail.length / 2)
  const tip = at(c, tail.length)
  const to = at(b, 0)
  return tail.curve > 0
    ? ` L ${pt(at(a, 0))} Q ${pt(first)} ${pt(tip)} Q ${pt(second)} ${pt(to)}`
    : ` L ${pt(at(a, 0))} L ${pt(tip)} L ${pt(to)}`
}

function rectPath(rect: Box, radii: CornerRadii | number, tail?: BubbleTail): string {
  const { x, y, width: w, height: h } = rect
  const fitted = typeof radii === 'number'
    ? (() => { const r = Math.min(radii, w / 2, h / 2); return { tl: r, tr: r, br: r, bl: r } })()
    : fitCornerRadii(radii, w, h)
  const { tl, tr, br, bl } = fitted
  const base = tail ? tailBase(rect, fitted, tail) : null
  if (tl <= 0 && tr <= 0 && br <= 0 && bl <= 0 && !base) return `M ${n(x)} ${n(y)} H ${n(x + w)} V ${n(y + h)} H ${n(x)} Z`
  const arc = (r: number, toX: number, toY: number) => (r > 0 ? ` A ${n(r)} ${n(r)} 0 0 1 ${n(toX)} ${n(toY)}` : '')
  // Travel is clockwise: top and right run toward larger coordinates, bottom and left toward smaller ones.
  const onSide = (side: BubbleTail['side'], reversed: boolean) => {
    if (!base || !tail || tail.side !== side) return ''
    return tailPath(rect, side, reversed ? base.to : base.from, reversed ? base.from : base.to, tail)
  }
  return `M ${n(x + tl)} ${n(y)}${onSide('top', false)} H ${n(x + w - tr)}${arc(tr, x + w, y + tr)}${onSide('right', false)} V ${n(y + h - br)}${arc(br, x + w - br, y + h)}${onSide('bottom', true)} `
    + `H ${n(x + bl)}${arc(bl, x, y + h - bl)}${onSide('left', true)} V ${n(y + tl)}${arc(tl, x + tl, y)} Z`
}

function ellipsePath(rect: { x: number; y: number; width: number; height: number }): string {
  const rx = rect.width / 2, ry = rect.height / 2, cx = rect.x + rx, cy = rect.y + ry
  return `M ${n(cx - rx)} ${n(cy)} A ${n(rx)} ${n(ry)} 0 1 1 ${n(cx + rx)} ${n(cy)} A ${n(rx)} ${n(ry)} 0 1 1 ${n(cx - rx)} ${n(cy)} Z`
}

function pointsPath(points: readonly MaskPathPoint[], closed: boolean): string {
  const segment = (from: MaskPathPoint, to: MaskPathPoint) => from.out || to.in
    ? `C ${pt(from.out ?? from)} ${pt(to.in ?? to)} ${pt(to)}` : `L ${pt(to)}`
  const parts = [`M ${pt(points[0])}`]
  for (let i = 1; i < points.length; i++) parts.push(segment(points[i - 1], points[i]))
  if (closed) parts.push(segment(points[points.length - 1], points[0]), 'Z')
  return parts.join(' ')
}

/** The outline in composition units, before the shape's own rotation. */
export function shapePathD(geometry: ShapeGeometry): string {
  switch (geometry.kind) {
    case 'rect': return rectPath(geometry.rect, geometry.cornerRadii ? resolveCornerRadii(geometry) : geometry.cornerRadius)
    case 'bubble': return rectPath(geometry.rect, geometry.cornerRadii ? resolveCornerRadii(geometry) : geometry.cornerRadius, geometry.tail)
    case 'ellipse': return ellipsePath(geometry.rect)
    case 'highlight': return rectPath(geometry.rect, 0)
    case 'line': return geometry.control
      ? `M ${pt(geometry.from)} Q ${pt(geometry.control)} ${pt(geometry.to)}` : `M ${pt(geometry.from)} L ${pt(geometry.to)}`
    case 'path': return pointsPath(geometry.points, geometry.closed)
  }
}

/** Where a bubble's tail tip sits before the shape's own rotation, or null when the tail has no room to draw. */
export function bubbleTailTip(geometry: ShapeGeometry): Vec | null {
  if (geometry.kind !== 'bubble') return null
  const { rect, tail } = geometry
  const radii = fitCornerRadii(geometry.cornerRadii ? resolveCornerRadii(geometry) : { tl: geometry.cornerRadius, tr: geometry.cornerRadius, br: geometry.cornerRadius, bl: geometry.cornerRadius }, rect.width, rect.height)
  const base = tailBase(rect, radii, tail)
  if (!base) return null
  switch (tail.side) {
    case 'top': return { x: base.center, y: rect.y - tail.length }
    case 'bottom': return { x: base.center, y: rect.y + rect.height + tail.length }
    case 'left': return { x: rect.x - tail.length, y: base.center }
    case 'right': return { x: rect.x + rect.width + tail.length, y: base.center }
  }
}

/** The rotation a box-shaped geometry carries, about its own centre; lines and paths carry none. */
export function shapeRotation(geometry: ShapeGeometry): { angle: number; cx: number; cy: number } {
  if (geometry.kind === 'rect' || geometry.kind === 'bubble' || geometry.kind === 'ellipse' || geometry.kind === 'highlight') {
    return { angle: geometry.rotation, cx: geometry.rect.x + geometry.rect.width / 2, cy: geometry.rect.y + geometry.rect.height / 2 }
  }
  return { angle: 0, cx: 0, cy: 0 }
}

/** The geometry's axis-aligned box before rotation, used for the left-to-right sweep reveal. */
export function shapeBox(geometry: ShapeGeometry): { x: number; y: number; width: number; height: number } {
  if (geometry.kind === 'rect' || geometry.kind === 'bubble' || geometry.kind === 'ellipse' || geometry.kind === 'highlight') return geometry.rect
  const points: Vec[] = geometry.kind === 'line'
    ? [geometry.from, geometry.to, ...(geometry.control ? [geometry.control] : [])]
    : geometry.points.flatMap((p) => [p, ...(p.in ? [p.in] : []), ...(p.out ? [p.out] : [])])
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y)
  const x = Math.min(...xs), y = Math.min(...ys)
  return { x, y, width: Math.max(1, Math.max(...xs) - x), height: Math.max(1, Math.max(...ys) - y) }
}

const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y })
function unit(v: Vec, fallback: Vec): Vec {
  const length = Math.hypot(v.x, v.y)
  return length < 1e-6 ? fallback : { x: v.x / length, y: v.y / length }
}

/** Where an arrow's two ends sit, and which way each points *away* from the line. */
export function lineEnds(geometry: ShapeGeometry): { start: Vec; startDir: Vec; end: Vec; endDir: Vec } | null {
  if (geometry.kind === 'line') {
    const { from, to, control } = geometry
    return { start: from, startDir: unit(sub(from, control ?? to), { x: -1, y: 0 }), end: to, endDir: unit(sub(to, control ?? from), { x: 1, y: 0 }) }
  }
  if (geometry.kind === 'path' && !geometry.closed) {
    const first = geometry.points[0], second = geometry.points[1]
    const last = geometry.points[geometry.points.length - 1], before = geometry.points[geometry.points.length - 2]
    return { start: first, startDir: unit(sub(first, first.out ?? second), { x: -1, y: 0 }), end: last, endDir: unit(sub(last, last.in ?? before), { x: 1, y: 0 }) }
  }
  return null
}

/** Arrowhead size follows the stroke so a thick marker gets a proportionally bigger head. */
export const arrowheadSize = (strokeWidth: number) => Math.max(16, strokeWidth * 4.5)

/** An arrowhead as an SVG path. Triangle and dot are filled; the open chevron is stroked only. */
export function arrowheadPath(kind: Exclude<Arrowhead, 'none'>, tip: Vec, direction: Vec, size: number): { d: string; filled: boolean } {
  const normal = { x: -direction.y, y: direction.x }
  const back = { x: tip.x - direction.x * size, y: tip.y - direction.y * size }
  const left = { x: back.x + normal.x * size * .5, y: back.y + normal.y * size * .5 }
  const right = { x: back.x - normal.x * size * .5, y: back.y - normal.y * size * .5 }
  if (kind === 'triangle') return { d: `M ${pt(tip)} L ${pt(left)} L ${pt(right)} Z`, filled: true }
  if (kind === 'open') return { d: `M ${pt(left)} L ${pt(tip)} L ${pt(right)}`, filled: false }
  const r = size * .4
  return { d: `M ${n(tip.x - r)} ${n(tip.y)} A ${n(r)} ${n(r)} 0 1 0 ${n(tip.x + r)} ${n(tip.y)} A ${n(r)} ${n(r)} 0 1 0 ${n(tip.x - r)} ${n(tip.y)} Z`, filled: true }
}

const shiftPoint = (p: Vec, dx: number, dy: number): Vec => ({ x: p.x + dx, y: p.y + dy })
const shiftPathPoint = (p: MaskPathPoint, dx: number, dy: number): MaskPathPoint => ({
  ...p, x: p.x + dx, y: p.y + dy,
  ...(p.in ? { in: shiftPoint(p.in, dx, dy) } : {}), ...(p.out ? { out: shiftPoint(p.out, dx, dy) } : {}),
})

/** Moves a geometry by (dx, dy) composition units. A rect's or ellipse's rotation is about its own centre, so it is kept as is. */
export function translateShapeGeometry<G extends ShapeGeometry>(geometry: G, dx: number, dy: number): G {
  const g = geometry as ShapeGeometry
  switch (g.kind) {
    case 'rect': case 'bubble': case 'ellipse': case 'highlight': return { ...g, rect: { ...g.rect, x: g.rect.x + dx, y: g.rect.y + dy } } as G
    case 'line': return { ...g, from: shiftPoint(g.from, dx, dy), to: shiftPoint(g.to, dx, dy), ...(g.control ? { control: shiftPoint(g.control, dx, dy) } : {}) } as G
    case 'path': return { ...g, points: g.points.map((p) => shiftPathPoint(p, dx, dy)) } as G
  }
}

/** Scales a geometry by `factor` about `anchor` (composition units). Rotation is kept; a rect's corner radii scale with it. */
export function scaleShapeGeometry<G extends ShapeGeometry>(geometry: G, factor: number, anchor: Vec): G {
  const g = geometry as ShapeGeometry
  const at = (p: Vec): Vec => ({ x: anchor.x + (p.x - anchor.x) * factor, y: anchor.y + (p.y - anchor.y) * factor })
  const scaleRect = (r: { x: number; y: number; width: number; height: number }) => {
    const origin = at(r)
    return { x: origin.x, y: origin.y, width: r.width * factor, height: r.height * factor }
  }
  switch (g.kind) {
    case 'rect': case 'bubble': {
      const { cornerRadii } = g
      return { ...g, rect: scaleRect(g.rect), cornerRadius: g.cornerRadius * factor,
        ...(cornerRadii ? { cornerRadii: { tl: cornerRadii.tl * factor, tr: cornerRadii.tr * factor, br: cornerRadii.br * factor, bl: cornerRadii.bl * factor } } : {}),
        ...(g.kind === 'bubble' ? { tail: { ...g.tail, width: g.tail.width * factor, length: g.tail.length * factor } } : {}) } as G
    }
    case 'ellipse': case 'highlight': return { ...g, rect: scaleRect(g.rect) } as G
    case 'line': return { ...g, from: at(g.from), to: at(g.to), ...(g.control ? { control: at(g.control) } : {}) } as G
    case 'path': return { ...g, points: g.points.map((p) => ({ ...p, ...at(p), ...(p.in ? { in: at(p.in) } : {}), ...(p.out ? { out: at(p.out) } : {}) })) } as G
  }
}
