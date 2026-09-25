import { describe, expect, it } from 'vitest'
import { graphicsPasses, passOf, blendingShapes, MAX_BLENDING_SHAPES } from './graphicsPasses'
import { defaultShape } from './shapeCommands'
import type { Shape } from './edit'

const shape = (id: string, layerOrder: number, blendMode?: Shape['blendMode'], startUs = 0): Shape =>
  ({ ...defaultShape('box', id, startUs, startUs + 1_000_000), layerOrder, ...(blendMode ? { blendMode } : {}) })

describe('graphicsPasses', () => {
  it('is one pass with no blending shapes', () => {
    const passes = graphicsPasses([shape('a', 1), shape('b', -1)])
    expect(passes.count).toBe(1)
    expect(passes.blendShapes).toEqual([])
  })

  it('is K = 2k+1 passes for k blending shapes, sorted into layer order', () => {
    const s1 = shape('s1', 5, 'multiply')
    const s2 = shape('s2', -5, 'screen')
    const passes = graphicsPasses([shape('plain', 0), s1, s2])
    expect(passes.count).toBe(5)
    expect(passes.blendShapes.map((s) => s.id)).toEqual(['s2', 's1'])
  })

  it('places pinned content in band 0 and fade in the last band, regardless of blending shapes', () => {
    const passes = graphicsPasses([shape('s1', 5, 'multiply'), shape('s2', -5, 'screen')])
    expect(passOf({ kind: 'pinned' }, passes)).toBe(0)
    expect(passOf({ kind: 'fade' }, passes)).toBe(passes.count - 1)
    expect(passOf({ kind: 'fade' }, passes)).toBe(4)
  })

  it('places a blend shape below captions in band 1, with the caption plane and everything above it in band 2', () => {
    const below = shape('below', -1, 'multiply')
    const passes = graphicsPasses([below])
    expect(passes.count).toBe(3)
    expect(passOf({ kind: 'caption' }, passes)).toBe(2)
    expect(passOf({ kind: 'graphic', item: shape('above-title', 1) }, passes)).toBe(2)
  })

  it('places a blend shape above captions in the last band, with captions and below-caption content in band 0', () => {
    const above = shape('above', 1, 'multiply')
    const passes = graphicsPasses([above])
    expect(passes.count).toBe(3)
    expect(passOf({ kind: 'caption' }, passes)).toBe(0)
    expect(passOf({ kind: 'graphic', item: shape('below-title', -1) }, passes)).toBe(0)
  })

  it('separates two adjacent blend shapes into their own bands, with normal content sandwiched between them', () => {
    const lower = shape('lower', -2, 'multiply')
    const upper = shape('upper', 2, 'screen')
    const passes = graphicsPasses([lower, upper])
    expect(passes.count).toBe(5)
    expect(passOf({ kind: 'caption' }, passes)).toBe(2)
    expect(passOf({ kind: 'graphic', item: shape('between', 0) }, passes)).toBe(2)
    expect(passOf({ kind: 'graphic', item: shape('far-below', -10) }, passes)).toBe(0)
    expect(passOf({ kind: 'graphic', item: shape('far-above', 10) }, passes)).toBe(4)
  })

  it('breaks a layerOrder tie between a blend shape and a graphic with startUs, then id, matching compareLayered', () => {
    const tiedShape = shape('tied-shape', 0, 'multiply', 5_000_000)
    const earlierGraphic = shape('earlier', 0, undefined, 1_000_000)
    const laterGraphic = shape('later', 0, undefined, 9_000_000)
    const passes = graphicsPasses([tiedShape])
    expect(passes.count).toBe(3)
    // Starts earlier than the blend shape at the same layerOrder, so it sorts (and paints) below it.
    expect(passOf({ kind: 'graphic', item: earlierGraphic }, passes)).toBe(0)
    // Starts later, so it sorts above the blend shape.
    expect(passOf({ kind: 'graphic', item: laterGraphic }, passes)).toBe(2)
  })

  it('caps at MAX_BLENDING_SHAPES', () => {
    expect(MAX_BLENDING_SHAPES).toBe(8)
  })

  it('blendingShapes only counts shapes with a stored blend mode', () => {
    expect(blendingShapes([shape('a', 0), shape('b', 0, 'multiply')]).map((s) => s.id)).toEqual(['b'])
  })
})
