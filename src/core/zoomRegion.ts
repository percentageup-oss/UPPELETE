import { COMPOSITION_WIDTH, type CompositionRect, type ZoomRegion } from './edit'
import type { Size } from './composition'
import { dragRangeBy, itemDragBounds, type CueDragMode } from './timeline'

/** Pixel-space shape carried by export manifest v3. It intentionally has no asset/track identity. */
export type ExportZoomRegion = { startUs: number; endUs: number; rect: { x: number; y: number; width: number; height: number }; fromRect?: { x: number; y: number; width: number; height: number }; easeInUs: number; easeOutUs: number }

/**
 * Pure math for zoom regions (docs/EDITING.md "Zoom regions"): the same shared-evaluator contract
 * `src/captions/renderer.ts` uses for caption motion — one function of an absolute sequence
 * timestamp, no elapsed clock, no accumulated easing state, so seeking to the same timestamp from
 * any direction produces the same crop window (mirrors the property `motion.test.tsx` pins for
 * captions). Preview (`App.tsx`'s `CaptionStage`) and the export filtergraph builder
 * (`workers/media/exportArguments.ts`) both call `zoomRectAt`, so there is exactly one definition
 * of what a zoom region does.
 */

/** The full-frame rect for a composition of the given size — what the picture eases from/to. */
export function fullFrameRect(composition: Size): CompositionRect {
  return { x: 0, y: 0, width: COMPOSITION_WIDTH, height: composition.height }
}

/** A sensible starting target for a freshly dropped zoom region: centered, at the output aspect (so
 * the export's crop never distorts the picture until the user drags it), scaled to `factor` of the
 * full frame — the gizmo (`RectStageEditor.tsx`) then lets the user move/resize it. */
export function defaultZoomRect(composition: Size, factor = 0.6): CompositionRect {
  const width = COMPOSITION_WIDTH * factor
  const height = composition.height * factor
  return { x: (COMPOSITION_WIDTH - width) / 2, y: (composition.height - height) / 2, width, height }
}

function clamp01(t: number): number {
  return Math.min(1, Math.max(0, t))
}

/** Ease in/out, matching the closed-form curves already used for caption motion (renderer.ts).
 * Exported so every other effect (`frameEffects.ts`) ramps on the same curve. */
export function smoothstep(t: number): number {
  const clamped = clamp01(t)
  return clamped * clamped * (3 - 2 * clamped)
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function lerpRect(from: CompositionRect, to: CompositionRect, t: number): CompositionRect {
  return { x: lerp(from.x, to.x, t), y: lerp(from.y, to.y, t), width: lerp(from.width, to.width, t), height: lerp(from.height, to.height, t) }
}

/**
 * The crop window at an absolute sequence time, or `null` outside every region (the full frame).
 * `easeInUs`/`easeOutUs` are clamped to half the region's own length so a short region's ramps can
 * never overlap into an undefined double-ease.
 */
export function zoomRectAt(regions: readonly ZoomRegion[], sequenceUs: number, composition: Size): CompositionRect | null {
  const region = regions.find((candidate) => sequenceUs >= candidate.startUs && sequenceUs < candidate.endUs)
  if (!region) return null
  // Pan / Ken Burns: one smoothstep across the whole region, no hold and no return to full frame.
  if (region.fromRect) return lerpRect(region.fromRect, region.rect, smoothstep((sequenceUs - region.startUs) / (region.endUs - region.startUs)))
  const half = (region.endUs - region.startUs) / 2
  const easeInUs = Math.min(region.easeInUs, half)
  const easeOutUs = Math.min(region.easeOutUs, half)
  const holdStartUs = region.startUs + easeInUs
  const holdEndUs = region.endUs - easeOutUs
  const full = fullFrameRect(composition)
  if (sequenceUs < holdStartUs) return lerpRect(full, region.rect, smoothstep(easeInUs > 0 ? (sequenceUs - region.startUs) / easeInUs : 1))
  if (sequenceUs >= holdEndUs) return lerpRect(region.rect, full, smoothstep(easeOutUs > 0 ? (sequenceUs - holdEndUs) / easeOutUs : 1))
  return region.rect
}

/** How far in the zoom-amount control (`ZoomInspector.tsx`) can push the target rect — beyond this
 * the crop window is narrower than useful, and closer than 1x means "not zoomed in" at all. */
export const MAX_ZOOM_FACTOR = 10

/** The target rect's zoom factor: how many times the output frame's width the rect is cropped down
 * to. Inverse of `rectAtZoomFactor`. */
export function zoomFactorOf(rect: CompositionRect): number {
  return COMPOSITION_WIDTH / rect.width
}

/**
 * Rescales `rect` to a new zoom factor (1 = full frame, 2 = half-width crop, …), keeping its center
 * fixed and the composition's own aspect ratio — the same invariant `defaultZoomRect` establishes,
 * so the crop is never stretched once it is scaled back up to fill the output frame. Clamped to
 * `MAX_ZOOM_FACTOR` and to stay within the frame.
 */
export function rectAtZoomFactor(rect: CompositionRect, factor: number, composition: Size): CompositionRect {
  const clampedFactor = Math.max(1, Math.min(MAX_ZOOM_FACTOR, factor))
  const width = COMPOSITION_WIDTH / clampedFactor
  const height = width * (composition.height / COMPOSITION_WIDTH)
  const centerX = rect.x + rect.width / 2
  const centerY = rect.y + rect.height / 2
  const x = Math.min(Math.max(0, centerX - width / 2), COMPOSITION_WIDTH - width)
  const y = Math.min(Math.max(0, centerY - height / 2), composition.height - height)
  return { x, y, width, height }
}

/** Pan / Ken Burns read better over a longer, slower move than a punch-in zoom. */
export const DEFAULT_PAN_REGION_US = 5_000_000

/**
 * Starting framings for the Pan and Ken Burns presets, at the output aspect (so the crop never
 * distorts). Pan: a 1.5x window slides from the left edge to the right edge at mid-height. Ken
 * Burns: the full frame pushes in to a 1.25x window offset toward the upper-left third.
 */
export function defaultPanRects(preset: 'pan' | 'ken-burns', composition: Size): { fromRect: CompositionRect; rect: CompositionRect } {
  if (preset === 'ken-burns') {
    const to = rectAtZoomFactor(fullFrameRect(composition), 1.25, composition)
    return { fromRect: fullFrameRect(composition), rect: { ...to, x: (COMPOSITION_WIDTH - to.width) * 0.35, y: (composition.height - to.height) * 0.35 } }
  }
  const window = rectAtZoomFactor(fullFrameRect(composition), 1.5, composition)
  return { fromRect: { ...window, x: 0 }, rect: { ...window, x: COMPOSITION_WIDTH - window.width } }
}

/** Below this, a region is too thin to be a usable gesture target or a meaningful FFmpeg crop window. */
export const MIN_ZOOM_REGION_US = 300_000
/** The length a dropped preset starts at, before the user trims it — long enough to read the ramp. */
export const DEFAULT_ZOOM_REGION_US = 2_500_000

type Gap = { startUs: number; endUs: number }

/** The lane's free space around `others`, from 0 to the last region's end (open-ended). */
function freeGaps(others: readonly { startUs: number; endUs: number }[]): Gap[] {
  const sorted = [...others].sort((a, b) => a.startUs - b.startUs)
  const gaps: Gap[] = []
  let cursor = 0
  for (const region of sorted) {
    if (region.startUs > cursor) gaps.push({ startUs: cursor, endUs: region.startUs })
    cursor = Math.max(cursor, region.endUs)
  }
  gaps.push({ startUs: cursor, endUs: Number.MAX_SAFE_INTEGER })
  return gaps
}

/** The gap with the most overlap with `range` — or, when none overlaps, the nearest one. Overlap is
 * negative for a non-overlapping gap, so `Math.max` naturally falls back to proximity. */
function bestGapFor(range: { startUs: number; endUs: number }, gaps: readonly Gap[]): Gap {
  let best = gaps[0]
  let bestOverlap = -Infinity
  for (const gap of gaps) {
    const overlap = Math.min(gap.endUs, range.endUs) - Math.max(gap.startUs, range.startUs)
    if (overlap > bestOverlap) { bestOverlap = overlap; best = gap }
  }
  return best
}

/**
 * Fits `candidate` into the free space around `others` (every other zoom region — there is one
 * lane, so it must never overlap another). Prefers the candidate's own timing, clamped into the gap
 * with the most overlap; shrinks toward the gap when the requested length does not fit. Returns
 * `null` when even the minimum region length has nowhere to go — the caller (a command or a drop
 * plan) then refuses the placement rather than silently overlapping another region.
 */
export function clampZoomRegion<T extends { startUs: number; endUs: number }>(candidate: T, others: readonly { startUs: number; endUs: number }[]): T | null {
  const gap = bestGapFor(candidate, freeGaps(others))
  const gapLengthUs = gap.endUs - gap.startUs
  if (gapLengthUs < MIN_ZOOM_REGION_US) return null
  const lengthUs = Math.min(Math.max(MIN_ZOOM_REGION_US, candidate.endUs - candidate.startUs), gapLengthUs)
  const startUs = Math.min(Math.max(candidate.startUs, gap.startUs), gap.endUs - lengthUs)
  return { ...candidate, startUs, endUs: startUs + lengthUs }
}

/** `Timeline.tsx`'s drag gesture for a zoom region reuses the cue/clip drag vocabulary. */
export type ZoomDragMode = CueDragMode

/**
 * Live drag preview (`Timeline.tsx`): `dragRangeBy` gives the free translation/resize (never
 * before zero, never shorter than the minimum), then `clampZoomRegion` fits it into the gap around
 * every other region in the one lane — the same two-step shape `zoom-region-move`/`-trim`
 * (`zoomRegionCommands.ts`) apply on commit, so the preview never promises a placement the command
 * would refuse. Falls back to the unmoved region on the rare gesture that finds no room at all.
 */
export function previewZoomDrag(region: ZoomRegion, mode: ZoomDragMode, deltaUs: number, others: readonly ZoomRegion[]): ZoomRegion {
  const free = dragRangeBy(region, mode, deltaUs, itemDragBounds(region, null, MIN_ZOOM_REGION_US))
  return clampZoomRegion({ ...region, ...free }, others) ?? region
}

function decimal(value: number): string {
  // All values originate in schema-validated integer microseconds/pixels. Fixed decimal literals
  // keep generated FFmpeg graphs deterministic and avoid scientific notation in filter syntax.
  return (Math.round(value * 1_000_000) / 1_000_000).toFixed(6)
}

function smoothstepExpression(phase: string): string {
  return `(${phase})*(${phase})*(3-2*(${phase}))`
}

function lerpExpression(from: number, to: number, phase: string): string {
  if (from === to) return decimal(from)
  return `(${decimal(from)}+(${decimal(to - from)})*(${smoothstepExpression(phase)}))`
}

/**
 * FFmpeg expressions for the same target rectangle `zoomRectAt` evaluates in preview. Scale can
 * re-evaluate its output dimensions per frame on FFmpeg 9.0.1; crop stays fixed at the output
 * dimensions and follows the scaled target origin. This avoids zoompan's constraints and crop's
 * unavailable `eval=frame` option while keeping all time calculations absolute (`t`, in seconds).
 */
export function zoomScaleCropExpressions(regions: readonly ExportZoomRegion[], output: { width: number; height: number }): { scale: string; x: string; y: string } | null {
  if (!regions.length) return null
  const full = { x: 0, y: 0, width: output.width, height: output.height }
  const sorted = [...regions].sort((a, b) => a.startUs - b.startUs || a.endUs - b.endUs)
  const property = (key: keyof typeof full) => {
    let expression = decimal(full[key])
    for (let index = sorted.length - 1; index >= 0; index--) {
      const region = sorted[index]
      const durationUs = region.endUs - region.startUs
      if (region.fromRect) {
        const startS = region.startUs / 1_000_000
        const endS = region.endUs / 1_000_000
        const pan = lerpExpression(region.fromRect[key], region.rect[key], `(t-${decimal(startS)})/${decimal(durationUs / 1_000_000)}`)
        expression = `if(gte(t,${decimal(startS)})*lt(t,${decimal(endS)}),${pan},${expression})`
        continue
      }
      const easeInUs = Math.min(region.easeInUs, durationUs / 2)
      const easeOutUs = Math.min(region.easeOutUs, durationUs / 2)
      const start = region.startUs / 1_000_000
      const end = region.endUs / 1_000_000
      const holdStart = start + easeInUs / 1_000_000
      const holdEnd = end - easeOutUs / 1_000_000
      const target = region.rect[key]
      const into = easeInUs ? lerpExpression(full[key], target, `(t-${decimal(start)})/${decimal(easeInUs / 1_000_000)}`) : decimal(target)
      const out = easeOutUs ? lerpExpression(target, full[key], `(t-${decimal(holdEnd)})/${decimal(easeOutUs / 1_000_000)}`) : decimal(target)
      const active = `if(lt(t,${decimal(holdStart)}),${into},if(lt(t,${decimal(holdEnd)}),${decimal(target)},${out}))`
      // Region end is half-open, just like `zoomRectAt`; at an exact adjoining boundary the next
      // region (or the full frame) wins. Multiplication is FFmpeg expression-language AND.
      expression = `if(gte(t,${decimal(start)})*lt(t,${decimal(end)}),${active},${expression})`
    }
    return expression
  }
  const width = property('width')
  const x = property('x')
  const y = property('y')
  const scale = `(${decimal(output.width)}/(${width}))`
  return { scale, x: `((${x})*(${scale}))`, y: `((${y})*(${scale}))` }
}
