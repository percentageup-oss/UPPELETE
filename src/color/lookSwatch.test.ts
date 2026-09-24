import { describe, expect, it } from 'vitest'
import { lookSwatchGradient } from './lookSwatch'
import { LOOKS } from './looks'

describe('lookSwatchGradient', () => {
  it('returns a 6-stop linear-gradient for every bundled look', () => {
    for (const look of LOOKS) {
      const css = lookSwatchGradient(look.id)
      expect(css.startsWith('linear-gradient(90deg, ')).toBe(true)
      expect(css.match(/rgb\(/g)?.length).toBe(6)
      expect(css).toContain('0%')
      expect(css).toContain('100%')
    }
  })

  it('two different looks produce different gradients', () => {
    const [a, b] = LOOKS
    expect(lookSwatchGradient(a.id)).not.toBe(lookSwatchGradient(b.id))
  })
})

describe('lookColorSwatchGradient', () => {
  it('samples 8 hue patches and differs per look', async () => {
    const { lookColorSwatchGradient } = await import('./lookSwatch')
    const [a, b] = LOOKS
    expect(lookColorSwatchGradient(a.id).match(/rgb\(/g)?.length).toBe(8)
    expect(lookColorSwatchGradient(a.id)).not.toBe(lookColorSwatchGradient(b.id))
  })
})
