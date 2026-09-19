import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseProbeJson } from '../../workers/media/probe'
import { COMPOSITION_WIDTH, compositionFor, compositionScalarToPixels, compositionToPixels, displayAspect, displayDimensions, evenDimensions } from './composition'

const fixture = (name: string) => readFile(path.join(__dirname, '../../tests/fixtures', name), 'utf8')
const rect = { x: 100, y: 50, width: 320, height: 180 }

describe('displayDimensions', () => {
  it('swaps width and height for a 90-degree-rotated source', async () => {
    const metadata = parseProbeJson(await fixture('ffprobe-rotated.json'))
    expect(metadata.width).toBe(1920)
    expect(metadata.height).toBe(1080)
    expect(metadata.rotationDegrees).toBe(-90)
    expect(displayDimensions(metadata)).toEqual({ width: 1080, height: 1920 })
    expect(displayAspect(metadata)).toBeCloseTo(1080 / 1920)
  })

  it('leaves an unrotated source alone and reports nothing without probed dimensions', async () => {
    const metadata = parseProbeJson(await fixture('ffprobe-vfr.json'))
    expect(displayDimensions(metadata)).toEqual({ width: metadata.width, height: metadata.height })
    expect(displayDimensions(null)).toBeNull()
    expect(displayDimensions({ ...metadata, width: null })).toBeNull()
  })

  it('agrees with planFromMedia on the exported orientation', async () => {
    const { planFromMedia } = await import('../export/plan')
    const metadata = parseProbeJson(await fixture('ffprobe-rotated.json'))
    const plan = planFromMedia(metadata)
    expect(evenDimensions(displayDimensions(metadata)!)).toEqual({ width: plan.width, height: plan.height })
  })
})

describe('even rounding', () => {
  it('rounds each axis to the nearest even number with a 16px floor, as H.264 requires', () => {
    expect(evenDimensions({ width: 1919, height: 1081 })).toEqual({ width: 1920, height: 1082 })
    expect(evenDimensions({ width: 1280.4, height: 720.6 })).toEqual({ width: 1280, height: 720 })
    expect(evenDimensions({ width: 3, height: 1 })).toEqual({ width: 16, height: 16 })
  })
})

describe('composition to output pixels', () => {
  it('is one scalar because the composition aspect equals the display aspect', () => {
    expect(compositionFor(16 / 9)).toEqual({ width: COMPOSITION_WIDTH, height: 1080 / (16 / 9) })
    expect(compositionScalarToPixels(12, { width: 1080, height: 1920 })).toBe(12)
    expect(compositionScalarToPixels(12, { width: 720, height: 1280 })).toBe(8)
    expect(compositionScalarToPixels(12, { width: 2160, height: 3840 })).toBe(24)
  })

  it('maps a rect at 1080 and 720 outputs', () => {
    expect(compositionToPixels(rect, { width: 1080, height: 607 })).toEqual({ x: 100, y: 50, width: 320, height: 180 })
    expect(compositionToPixels(rect, { width: 720, height: 405 })).toEqual({ x: 67, y: 33, width: 213, height: 120 })
  })

  it('maps a rect for a rotated (portrait) output', () => {
    // A 1080x1920 output is exactly 1:1 with composition units, rotation already applied on decode.
    expect(compositionToPixels({ x: 0, y: 1700, width: 1080, height: 220 }, { width: 1080, height: 1920 }))
      .toEqual({ x: 0, y: 1700, width: 1080, height: 220 })
  })

  it('clamps a crop to the output bounds so FFmpeg can never read outside the frame', () => {
    const output = { width: 720, height: 405 }
    expect(compositionToPixels({ x: 1000, y: 500, width: 80, height: 300 }, output))
      .toEqual({ x: 667, y: 333, width: 53, height: 72 })
    expect(compositionScalarToPixels(0, output)).toBe(0)
    expect(() => compositionScalarToPixels(1, { width: 0, height: 0 })).toThrow()
  })
})
