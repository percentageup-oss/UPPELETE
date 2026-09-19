import { COMPOSITION_WIDTH, type CompositionRect } from './edit'
import type { MediaMetadata } from './media'
import type { Size } from './composition'

/** A newly imported overlay starts at a third of the composition's width, keeping the image's own
 * aspect, centred in the frame. 360 is `COMPOSITION_WIDTH / 3`, not an independent constant. */
const DEFAULT_OVERLAY_WIDTH = COMPOSITION_WIDTH / 3

export function defaultOverlayRect(imageMetadata: MediaMetadata | null, composition: Size): CompositionRect {
  const aspect = imageMetadata?.width && imageMetadata.height ? imageMetadata.width / imageMetadata.height : 1
  const width = DEFAULT_OVERLAY_WIDTH
  const height = width / aspect
  return { x: (COMPOSITION_WIDTH - width) / 2, y: Math.max(0, (composition.height - height) / 2), width, height }
}

const DEFAULT_OVERLAY_DURATION_US = 3_000_000

/** Anchors a new overlay at the playhead for three seconds, clamped so it never runs past the
 * known media end (and always has a positive duration even for a very short clip). */
export function defaultOverlayRange(currentUs: number, mediaDurationUs: number | null): { startUs: number; endUs: number } {
  const startUs = Math.max(0, Math.round(currentUs))
  const maxEndUs = mediaDurationUs != null ? Math.max(startUs + 1, mediaDurationUs) : Infinity
  const endUs = Math.min(startUs + DEFAULT_OVERLAY_DURATION_US, maxEndUs)
  return { startUs, endUs }
}
