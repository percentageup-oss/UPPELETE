import type { Shape, ShapeGeometry } from './edit'
import type { Size } from './composition'
import { layoutCaption, type MeasureText } from '../captions/renderer'
import { captionStyleInputs, type CaptionStyle } from '../captions/style'

/** `[horizontal, vertical]` padding between the text block and the shape's edge, in composition units. */
export type FitPadding = readonly [number, number]
export type TextBlock = { x: number; y: number; width: number; height: number }
export type FitResult = { geometry: ShapeGeometry; rect: { x: number; y: number; width: number; height: number } }

const round = (value: number) => Math.round(value * 100) / 100
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/** Geometry kinds that have a box to size. Lines and paths follow their points, so they are never fitted. */
export const isFittableGeometry = (geometry: ShapeGeometry): geometry is Extract<ShapeGeometry, { kind: 'rect' | 'bubble' | 'ellipse' | 'highlight' }> =>
  geometry.kind === 'rect' || geometry.kind === 'bubble' || geometry.kind === 'ellipse' || geometry.kind === 'highlight'

/**
 * Where a title's text block lands and how big it is, using the exact caption layout the painter uses
 * (`layoutCaption`), so Malayalam shaping, emphasis and wrapping are measured as painted. `measure` must
 * measure with fonts already loaded: an unloaded font gives an empty layout and this returns null.
 * The box is the block including the style's own padding and outline; its rotation is not applied.
 */
export function textBlockBounds(text: string, style: CaptionStyle, composition: Size, measure: MeasureText): TextBlock | null {
  if (!text.trim()) return null
  try {
    const inputs = captionStyleInputs(style, composition)
    const layout = layoutCaption(text, { ...inputs, font: { ...inputs.font, readiness: 'ready' } }, measure)
    if (layout.lines.length === 0) return null
    return { ...layout.bounds }
  } catch {
    return null
  }
}

/**
 * The 0..1 position that puts a title's text block, `width` x `height` big, centred on `center`, and the
 * centre it really ends up at (the position is clamped to the safe area, so a centre near the frame edge
 * may not be reachable exactly).
 */
export function placeTextCentered(center: { x: number; y: number }, block: { width: number; height: number }, style: CaptionStyle, composition: Size): { horizontal: number; vertical: number; center: { x: number; y: number } } {
  const { safeArea } = captionStyleInputs(style, composition)
  const safe = { x: composition.width * safeArea.left, y: composition.height * safeArea.top,
    width: composition.width * (1 - safeArea.left - safeArea.right), height: composition.height * (1 - safeArea.top - safeArea.bottom) }
  const axis = (target: number, start: number, room: number, size: number) => {
    const free = room - size
    const fraction = free > 0 ? Number(clamp((target - size / 2 - start) / free, 0, 1).toFixed(4)) : 0.5
    return { fraction, center: start + free * fraction + size / 2 }
  }
  const h = axis(center.x, safe.x, safe.width, block.width), v = axis(center.y, safe.y, safe.height, block.height)
  return { horizontal: h.fraction, vertical: v.fraction, center: { x: h.center, y: v.center } }
}

/**
 * Resizes a box geometry to hold a `block`-sized text block centred on `center`, with `padding` around it.
 * An ellipse is grown by root two so the block's corners stay inside. `maxWidth` caps the box width only:
 * wrapping is decided by the title itself, so a longer line simply overflows the capped box.
 * A bubble keeps its tail (side, offset, size); returns null for lines and paths.
 */
export function fitGeometryToBlock(geometry: ShapeGeometry, center: { x: number; y: number }, block: { width: number; height: number }, padding: FitPadding, maxWidth?: number): FitResult | null {
  if (!isFittableGeometry(geometry)) return null
  const grow = geometry.kind === 'ellipse' ? Math.SQRT2 : 1
  const width = Math.max(1, Math.min(round((block.width + padding[0] * 2) * grow), maxWidth ?? Infinity))
  const height = Math.max(1, round((block.height + padding[1] * 2) * grow))
  const rect = { x: round(center.x - width / 2), y: round(center.y - height / 2), width, height }
  return { geometry: { ...geometry, rect }, rect }
}

/**
 * Sizes `shape` to the title text it holds, from measured text plus padding. The result is a stored value:
 * the caller puts it in a `shape-update`; nothing computes it at render time.
 */
export function fitShapeToText(shape: Shape, text: string, style: CaptionStyle, measure: MeasureText, padding: FitPadding, options: { composition: Size; maxWidth?: number }): FitResult | null {
  const bounds = textBlockBounds(text, style, options.composition, measure)
  if (!bounds) return null
  return fitGeometryToBlock(shape.geometry, { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }, bounds, padding, options.maxWidth)
}
