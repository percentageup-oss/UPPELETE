import { z } from 'zod'
import { mediaFingerprintSchema } from './media'

export const THUMBNAIL_EXTRACTION_VERSION = 'ffmpeg-mjpeg-showinfo-v1'
/** Keeps cached thumbnails small and bounds real per-request FFmpeg process spawns. */
export const THUMBNAIL_MAX_WIDTH = 480
export const THUMBNAIL_MAX_COUNT = 64
const TARGET_THUMBNAIL_WIDTH_PX = 140

const microseconds = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)

export const thumbnailImageSchema = z.strictObject({
  requestedUs: microseconds,
  actualUs: microseconds,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  dataUrl: z.string().min(1).max(2_000_000),
})

export const thumbnailLoadRequestSchema = z.strictObject({
  requestId: z.uuid(),
  fingerprint: mediaFingerprintSchema,
  timestampsUs: z.array(microseconds).min(1).max(THUMBNAIL_MAX_COUNT),
  width: z.number().int().positive().max(THUMBNAIL_MAX_WIDTH),
})

export type ThumbnailImage = z.infer<typeof thumbnailImageSchema>
export type ThumbnailLoadRequest = z.infer<typeof thumbnailLoadRequestSchema>
export type ThumbnailLoadResult = {
  thumbnails: ThumbnailImage[]
  extractionVersion: typeof THUMBNAIL_EXTRACTION_VERSION
}

/** Deterministic bucket-midpoint sample points using wide integer arithmetic so long durations never accumulate rounding drift. */
export function thumbnailTimestamps(durationUs: number, count: number): number[] {
  if (!Number.isSafeInteger(count) || count < 1) throw new Error('Thumbnail count must be a positive safe integer')
  if (!Number.isSafeInteger(durationUs) || durationUs <= 0) return []
  const duration = BigInt(durationUs)
  const total = BigInt(count)
  return Array.from({ length: count }, (_, index) => {
    const i = BigInt(index)
    const start = (i * duration) / total
    const end = ((i + 1n) * duration) / total
    return Number(start + (end - start) / 2n)
  })
}

/**
 * More thumbnails as the visible content gets wider (zoomed in), bounded so one zoom step never spawns unbounded FFmpeg processes.
 * `targetWidthPx` lets a taller filmstrip ask for wider tiles so frames tile edge to edge instead of being cropped.
 */
export function thumbnailCountForViewport(zoom: number, viewportWidthPx: number, targetWidthPx = TARGET_THUMBNAIL_WIDTH_PX): number {
  if (!(zoom > 0) || !(viewportWidthPx > 0) || !(targetWidthPx > 0)) return 0
  const contentWidthPx = zoom * viewportWidthPx
  const count = Math.round(contentWidthPx / targetWidthPx)
  return Math.max(4, Math.min(THUMBNAIL_MAX_COUNT, count))
}
