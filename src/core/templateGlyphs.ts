import type { MaskPathPoint, ShapeGeometry } from './edit'

/**
 * Icon glyphs for the templates, drawn as `path` geometries (cubic Bezier points with absolute handles) so they
 * scale, recolour and export like any shape. Own geometry: no third-party icon assets and no emoji, whose look
 * depends on the system font. Each function takes the glyph's centre and its overall size in composition units.
 */
type Point = { x: number; y: number }

const KAPPA = 0.5523
const round = (n: number) => Math.round(n * 100) / 100

/** One point from unit-box numbers: `[x, y, inX?, inY?, outX?, outY?]`, mapped to `centre + unit * size / 2`. */
function unitPoints(center: Point, size: number, unit: readonly (readonly number[])[]): MaskPathPoint[] {
  const half = size / 2
  const at = (x: number, y: number) => ({ x: round(center.x + x * half), y: round(center.y + y * half) })
  return unit.map(([x, y, inX, inY, outX, outY]) => ({
    ...at(x, y),
    ...(inX !== undefined && inY !== undefined ? { in: at(inX, inY) } : {}),
    ...(outX !== undefined && outY !== undefined ? { out: at(outX, outY) } : {}),
  }))
}

/** A closed circle as four Bezier points; a path circle is what a glyph needs when it must share path styling. */
export function circleGlyph(center: Point, size: number): ShapeGeometry {
  const k = KAPPA
  return { kind: 'path', closed: true, points: unitPoints(center, size, [
    [0, -1, -k, -1, k, -1], [1, 0, 1, -k, 1, k], [0, 1, k, 1, -k, 1], [-1, 0, -1, k, -1, -k],
  ]) }
}

/** A heart, closed. Fill it for "liked" or stroke it for the outline button. */
export function heartGlyph(center: Point, size: number): ShapeGeometry {
  return { kind: 'path', closed: true, points: unitPoints({ x: center.x, y: center.y + size * 0.03 }, size, [
    [0, 0.9, 0.35, 0.65, -0.35, 0.65],
    [-0.95, -0.3, -0.95, 0.25, -0.95, -0.9],
    [0, -0.35, -0.25, -0.85, 0.25, -0.85],
    [0.95, -0.3, 0.95, -0.9, 0.95, 0.25],
  ]) }
}

/** A bell body, closed, with a flared rim. Pair it with `bellClapperGlyph` for the clapper. */
export function bellGlyph(center: Point, size: number): ShapeGeometry {
  return { kind: 'path', closed: true, points: unitPoints({ x: center.x, y: center.y - size * 0.08 }, size, [
    [0, -0.9, -0.5, -0.9, 0.5, -0.9],
    [0.62, 0.3, 0.62, -0.6, 0.62, 0.5],
    [0.95, 0.55],
    [0.95, 0.72],
    [-0.95, 0.72],
    [-0.95, 0.55],
    [-0.62, 0.3, -0.62, 0.5, -0.62, -0.6],
  ]) }
}

/** The small circle under a bell. */
export function bellClapperGlyph(center: Point, size: number): ShapeGeometry {
  return circleGlyph({ x: center.x, y: center.y + size * 0.42 }, size * 0.26)
}

/** A tick mark, an open path (stroke it). */
export function tickGlyph(center: Point, size: number): ShapeGeometry {
  return { kind: 'path', closed: false, points: unitPoints(center, size, [[-0.9, 0.05], [-0.3, 0.65], [0.9, -0.7]]) }
}

/** A magnifier as two parts to stroke: the lens ring and the handle. */
export function magnifierGlyph(center: Point, size: number): { lens: ShapeGeometry; handle: ShapeGeometry } {
  const lensSize = size * 0.66
  const lens = { x: center.x - size * 0.17, y: center.y - size * 0.17 }
  const edge = lensSize / 2 * Math.SQRT1_2
  return {
    lens: { kind: 'ellipse', rect: { x: round(lens.x - lensSize / 2), y: round(lens.y - lensSize / 2), width: round(lensSize), height: round(lensSize) }, rotation: 0 },
    handle: { kind: 'line', from: { x: round(lens.x + edge), y: round(lens.y + edge) }, to: { x: round(center.x + size * 0.5), y: round(center.y + size * 0.5) } },
  }
}
