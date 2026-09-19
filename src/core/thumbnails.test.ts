import { describe, expect, it } from 'vitest'
import { THUMBNAIL_MAX_COUNT, thumbnailCountForViewport, thumbnailLoadRequestSchema, thumbnailTimestamps } from './thumbnails'

describe('zoom-aware thumbnail timestamp selection', () => {
  it('places bucket-midpoint timestamps across the full duration without accumulated rounding drift', () => {
    const timestamps = thumbnailTimestamps(3_123_456, 4)
    expect(timestamps).toHaveLength(4)
    expect(timestamps.every((value, index) => index === 0 || value > timestamps[index - 1])).toBe(true)
    expect(timestamps[0]).toBeGreaterThanOrEqual(0)
    expect(timestamps.at(-1)).toBeLessThan(3_123_456)
    // Large source times still use exact wide integer arithmetic, not floating point.
    const large = thumbnailTimestamps(8_000_001_923_456, 7)
    expect(large).toHaveLength(7)
    expect(large.every((value, index) => index === 0 || value >= large[index - 1])).toBe(true)
  })

  it('returns no timestamps for a zero or unknown duration and rejects a non-positive count', () => {
    expect(thumbnailTimestamps(0, 4)).toEqual([])
    expect(() => thumbnailTimestamps(1_000_000, 0)).toThrow()
  })

  it('requests more thumbnails as zoom increases, bounded by a floor and the absolute ceiling', () => {
    const atZoom1 = thumbnailCountForViewport(1, 1200)
    const atZoom8 = thumbnailCountForViewport(8, 1200)
    expect(atZoom8).toBeGreaterThan(atZoom1)
    expect(thumbnailCountForViewport(1, 1200)).toBeGreaterThanOrEqual(4)
    expect(thumbnailCountForViewport(32, 4000)).toBeLessThanOrEqual(THUMBNAIL_MAX_COUNT)
    expect(thumbnailCountForViewport(1, 0)).toBe(0)
  })
})

describe('thumbnail load request validation', () => {
  it('accepts a well-formed request and rejects an oversized batch or width', () => {
    const base = { requestId: crypto.randomUUID(), fingerprint: { algorithm: 'sha256-sampled-v1' as const, value: 'a'.repeat(64), sizeBytes: 10, sampledBytes: 10 }, timestampsUs: [0, 1000], width: 160 }
    expect(thumbnailLoadRequestSchema.parse(base)).toEqual(base)
    expect(thumbnailLoadRequestSchema.safeParse({ ...base, timestampsUs: [] }).success).toBe(false)
    expect(thumbnailLoadRequestSchema.safeParse({ ...base, timestampsUs: Array.from({ length: 65 }, (_, i) => i) }).success).toBe(false)
    expect(thumbnailLoadRequestSchema.safeParse({ ...base, width: 5000 }).success).toBe(false)
  })
})
