import { isClosedShapeGeometry, type Shape } from './edit'

const REVEALS = ['draw', 'sweep', 'grow']

/** Why a shape cannot be glass, or null when it can (docs/EDITING.md "Shapes"). Glass is a filtered copy of
 * the picture behind it, so it needs a silhouette with an inside, and it cannot be masked, blended or drawn on. */
export function glassProblem(shape: Pick<Shape, 'geometry' | 'mask' | 'blendMode' | 'enter' | 'exit'>): string | null {
  if (!isClosedShapeGeometry(shape.geometry)) return 'Glass needs a closed shape: a box, ellipse, highlight or closed path.'
  if (shape.mask !== undefined) return 'A glass shape cannot have a mask.'
  if (shape.blendMode !== undefined) return 'A glass shape cannot have a blend mode.'
  if (REVEALS.includes(shape.enter.kind) || REVEALS.includes(shape.exit.kind)) return 'A glass shape cannot use the draw, sweep or grow animation; use fade, pop or slide.'
  return null
}
