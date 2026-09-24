import { describe, expect, it } from 'vitest'
import { isFragmentedLine } from './shaping'

const line = 'നമസ്കാരം hello world'

describe('isFragmentedLine', () => {
  it('accepts a line painted as one full run, or twice for a gradient fill', () => {
    expect(isFragmentedLine([line], line)).toBe(false)
    expect(isFragmentedLine([line, line], line)).toBe(false)
  })
  it('accepts a title-motion line whose words have not started yet (nothing painted)', () => {
    expect(isFragmentedLine([''], line)).toBe(false)
  })
  it('accepts title-motion word crops, each of which holds a full copy of the line', () => {
    expect(isFragmentedLine([line, line, line], line)).toBe(false)
  })
  it('rejects a line split into words or graphemes', () => {
    expect(isFragmentedLine(['നമസ്കാരം ', 'hello ', 'world'], line)).toBe(true)
    expect(isFragmentedLine([line, 'ക'], line)).toBe(true)
    expect(isFragmentedLine([line, ''], line)).toBe(true)
  })
})
