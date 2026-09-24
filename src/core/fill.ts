import type { BackgroundMotion, ColorClip, Fill } from './edit'
import { gridSwatchCss } from './gridFill'

/**
 * Backgrounds (schema 13): the one place that decides how a `color` clip looks at a given time.
 * The preview paints these values with CSS (`CompositionLayers`) and export turns the same numbers
 * into FFmpeg filters (`workers/media/exportArguments.ts`), so the two cannot drift apart.
 */

/** A drifting gradient is drawn this many times the frame size, then panned inside the frame. */
export const DRIFT_OVERSIZE = 1.5
/** How far the oversized picture travels each way, as a fraction of the frame — the margin that
 * `DRIFT_OVERSIZE` leaves, so the pan never reveals an edge. */
export const DRIFT_TRAVEL = (DRIFT_OVERSIZE - 1) / 2

export const DEFAULT_MOTION_PERIOD_US = 4_000_000

/** Microseconds into the clip's own (synthetic) source range. Because it counts from the source
 * start, a moved clip keeps its phase and the right half of a split continues the left half's loop. */
export function elapsedUs(clip: Pick<ColorClip, 'timelineStartUs' | 'sourceStartUs'>, sequenceUs: number): number {
  return sequenceUs - clip.timelineStartUs + clip.sourceStartUs
}

/** 0 → 1 → 0 once per period, easing at both ends: `0.5 − 0.5·cos(2π·t/period)`. */
export function easedPhase(periodUs: number, elapsed: number): number {
  return 0.5 - 0.5 * Math.cos(2 * Math.PI * elapsed / periodUs)
}

/** The same phase as an FFmpeg expression in `T` (seconds), for `blend`/`crop`. */
export function easedPhaseExpression(periodUs: number, offsetUs: number): string {
  return `(0.5-0.5*cos(2*PI*(T+${(offsetUs / 1e6).toFixed(6)})/${(periodUs / 1e6).toFixed(6)}))`
}

/** Unit vector of a CSS-style angle (0° up, 90° right, y grows downward). */
export function angleVector(angleDeg: number): { x: number; y: number } {
  const radians = angleDeg * Math.PI / 180
  return { x: Math.sin(radians), y: -Math.cos(radians) }
}

/** CSS `background` for a solid or gradient fill (a grid is drawn by `FillPicture`, which needs a
 * pixel size, so its `background` color is all a plain CSS value can say). */
export function fillCss(fill: Fill): string {
  if (fill.type === 'solid') return fill.color
  if (fill.type === 'grid') return fill.background
  return `linear-gradient(${fill.angle}deg, ${fill.from}, ${fill.to})`
}

/**
 * `t = ax·X + ay·Y + c` is the gradient position (0 = `from`, 1 = `to`, clamped by the caller) of the
 * pixel at (X, Y), measured in pixels from the top-left of a `width`×`height` box. It is exactly
 * CSS's gradient line: through the center, `(|w·sinθ| + |h·cosθ|)` long, so the corners land on 0 and 1.
 */
export function gradientLine(angleDeg: number, width: number, height: number): { ax: number; ay: number; c: number } {
  const { x, y } = angleVector(angleDeg)
  const length = Math.abs(width * x) + Math.abs(height * y)
  const ax = x / length
  const ay = y / length
  return { ax, ay, c: 0.5 - (width / 2) * ax - (height / 2) * ay }
}

export type FillPaint = {
  /** What the base picture is drawn from. */
  fill: Fill
  /** Base picture box relative to the clip's frame, in fractions of it: 1×1 at 0,0 unless drifting. */
  base: { left: number; top: number; width: number; height: number }
  /** A second picture blended on top at `opacity` (shift → the other fill; pulse → black/white). */
  overlay: { fill: Fill; opacity: number } | null
  /** A scrolling grid: how many cells the pattern has traveled along each axis (signed, unbounded),
   * from `direction` and the clip's own clock. Each renderer turns it into pixels with its own cell size. */
  scroll: { x: number; y: number } | null
}

const solid = (color: string): Fill => ({ type: 'solid', color })

/** Drift is a no-op on a solid, so it paints as a still. */
export function driftOffset(motion: Extract<BackgroundMotion, { type: 'drift' }>, elapsed: number): { x: number; y: number } {
  const p = -Math.cos(2 * Math.PI * elapsed / motion.periodUs)
  const direction = angleVector(motion.direction)
  return { x: DRIFT_TRAVEL * p * direction.x, y: DRIFT_TRAVEL * p * direction.y }
}

/** Cells traveled by a scrolling grid: one cell per period toward `direction` (CSS angle). */
export function scrollPhase(motion: Extract<BackgroundMotion, { type: 'scroll' }>, elapsed: number): { x: number; y: number } {
  // Snapped to the 10 decimals FFmpeg's expression carries, so cos(90°)'s 6e-17 is exactly 0 in both
  // and a straight scroll can never creep a whole pixel sideways after a long time.
  const direction = angleVector(motion.direction)
  const cells = elapsed / motion.periodUs
  const snap = (component: number) => Math.round(component * 1e10) / 1e10 + 0
  return { x: snap(direction.x) * cells, y: snap(direction.y) * cells }
}

export function paintAt(clip: ColorClip, sequenceUs: number): FillPaint {
  const still = { left: 0, top: 0, width: 1, height: 1 }
  const motion = clip.motion
  if (!motion) return { fill: clip.fill, base: still, overlay: null, scroll: null }
  const elapsed = elapsedUs(clip, sequenceUs)
  if (motion.type === 'shift') return { fill: clip.fill, base: still, overlay: { fill: motion.to, opacity: easedPhase(motion.periodUs, elapsed) }, scroll: null }
  if (motion.type === 'pulse') return { fill: clip.fill, base: still, overlay: { fill: solid(motion.toward === 'black' ? '#000000' : '#ffffff'), opacity: motion.depth * easedPhase(motion.periodUs, elapsed) }, scroll: null }
  if (motion.type === 'scroll') return { fill: clip.fill, base: still, overlay: null, scroll: clip.fill.type === 'grid' ? scrollPhase(motion, elapsed) : null }
  if (clip.fill.type === 'solid' || clip.fill.type === 'grid') return { fill: clip.fill, base: still, overlay: null, scroll: null }
  const offset = driftOffset(motion, elapsed)
  return { fill: clip.fill, base: { left: -DRIFT_TRAVEL + offset.x, top: -DRIFT_TRAVEL + offset.y, width: DRIFT_OVERSIZE, height: DRIFT_OVERSIZE }, overlay: null, scroll: null }
}

/** Whether a motion does anything to this fill: a solid or grid has nothing to pan, and a scroll only
 * moves a grid. Such a pairing paints (and exports) as a still. */
export function motionApplies(fill: Fill, motion: BackgroundMotion | undefined): boolean {
  if (!motion) return false
  if (motion.type === 'drift') return fill.type === 'gradient'
  if (motion.type === 'scroll') return fill.type === 'grid'
  return true
}

export function isAnimated(clip: ColorClip): boolean {
  return motionApplies(clip.fill, clip.motion)
}

/** What the timeline block and inspector call a background. */
export function colorClipLabel(clip: ColorClip): string {
  const kind = { solid: 'Color', gradient: 'Gradient', grid: { lines: 'Grid', dots: 'Dot grid', perspective: 'Perspective grid' }[clip.fill.type === 'grid' ? clip.fill.pattern : 'lines'] }[clip.fill.type]
  const motion = clip.motion ? { shift: 'shift', pulse: 'pulse', drift: 'drift', scroll: 'scroll' }[clip.motion.type] : null
  return motion ? `${kind} · ${motion}` : kind
}

/** A static CSS approximation of a clip for swatches (the timeline block, panel tiles): the fill,
 * with a shift's second color as a diagonal so the motion is hinted at without animating. */
export function swatchCss(clip: Pick<ColorClip, 'fill' | 'motion'>): string {
  if (clip.motion?.type === 'shift' && clip.fill.type !== 'grid') {
    const lead = (fill: Fill) => fill.type === 'solid' ? fill.color : fill.type === 'gradient' ? fill.from : fill.background
    return `linear-gradient(90deg, ${lead(clip.fill)}, ${lead(clip.motion.to)})`
  }
  return clip.fill.type === 'grid' ? gridSwatchCss(clip.fill) : fillCss(clip.fill)
}
