import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { readThumbnailCache, thumbnailCacheKey, writeThumbnailCache } from './thumbnailCache'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))) })

const request = {
  fingerprint: { algorithm: 'sha256-sampled-v1' as const, value: 'a'.repeat(64), sizeBytes: 123_456, sampledBytes: 123_456 },
  requestedUs: 1_500_000,
  width: 160,
}
const thumbnail = { requestedUs: request.requestedUs, actualUs: 1_500_033, width: 160, height: 90, dataUrl: 'data:image/jpeg;base64,AAAA' }

describe('thumbnail cache', () => {
  it('atomically stores and reads a validated thumbnail without leaving temporary files', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'thumbnail cache-'))
    directories.push(directory)
    await writeThumbnailCache(directory, request, thumbnail)
    expect(await readThumbnailCache(directory, request)).toEqual(thumbnail)
    expect(await readdir(directory)).toEqual([`${thumbnailCacheKey(request)}.json`])
  })

  it('invalidates on fingerprint, requested timestamp, width or extraction-version changes and ignores malformed entries', async () => {
    expect(thumbnailCacheKey(request)).not.toBe(thumbnailCacheKey({ ...request, fingerprint: { ...request.fingerprint, value: 'b'.repeat(64) } }))
    expect(thumbnailCacheKey(request)).not.toBe(thumbnailCacheKey({ ...request, requestedUs: 2_000_000 }))
    expect(thumbnailCacheKey(request)).not.toBe(thumbnailCacheKey({ ...request, width: 320 }))
    expect(thumbnailCacheKey(request)).not.toBe(thumbnailCacheKey(request, 'next-extractor-version'))
    const directory = await mkdtemp(path.join(tmpdir(), 'thumbnail corrupt cache-'))
    directories.push(directory)
    await writeFile(path.join(directory, `${thumbnailCacheKey(request)}.json`), '{bad json')
    expect(await readThumbnailCache(directory, request)).toBeNull()
  })

  it('misses when a differently identified thumbnail is requested at the same cache key namespace', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'thumbnail cache miss-'))
    directories.push(directory)
    await writeThumbnailCache(directory, request, thumbnail)
    expect(await readThumbnailCache(directory, { ...request, requestedUs: 9_999_999 })).toBeNull()
    expect(await readThumbnailCache(directory, { ...request, width: 80 })).toBeNull()
  })
})
