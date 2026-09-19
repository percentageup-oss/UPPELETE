import { describe, expect, it } from 'vitest'
import { describeMediaMismatches, type ProjectMedia } from './media'

const media = (overrides: Partial<ProjectMedia> = {}): ProjectMedia => ({
  name: 'clip.mp4',
  reference: { relativePath: 'clip.mp4', absolutePath: '/project/clip.mp4' },
  fingerprint: { algorithm: 'sha256-sampled-v1', value: 'a'.repeat(64), sizeBytes: 1000, sampledBytes: 1000 },
  metadata: {
    durationUs: 2_000_000,
    width: 1080,
    height: 1920,
    rotationDegrees: 90,
    frameRate: { numerator: 30000, denominator: 1001 },
    nominalFrameRate: { numerator: 30, denominator: 1 },
    streams: [],
  },
  ...overrides,
})

describe('media replacement verification', () => {
  it('reports identity and useful metadata differences without rejecting the candidate', () => {
    const replacement = media({
      fingerprint: { algorithm: 'sha256-sampled-v1', value: 'b'.repeat(64), sizeBytes: 2000, sampledBytes: 2000 },
      metadata: { ...media().metadata!, durationUs: 3_000_000, width: 1920, height: 1080, rotationDegrees: 0, frameRate: { numerator: 25, denominator: 1 } },
    })
    const messages = describeMediaMismatches(media(), replacement)
    expect(messages).toHaveLength(5)
    expect(messages.join(' ')).toMatch(/fingerprint differs.*Duration differs.*dimensions differ.*Rotation differs.*frame rate differs/i)
    expect(replacement.name).toBe('clip.mp4')
  })

  it('explains why migrated projects cannot be verified', () => {
    const legacy = media({ fingerprint: null, metadata: null })
    expect(describeMediaMismatches(legacy, media())).toEqual([
      'This older project has no stored media fingerprint, so file identity cannot be confirmed.',
      'This older project has no stored media metadata for comparison.',
    ])
  })
})
