import { describe, expect, it } from 'vitest'
import { positionWordActionMenu } from './wordActionMenu'

describe('positionWordActionMenu', () => {
  it('places the menu below a word when there is room', () => {
    expect(positionWordActionMenu(
      { top: 100, right: 160, bottom: 120, left: 100 },
      { width: 240, height: 300 },
      { width: 1000, height: 800 },
    )).toEqual({ left: 100, top: 126 })
  })

  it('flips above a bottom caption instead of entering the timeline area', () => {
    expect(positionWordActionMenu(
      { top: 500, right: 160, bottom: 520, left: 100 },
      { width: 240, height: 300 },
      { width: 1000, height: 700 },
    )).toEqual({ left: 100, top: 194 })
  })

  it('keeps an oversized edge menu inside the viewport', () => {
    expect(positionWordActionMenu(
      { top: 4, right: 994, bottom: 24, left: 950 },
      { width: 240, height: 684 },
      { width: 1000, height: 700 },
    )).toEqual({ left: 752, top: 8 })
  })
})
