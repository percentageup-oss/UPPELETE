import { describe, expect, it } from 'vitest'
import { float32ToHalfFloat } from './webglLut'

describe('float32ToHalfFloat', () => {
  it('matches known IEEE-754 binary16 encodings', () => {
    expect(float32ToHalfFloat(0)).toBe(0x0000)
    expect(float32ToHalfFloat(1)).toBe(0x3c00)
    expect(float32ToHalfFloat(-1)).toBe(0xbc00)
    expect(float32ToHalfFloat(0.5)).toBe(0x3800)
    expect(float32ToHalfFloat(2)).toBe(0x4000)
  })

  it('rounds a value that has no exact half-float representation', () => {
    // 0.1 has no exact binary16 value; the nearest is 0x2e66 (≈0.099976...).
    expect(float32ToHalfFloat(0.1)).toBe(0x2e66)
  })
})
