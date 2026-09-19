import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { readWaveformCache, waveformCacheKey, writeWaveformCache } from './waveformCache'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))) })

const request = {
  fingerprint: { algorithm: 'sha256-sampled-v1' as const, value: 'a'.repeat(64), sizeBytes: 123_456, sampledBytes: 123_456 },
  range: { startUs: 0, endUs: 2_000_000 },
  maxPeaks: 4,
}

describe('waveform cache', () => {
  it('atomically stores and reads validated waveform data without leaving temporary files', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'waveform cache-'))
    directories.push(directory)
    const waveform = { range: request.range, peaks: [0, .25, 1, .5] }
    await writeWaveformCache(directory, request, waveform)
    expect(await readWaveformCache(directory, request)).toEqual(waveform)
    expect(await readdir(directory)).toEqual([`${waveformCacheKey(request)}.json`])
  })

  it('invalidates on fingerprint, extraction version, range or peak-count changes and ignores malformed entries', async () => {
    expect(waveformCacheKey(request)).not.toBe(waveformCacheKey({ ...request, fingerprint: { ...request.fingerprint, value: 'b'.repeat(64) } }))
    expect(waveformCacheKey(request)).not.toBe(waveformCacheKey({ ...request, range: { startUs: 1, endUs: 2_000_000 } }))
    expect(waveformCacheKey(request)).not.toBe(waveformCacheKey({ ...request, maxPeaks: 8 }))
    expect(waveformCacheKey(request)).not.toBe(waveformCacheKey(request, 'next-extractor-version'))
    const directory = await mkdtemp(path.join(tmpdir(), 'waveform corrupt cache-'))
    directories.push(directory)
    await writeFile(path.join(directory, `${waveformCacheKey(request)}.json`), '{bad json')
    expect(await readWaveformCache(directory, request)).toBeNull()
  })
})
