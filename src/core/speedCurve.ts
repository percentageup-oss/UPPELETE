import type { ClipSpeed } from './edit'
import { SPEED_MAX, SPEED_MIN } from './edit'
import { speedRateAt } from './clipTime'

/**
 * Pure helpers behind the speed-curve editor (`SpeedCurveEditor.tsx`): the curve is a list of
 * `{ sourceUs, rate }` points over the clip's source range, edited by dragging, adding and removing
 * points. Rates are drawn on a log axis so 0.5× and 2× sit equally far from 1×.
 */
export type SpeedPoint = ClipSpeed['points'][number]
export type SourceRange = { startUs: number; endUs: number }
export const MAX_SPEED_POINTS = 32

const LOG_MIN = Math.log(SPEED_MIN)
const LOG_MAX = Math.log(SPEED_MAX)
export const clampRate = (rate: number) => Math.min(SPEED_MAX, Math.max(SPEED_MIN, rate))

/** 0 (bottom, slowest) to 1 (top, fastest) on the log rate axis. */
export const rateToFraction = (rate: number): number => (Math.log(clampRate(rate)) - LOG_MIN) / (LOG_MAX - LOG_MIN)
export const fractionToRate = (fraction: number): number => clampRate(Math.exp(LOG_MIN + Math.min(1, Math.max(0, fraction)) * (LOG_MAX - LOG_MIN)))

/** The editable points of a clip's speed: a missing or single-point speed shows as a flat line across the range. */
export function editablePoints(speed: ClipSpeed | undefined, range: SourceRange): SpeedPoint[] {
  if (!speed) return [{ sourceUs: range.startUs, rate: 1 }, { sourceUs: range.endUs, rate: 1 }]
  if (speed.points.length === 1) return [{ sourceUs: range.startUs, rate: speed.points[0].rate }, { sourceUs: range.endUs, rate: speed.points[0].rate }]
  return speed.points.map((point) => ({ ...point }))
}

/** The smallest gap kept between neighbouring points so their order is always strict. */
const minGapUs = (range: SourceRange) => Math.max(1, Math.round((range.endUs - range.startUs) / 500))

/** Moves point `index` to `next`, keeping it between its neighbours and inside the range and the rate bounds. */
export function movePoint(points: readonly SpeedPoint[], index: number, next: { sourceUs: number; rate: number }, range: SourceRange): SpeedPoint[] {
  const gap = minGapUs(range)
  const low = index > 0 ? points[index - 1].sourceUs + gap : range.startUs
  const high = index < points.length - 1 ? points[index + 1].sourceUs - gap : range.endUs
  const sourceUs = Math.round(Math.min(Math.max(next.sourceUs, low), Math.max(low, high)))
  return points.map((point, at) => at === index ? { sourceUs, rate: clampRate(next.rate) } : { ...point })
}

/** Adds a point at `sourceUs` on the current curve (so the shape is unchanged until it is dragged). Null when full or too close to a neighbour. */
export function addPoint(points: readonly SpeedPoint[], sourceUs: number, range: SourceRange): SpeedPoint[] | null {
  if (points.length >= MAX_SPEED_POINTS) return null
  const at = Math.round(Math.min(Math.max(sourceUs, range.startUs), range.endUs))
  const gap = minGapUs(range)
  if (points.some((point) => Math.abs(point.sourceUs - at) < gap)) return null
  const rate = speedRateAt({ points: [...points] }, at)
  return [...points.map((point) => ({ ...point })), { sourceUs: at, rate }].sort((a, b) => a.sourceUs - b.sourceUs)
}

/** Removes point `index`; a curve always keeps at least two points in the editor. */
export function removePoint(points: readonly SpeedPoint[], index: number): SpeedPoint[] | null {
  if (points.length <= 2) return null
  return points.filter((_, at) => at !== index).map((point) => ({ ...point }))
}
