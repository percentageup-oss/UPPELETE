import { describe, expect, it } from 'vitest'
import { createThumbnailQueue, stripTimestamps } from './thumbnailQueue'

const fingerprint = { algorithm: 'sha256-sampled-v1' as const, value: 'f'.repeat(64), sizeBytes: 1, sampledBytes: 1 }
const request = (sourceStartUs: number) => ({ fingerprint, sourceStartUs, sourceEndUs: sourceStartUs + 4_000_000, count: 4, width: 160 })

describe('thumbnail queue', () => {
  it('samples bucket midpoints across the clip’s own source range', () => {
    expect(stripTimestamps(10_000_000, 14_000_000, 4)).toEqual([10_500_000, 11_500_000, 12_500_000, 13_500_000])
  })

  it('caps requests in flight, caches by strip, and only loads what is wanted', async () => {
    const resolvers: (() => void)[] = []
    const queue = createThumbnailQueue(() => new Promise((resolve) => resolvers.push(() => resolve([]))), 2)
    expect(queue.get(request(0), false).state).toBe('idle')
    for (let index = 0; index < 5; index++) queue.get(request(index * 1_000_000), true)
    expect(queue.inFlight()).toBe(2)
    queue.get(request(0), true) // cached: no second request
    expect(resolvers).toHaveLength(2)
    resolvers[0]()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(queue.get(request(0), true).state).toBe('ready')
    expect(queue.inFlight()).toBe(2)
    expect(resolvers).toHaveLength(3)
  })
})
