import type { Shape } from './edit'
import { compareLayered, type Layered } from './graphicsOrder'

/** Each blending shape costs an extra export pass, so a project may hold only this many. */
export const MAX_BLENDING_SHAPES = 8

/** Blending and glass shapes each cost an extra export pass, so together they share this cap. */
export const MAX_PASS_SHAPES = 8

/** Shapes that have a glass look (absent means not glass). */
export const glassShapes = (shapes: readonly Shape[]): Shape[] => shapes.filter((shape) => shape.glass !== undefined)

/** Shapes that need their own export pass: blending shapes plus glass shapes. */
export const passShapes = (shapes: readonly Shape[]): Shape[] => shapes.filter((shape) => shape.blendMode !== undefined || shape.glass !== undefined)

/** Shapes that have a blend mode (`normal` is never stored, so presence means blending). */
export const blendingShapes = (shapes: readonly Shape[]): Shape[] => shapes.filter((shape) => shape.blendMode !== undefined)

/**
 * The export pass model (docs/plans/shape-blend/02-export-passes.md): the host paints ALL
 * host-painted content (pinned overlays/effects, graphics below captions, the caption plane,
 * graphics above, fade) onto one transparent frame FFmpeg overlays on the picture. A transparent
 * layer cannot blend, so a project with k blending shapes splits into K = 2k+1 passes: even bands
 * are normal content composited with `overlay`, odd bands are exactly one blending shape each,
 * composited with FFmpeg's `blend`. With no blending shapes K = 1 — the untouched single pass.
 */
export type GraphicsPasses = { count: number; blendShapes: readonly Shape[]; bands: readonly PassBand[] }

/**
 * One odd band. A glass shape (docs/plans/liquid-glass/04-glass-export-pass.md) uses one too: its band
 * is the opaque refraction map FFmpeg blurs and displaces the picture with, and the glass surface (tint,
 * rim, shadow) is an ordinary graphic in the even band right after it. A shape is never both: glass is
 * refused on a shape with a blend mode.
 */
export type PassBand = { kind: 'blend' | 'glass'; shape: Shape }

/** The pass shapes (blending and glass), sorted into the same layer order the single flat pass painted them in. */
export function graphicsPasses(shapes: readonly Shape[]): GraphicsPasses {
  const bands = passShapes(shapes).slice().sort(compareLayered)
    .map((shape): PassBand => ({ kind: shape.blendMode !== undefined ? 'blend' : 'glass', shape }))
  return { count: bands.length * 2 + 1, blendShapes: bands.filter((band) => band.kind === 'blend').map((band) => band.shape), bands }
}

/**
 * What a pass placement question is being asked about: pinned host-painted content (images, and
 * the frame-paint effects other than fade) always lands in band 0; fade always lands in the last
 * band, since it must cover everything, including every blending shape; the caption plane and a
 * non-blending graphic (an authored title or a plain shape) land wherever `compareLayered` puts
 * them relative to the blending shapes.
 */
export type PassEntry = { kind: 'pinned' } | { kind: 'fade' } | { kind: 'caption' } | { kind: 'graphic'; item: Layered }

/**
 * The caption plane sorts as `layerOrder: 0` but before anything else at that same layer order —
 * `belowCaptions` (`graphicsOrder.ts`) already treats `layerOrder < 0` as "below captions" and
 * `>= 0` as "above", so a real graphic at `layerOrder: 0` must sort after this key, never before it.
 */
const CAPTION_KEY: Layered = { layerOrder: 0, startUs: -Infinity, id: '' }

/** Which of `passes.count` bands `entry` paints in. */
export function passOf(entry: PassEntry, passes: GraphicsPasses): number {
  if (entry.kind === 'pinned') return 0
  if (entry.kind === 'fade') return passes.count - 1
  const key = entry.kind === 'caption' ? CAPTION_KEY : entry.item
  let band = 0
  for (const { shape } of passes.bands) {
    // `<= 0`: a glass shape's own surface (the same key) lands right after its map band.
    if (compareLayered(shape, key) <= 0) band += 2
    else break
  }
  return band
}
