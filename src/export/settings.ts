import { z } from 'zod'
import type { SequenceFormat } from '../core/edit'
import { fittedFrameRate } from '../core/format'

/**
 * User-chosen export size, rate and bitrate. Presets never change the frame *shape*: resolution
 * names the target short edge, the aspect ratio is kept, and a preset whose platform shape does not
 * fit the project produces a warning rather than a reframe. Preset numbers are app defaults based on
 * the platforms' published upload recommendations, not guarantees.
 */
export const EXPORT_PRESET_IDS = ['source', 'youtube-1080', 'youtube-1440', 'youtube-2160', 'instagram-reels', 'instagram-feed', 'custom'] as const
export const exportSettingsSchema = z.strictObject({
  preset: z.enum(EXPORT_PRESET_IDS),
  resolution: z.union([z.literal('source'), z.literal(480), z.literal(720), z.literal(1080), z.literal(1440), z.literal(2160)]),
  frameRate: z.union([z.literal('source'), z.literal(24), z.literal(25), z.literal(30), z.literal(50), z.literal(60)]),
  /** `null` keeps the automatic bitrate class. */
  videoBitrateKbps: z.number().int().min(500).max(100_000).nullable(),
  /** Export only this sequence-time range (the I/O marks); absent exports the whole timeline. */
  range: z.strictObject({ startUs: z.number().int().nonnegative(), endUs: z.number().int().positive() }).refine((range) => range.endUs > range.startUs, 'Range end must follow its start').optional(),
})
export type ExportSettings = z.infer<typeof exportSettingsSchema>
export type ExportPresetId = ExportSettings['preset']
export type ExportResolution = ExportSettings['resolution']
export type ExportFrameRate = ExportSettings['frameRate']

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = { preset: 'source', resolution: 'source', frameRate: 'source', videoBitrateKbps: null }

type Preset = {
  id: Exclude<ExportPresetId, 'custom'>; label: string; detail: string
  resolution: ExportResolution; frameRate: ExportFrameRate
  /** Mbps at ≤30 fps and above 30 fps; `null` is the automatic class. */
  bitrateMbps: readonly [number, number] | null
  /** Aspect ratios (width/height) the platform expects; empty means any. */
  aspects: readonly number[]; aspectLabel: string
}
export const EXPORT_PRESETS: readonly Preset[] = [
  { id: 'source', label: 'Source', detail: 'Same size and frame rate as the project', resolution: 'source', frameRate: 'source', bitrateMbps: null, aspects: [], aspectLabel: '' },
  { id: 'youtube-1080', label: 'YouTube 1080p', detail: '1080p, source frame rate', resolution: 1080, frameRate: 'source', bitrateMbps: [8, 12], aspects: [16 / 9, 9 / 16], aspectLabel: '16:9 or 9:16' },
  { id: 'youtube-1440', label: 'YouTube 1440p (2K)', detail: '1440p, source frame rate', resolution: 1440, frameRate: 'source', bitrateMbps: [16, 24], aspects: [16 / 9, 9 / 16], aspectLabel: '16:9 or 9:16' },
  { id: 'youtube-2160', label: 'YouTube 4K', detail: '2160p, source frame rate', resolution: 2160, frameRate: 'source', bitrateMbps: [35, 53], aspects: [16 / 9, 9 / 16], aspectLabel: '16:9 or 9:16' },
  { id: 'instagram-reels', label: 'Instagram Reels / Stories', detail: '1080p, 30 fps', resolution: 1080, frameRate: 30, bitrateMbps: [8, 8], aspects: [9 / 16], aspectLabel: '9:16' },
  { id: 'instagram-feed', label: 'Instagram Feed', detail: '1080p, 30 fps', resolution: 1080, frameRate: 30, bitrateMbps: [8, 8], aspects: [4 / 5, 1], aspectLabel: '4:5 or 1:1' },
]

/** The settings a preset stands for (Custom keeps whatever the caller already has). */
export function settingsForPreset(id: ExportPresetId, current: ExportSettings = DEFAULT_EXPORT_SETTINGS): ExportSettings {
  if (id === 'custom') return { ...current, preset: 'custom' }
  const preset = EXPORT_PRESETS.find((candidate) => candidate.id === id)!
  return { preset: id, resolution: preset.resolution, frameRate: preset.frameRate, videoBitrateKbps: null }
}

const even = (value: number) => Math.max(16, Math.round(value / 2) * 2)

/** Keeps the aspect ratio; the short edge becomes the target, capped so the long edge is ≤ 3840. 'source' returns `format` itself. */
export function resolveExportFormat(format: SequenceFormat, settings: ExportSettings | undefined): SequenceFormat {
  if (!settings) return format
  let { width, height } = format
  if (settings.resolution !== 'source') {
    const scale = Math.min(settings.resolution / Math.min(width, height), 3840 / Math.max(width, height))
    width = even(width * scale); height = even(height * scale)
  }
  const frameRate = settings.frameRate === 'source' ? format.frameRate : fittedFrameRate({ numerator: settings.frameRate, denominator: 1 })
  if (width === format.width && height === format.height && frameRate === format.frameRate) return format
  return { width, height, frameRate }
}

/** Explicit bitrate, else the preset's for this output rate; `null` means the automatic class. */
export function resolveVideoBitrateKbps(settings: ExportSettings | undefined, output: SequenceFormat): number | null {
  if (!settings) return null
  if (settings.videoBitrateKbps !== null) return settings.videoBitrateKbps
  const preset = EXPORT_PRESETS.find((candidate) => candidate.id === settings.preset)
  if (!preset?.bitrateMbps) return null
  return preset.bitrateMbps[output.frameRate.numerator / output.frameRate.denominator > 30.5 ? 1 : 0] * 1000
}

export function exportWarnings(source: SequenceFormat, settings: ExportSettings): string[] {
  const warnings: string[] = []
  const preset = EXPORT_PRESETS.find((candidate) => candidate.id === settings.preset)
  const aspect = source.width / source.height
  if (preset?.aspects.length && !preset.aspects.some((wanted) => Math.abs(wanted - aspect) / wanted < 0.02)) {
    warnings.push(`This project is ${source.width}×${source.height}; ${preset.label} expects ${preset.aspectLabel}. It will export in the project's shape.`)
  }
  if (settings.resolution !== 'source' && settings.resolution > Math.min(source.width, source.height)) {
    warnings.push(`The project is smaller than ${settings.resolution}p; exporting larger upscales the picture and does not add detail.`)
  }
  return warnings
}

/** Rough size for the dialog (video + 192 kbps audio); labelled an estimate wherever shown. */
export function estimateSizeBytes(durationUs: number, videoKbps: number): number {
  return Math.round((durationUs / 1_000_000) * (videoKbps + 192) * 1000 / 8)
}
