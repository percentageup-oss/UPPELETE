import { COMPOSITION_WIDTH, type CompositionRect } from './edit'
import type { Size } from './composition'

/**
 * Pure rect math for the stage editor (`ClipStageEditor.tsx`) and inspector quick actions
 * (`ClipInspector.tsx`): move, resize-by-handle and keyboard nudge, for images and picture-in-picture
 * video alike. All
 * of it operates in composition units (1080 wide, see `edit.ts`) and never touches the DOM, so it
 * is exercised directly by callers' own manual verification rather than duplicating `edit.ts`'s
 * schema bounds here — every result is expected to satisfy `compositionRectSchema`.
 */
export type RectHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

const MIN_SIZE = 16

function clampRect(rect: CompositionRect, composition: Size): CompositionRect {
  const width = Math.min(rect.width, COMPOSITION_WIDTH)
  const height = Math.min(rect.height, Math.max(composition.height, MIN_SIZE))
  const x = Math.max(0, Math.min(rect.x, COMPOSITION_WIDTH - width))
  const y = Math.max(0, Math.min(rect.y, Math.max(0, composition.height - height)))
  return { x, y, width, height }
}

/** Translates a rect by a composition-unit delta, clamped to stay fully inside the frame. */
export function moveRect(rect: CompositionRect, dx: number, dy: number, composition: Size): CompositionRect {
  return clampRect({ ...rect, x: rect.x + dx, y: rect.y + dy }, composition)
}

/** Keyboard nudge (arrow keys in the stage editor) is exactly a move by a fixed step. */
export function nudgeRect(rect: CompositionRect, dx: number, dy: number, composition: Size): CompositionRect {
  return moveRect(rect, dx, dy, composition)
}

/**
 * Resizes from one handle, anchoring the opposite edge/corner. Corners keep aspect when
 * `keepAspect` is set (Shift frees it in the stage editor); edge handles always move one axis.
 * The result is clamped to the frame and never shrinks below `minSize` units on either axis.
 */
export function resizeRect(rect: CompositionRect, handle: RectHandle, dx: number, dy: number,
  options: { composition: Size; keepAspect?: boolean; minSize?: number }): CompositionRect {
  const { composition, keepAspect = false, minSize = MIN_SIZE } = options
  const left = rect.x, top = rect.y, right = rect.x + rect.width, bottom = rect.y + rect.height
  let nextLeft = left, nextTop = top, nextRight = right, nextBottom = bottom
  const affectsLeft = handle.includes('w'), affectsRight = handle.includes('e')
  const affectsTop = handle.includes('n'), affectsBottom = handle.includes('s')
  if (affectsLeft) nextLeft = Math.min(left + dx, right - minSize)
  if (affectsRight) nextRight = Math.max(right + dx, left + minSize)
  if (affectsTop) nextTop = Math.min(top + dy, bottom - minSize)
  if (affectsBottom) nextBottom = Math.max(bottom + dy, top + minSize)

  const isCorner = (affectsLeft || affectsRight) && (affectsTop || affectsBottom)
  if (isCorner && keepAspect && rect.width > 0 && rect.height > 0) {
    const aspect = rect.width / rect.height
    const width = nextRight - nextLeft, height = nextBottom - nextTop
    // Drive the axis with the larger relative change, so the drag feels like it tracks the pointer.
    const byWidth = Math.abs(width / rect.width - 1) >= Math.abs(height / rect.height - 1)
    if (byWidth) {
      const targetHeight = Math.max(minSize, width / aspect)
      if (affectsTop) nextTop = nextBottom - targetHeight; else nextBottom = nextTop + targetHeight
    } else {
      const targetWidth = Math.max(minSize, height * aspect)
      if (affectsLeft) nextLeft = nextRight - targetWidth; else nextRight = nextLeft + targetWidth
    }
  }

  const resized: CompositionRect = { x: nextLeft, y: nextTop, width: nextRight - nextLeft, height: nextBottom - nextTop }
  // Clamping after resize could distort the aspect it just enforced against the frame edge; the
  // stage editor already bounds pointer deltas against the frame, so this is a cheap backstop.
  return clampRect(resized, composition)
}

/** Rounds a rect to integer composition units, matching the inspector's plain number fields. */
export function roundRect(rect: CompositionRect): CompositionRect {
  return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
}

/** Centers a rect on one or both axes of the composition (the inspector's Center/Center H/Center V actions). */
export function centerRect(rect: CompositionRect, composition: Size, axis: 'x' | 'y' | 'both' = 'both'): CompositionRect {
  const x = axis === 'y' ? rect.x : (COMPOSITION_WIDTH - rect.width) / 2
  const y = axis === 'x' ? rect.y : Math.max(0, (composition.height - rect.height) / 2)
  return clampRect({ ...rect, x, y }, composition)
}
