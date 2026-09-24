import { createHash, randomUUID } from 'node:crypto'
import { access, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { mediaFingerprintSchema, type MediaFingerprint } from '../src/core/media'
import { PROXY_CONVERSION_VERSION } from '../src/core/proxy'

/**
 * Disk cache for automatic playback proxies (docs/STATUS.md), modeled on `thumbnailCache.ts` and
 * `waveformCache.ts`: a small JSON sidecar recording identity plus the re-probed duration, next to
 * the actual proxy video file. Unlike those caches the payload is a whole video file rather than
 * inline JSON, so the sidecar stores a path, and a hit is only trusted once the video file is
 * confirmed to still exist on disk (deleting just the video, e.g. to reclaim space, must not leave
 * a hit that then 404s).
 */

const cacheEntrySchema = z.strictObject({
  cacheVersion: z.literal(1),
  cacheKey: z.string().regex(/^[a-f0-9]{64}$/),
  conversionVersion: z.literal(PROXY_CONVERSION_VERSION),
  fingerprint: mediaFingerprintSchema,
  durationUs: z.number().int().nonnegative(),
})

export type PlaybackProxyCacheEntry = { path: string; durationUs: number }

export function playbackProxyCacheKey(fingerprint: MediaFingerprint, conversionVersion: string = PROXY_CONVERSION_VERSION): string {
  const identity = { conversionVersion, fingerprint }
  return createHash('sha256').update(JSON.stringify(identity)).digest('hex')
}

function sidecarPath(cacheDirectory: string, fingerprint: MediaFingerprint) {
  return path.join(cacheDirectory, `${playbackProxyCacheKey(fingerprint)}.json`)
}
function videoPath(cacheDirectory: string, fingerprint: MediaFingerprint) {
  return path.join(cacheDirectory, `${playbackProxyCacheKey(fingerprint)}.webm`)
}

export async function readPlaybackProxyCache(cacheDirectory: string, fingerprint: MediaFingerprint): Promise<PlaybackProxyCacheEntry | null> {
  const expectedKey = playbackProxyCacheKey(fingerprint)
  try {
    const entry = cacheEntrySchema.parse(JSON.parse(await readFile(sidecarPath(cacheDirectory, fingerprint), 'utf8')))
    if (entry.cacheKey !== expectedKey) return null
    if (playbackProxyCacheKey(entry.fingerprint, entry.conversionVersion) !== expectedKey) return null
    const proxyPath = videoPath(cacheDirectory, fingerprint)
    await stat(proxyPath)
    return { path: proxyPath, durationUs: entry.durationUs }
  } catch { return null }
}

/**
 * Moves an already-generated, already-validated proxy file (`sourcePath`, typically a job-owned
 * temp file) into the cache and records its sidecar. The caller re-probes and validates duration
 * *before* calling this — this function only persists a result already decided to be trustworthy.
 */
export async function writePlaybackProxyCache(cacheDirectory: string, fingerprint: MediaFingerprint, sourcePath: string, durationUs: number): Promise<PlaybackProxyCacheEntry> {
  const cacheKey = playbackProxyCacheKey(fingerprint)
  await mkdir(cacheDirectory, { recursive: true })
  const destination = videoPath(cacheDirectory, fingerprint)
  try { await rename(sourcePath, destination) }
  catch (error) {
    // Another request for the same fingerprint may have won the race and already produced a
    // cached file; if the destination exists, that result is just as valid as this one.
    try { await access(destination) } catch { throw error }
  }
  const temporarySidecar = path.join(cacheDirectory, `${cacheKey}.${randomUUID()}.tmp`)
  try {
    await writeFile(temporarySidecar, JSON.stringify({
      cacheVersion: 1, cacheKey, conversionVersion: PROXY_CONVERSION_VERSION, fingerprint, durationUs,
    }), { encoding: 'utf8', flag: 'wx' })
    try { await rename(temporarySidecar, sidecarPath(cacheDirectory, fingerprint)) }
    catch (error) {
      try { await access(sidecarPath(cacheDirectory, fingerprint)) }
      catch { throw error }
    }
  } finally { await rm(temporarySidecar, { force: true }) }
  return { path: destination, durationUs }
}
