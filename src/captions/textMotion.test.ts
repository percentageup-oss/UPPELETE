import { describe, expect, it } from 'vitest'
import { defaultTextOverlay } from '../core/textCommands'
import { decorativeTextCue, textMotionAt } from './textMotion'

describe('authored text motion', () => {
  it('derives deterministic decorative whole-token timing without marking it aligned', () => {
    const item = defaultTextOverlay('title', 1_000_000, 5_000_000, 'ആപ്പിൾ iPhone 16')
    const first = decorativeTextCue(item)
    expect(decorativeTextCue(item)).toEqual(first)
    const words = first.words ?? []
    expect(words.map((word) => word.text)).toEqual(['ആപ്പിൾ', 'iPhone', '16'])
    expect(words.every((word) => word.timingSource === 'decorative' && !word.needsReview)).toBe(true)
    expect(words[0].startUs).toBe(1_000_000)
    expect(words.at(-1)?.endUs).toBe(5_000_000)
  })

  it('evaluates absolute-time fade/pop and composes ramps proportionally on short items', () => {
    const item = { ...defaultTextOverlay('title', 1_000_000, 1_400_000), enter: { kind: 'pop' as const, durationUs: 300_000 }, exit: { kind: 'fade' as const, durationUs: 300_000 } }
    expect(textMotionAt(item, 999_999).visible).toBe(false)
    expect(textMotionAt(item, 1_000_000).opacity).toBe(0)
    expect(textMotionAt(item, 1_200_000).scale).toBeGreaterThan(.82)
    expect(textMotionAt(item, 1_399_999).opacity).toBeLessThan(.01)
    expect(textMotionAt(item, 1_400_000).visible).toBe(false)
  })

  it.each(['left', 'right', 'up', 'down'] as const)('slides %s from the correct side', (direction) => {
    const item = { ...defaultTextOverlay('title', 0, 1_000_000), enter: { kind: 'slide' as const, direction, durationUs: 200_000 }, exit: { kind: 'none' as const, durationUs: 0 } }
    const start = textMotionAt(item, 0)
    expect(direction === 'left' || direction === 'right' ? start.x : start.y).toBe(direction === 'left' || direction === 'up' ? -64 : 64)
  })
})
