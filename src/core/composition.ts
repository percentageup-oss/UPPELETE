import { COMPOSITION_WIDTH, type CompositionRect } from './edit'
import type { MediaMetadata } from './media'

/**
 * Composition space is a fixed 1080-unit-wide canvas whose height is `1080 / display aspect`
 * (docs/EDITING.md). Because the composition aspect *equals* the display aspect, converting
 * composition units to output pixels is one scalar — `output.width / 1080` — in both directions
 * and for both axes. Everything here is pure so main can build the export manifest with it.
 */
export type Size = { width: number; height: number }
export type PixelRect = { x: number; y: number; width: number; height: number }

export { COMPOSITION_WIDTH }

/**
 * The media's dimensions as the viewer actually sees them. A ±90° rotation swaps width and height;
 * FFmpeg autorotates on decode and the `<video>` element reports the rotated size, so this is the
 * one orientation both preview and export agree on. Extracted from `App.tsx`'s inline aspect
 * derivation so the export manifest builder in main can use exactly the same rule.
 */
export function displayDimensions(metadata: MediaMetadata | null | undefined): Size | null {
  if (!metadata?.width || !metadata?.height) return null
  const swapped = metadata.rotationDegrees != null && Math.abs(metadata.rotationDegrees) % 180 === 90
  return swapped ? { width: metadata.height, height: metadata.width } : { width: metadata.width, height: metadata.height }
}

export function displayAspect(metadata: MediaMetadata | null | undefined): number | null {
  const size = displayDimensions(metadata)
  return size ? size.width / size.height : null
}

/** The composition for a display aspect: always 1080 wide, height follows. */
export function compositionFor(aspect: number): Size {
  if (!Number.isFinite(aspect) || aspect <= 0) throw new Error('Composition needs a positive display aspect.')
  return { width: COMPOSITION_WIDTH, height: COMPOSITION_WIDTH / aspect }
}

/** H.264 needs even dimensions; composition→pixel *offsets* do not, because the graph is RGBA. */
export function evenDimensions(size: Size): Size {
  const even = (value: number) => Math.max(16, Math.round(value / 2) * 2)
  return { width: even(size.width), height: even(size.height) }
}

export function compositionScale(output: Size): number {
  if (!Number.isFinite(output.width) || output.width <= 0) throw new Error('Composition scaling needs a positive output width.')
  return output.width / COMPOSITION_WIDTH
}

/** Scales a length (a blur sigma, a stroke width) from composition units to output pixels. */
export function compositionScalarToPixels(value: number, output: Size): number {
  return value * compositionScale(output)
}

/** Integer output-pixel rect, clamped to the frame so an FFmpeg `crop` can never leave its input. */
export function compositionToPixels(rect: CompositionRect, output: Size): PixelRect {
  const scale = compositionScale(output)
  const left = Math.max(0, Math.min(output.width, Math.round(rect.x * scale)))
  const top = Math.max(0, Math.min(output.height, Math.round(rect.y * scale)))
  const right = Math.max(left, Math.min(output.width, Math.round((rect.x + rect.width) * scale)))
  const bottom = Math.max(top, Math.min(output.height, Math.round((rect.y + rect.height) * scale)))
  return { x: left, y: top, width: right - left, height: bottom - top }
}
