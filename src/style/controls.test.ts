import { describe, expect, it } from 'vitest'
import { parsePercent } from './controls'

describe('parsePercent', () => {
  it('turns a typed percentage into a fraction', () => {
    expect(parsePercent('70')).toBe(.7)
    expect(parsePercent('7')).toBe(.07)
    expect(parsePercent('12.5')).toBe(.125)
    expect(parsePercent('0')).toBe(0)
    expect(parsePercent('100')).toBe(1)
  })

  it('clamps out-of-range input to the 0–1 range', () => {
    expect(parsePercent('150')).toBe(1)
    expect(parsePercent('-5')).toBe(0)
  })

  it('returns null for half-typed text so it never reaches the project', () => {
    for (const text of ['', '  ', '-', '.', 'abc']) expect(parsePercent(text)).toBeNull()
  })
})
