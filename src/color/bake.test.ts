import { describe, expect, it } from 'vitest'
import { bakeGrade, composeLuts, evaluateGrade, NEUTRAL_GRADE, sampleLut, type Grade } from './bake'
import { cubeIndex, type Cube3D } from './cube'
import { NEUTRAL_PRIMARIES } from './primaries'

describe('evaluateGrade', () => {
  it('is the identity at intensity 0 regardless of the rest of the grade', () => {
    const grade: Grade = {
      input: { type: 'log', profile: 's-log3' },
      primaries: { ...NEUTRAL_PRIMARIES, exposureStops: 3, saturation: -1 },
      look: { id: 'slide-vivid', strength: 1 },
      intensity: 0,
    }
    const [r, g, b] = evaluateGrade([0.4, 0.5, 0.6], grade)
    expect(r).toBe(0.4); expect(g).toBe(0.5); expect(b).toBe(0.6)
  })

  it('NEUTRAL_GRADE (input none, neutral primaries, no look, full intensity) is the Rec.709 OETF of the domain value', () => {
    const [r] = evaluateGrade([0.18, 0.18, 0.18], NEUTRAL_GRADE)
    // input 'none' treats the domain value as already display-referred, decodes to scene-linear, then
    // NEUTRAL_PRIMARIES re-encodes it — net effect is the identity.
    expect(r).toBeCloseTo(0.18, 5)
  })

  it('intensity linearly interpolates between the untouched domain value and the fully graded one', () => {
    const grade: Grade = { input: { type: 'none' }, primaries: { ...NEUTRAL_PRIMARIES, exposureStops: 2 }, look: null, intensity: 1 }
    const full = evaluateGrade([0.3, 0.3, 0.3], grade)
    const half = evaluateGrade([0.3, 0.3, 0.3], { ...grade, intensity: 0.5 })
    expect(half[0]).toBeCloseTo(0.3 + (full[0] - 0.3) * 0.5, 6)
  })
})

describe('bakeGrade', () => {
  it('bakes the neutral grade close to the identity LUT', () => {
    const cube = bakeGrade(NEUTRAL_GRADE, 5)
    const step = 1 / 4
    for (let b = 0; b < 5; b++) for (let g = 0; g < 5; g++) for (let r = 0; r < 5; r++) {
      const i = cubeIndex(5, r, g, b)
      expect(cube.data[i]).toBeCloseTo(r * step, 4)
      expect(cube.data[i + 1]).toBeCloseTo(g * step, 4)
      expect(cube.data[i + 2]).toBeCloseTo(b * step, 4)
    }
  })

  it('bakes a zero-intensity grade to exactly the identity LUT, whatever the rest of the grade is', () => {
    const grade: Grade = { input: { type: 'log', profile: 'v-log' }, primaries: { ...NEUTRAL_PRIMARIES, exposureStops: 5 }, look: { id: 'mono-deep', strength: 1 }, intensity: 0 }
    const cube = bakeGrade(grade, 4)
    const step = 1 / 3
    for (let b = 0; b < 4; b++) for (let g = 0; g < 4; g++) for (let r = 0; r < 4; r++) {
      const i = cubeIndex(4, r, g, b)
      expect(cube.data[i]).toBeCloseTo(r * step, 6)
      expect(cube.data[i + 1]).toBeCloseTo(g * step, 6)
      expect(cube.data[i + 2]).toBeCloseTo(b * step, 6)
    }
  })

  it('produces a cube whose declared size matches its data length', () => {
    const cube = bakeGrade(NEUTRAL_GRADE, 9)
    expect(cube.data.length).toBe(9 ** 3 * 3)
  })
})

describe('sampleLut', () => {
  function identityCube(size: number): Cube3D {
    const data = new Float32Array(size ** 3 * 3)
    const step = 1 / (size - 1)
    for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) {
      const i = cubeIndex(size, r, g, b)
      data[i] = r * step; data[i + 1] = g * step; data[i + 2] = b * step
    }
    return { size, title: '', domainMin: [0, 0, 0], domainMax: [1, 1, 1], data }
  }

  it('the identity cube samples back exactly what went in, including off-lattice points', () => {
    const cube = identityCube(5)
    const [r, g, b] = sampleLut(cube, [0.37, 0.81, 0.02])
    expect(r).toBeCloseTo(0.37, 5)
    expect(g).toBeCloseTo(0.81, 5)
    expect(b).toBeCloseTo(0.02, 5)
  })

  it('clamps input outside the domain to the lattice edge', () => {
    const cube = identityCube(3)
    const [r] = sampleLut(cube, [2, 0, 0])
    expect(r).toBeCloseTo(1, 5)
    const [r2] = sampleLut(cube, [-1, 0, 0])
    expect(r2).toBeCloseTo(0, 5)
  })
})

describe('composeLuts', () => {
  it('composing two identity-ish grades is the identity', () => {
    const a = bakeGrade(NEUTRAL_GRADE, 5)
    const b = bakeGrade(NEUTRAL_GRADE, 5)
    const composed = composeLuts(a, b, 5)
    const [r, g, bch] = sampleLut(composed, [0.6, 0.2, 0.9])
    expect(r).toBeCloseTo(0.6, 3)
    expect(g).toBeCloseTo(0.2, 3)
    expect(bch).toBeCloseTo(0.9, 3)
  })

  it('applies the first grade then the second, matching manual sequential sampling', () => {
    const bright: Grade = { input: { type: 'none' }, primaries: { ...NEUTRAL_PRIMARIES, exposureStops: 0.4 }, look: null, intensity: 1 }
    const contrasty: Grade = { input: { type: 'none' }, primaries: { ...NEUTRAL_PRIMARIES, contrast: 0.3 }, look: null, intensity: 1 }
    const a = bakeGrade(bright, 9)
    const b = bakeGrade(contrasty, 9)
    const composed = composeLuts(a, b, 9)
    const point: [number, number, number] = [0.4, 0.4, 0.4]
    const manual = sampleLut(b, sampleLut(a, point))
    const direct = sampleLut(composed, point)
    direct.forEach((v, i) => expect(v).toBeCloseTo(manual[i], 4))
  })
})
