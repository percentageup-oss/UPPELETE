import type { Glass, ShapeGeometry } from '../core/edit'
import { buildGlassMap, glassBounds, type Box } from '../core/glassMap'
import { shapePathD, shapeRotation } from '../core/shapePath'

/** The two images a glass layer needs, as PNG data URLs: the refraction map (feImage source) and the
 * silhouette (the layer's own `mask-image`). Both cover `bounds`, at `scale` pixels per composition unit. */
export type GlassImages = { bounds: Box; width: number; height: number; mapUrl: string; maskUrl: string }

const cache = new Map<string, GlassImages>()
/** Silhouette rasters beyond this many pixels are not built: the layer then paints without refraction. */
const MAX_PIXELS = 16_000_000

function canvasOf(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width; canvas.height = height
  return canvas
}

/** Rasterises the silhouette (rotation included) and builds the map from it. Browser only (canvas). Cached
 * by the inputs that change the pixels, so motion and opacity never rebuild it. */
export function glassImages(geometry: ShapeGeometry, glass: Pick<Glass, 'refraction' | 'bezel'>, scale: number): GlassImages | null {
  const bounds = glassBounds(geometry)
  const width = Math.max(1, Math.ceil(bounds.width * scale)), height = Math.max(1, Math.ceil(bounds.height * scale))
  if (width * height > MAX_PIXELS || typeof document === 'undefined') return null
  const d = shapePathD(geometry)
  const key = JSON.stringify([d, shapeRotation(geometry), bounds, glass.refraction, glass.bezel, width, height, scale])
  const hit = cache.get(key)
  if (hit) return hit

  const silhouette = canvasOf(width, height)
  const context = silhouette.getContext('2d', { willReadFrequently: true })
  if (!context) return null
  const { angle, cx, cy } = shapeRotation(geometry)
  context.scale(width / bounds.width, height / bounds.height)
  context.translate(-bounds.x, -bounds.y)
  if (angle) { context.translate(cx, cy); context.rotate(angle * Math.PI / 180); context.translate(-cx, -cy) }
  context.fillStyle = '#fff'
  context.fill(new Path2D(d))
  const pixels = context.getImageData(0, 0, width, height).data
  const inside = new Uint8Array(width * height)
  for (let i = 0; i < inside.length; i++) inside[i] = pixels[i * 4 + 3] > 127 ? 1 : 0

  const map = buildGlassMap({ inside, width, height, bezel: glass.bezel * scale, maxShift: glass.refraction * scale })
  const mapCanvas = canvasOf(width, height)
  mapCanvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(map.rgba), width, height), 0, 0)
  const images: GlassImages = { bounds, width, height, mapUrl: mapCanvas.toDataURL('image/png'), maskUrl: silhouette.toDataURL('image/png') }
  if (cache.size > 24) cache.clear()
  cache.set(key, images)
  return images
}

const coverageCache = new Map<string, GlassImages>()

/**
 * The export pass's map (docs/plans/liquid-glass/04-glass-export-pass.md): the same R/G displacement as
 * `glassImages`, but B = the silhouette's own coverage (anti-aliased) instead of a constant, so FFmpeg can cut
 * the glassed picture to the shape with it. Opaque everywhere (alpha 255); `maskUrl` is the plain silhouette.
 */
export function glassCoverageMap(geometry: ShapeGeometry, glass: Pick<Glass, 'refraction' | 'bezel'>, scale: number): GlassImages | null {
  const bounds = glassBounds(geometry)
  const width = Math.max(1, Math.ceil(bounds.width * scale)), height = Math.max(1, Math.ceil(bounds.height * scale))
  if (width * height > MAX_PIXELS || typeof document === 'undefined') return null
  const d = shapePathD(geometry)
  const key = JSON.stringify([d, shapeRotation(geometry), bounds, glass.refraction, glass.bezel, width, height, scale])
  const hit = coverageCache.get(key)
  if (hit) return hit

  const silhouette = canvasOf(width, height)
  const context = silhouette.getContext('2d', { willReadFrequently: true })
  if (!context) return null
  const { angle, cx, cy } = shapeRotation(geometry)
  context.scale(width / bounds.width, height / bounds.height)
  context.translate(-bounds.x, -bounds.y)
  if (angle) { context.translate(cx, cy); context.rotate(angle * Math.PI / 180); context.translate(-cx, -cy) }
  context.fillStyle = '#fff'
  context.fill(new Path2D(d))
  const pixels = context.getImageData(0, 0, width, height).data
  const inside = new Uint8Array(width * height)
  for (let i = 0; i < inside.length; i++) inside[i] = pixels[i * 4 + 3] > 127 ? 1 : 0

  const map = buildGlassMap({ inside, width, height, bezel: glass.bezel * scale, maxShift: glass.refraction * scale })
  for (let i = 0; i < inside.length; i++) map.rgba[i * 4 + 2] = pixels[i * 4 + 3]
  const mapCanvas = canvasOf(width, height)
  mapCanvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(map.rgba), width, height), 0, 0)
  const images: GlassImages = { bounds, width, height, mapUrl: mapCanvas.toDataURL('image/png'), maskUrl: '' }
  if (coverageCache.size > 24) coverageCache.clear()
  coverageCache.set(key, images)
  return images
}
