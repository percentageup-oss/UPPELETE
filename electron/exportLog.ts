import { app } from 'electron'
import { appendFile, mkdir, rename, stat } from 'node:fs/promises'
import path from 'node:path'

/**
 * A local, bounded diagnostic log for export jobs.
 *
 * The renderer's failure notice is one line, and a structured error's `diagnostic` (the encoder's
 * own stderr, a worker exit code) never reached the user at all — so an export that stopped on a
 * real project left nothing behind to diagnose it with. This records the shape of each job and how
 * it ended, in the user's own app-data directory. Nothing is ever sent anywhere (docs/PRODUCT.md:
 * no telemetry), and it records counts, paths and error details — never caption or media content.
 */
export const EXPORT_LOG_MAX_BYTES = 2 * 1024 * 1024

/** Appends one line, rotating once so a long-running install never grows without bound. */
export async function appendLogLine(file: string, line: string, maxBytes = EXPORT_LOG_MAX_BYTES): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  const size = await stat(file).then((info) => info.size, () => 0)
  if (size > 0 && size + line.length > maxBytes) await rename(file, `${file}.1`).catch(() => {})
  await appendFile(file, line, 'utf8')
}

export function logLine(event: string, detail: Record<string, unknown>): string {
  try { return `${JSON.stringify({ at: new Date().toISOString(), event, ...detail })}\n` }
  catch { return `${JSON.stringify({ at: new Date().toISOString(), event, detail: 'unserializable' })}\n` }
}

export function exportLogPath(): string {
  return path.join(app.getPath('userData'), 'logs', 'export.log')
}

/** Writes are serialized and never awaited by a caller: logging must not delay or fail a job. */
let pending: Promise<void> = Promise.resolve()
export function logExport(event: string, detail: Record<string, unknown> = {}): void {
  const line = logLine(event, detail)
  pending = pending.then(() => appendLogLine(exportLogPath(), line)).catch(() => {})
}
