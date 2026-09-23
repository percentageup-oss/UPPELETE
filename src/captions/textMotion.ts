import { captionTokens } from '../core/captionText'
import type { TextAnimation, TextOverlay } from '../core/edit'
import type { MotionCue } from './renderer'

export type TextMotionFrame = { opacity: number; scale: number; x: number; y: number; visible: boolean }

/** Runtime-only timing for template word motion. These boundaries follow complete lexical tokens
 * from captionTokens (which uses grapheme-aware segmentation); they are never stored as caption timing. */
export function decorativeTextCue(item: TextOverlay): MotionCue {
  const tokens = captionTokens(item.text), durationUs = item.endUs - item.startUs
  const words = tokens.map((token, index) => ({
    ...token, id: `${item.id}:decorative:${index}`,
    startUs: item.startUs + Math.floor(durationUs * index / Math.max(1, tokens.length)),
    endUs: item.startUs + Math.max(1, Math.floor(durationUs * (index + 1) / Math.max(1, tokens.length))),
    timingSource: 'decorative' as const, needsReview: false,
  }))
  return { text: item.text, startUs: item.startUs, endUs: item.endUs, words }
}

function ease(value: number): number {
  const t = Math.max(0, Math.min(1, value))
  return t * t * (3 - 2 * t)
}
function animationValue(animation: TextAnimation, progress: number, entering: boolean): TextMotionFrame {
  if (animation.kind === 'none' || animation.durationUs === 0) return { opacity: 1, scale: 1, x: 0, y: 0, visible: true }
  const p = ease(progress)
  if (animation.kind === 'fade') return { opacity: entering ? p : 1 - p, scale: 1, x: 0, y: 0, visible: true }
  if (animation.kind === 'pop') return { opacity: entering ? p : 1 - p, scale: entering ? .82 + .18 * p : 1 - .18 * p, x: 0, y: 0, visible: true }
  const distance = 64 * (entering ? 1 - p : p)
  const sign = animation.direction === 'left' || animation.direction === 'up' ? -1 : 1
  return { opacity: entering ? p : 1 - p, scale: 1,
    x: animation.direction === 'left' || animation.direction === 'right' ? sign * distance : 0,
    y: animation.direction === 'up' || animation.direction === 'down' ? sign * distance : 0, visible: true }
}

/** Closed-form sequence-time evaluation, so preview, reverse seeks and export agree. The two ramps
 * are shortened proportionally when their requested durations exceed the item's hold duration. */
export function textMotionAt(item: TextOverlay, timestampUs: number): TextMotionFrame {
  const duration = item.endUs - item.startUs
  if (timestampUs < item.startUs || timestampUs >= item.endUs) return { opacity: 0, scale: 1, x: 0, y: 0, visible: false }
  const requestedIn = item.enter.kind === 'none' ? 0 : item.enter.durationUs
  const requestedOut = item.exit.kind === 'none' ? 0 : item.exit.durationUs
  const requested = requestedIn + requestedOut
  const factor = requested > duration && requested > 0 ? duration / requested : 1
  const enterUs = Math.round(requestedIn * factor), exitUs = Math.round(requestedOut * factor)
  const elapsed = timestampUs - item.startUs, remaining = item.endUs - timestampUs
  const enter = enterUs > 0 && elapsed < enterUs ? animationValue(item.enter, elapsed / enterUs, true) : null
  const exit = exitUs > 0 && remaining <= exitUs ? animationValue(item.exit, 1 - remaining / exitUs, false) : null
  const a = enter ?? { opacity: 1, scale: 1, x: 0, y: 0, visible: true }
  const b = exit ?? { opacity: 1, scale: 1, x: 0, y: 0, visible: true }
  return { visible: true, opacity: a.opacity * b.opacity, scale: a.scale * b.scale, x: a.x + b.x, y: a.y + b.y }
}
