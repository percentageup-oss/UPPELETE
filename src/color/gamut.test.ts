import { describe, expect, it } from 'vitest'
import { applyMatrix3, gamutToRec709Matrix, highlightRolloff, type CameraGamut } from './gamut'

const GAMUTS: CameraGamut[] = ['rec2020', 'f-gamut-c', 's-gamut3-cine', 'v-gamut', 'cinema-gamut']

describe('gamutToRec709Matrix', () => {
  for (const gamut of GAMUTS) {
    it(`${gamut}: maps its own white (1,1,1) to Rec.709 white (1,1,1)`, () => {
      const [r, g, b] = applyMatrix3(gamutToRec709Matrix(gamut), 1, 1, 1)
      expect(r).toBeCloseTo(1, 5)
      expect(g).toBeCloseTo(1, 5)
      expect(b).toBeCloseTo(1, 5)
    })

    it(`${gamut}: maps 18% grey (0.18,0.18,0.18) to 18% grey`, () => {
      const [r, g, b] = applyMatrix3(gamutToRec709Matrix(gamut), 0.18, 0.18, 0.18)
      expect(r).toBeCloseTo(0.18, 5)
      expect(g).toBeCloseTo(0.18, 5)
      expect(b).toBeCloseTo(0.18, 5)
    })
  }

  it('a wide gamut (larger triangle than Rec.709) produces some out-of-[0,1] component for a saturated Rec.709 primary — that is expected, not a bug', () => {
    // Rec.709 pure red (1,0,0) expressed in a wider gamut's coordinates has a negative component in
    // at least one channel once converted back, which is exactly what "wider gamut" means.
    const m = gamutToRec709Matrix('s-gamut3-cine')
    const [r, g, b] = applyMatrix3(m, 1, 0, 0)
    expect([r, g, b].some((v) => v > 1 || v < 0)).toBe(true)
  })
})

describe('highlightRolloff', () => {
  it('is the identity below the knee', () => {
    expect(highlightRolloff(0.5, 0.85)).toBeCloseTo(0.5, 9)
    expect(highlightRolloff(0, 0.85)).toBeCloseTo(0, 9)
  })

  it('is the identity everywhere when knee is 1 (disabled)', () => {
    expect(highlightRolloff(5, 1)).toBe(5)
    expect(highlightRolloff(0.5, 1)).toBe(0.5)
  })

  it('compresses values above the knee toward 1/knee without ever reaching it', () => {
    const knee = 0.8
    const a = highlightRolloff(2, knee)
    const b = highlightRolloff(20, knee)
    const ceiling = 1
    expect(a).toBeGreaterThan(knee)
    expect(a).toBeLessThan(ceiling)
    expect(b).toBeGreaterThan(a)
    expect(b).toBeLessThan(ceiling)
  })

  it('is continuous at the knee', () => {
    const knee = 0.85
    expect(highlightRolloff(knee + 1e-6, knee)).toBeCloseTo(knee, 4)
  })
})
