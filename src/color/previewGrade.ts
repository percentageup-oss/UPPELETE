/**
 * Bakes a live-preview grade stack into one `Cube3D`, the preview counterpart of `bakeStackLut` in
 * `src/export/plan.ts` — same math (`bakeGrade`/`composeLuts`), same content-keyed memoization, just
 * baked in the renderer process from an in-memory LUT-asset cache instead of the export worker's
 * on-disk one. `GradedVideo`'s WebGL2 texture cache is keyed by this function's own return value
 * (`uploadLut` re-uploads only when it changes), so a stack that keeps resolving to the same cube
 * never re-uploads either.
 */

import { bakeGrade, composeLuts, type Grade as BakedGrade } from './bake'
import type { Cube3D } from './cube'
import type { AdjustmentClip, Grade } from '../core/edit'

/** Capped so a long session of slider-dragging (a new grade, and so a new cache key, on every tick)
 * never grows this without bound — crude but sufficient for v1; see docs/STATUS.md limitations. */
const MAX_CACHE_ENTRIES = 64

const cache = new Map<string, Cube3D | null>()

/** The persisted `Grade` as the runtime shape `bakeGrade`/`composeLuts` evaluate — mirrors
 * `resolveGrade` in `src/export/plan.ts`. `null` means a `lut`-type input names an asset this session
 * has not resolved a parsed cube for yet (missing, still loading, or failed to parse). */
function resolveGrade(grade: Grade, cubes: ReadonlyMap<string, Cube3D>): BakedGrade | null {
  if (grade.input.type !== 'lut') return grade as BakedGrade
  const cube = cubes.get(grade.input.assetId)
  return cube ? { ...grade, input: { type: 'lut', cube } } : null
}

/**
 * Bakes (and memoizes, by a JSON key of the stack's own grades) the single 3D LUT for a bottom-up
 * grade stack. `null` means either the stack is empty (nothing to grade — callers should treat that
 * the same as "not graded", not draw an identity LUT through WebGL for no reason) or at least one
 * grade in it needs a LUT asset this session has not resolved — the caller renders that layer
 * ungraded with a warning rather than guessing at missing data.
 */
export function bakedGradeStack(stack: readonly AdjustmentClip[], cubes: ReadonlyMap<string, Cube3D>): Cube3D | null {
  if (!stack.length) return null
  const key = JSON.stringify(stack.map((clip) => clip.grade))
  if (cache.has(key)) return cache.get(key)!
  if (cache.size >= MAX_CACHE_ENTRIES) cache.clear()
  let composed: Cube3D | null = null
  for (const adjustment of stack) {
    const resolved = resolveGrade(adjustment.grade, cubes)
    if (!resolved) { cache.set(key, null); return null }
    const baked = bakeGrade(resolved)
    composed = composed ? composeLuts(composed, baked) : baked
  }
  cache.set(key, composed)
  return composed
}
