import { createHash, randomUUID } from 'node:crypto'
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import {
  WAVEFORM_EXTRACTION_VERSION,
  waveformDataSchema,
  waveformLoadRequestSchema,
  type WaveformData,
  type WaveformLoadRequest,
} from '../src/core/waveform'

const cacheEntrySchema = z.strictObject({
  cacheVersion: z.literal(1),
  cacheKey: z.string().regex(/^[a-f0-9]{64}$/),
  extractionVersion: z.literal(WAVEFORM_EXTRACTION_VERSION),
  request: waveformLoadRequestSchema.omit({ requestId: true }),
  waveform: waveformDataSchema,
})

export function waveformCacheKey(request: Omit<WaveformLoadRequest, 'requestId'>,
  extractionVersion: string = WAVEFORM_EXTRACTION_VERSION): string {
  const identity = {
    extractionVersion,
    fingerprint: request.fingerprint,
    range: request.range,
    maxPeaks: request.maxPeaks,
  }
  return createHash('sha256').update(JSON.stringify(identity)).digest('hex')
}

function cachePath(cacheDirectory: string, request: Omit<WaveformLoadRequest, 'requestId'>) {
  return path.join(cacheDirectory, `${waveformCacheKey(request)}.json`)
}

export async function readWaveformCache(cacheDirectory: string,
  request: Omit<WaveformLoadRequest, 'requestId'>): Promise<WaveformData | null> {
  const expectedKey = waveformCacheKey(request)
  try {
    const entry = cacheEntrySchema.parse(JSON.parse(await readFile(cachePath(cacheDirectory, request), 'utf8')))
    if (entry.cacheKey !== expectedKey) return null
    if (waveformCacheKey(entry.request) !== expectedKey) return null
    if (entry.waveform.range.startUs !== request.range.startUs || entry.waveform.range.endUs !== request.range.endUs) return null
    if (entry.waveform.peaks.length > request.maxPeaks) return null
    return entry.waveform
  } catch { return null }
}

export async function writeWaveformCache(cacheDirectory: string, request: Omit<WaveformLoadRequest, 'requestId'>,
  waveformValue: WaveformData): Promise<void> {
  const waveform = waveformDataSchema.parse(waveformValue)
  const cacheKey = waveformCacheKey(request)
  await mkdir(cacheDirectory, { recursive: true })
  const destination = cachePath(cacheDirectory, request)
  const temporary = path.join(cacheDirectory, `${cacheKey}.${randomUUID()}.tmp`)
  try {
    await writeFile(temporary, JSON.stringify({
      cacheVersion: 1,
      cacheKey,
      extractionVersion: WAVEFORM_EXTRACTION_VERSION,
      request,
      waveform,
    }), { encoding: 'utf8', flag: 'wx' })
    try { await rename(temporary, destination) }
    catch (error) {
      try { await access(destination) }
      catch { throw error }
    }
  } finally { await rm(temporary, { force: true }) }
}
