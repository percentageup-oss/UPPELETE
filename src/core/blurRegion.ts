import { fullFrameRect } from './zoomRegion'
import { COMPOSITION_WIDTH, type BlurRegion, type CompositionRect } from './edit'
import type { Size } from './composition'
import { dragRangeBy, itemDragBounds, type CueDragMode } from './timeline'

/**
 * Pure math for blur regions (docs/EDITING.md "Blur regions"): sequence-timed, an arbitrary pixel
 * rect and a Gaussian radius, applied by FFmpeg's `split/crop/gblur/overlay`
 * (`workers/media/exportArguments.ts`'s `blurPictureChain`) and previewed as a `backdrop-filter`
 * layer (`CompositionLayers.tsx`). Unlike zoom, blur regions belong to no shared lane — several may
 * overlap in time and in the frame (`blur-add`/`blur-update` in `clipCommands.ts` never check for
 * overlap), so there is no `clampZoomRegion`-style gap-fitting here.
 */

export const DEFAULT_BLUR_RADIUS = 24
export const MIN_BLUR_REGION_US = 300_000
/** The length a dropped preset starts at, before the user trims it. Matches `zoomRegion.ts`'s
 * `DEFAULT_ZOOM_REGION_US`; blur has no shared lane to fit into, so `blur-add` never clamps it. */
export const DEFAULT_BLUR_REGION_US = 2_500_000

/** A sensible starting target for a freshly dropped "Blur area": centered, a third of the frame's
 * width — small enough to read as a masked region rather than a whole-frame effect. The gizmo
 * (`RectStageEditor.tsx`) then lets the user move/resize it, with no aspect lock. */
export function defaultBlurAreaRect(composition: Size): CompositionRect {
  const width = COMPOSITION_WIDTH / 3
  const height = width * (composition.height / COMPOSITION_WIDTH)
  return { x: (COMPOSITION_WIDTH - width) / 2, y: (composition.height - height) / 2, width, height }
}

/** "Blur frame" starts covering the whole output — the common "blur the background" shortcut,
 * which the user can then narrow with the same gizmo. */
export function defaultBlurFrameRect(composition: Size): CompositionRect {
  return fullFrameRect(composition)
}

export type BlurDragMode = CueDragMode

/** Live drag preview (`Timeline.tsx`): a free translation/resize, clamped only to the timeline
 * start and the region's own minimum length. Blur regions may overlap, so unlike
 * `previewZoomDrag` there is no other-region gap to fit into. */
export function previewBlurDrag(region: BlurRegion, mode: BlurDragMode, deltaUs: number): BlurRegion {
  return { ...region, ...dragRangeBy(region, mode, deltaUs, itemDragBounds(region, null, MIN_BLUR_REGION_US)) }
}
