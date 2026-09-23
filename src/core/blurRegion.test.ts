import { describe, expect, it } from 'vitest'
import { COMPOSITION_WIDTH, type BlurRegion } from './edit'
import { defaultBlurAreaRect, defaultBlurFrameRect, DEFAULT_BLUR_REGION_US, MIN_BLUR_REGION_US, previewBlurDrag } from './blurRegion'

const composition = { width: 1080, height: 607.5 }

describe('defaultBlurAreaRect', () => {
  it('centers a rect a third of the composition width wide, at the composition aspect', () => {
    const rect = defaultBlurAreaRect(composition)
    expect(rect.width).toBeCloseTo(COMPOSITION_WIDTH / 3)
    expect(rect.height).toBeCloseTo(rect.width * (composition.height / COMPOSITION_WIDTH))
    expect(rect.x).toBeCloseTo((COMPOSITION_WIDTH - rect.width) / 2)
    expect(rect.y).toBeCloseTo((composition.height - rect.height) / 2)
  })
})

describe('defaultBlurFrameRect', () => {
  it('covers the whole output frame', () => {
    const rect = defaultBlurFrameRect(composition)
    expect(rect).toEqual({ x: 0, y: 0, width: COMPOSITION_WIDTH, height: composition.height })
  })
})

describe('constants', () => {
  it('keeps the default preset length comfortably above the minimum', () => {
    expect(DEFAULT_BLUR_REGION_US).toBeGreaterThan(MIN_BLUR_REGION_US)
  })
})

describe('previewBlurDrag', () => {
  const region: BlurRegion = { id: 'b1', startUs: 2_000_000, endUs: 4_000_000, rect: { x: 0, y: 0, width: 100, height: 100 }, radius: 24, enabled: true }

  it('moves both edges by the same delta, preserving length', () => {
    const preview = previewBlurDrag(region, 'move', 500_000)
    expect(preview.startUs).toBe(2_500_000)
    expect(preview.endUs).toBe(4_500_000)
  })

  it('never moves the start before zero', () => {
    const preview = previewBlurDrag(region, 'move', -3_000_000)
    expect(preview.startUs).toBe(0)
    expect(preview.endUs).toBe(2_000_000)
  })

  it('trims the end edge only, clamped to the minimum length', () => {
    expect(previewBlurDrag(region, 'end', 500_000).endUs).toBe(4_500_000)
    expect(previewBlurDrag(region, 'end', -10_000_000).endUs).toBe(region.startUs + MIN_BLUR_REGION_US)
  })

  it('trims the start edge only, clamped to the minimum length', () => {
    expect(previewBlurDrag(region, 'start', -500_000).startUs).toBe(1_500_000)
    expect(previewBlurDrag(region, 'start', 10_000_000).startUs).toBe(region.endUs - MIN_BLUR_REGION_US)
  })

  it('has no other-region gap to fit into — an overlapping target is left exactly as dragged', () => {
    // Unlike `previewZoomDrag`, this takes no `others` argument at all: overlap is allowed by design.
    const preview = previewBlurDrag(region, 'move', -1_000_000)
    expect(preview).toEqual({ ...region, startUs: 1_000_000, endUs: 3_000_000 })
  })
})
