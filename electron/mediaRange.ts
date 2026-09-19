import path from 'node:path'

const CONTENT_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4', '.m4v': 'video/x-m4v', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska', '.webm': 'video/webm',
}

export type RangePlan =
  | { status: 200 | 206; start: number; end: number; headers: Record<string, string> }
  | { status: 416; headers: Record<string, string> }

export function mediaContentType(filePath: string): string {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream'
}

/**
 * Chromium only treats media as seekable when byte ranges are answered with 206 + Content-Range, which
 * Electron's file fetch does not do on its own. Supports the single-range forms HTML media actually sends.
 */
export function planMediaRange(rangeHeader: string | null, sizeBytes: number, filePath: string): RangePlan {
  const base = { 'Content-Type': mediaContentType(filePath), 'Accept-Ranges': 'bytes' }
  if (!rangeHeader) return { status: 200, start: 0, end: sizeBytes - 1, headers: { ...base, 'Content-Length': String(sizeBytes) } }
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim())
  const unsatisfiable = { status: 416 as const, headers: { ...base, 'Content-Range': `bytes */${sizeBytes}` } }
  if (!match || (match[1] === '' && match[2] === '')) return unsatisfiable
  let start: number
  let end: number
  if (match[1] === '') {
    // Suffix range: the last N bytes.
    const suffix = Number(match[2])
    if (suffix === 0) return unsatisfiable
    start = Math.max(0, sizeBytes - suffix)
    end = sizeBytes - 1
  } else {
    start = Number(match[1])
    end = match[2] === '' ? sizeBytes - 1 : Math.min(sizeBytes - 1, Number(match[2]))
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= sizeBytes || start > end) return unsatisfiable
  return { status: 206, start, end, headers: { ...base, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${sizeBytes}` } }
}
