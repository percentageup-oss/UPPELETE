import { describe, expect, it } from 'vitest'
import { bakedGradeStack } from './previewGrade'
import { sampleLut } from './bake'
import type { Cube3D } from './cube'
import type { AdjustmentClip, Grade, PrimariesGrade } from '../core/edit'

const US = 1_000_000
const NEUTRAL_PRIMARIES: PrimariesGrade = {
  contrast: 0, highlights: 0, shadows: 0, saturation: 0, lift: [0, 0, 0], gamma: [0, 0, 0], gain: [0, 0, 0], exposureStops: 0, temperature: 0, tint: 0,
}
const NEUTRAL_GRADE: Grade = { input: { type: 'none' }, primaries: NEUTRAL_PRIMARIES, look: null, intensity: 1 }
const graded = (exposureStops: number): Grade => ({ ...NEUTRAL_GRADE, primaries: { ...NEUTRAL_PRIMARIES, exposureStops } })
const adjustment = (id: string, grade: Grade): AdjustmentClip => ({ kind: 'adjustment', id, trackId: 'V2', timelineStartUs: 0, sourceStartUs: 0, sourceEndUs: 10 * US, grade })

describe('bakedGradeStack', () => {
  it('an empty stack bakes nothing', () => {
    expect(bakedGradeStack([], new Map())).toBeNull()
  })

  it('bakes a single grade to a cube that brightens a mid-grey input', () => {
    const cube = bakedGradeStack([adjustment('a', graded(1))], new Map())!
    expect(cube).not.toBeNull()
    const [r] = sampleLut(cube, [0.5, 0.5, 0.5])
    expect(r).toBeGreaterThan(0.5)
  })

  it('composes two stacked grades to strictly more than either alone', () => {
    const both = bakedGradeStack([adjustment('a', graded(1)), adjustment('b', graded(1))], new Map())!
    const one = bakedGradeStack([adjustment('solo', graded(1))], new Map())!
    const [rBoth] = sampleLut(both, [0.3, 0.3, 0.3])
    const [rOne] = sampleLut(one, [0.3, 0.3, 0.3])
    expect(rBoth).toBeGreaterThan(rOne)
  })

  it('is null when a lut-type input names an asset with no resolved cube yet', () => {
    const grade: Grade = { ...NEUTRAL_GRADE, input: { type: 'lut', assetId: 'missing-lut' } }
    expect(bakedGradeStack([adjustment('a', grade)], new Map())).toBeNull()
  })

  it('resolves a lut-type input once its cube is in the resolved map', () => {
    const identity: Cube3D = { size: 2, title: '', domainMin: [0, 0, 0], domainMax: [1, 1, 1], data: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1, 1, 1, 1]) }
    const grade: Grade = { ...NEUTRAL_GRADE, input: { type: 'lut', assetId: 'user-lut' } }
    const cube = bakedGradeStack([adjustment('a', grade)], new Map([['user-lut', identity]]))
    expect(cube).not.toBeNull()
    const replaced: Cube3D = { ...identity, data: Float32Array.from(identity.data, (value) => 1 - value) }
    const afterRelink = bakedGradeStack([adjustment('a', grade)], new Map([['user-lut', replaced]]))
    expect(afterRelink).not.toBe(cube)
  })

  it('memoizes by the stack content: two calls with equal (but not identical) grades share a cube', () => {
    const first = bakedGradeStack([adjustment('a', graded(2))], new Map())
    const second = bakedGradeStack([adjustment('a', graded(2))], new Map())
    expect(first).toBe(second)
  })
})
