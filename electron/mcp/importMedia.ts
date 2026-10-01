import { createHash } from 'node:crypto'
import { mkdir, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { AUDIO_EXTENSIONS, IMAGE_EXTENSIONS, VIDEO_EXTENSIONS } from '../../src/core/assetKind'

/**
 * Pure(ish) rules for `import_media` (docs/MCP.md): what an agent may bring into the project, and how
 * bytes it fetched or received are landed on disk before they go through the SAME probe/fingerprint path
 * a dragged-in file uses. No Electron import, so every rule is unit-testable.
 *
 * Nothing here opens a native dialog and nothing is sent anywhere except the one https GET the user's own
 * agent asked for. Imported bytes never overwrite an existing file: landing is content-addressed.
 */
export type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' | 'image/bmp'

/** Largest image accepted from the clipboard, base64 or an https URL. A photo is a few MB. */
export const MAX_IMPORT_IMAGE_BYTES = 25 * 1024 * 1024
export const MAX_IMPORT_BASE64_BYTES = 5 * 1024 * 1024
export const IMPORT_FETCH_TIMEOUT_MS = 20_000
const MAX_REDIRECTS = 4

const EXTENSION_BY_MIME: Record<ImageMime, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/bmp': 'bmp' }
const PATH_EXTENSIONS = new Set([...IMAGE_EXTENSIONS, ...AUDIO_EXTENSIONS, ...VIDEO_EXTENSIONS])

/** Identifies an image from its first bytes; the extension and any server-declared type are never trusted. */
export function sniffImageMime(bytes: Uint8Array): ImageMime | null {
  const at = (index: number) => bytes[index]
  if (bytes.length >= 8 && at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return 'image/png'
  if (bytes.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg'
  if (bytes.length >= 6 && at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x38) return 'image/gif'
  if (bytes.length >= 12 && at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 && at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50) return 'image/webp'
  if (bytes.length >= 2 && at(0) === 0x42 && at(1) === 0x4d) return 'image/bmp'
  return null
}

/** An absolute path to an image, audio or video file. The probe (not this check) decides what it really is. */
export function assertImportPath(filePath: string): void {
  if (!path.isAbsolute(filePath)) throw new Error('path must be an absolute path to an image, audio or video file.')
  const extension = path.extname(filePath).toLowerCase().slice(1)
  if (!PATH_EXTENSIONS.has(extension)) throw new Error(`path must be an image, audio or video file (${[...PATH_EXTENSIONS].join(', ')}).`)
}

const PRIVATE_IPV4 = [/^0\./, /^10\./, /^127\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./]

/**
 * Only public https image URLs. Literal IPs and local names are refused so a prompt-injected agent cannot
 * point the fetch at the user's own machine or network. A hostname that resolves to a private address (DNS
 * rebinding) is NOT caught here; the fetched bytes are only ever decoded as an image and never returned.
 */
export function assertImportUrl(rawUrl: string): URL {
  let url: URL
  try { url = new URL(rawUrl) } catch { throw new Error('url is not a valid URL.') }
  if (url.protocol !== 'https:') throw new Error('url must use https.')
  if (url.username || url.password) throw new Error('url must not contain credentials.')
  const host = url.hostname.toLowerCase()
  if (host.startsWith('[') || /^\d+\.\d+\.\d+\.\d+$/.test(host) || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || !host.includes('.')) {
    throw new Error('url must point at a public website, not an IP address or local name.')
  }
  if (PRIVATE_IPV4.some((pattern) => pattern.test(host))) throw new Error('url must point at a public website.')
  return url
}

export type FetchLike = (input: string, init: { redirect: 'manual'; signal: AbortSignal; headers: Record<string, string> }) => Promise<Response>

/** Downloads an image with a size cap, a timeout and per-hop URL validation. Rejects anything that is not an image by content. */
export async function fetchImageBytes(rawUrl: string, fetchImpl: FetchLike = (input, init) => fetch(input, init)): Promise<{ bytes: Buffer; mime: ImageMime }> {
  let url = assertImportUrl(rawUrl)
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await fetchImpl(url.toString(), { redirect: 'manual', signal: AbortSignal.timeout(IMPORT_FETCH_TIMEOUT_MS), headers: { accept: 'image/*', 'user-agent': 'UPPELETE' } })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) throw new Error(`The image server redirected without a location (HTTP ${response.status}).`)
      url = assertImportUrl(new URL(location, url).toString())
      continue
    }
    if (!response.ok) throw new Error(`The image server answered HTTP ${response.status}.`)
    const declared = Number(response.headers.get('content-length') ?? '0')
    if (declared > MAX_IMPORT_IMAGE_BYTES) throw new Error(`The image is larger than ${MAX_IMPORT_IMAGE_BYTES / (1024 * 1024)} MB.`)
    const bytes = await readCapped(response, MAX_IMPORT_IMAGE_BYTES)
    const mime = sniffImageMime(bytes)
    if (!mime) throw new Error('That url did not return a png, jpeg, webp, gif or bmp image.')
    return { bytes, mime }
  }
  throw new Error('The image url redirected too many times.')
}

async function readCapped(response: Response, limit: number): Promise<Buffer> {
  if (!response.body) return Buffer.from(await response.arrayBuffer())
  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > limit) { await reader.cancel().catch(() => undefined); throw new Error(`The image is larger than ${limit / (1024 * 1024)} MB.`) }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks)
}

/** Decodes a base64 image, rejecting anything not an image or over the small-image cap. */
export function decodeBase64Image(imageBase64: string): { bytes: Buffer; mime: ImageMime } {
  const bytes = Buffer.from(imageBase64, 'base64')
  if (bytes.length === 0) throw new Error('imageBase64 is empty.')
  if (bytes.length > MAX_IMPORT_BASE64_BYTES) throw new Error(`imageBase64 is larger than ${MAX_IMPORT_BASE64_BYTES / (1024 * 1024)} MB; pass a path or url instead.`)
  const mime = sniffImageMime(bytes)
  if (!mime) throw new Error('imageBase64 is not a png, jpeg, webp, gif or bmp image.')
  return { bytes, mime }
}

/** Content-addressed name, so importing the same picture twice lands on one file. */
export function agentMediaFileName(bytes: Uint8Array, mime: ImageMime): string {
  return `${createHash('sha256').update(bytes).digest('hex').slice(0, 32)}.${EXTENSION_BY_MIME[mime]}`
}

/** Lands image bytes in `directory` atomically (temp file + rename) and returns the final path. An existing file is left untouched. */
export async function saveAgentMedia(directory: string, bytes: Buffer, mime: ImageMime): Promise<string> {
  await mkdir(directory, { recursive: true })
  const finalPath = path.join(directory, agentMediaFileName(bytes, mime))
  if (await stat(finalPath).then((info) => info.isFile(), () => false)) return finalPath
  const temporaryPath = `${finalPath}.${process.pid}.tmp`
  await writeFile(temporaryPath, bytes, { flag: 'w' })
  await rename(temporaryPath, finalPath)
  return finalPath
}
