import type { Shape, ShapeAnimation } from '../core/edit'
import { ease } from './textMotion'

/** One shape's evaluated state at a sequence time. `draw` is how much of the outline is traced and
 * `sweep` how much of the shape is revealed left to right; `grow` is the shape's width as a fraction of
 * its full width, anchored at its left edge. All three are 1 when the shape is at rest. */
export type ShapeFrame = { visible: boolean; opacity: number; scale: number; x: number; y: number; draw: number; sweep: number; grow: number }

const REST: ShapeFrame = { visible: true, opacity: 1, scale: 1, x: 0, y: 0, draw: 1, sweep: 1, grow: 1 }
const HIDDEN: ShapeFrame = { visible: false, opacity: 0, scale: 1, x: 0, y: 0, draw: 0, sweep: 0, grow: 0 }

function animationValue(animation: ShapeAnimation, progress: number, entering: boolean): ShapeFrame {
  if (animation.kind === 'none' || animation.durationUs === 0) return REST
  const p = ease(progress)
  // Entering runs 0 -> 1; leaving runs 1 -> 0, so `shown` is how present the shape is.
  const shown = entering ? p : 1 - p
  switch (animation.kind) {
    case 'fade': return { ...REST, opacity: shown }
    case 'pop': return { ...REST, opacity: shown, scale: .82 + .18 * shown }
    case 'draw': return { ...REST, draw: shown }
    case 'sweep': return { ...REST, sweep: shown }
    case 'grow': return { ...REST, grow: shown }
    case 'slide': {
      const distance = 64 * (1 - shown)
      const sign = animation.direction === 'left' || animation.direction === 'up' ? -1 : 1
      const horizontal = animation.direction === 'left' || animation.direction === 'right'
      return { ...REST, opacity: shown, x: horizontal ? sign * distance : 0, y: horizontal ? 0 : sign * distance }
    }
  }
}

/**
 * Closed-form sequence-time evaluation, so preview, reverse seeks and export agree. The two ramps
 * are shortened proportionally when together they exceed the shape's duration, exactly as
 * `textMotionAt` does for text.
 */
export function shapeFrameAt(shape: Pick<Shape, 'startUs' | 'endUs' | 'enter' | 'exit'>, timestampUs: number): ShapeFrame {
  if (timestampUs < shape.startUs || timestampUs >= shape.endUs) return HIDDEN
  const duration = shape.endUs - shape.startUs
  const requestedIn = shape.enter.kind === 'none' ? 0 : shape.enter.durationUs
  const requestedOut = shape.exit.kind === 'none' ? 0 : shape.exit.durationUs
  const requested = requestedIn + requestedOut
  const factor = requested > duration && requested > 0 ? duration / requested : 1
  const enterUs = Math.round(requestedIn * factor), exitUs = Math.round(requestedOut * factor)
  const elapsed = timestampUs - shape.startUs, remaining = shape.endUs - timestampUs
  const a = enterUs > 0 && elapsed < enterUs ? animationValue(shape.enter, elapsed / enterUs, true) : REST
  const b = exitUs > 0 && remaining <= exitUs ? animationValue(shape.exit, 1 - remaining / exitUs, false) : REST
  return { visible: true, opacity: a.opacity * b.opacity, scale: a.scale * b.scale, x: a.x + b.x, y: a.y + b.y, draw: Math.min(a.draw, b.draw), sweep: Math.min(a.sweep, b.sweep), grow: Math.min(a.grow, b.grow) }
}
