import type { CompositionRect, LayerMask, MaskPathPoint, MaskShape } from './edit'

/**
 * The one mask generator (docs/EDITING.md "Layer masks"): a pure function from a `LayerMask` to an
 * SVG whose **alpha** is the mask. The live preview and the export host use it as a CSS
 * `mask-image`; the export worker asks the host to rasterize the same SVG for FFmpeg's mask input.
 * No DOM, so it runs in the worker and in tests.
 */
type Size = { width: number; height: number }

const n = (value: number) => String(Math.round(value * 1000) / 1000)

/** Closed cubic-bezier path through the points; a corner side (no handle) uses its own point. */
export function pathD(points: readonly MaskPathPoint[]): string {
  if (points.length < 2) return ''
  const first = points[0]
  let d = `M${n(first.x)} ${n(first.y)}`
  for (let i = 0; i < points.length; i++) {
    const from = points[i], to = points[(i + 1) % points.length]
    const c1 = from.out ?? from, c2 = to.in ?? to
    d += ` C${n(c1.x)} ${n(c1.y)} ${n(c2.x)} ${n(c2.y)} ${n(to.x)} ${n(to.y)}`
  }
  return d + ' Z'
}

function shapeElement(shape: MaskShape, attrs: string): string {
  if (shape.kind === 'path') return `<path d="${pathD(shape.points)}" ${attrs}/>`
  const { x, y, width, height } = shape.rect
  if (shape.kind === 'ellipse') return `<ellipse cx="${n(x + width / 2)}" cy="${n(y + height / 2)}" rx="${n(width / 2)}" ry="${n(height / 2)}" ${attrs}/>`
  const radius = Math.min(shape.cornerRadius, width / 2, height / 2)
  return `<rect x="${n(x)}" y="${n(y)}" width="${n(width)}" height="${n(height)}"${radius > 0 ? ` rx="${n(radius)}"` : ''} ${attrs}/>`
}

/** A mask that hides nothing is skipped by every consumer, so a disabled mask costs no work. */
export const activeMask = (mask: LayerMask | undefined | null): LayerMask | null => mask && mask.enabled ? mask : null

/**
 * SVG at composition size. Non-inverted: the shape is opaque (scaled by `density`) on transparent.
 * Inverted: everything is opaque except the shape. Feather is a Gaussian blur of the shape with
 * σ = feather / 2, computed over a margin so a shape overhanging the frame still feathers at the edge.
 */
export function maskSvg(mask: LayerMask, composition: Size, pixels: Size = composition): string {
  const { width, height } = composition
  const sigma = mask.feather / 2
  const margin = Math.ceil(sigma * 3) + 1
  const filter = sigma > 0
    ? `<filter id="f" filterUnits="userSpaceOnUse" x="${-margin}" y="${-margin}" width="${width + margin * 2}" height="${height + margin * 2}"><feGaussianBlur stdDeviation="${n(sigma)}"/></filter>`
    : ''
  const shape = shapeElement(mask.shape, `fill="${mask.invert ? '#000' : '#fff'}"${sigma > 0 ? ' filter="url(#f)"' : ''}`)
  const body = mask.invert
    ? `<mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#fff"/>${shape}</mask>`
      + `<rect width="${width}" height="${height}" fill="#000" fill-opacity="${n(mask.density)}" mask="url(#m)"/>`
    : `<g fill-opacity="${n(mask.density)}">${shape}</g>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${n(pixels.width)}" height="${n(pixels.height)}" viewBox="0 0 ${width} ${height}"><defs>${filter}</defs>${body}</svg>`
}

/** The CSS `mask-image` value; `composition` is the 1080-unit space the shape lives in, `pixels` the painted size. */
export const maskImageUrl = (mask: LayerMask, composition: Size, pixels: Size = composition): string =>
  `url("data:image/svg+xml,${encodeURIComponent(maskSvg(mask, composition, pixels))}")`

const shiftPoint = <T extends { x: number; y: number }>(point: T | undefined, dx: number, dy: number) => point && { ...point, x: point.x + dx, y: point.y + dy }

/** Translates a mask with its item — a clip or title dragged on the stage takes its mask along
 * (a linked mask); resizing never rescales it. */
export function translateMask(mask: LayerMask, dx: number, dy: number): LayerMask {
  const shape: MaskShape = mask.shape.kind === 'path'
    ? { kind: 'path', points: mask.shape.points.map((point) => {
      const { in: handleIn, out: handleOut, ...anchor } = point
      return { ...anchor, x: point.x + dx, y: point.y + dy, ...(handleIn ? { in: shiftPoint(handleIn, dx, dy) } : {}), ...(handleOut ? { out: shiftPoint(handleOut, dx, dy) } : {}) }
    }) }
    : { ...mask.shape, rect: { ...mask.shape.rect, x: mask.shape.rect.x + dx, y: mask.shape.rect.y + dy } }
  return { ...mask, shape }
}

export function maskBounds(shape: MaskShape): CompositionRect {
  if (shape.kind !== 'path') return shape.rect
  const xs = shape.points.flatMap((p) => [p.x, p.in?.x ?? p.x, p.out?.x ?? p.x]), ys = shape.points.flatMap((p) => [p.y, p.in?.y ?? p.y, p.out?.y ?? p.y])
  const x = Math.min(...xs), y = Math.min(...ys)
  return { x, y, width: Math.max(1, Math.max(...xs) - x), height: Math.max(1, Math.max(...ys) - y) }
}

/** A fresh mask covering `bounds`: rect and ellipse fill it, a pen starts as an inscribed triangle to be reshaped. */
export function defaultMask(kind: MaskShape['kind'], bounds: CompositionRect): LayerMask {
  const base = { enabled: true, invert: false, feather: 0, density: 1 }
  if (kind === 'rect') return { ...base, shape: { kind, rect: bounds, cornerRadius: 0 } }
  if (kind === 'ellipse') return { ...base, shape: { kind, rect: bounds } }
  const { x, y, width, height } = bounds
  return { ...base, shape: { kind: 'path', points: [{ x: x + width / 2, y }, { x: x + width, y: y + height }, { x, y: y + height }] } }
}

const KAPPA = 0.5522847498

/** Converts a mask to another shape kind in place: rect/ellipse become path anchors (an ellipse as four smooth points), a path becomes its bounds. */
export function convertMaskShape(mask: LayerMask, kind: MaskShape['kind']): LayerMask {
  const shape = mask.shape
  if (shape.kind === kind) return mask
  const bounds = maskBounds(shape)
  if (kind === 'rect') return { ...mask, shape: { kind, rect: bounds, cornerRadius: 0 } }
  if (kind === 'ellipse') return { ...mask, shape: { kind, rect: bounds } }
  const { x, y, width, height } = bounds
  const cx = x + width / 2, cy = y + height / 2, kx = width / 2 * KAPPA, ky = height / 2 * KAPPA
  const points: MaskPathPoint[] = shape.kind === 'ellipse'
    ? [{ x: cx, y, in: { x: cx - kx, y }, out: { x: cx + kx, y } }, { x: x + width, y: cy, in: { x: x + width, y: cy - ky }, out: { x: x + width, y: cy + ky } },
      { x: cx, y: y + height, in: { x: cx + kx, y: y + height }, out: { x: cx - kx, y: y + height } }, { x, y: cy, in: { x, y: cy + ky }, out: { x, y: cy - ky } }]
    : [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }]
  return { ...mask, shape: { kind: 'path', points } }
}
