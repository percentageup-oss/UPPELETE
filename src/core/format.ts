import type { SequenceFormat } from './edit'
import type { MediaMetadata, Rational } from './media'

/**
 * The sequence's output frame, derived from one video's probe. This is the whole of X2's
 * `planFromMedia` minus its source range, moved here so the project schema (`project.format`), the
 * preview's caption composition and the export plan all share one rule — a migrated project's format
 * is byte-for-byte what `planFromMedia` produced before it (the export parity hinge, docs/EDITING.md).
 */

/**
 * Keeps the source's exact rational rate whenever it already fits the profile's 1-60 fps band
 * (30000/1001 stays 30000/1001, never rounded to 30). A rate above 60 is halved — which preserves
 * exact rational equality, unlike rounding to an integer fps — until it fits; anything that still
 * can't be expressed this way (non-finite, zero or sub-1fps) falls back to a plain 30/1 default.
 */
export function fittedFrameRate(candidate: Rational): Rational {
  let { numerator, denominator } = candidate
  for (let guard = 0; guard < 32 && numerator / denominator > 60 && denominator <= Number.MAX_SAFE_INTEGER / 2; guard++) denominator *= 2
  const value = numerator / denominator
  return Number.isFinite(value) && value >= 1 && value <= 60 ? { numerator, denominator } : { numerator: 30, denominator: 1 }
}

/** `null` when the probe reported no dimensions — the caller keeps the format unset until it does. */
export function formatFromMedia(metadata: MediaMetadata | null | undefined): SequenceFormat | null {
  if (!metadata?.width || !metadata.height) return null
  const video = metadata.streams.find((s) => s.kind === 'video')
  const sar = video?.sampleAspectRatio
  let width = metadata.width * (sar ? sar.numerator / sar.denominator : 1), height = metadata.height
  const rotation = metadata.rotationDegrees ?? 0
  // Arbitrary angles produce a bounding box; FFmpeg autorotation handles the corresponding pixels.
  const radians = rotation * Math.PI / 180
  ;[width, height] = [Math.abs(width * Math.cos(radians)) + Math.abs(height * Math.sin(radians)),
    Math.abs(width * Math.sin(radians)) + Math.abs(height * Math.cos(radians))]
  const scale = Math.min(1, 3840 / Math.max(width, height))
  const even = (v: number) => Math.max(16, Math.round(v * scale / 2) * 2)
  const candidate = metadata.nominalFrameRate ?? metadata.frameRate ?? { numerator: 30, denominator: 1 }
  return { width: even(width), height: even(height), frameRate: fittedFrameRate(candidate) }
}

export const DEFAULT_FORMAT_ASPECT = 16 / 9

/** The display aspect the caption composition is built in; 16:9 before any video has been probed. */
export function formatAspect(format: SequenceFormat | null | undefined): number {
  return format ? format.width / format.height : DEFAULT_FORMAT_ASPECT
}

/** Human-readable download/file size: "148 MB", "1.6 GB". */
export function formatSize(bytes: number): string {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`
}
