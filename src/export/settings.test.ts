import { describe, expect, it } from 'vitest'
import { DEFAULT_EXPORT_SETTINGS, estimateSizeBytes, exportSettingsSchema, exportWarnings, resolveExportFormat, resolveVideoBitrateKbps, settingsForPreset } from './settings'

const fps = (numerator: number, denominator = 1) => ({ numerator, denominator })
const landscape = { width: 3840, height: 2160, frameRate: fps(30000, 1001) }
const portrait = { width: 1080, height: 1920, frameRate: fps(30) }

describe('export settings', () => {
  it('source is the identity', () => {
    expect(resolveExportFormat(landscape, DEFAULT_EXPORT_SETTINGS)).toBe(landscape)
    expect(resolveExportFormat(landscape, undefined)).toBe(landscape)
  })
  it('scales the short edge and keeps the shape', () => {
    expect(resolveExportFormat(landscape, { ...DEFAULT_EXPORT_SETTINGS, resolution: 720 })).toEqual({ width: 1280, height: 720, frameRate: fps(30000, 1001) })
    expect(resolveExportFormat(portrait, { ...DEFAULT_EXPORT_SETTINGS, resolution: 2160 })).toEqual({ width: 2160, height: 3840, frameRate: fps(30) })
  })
  it('caps the long edge at 3840 with even dimensions', () => {
    const ultrawide = { width: 2560, height: 1080, frameRate: fps(30) }
    const out = resolveExportFormat(ultrawide, { ...DEFAULT_EXPORT_SETTINGS, resolution: 2160 })
    expect(out.width).toBe(3840)
    expect(out.width % 2 === 0 && out.height % 2 === 0).toBe(true)
  })
  it('applies a frame rate and picks the preset bitrate by output rate', () => {
    const reels = settingsForPreset('instagram-reels')
    const out = resolveExportFormat(portrait, reels)
    expect(out.frameRate).toEqual(fps(30))
    expect(resolveVideoBitrateKbps(reels, out)).toBe(8000)
    const yt = settingsForPreset('youtube-1080')
    expect(resolveVideoBitrateKbps(yt, { ...landscape, frameRate: fps(30) })).toBe(8000)
    expect(resolveVideoBitrateKbps(yt, { ...landscape, frameRate: fps(60) })).toBe(12000)
    expect(resolveVideoBitrateKbps({ ...yt, videoBitrateKbps: 5000 }, landscape)).toBe(5000)
    expect(resolveVideoBitrateKbps(DEFAULT_EXPORT_SETTINGS, landscape)).toBeNull()
  })
  it('warns on shape mismatch and upscaling', () => {
    expect(exportWarnings(landscape, settingsForPreset('instagram-reels'))[0]).toMatch(/expects 9:16/)
    expect(exportWarnings(portrait, settingsForPreset('instagram-reels'))).toEqual([])
    expect(exportWarnings({ width: 1280, height: 720, frameRate: fps(30) }, settingsForPreset('youtube-1080')).join()).toMatch(/upscales/)
  })
  it('validates bounds and rejects unknown keys', () => {
    expect(exportSettingsSchema.safeParse({ ...DEFAULT_EXPORT_SETTINGS, videoBitrateKbps: 100 }).success).toBe(false)
    expect(exportSettingsSchema.safeParse({ ...DEFAULT_EXPORT_SETTINGS, extra: 1 }).success).toBe(false)
  })
  it('estimates size', () => { expect(estimateSizeBytes(10_000_000, 8000)).toBe(10_240_000) })
})
