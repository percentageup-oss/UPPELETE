import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PROXY_CONVERSION_VERSION } from '../src/core/proxy'
import { playbackProxyCacheKey, readPlaybackProxyCache, writePlaybackProxyCache } from './playbackProxyCache'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))) })

const fingerprint = { algorithm: 'sha256-sampled-v1' as const, value: 'a'.repeat(64), sizeBytes: 123_456, sampledBytes: 123_456 }

async function newDirectory(prefix: string) {
  const directory = await mkdtemp(path.join(tmpdir(), prefix))
  directories.push(directory)
  return directory
}

describe('playback proxy cache', () => {
  it('atomically moves the generated file into the cache and reads it back by fingerprint', async () => {
    const directory = await newDirectory('playback-proxy-cache-')
    const source = path.join(directory, 'generated.webm.tmp')
    await writeFile(source, 'fake webm bytes')
    const entry = await writePlaybackProxyCache(directory, fingerprint, source, 5_000_000)
    expect(entry.durationUs).toBe(5_000_000)
    expect(await readFile(entry.path, 'utf8')).toBe('fake webm bytes')
    const read = await readPlaybackProxyCache(directory, fingerprint)
    expect(read).toEqual({ path: entry.path, durationUs: 5_000_000 })
    // The source temp file was moved, not copied.
    await expect(readFile(source, 'utf8')).rejects.toThrow()
    const files = await readdir(directory)
    expect(files.sort()).toEqual([`${playbackProxyCacheKey(fingerprint)}.json`, `${playbackProxyCacheKey(fingerprint)}.webm`])
  })

  it('misses for a different fingerprint or a different conversion version', async () => {
    const directory = await newDirectory('playback-proxy-cache-miss-')
    const source = path.join(directory, 'generated.webm.tmp')
    await writeFile(source, 'bytes')
    await writePlaybackProxyCache(directory, fingerprint, source, 1_000_000)
    expect(await readPlaybackProxyCache(directory, { ...fingerprint, value: 'b'.repeat(64) })).toBeNull()
    expect(playbackProxyCacheKey(fingerprint)).not.toBe(playbackProxyCacheKey(fingerprint, 'next-conversion-version'))
  })

  it('treats a cache entry as a miss once its video file is gone, even with a valid sidecar', async () => {
    const directory = await newDirectory('playback-proxy-cache-deleted-')
    const source = path.join(directory, 'generated.webm.tmp')
    await writeFile(source, 'bytes')
    const entry = await writePlaybackProxyCache(directory, fingerprint, source, 1_000_000)
    await rm(entry.path)
    expect(await readPlaybackProxyCache(directory, fingerprint)).toBeNull()
  })

  it('ignores a malformed or version-stamped-differently sidecar', async () => {
    const directory = await newDirectory('playback-proxy-cache-corrupt-')
    await writeFile(path.join(directory, `${playbackProxyCacheKey(fingerprint)}.json`), '{bad json')
    expect(await readPlaybackProxyCache(directory, fingerprint)).toBeNull()

    const directory2 = await newDirectory('playback-proxy-cache-corrupt2-')
    await writeFile(path.join(directory2, `${playbackProxyCacheKey(fingerprint)}.webm`), 'bytes')
    await writeFile(path.join(directory2, `${playbackProxyCacheKey(fingerprint)}.json`), JSON.stringify({
      cacheVersion: 1, cacheKey: playbackProxyCacheKey(fingerprint), conversionVersion: PROXY_CONVERSION_VERSION,
      fingerprint, durationUs: -1,
    }))
    expect(await readPlaybackProxyCache(directory2, fingerprint)).toBeNull()
  })

  it('a second write for the same identity replaces the first (last generation wins)', async () => {
    const directory = await newDirectory('playback-proxy-cache-rewrite-')
    const first = path.join(directory, 'first.webm.tmp')
    const second = path.join(directory, 'second.webm.tmp')
    await writeFile(first, 'first bytes')
    await writeFile(second, 'second bytes')
    await writePlaybackProxyCache(directory, fingerprint, first, 1_000_000)
    const entry = await writePlaybackProxyCache(directory, fingerprint, second, 2_000_000)
    expect(await readFile(entry.path, 'utf8')).toBe('second bytes')
    expect((await readPlaybackProxyCache(directory, fingerprint))?.durationUs).toBe(2_000_000)
  })
})
