import type { Glass, ShapeGeometry } from './edit'
import { shapeBox, shapeRotation } from './shapePath'

/**
 * Liquid Glass refraction map (docs/EDITING.md "Shapes"). Pure and deterministic: the browser rasterises the
 * silhouette (`src/captions/glassMapImage.ts`), everything else lives here so preview and the export pass build
 * the same map. Encoding is the one measured in docs/STATUS.md (liquid glass 02): a byte moves the picture by
 * `byte - 128` whole pixels scaled by `maxShift / 127`; R = x, G = y, B = 128, alpha 255.
 */

/** The "Liquid Glass" quick preset from the inspector. */
export const LIQUID_GLASS_PRESET: Glass = {
  blur: 14, saturation: 1.6, refraction: 14, bezel: 22, tintOpacity: 0.1, rim: 0.6, specular: 0.5,
  shadow: { blur: 24, offsetY: 12, opacity: 0.25 },
}

export type Box = { x: number; y: number; width: number; height: number }

/** Axis-aligned bounds of the silhouette after the shape's own rotation, in composition units. The glass layer
 * is exactly this box, so no CSS rotation is needed and the map matches the layer pixel for pixel. */
export function glassBounds(geometry: ShapeGeometry): Box {
  const box = shapeBox(geometry)
  const { angle } = shapeRotation(geometry)
  if (geometry.kind === 'bubble') {
    // The tail reaches outside the rect: take the rect grown by the tail length on its side, then rotate its corners about the rect's centre.
    const { side, length } = geometry.tail
    const grown = { x: box.x - (side === 'left' ? length : 0), y: box.y - (side === 'top' ? length : 0),
      width: box.width + (side === 'left' || side === 'right' ? length : 0), height: box.height + (side === 'top' || side === 'bottom' ? length : 0) }
    if (!angle) return grown
    const radians = angle * Math.PI / 180, cos = Math.cos(radians), sin = Math.sin(radians)
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2
    const xs: number[] = [], ys: number[] = []
    for (const [px, py] of [[grown.x, grown.y], [grown.x + grown.width, grown.y], [grown.x, grown.y + grown.height], [grown.x + grown.width, grown.y + grown.height]]) {
      xs.push(cx + (px - cx) * cos - (py - cy) * sin); ys.push(cy + (px - cx) * sin + (py - cy) * cos)
    }
    const x = Math.min(...xs), y = Math.min(...ys)
    return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
  }
  if (!angle) return box
  const radians = angle * Math.PI / 180
  const cos = Math.abs(Math.cos(radians)), sin = Math.abs(Math.sin(radians))
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2
  const a = box.width / 2, b = box.height / 2
  const [halfWidth, halfHeight] = geometry.kind === 'ellipse'
    ? [Math.hypot(a * cos, b * sin), Math.hypot(a * sin, b * cos)]
    : [a * cos + b * sin, a * sin + b * cos]
  return { x: cx - halfWidth, y: cy - halfHeight, width: halfWidth * 2, height: halfHeight * 2 }
}

const INFINITY_SQUARED = 1e20

/** One-dimensional squared distance transform (Felzenszwalb & Huttenlocher). */
function transform1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0
  v[0] = 0; z[0] = -Infinity; z[1] = Infinity
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]) }
    k++
    v[k] = q; z[k] = s; z[k + 1] = Infinity
  }
  k = 0
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]
  }
}

/** Euclidean distance from each inside pixel to the nearest outside pixel (0 outside), in pixels. The frame
 * counts as outside, so a silhouette that fills its box still gets a rim along the box edge. */
export function distanceInside(inside: Uint8Array, width: number, height: number): Float32Array {
  const pw = width + 2, ph = height + 2
  const grid = new Float64Array(pw * ph)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) grid[(y + 1) * pw + x + 1] = inside[y * width + x] ? INFINITY_SQUARED : 0
  const size = Math.max(pw, ph)
  const f = new Float64Array(size), d = new Float64Array(size), v = new Int32Array(size), z = new Float64Array(size + 1)
  for (let x = 0; x < pw; x++) {
    for (let y = 0; y < ph; y++) f[y] = grid[y * pw + x]
    transform1d(f, ph, d, v, z)
    for (let y = 0; y < ph; y++) grid[y * pw + x] = d[y]
  }
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) f[x] = grid[y * pw + x]
    transform1d(f, pw, d, v, z)
    for (let x = 0; x < pw; x++) grid[y * pw + x] = d[x]
  }
  const out = new Float32Array(width * height)
  // A pixel centre sits half a pixel inside the edge, so subtract that to make the rim start at distance 0.
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x
    out[i] = inside[i] ? Math.max(0, Math.sqrt(grid[(y + 1) * pw + x + 1]) - 0.5) : 0
  }
  return out
}

/** Convex squircle bezel profile: 1 at the edge (t = 0), easing to 0 at the inner edge of the bezel (t = 1). */
export function squircleProfile(t: number): number {
  if (t <= 0) return 1
  if (t >= 1) return 0
  return 1 - Math.pow(1 - Math.pow(1 - t, 4), 0.25)
}

export type GlassMapInput = {
  /** 1 inside the silhouette, 0 outside; `width * height` entries. */
  inside: Uint8Array
  width: number
  height: number
  /** Bezel width in pixels. */
  bezel: number
  /** Maximum shift in pixels (the map's full scale). */
  maxShift: number
}

export type GlassMap = {
  width: number
  height: number
  /** Signed shift in pixels a sample takes from (dx, dy), interleaved; float, before quantising. */
  shift: Float32Array
  /** RGBA bytes, encoded as documented at the top of the file. */
  rgba: Uint8ClampedArray
}

/** Displacement field: zero in the interior and outside, at most `maxShift` in the bezel, pointing along the
 * inward normal (the gradient of the distance to the edge). */
export function buildGlassMap({ inside, width, height, bezel, maxShift }: GlassMapInput): GlassMap {
  const distance = distanceInside(inside, width, height)
  const shift = new Float32Array(width * height * 2)
  const rgba = new Uint8ClampedArray(width * height * 4)
  const at = (x: number, y: number) => distance[Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))]
  const usable = bezel > 0 && maxShift > 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      let dx = 0, dy = 0
      if (usable && inside[i] && distance[i] < bezel) {
        const gx = at(x + 1, y) - at(x - 1, y), gy = at(x, y + 1) - at(x, y - 1)
        const length = Math.hypot(gx, gy)
        if (length > 1e-6) {
          const magnitude = maxShift * squircleProfile(distance[i] / bezel)
          dx = gx / length * magnitude
          dy = gy / length * magnitude
        }
      }
      shift[i * 2] = dx; shift[i * 2 + 1] = dy
      const o = i * 4
      rgba[o] = encodeShift(dx, maxShift); rgba[o + 1] = encodeShift(dy, maxShift); rgba[o + 2] = 128; rgba[o + 3] = 255
    }
  }
  return { width, height, shift, rgba }
}

/** `byte = 128 + 127 * d / maxShift`, rounded to whole bytes. */
export function encodeShift(shift: number, maxShift: number): number {
  if (maxShift <= 0) return 128
  return Math.round(128 + 127 * Math.max(-maxShift, Math.min(maxShift, shift)) / maxShift)
}

/** Chromium `feDisplacementMap` scale that reproduces the encoded shifts (measured equal to FFmpeg `displace`). */
export const chromiumDisplacementScale = (maxShift: number) => 255 * maxShift / 127
