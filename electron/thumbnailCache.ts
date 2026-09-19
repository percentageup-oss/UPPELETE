import { createHash, randomUUID } from 'node:crypto'
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { mediaFingerprintSchema } from '../src/core/media'
import { THUMBNAIL_EXTRACTION_VERSION, thumbnailImageSchema, type ThumbnailImage } from '../src/core/thumbnails'

const requestIdentitySchema = z.strictObject({
  fingerprint: mediaFingerprintSchema,
  requestedUs: z.number().int().nonnegative(),
  width: z.number().int().positive(),
})
type CacheRequest = z.infer<typeof requestIdentitySchema>

const cacheEntrySchema = z.strictObject({
  cacheVersion: z.literal(1),
  cacheKey: z.string().regex(/^[a-f0-9]{64}$/),
  extractionVersion: z.literal(THUMBNAIL_EXTRACTION_VERSION),
  request: requestIdentitySchema,
  thumbnail: thumbnailImageSchema,
})

export function thumbnailCacheKey(request: CacheRequest, extractionVersion: string = THUMBNAIL_EXTRACTION_VERSION): string {
  const identity = { extractionVersion, fingerprint: request.fingerprint, requestedUs: request.requestedUs, width: request.width }
  return createHash('sha256').update(JSON.stringify(identity)).digest('hex')
}

function cachePath(cacheDirectory: string, request: CacheRequest) {
  return path.join(cacheDirectory, `${thumbnailCacheKey(request)}.json`)
}

export async function readThumbnailCache(cacheDirectory: string, request: CacheRequest): Promise<ThumbnailImage | null> {
  const expectedKey = thumbnailCacheKey(request)
  try {
    const entry = cacheEntrySchema.parse(JSON.parse(await readFile(cachePath(cacheDirectory, request), 'utf8')))
    if (entry.cacheKey !== expectedKey) return null
    if (thumbnailCacheKey(entry.request) !== expectedKey) return null
    if (entry.thumbnail.requestedUs !== request.requestedUs || entry.thumbnail.width !== request.width) return null
    return entry.thumbnail
  } catch { return null }
}

export async function writeThumbnailCache(cacheDirectory: string, request: CacheRequest, thumbnailValue: ThumbnailImage): Promise<void> {
  const thumbnail = thumbnailImageSchema.parse(thumbnailValue)
  const cacheKey = thumbnailCacheKey(request)
  await mkdir(cacheDirectory, { recursive: true })
  const destination = cachePath(cacheDirectory, request)
  const temporary = path.join(cacheDirectory, `${cacheKey}.${randomUUID()}.tmp`)
  try {
    await writeFile(temporary, JSON.stringify({
      cacheVersion: 1,
      cacheKey,
      extractionVersion: THUMBNAIL_EXTRACTION_VERSION,
      request,
      thumbnail,
    }), { encoding: 'utf8', flag: 'wx' })
    try { await rename(temporary, destination) }
    catch (error) {
      try { await access(destination) }
      catch { throw error }
    }
  } finally { await rm(temporary, { force: true }) }
}
