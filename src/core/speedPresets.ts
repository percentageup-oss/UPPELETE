import type { ClipSpeed } from './edit'
import { SPEED_MAX, SPEED_MIN } from './edit'

/**
 * Ready-made speed ramps. Each is a list of `(position, rate)` where position is 0–1 along the clip's
 * **source** range, so applying one to a clip maps it onto whatever part of the file the clip plays.
 * They are plain data — the curve they produce is an ordinary `ClipSpeed` the user can then edit.
 */
export type SpeedPreset = { id: string; name: string; hint: string; points: readonly (readonly [number, number])[] }

export const SPEED_PRESETS: readonly SpeedPreset[] = [
  { id: 'montage', name: 'Montage', hint: 'Fast, slows through the middle, fast again', points: [[0, 2.5], [0.35, 1], [0.65, 1], [1, 2.5]] },
  { id: 'hero', name: 'Hero', hint: 'Normal, drops to slow motion, then back', points: [[0, 1], [0.3, 1], [0.45, 0.25], [0.7, 0.25], [0.85, 1], [1, 1]] },
  { id: 'bullet', name: 'Bullet', hint: 'Extreme slow motion in the middle', points: [[0, 1], [0.35, 0.15], [0.65, 0.15], [1, 1]] },
  { id: 'flash-in', name: 'Flash in', hint: 'Starts fast and settles to normal', points: [[0, 6], [0.4, 1], [1, 1]] },
  { id: 'flash-out', name: 'Flash out', hint: 'Normal, then speeds away', points: [[0, 1], [0.6, 1], [1, 6]] },
  { id: 'jump-cut', name: 'Jump cut', hint: 'Quick punch-in pace at both ends', points: [[0, 4], [0.15, 1], [0.85, 1], [1, 4]] },
]

const clampRate = (rate: number) => Math.min(SPEED_MAX, Math.max(SPEED_MIN, rate))

/** A preset laid over a clip's source range. Positions collapse to distinct integer µs, so a very short clip stays valid. */
export function presetSpeed(preset: SpeedPreset, sourceStartUs: number, sourceEndUs: number): ClipSpeed {
  const span = sourceEndUs - sourceStartUs
  const points: { sourceUs: number; rate: number }[] = []
  for (const [position, rate] of preset.points) {
    const sourceUs = Math.round(sourceStartUs + position * span)
    if (points.length && sourceUs <= points[points.length - 1].sourceUs) continue
    points.push({ sourceUs, rate: clampRate(rate) })
  }
  return { points }
}

/** Steady speed at `rate` (clamped to the supported range). */
export const constantSpeed = (rate: number): ClipSpeed => ({ points: [{ sourceUs: 0, rate: clampRate(rate) }] })
