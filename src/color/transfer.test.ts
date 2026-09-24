import { describe, expect, it } from 'vitest'
import { decodeSceneLinear, encodeLog, type LogProfile } from './transfer'

const PROFILES: LogProfile[] = ['f-log', 'f-log2', 's-log3', 'apple-log', 'v-log', 'c-log3']

describe('decodeSceneLinear / encodeLog round trip', () => {
  for (const profile of PROFILES) {
    it(`${profile} round-trips scene-linear values, including above 1.0`, () => {
      for (const linear of [0, 0.001, 0.02, 0.18, 0.5, 0.9, 2, 4]) {
        const code = encodeLog(profile, linear)
        expect(decodeSceneLinear(profile, code)).toBeCloseTo(linear, 4)
      }
    })

    it(`${profile} is finite everywhere across its own toe/shoulder joins`, () => {
      for (let code = 0; code <= 1; code += 0.001) expect(Number.isFinite(decodeSceneLinear(profile, code))).toBe(true)
    })

    it(`${profile} is monotonically increasing`, () => {
      let previous = decodeSceneLinear(profile, 0)
      for (let code = 0.01; code <= 1; code += 0.01) {
        const linear = decodeSceneLinear(profile, code)
        expect(linear).toBeGreaterThan(previous)
        previous = linear
      }
    })
  }
})

describe('published anchor values (vendor data sheets / white papers)', () => {
  it('F-Log: 18% grey encodes to ~470/1023 (F-Log Data Sheet, widely-cited 10-bit anchor)', () => {
    expect(encodeLog('f-log', 0.18) * 1023).toBeCloseTo(470, 0)
  })

  it('S-Log3: 18% grey encodes to exactly 420/1023 (the formula is defined so 0.18 is its own pivot)', () => {
    expect(encodeLog('s-log3', 0.18)).toBeCloseTo(420 / 1023, 6)
    expect(decodeSceneLinear('s-log3', 420 / 1023)).toBeCloseTo(0.18, 6)
  })

  it('Apple Log: 18% grey encodes to 0.4882724... (Apple Log Profile White Paper worked example)', () => {
    expect(encodeLog('apple-log', 0.18)).toBeCloseTo(0.4882724585, 6)
  })

  it('V-Log: 18% grey encodes to 0.4233114... (VARICAM V-Log/V-Gamut Reference Manual worked example)', () => {
    expect(encodeLog('v-log', 0.18)).toBeCloseTo(0.4233114488, 6)
  })

  it('Canon Log 3 (rev. 1.2): the white paper\'s worked code value decodes back to 18% grey', () => {
    expect(decodeSceneLinear('c-log3', 34.338937037393549 / 100)).toBeCloseTo(0.18, 5)
  })

  it('every curve maps 18% grey to a mid-range code value (a log curve\'s defining property)', () => {
    for (const profile of PROFILES) {
      const code = encodeLog(profile, 0.18)
      expect(code).toBeGreaterThan(0.3)
      expect(code).toBeLessThan(0.6)
    }
  })
})
