import type { Rect } from '../captions/renderer'

/**
 * Pure math for the caption stage editor (`CaptionStageEditor.tsx`): inverting `layoutCaption`'s
 * placement formula (`renderer.ts`'s `bounds` calculation) back from a dragged pixel position into
 * the `{horizontal, vertical}` fractions the caption style actually stores, plus font-size scaling
 * and rotation for the resize/rotate handles. Like `overlayRect.ts`, this never touches the DOM or a
 * measured layout — it is exercised directly by its own unit tests and by manual verification of the
 * stage editor.
 *
 * `horizontal`/`vertical` are NOT pixel coordinates: they are 0..1 fractions of the *free space* the
 * caption's measured block has within the safe area (`renderer.ts`'s `bounds.x = safeRect.x +
 * (safeRect.width - blockWidth * fitScale) * horizontal`, and the `vertical` analogue). A block that
 * exactly fills the safe area on an axis has no free space on that axis, so its fraction is undefined
 * on that axis — every function here is written to leave that axis alone rather than divide by zero.
 */

const MIN_FONT_SIZE = 20
const MAX_FONT_SIZE = 120

export type CaptionPlacement = { horizontal: number; vertical: number }

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

/** Inverts `bounds.x`/`bounds.y` back into the fractions that produced them. `bounds` is the
 * caption's own measured, fitted rect (`CaptionLayout.bounds`); `safeRect` is `CaptionLayout.safeRect`. */
export function boundsToPlacement(bounds: Rect, safeRect: Rect, fallback: CaptionPlacement): CaptionPlacement {
  const freeWidth = safeRect.width - bounds.width, freeHeight = safeRect.height - bounds.height
  const horizontal = freeWidth > 0 ? clamp01((bounds.x - safeRect.x) / freeWidth) : fallback.horizontal
  const vertical = freeHeight > 0 ? clamp01((bounds.y - safeRect.y) / freeHeight) : fallback.vertical
  return { horizontal, vertical }
}

/** Drags the caption by a composition-unit pointer delta. `dx`/`dy` are already divided by the
 * preview's projection scale (`useCompositionProjection`), so they are in the same units as `bounds`. */
export function movePlacement(base: CaptionPlacement, dx: number, dy: number, safeRect: Rect, bounds: Rect): CaptionPlacement {
  const freeWidth = safeRect.width - bounds.width, freeHeight = safeRect.height - bounds.height
  const horizontal = freeWidth > 0 ? clamp01(base.horizontal + dx / freeWidth) : base.horizontal
  const vertical = freeHeight > 0 ? clamp01(base.vertical + dy / freeHeight) : base.vertical
  return { horizontal, vertical }
}

/** Arrow-key nudge: a fixed composition-unit step (1, or 10 with Shift) through the same math as a drag. */
export function nudgePlacement(base: CaptionPlacement, dx: number, dy: number, safeRect: Rect, bounds: Rect): CaptionPlacement {
  return movePlacement(base, dx, dy, safeRect, bounds)
}

/** The pointer's distance from the block's center, in composition units — used as a scale-drag ratio.
 * Distance-from-center is rotation-invariant, so a rotated caption needs no inverse-rotation of the
 * pointer point here. */
function distanceFromCenter(center: { x: number; y: number }, point: { x: number; y: number }): number {
  return Math.hypot(point.x - center.x, point.y - center.y)
}

/** A corner-handle resize ratio: how much farther (or closer) the pointer now is from the block's
 * center than where the gesture started. 1 = no change. Guards a zero-length start distance (the
 * pointer started exactly on the center) by treating it as no change rather than producing Infinity. */
export function pointerScaleFactor(center: { x: number; y: number }, startPoint: { x: number; y: number }, currentPoint: { x: number; y: number }): number {
  const startDistance = distanceFromCenter(center, startPoint)
  if (startDistance <= 0) return 1
  return distanceFromCenter(center, currentPoint) / startDistance
}

/** Applies a scale ratio to a base font size, clamped to the appearance schema's bounds (20-120). */
export function scaleFontSize(baseFontSize: number, factor: number): number {
  if (!Number.isFinite(factor) || factor <= 0) return baseFontSize
  return Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, baseFontSize * factor))
}

function angleFromCenter(center: { x: number; y: number }, point: { x: number; y: number }): number {
  return Math.atan2(point.y - center.y, point.x - center.x) * (180 / Math.PI)
}

function normalizeDegrees(degrees: number): number {
  const wrapped = ((degrees + 180) % 360 + 360) % 360 - 180
  // Keep the schema's own +180 boundary exact rather than the -180 wrap-around.
  return wrapped === -180 ? 180 : wrapped
}

/** The rotate handle: the caption's new rotation given where the pointer started and now is, added
 * to the rotation the gesture began with. `snap` (Shift) rounds to the nearest 15°. */
export function rotationAt(center: { x: number; y: number }, startPoint: { x: number; y: number }, currentPoint: { x: number; y: number },
  baseRotation: number, snap: boolean): number {
  const delta = angleFromCenter(center, currentPoint) - angleFromCenter(center, startPoint)
  const next = normalizeDegrees(baseRotation + delta)
  return snap ? normalizeDegrees(Math.round(next / 15) * 15) : next
}
