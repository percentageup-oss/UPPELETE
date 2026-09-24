import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { Writable } from 'node:stream'
import { failure } from './protocol'

/** Private streams: binary stdout is never mixed with the JSON media-worker channel. */
export function ownedProcess(executable: string, args: string[], signal: AbortSignal, env = process.env) {
  if (signal.aborted) throw failure('CANCELLED', 'Export cancelled')
  const child: ChildProcessWithoutNullStreams = spawn(executable, args, { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env })
  let diagnostic = '', timer: ReturnType<typeof setTimeout> | undefined, problem: Error | undefined
  child.stderr.on('data', (chunk: Buffer) => { diagnostic = (diagnostic + chunk.toString('utf8')).slice(-8192) })
  child.stdin.on('error', () => {})
  const stop = () => { child.kill('SIGTERM'); timer ??= setTimeout(() => child.kill('SIGKILL'), 500) }
  signal.addEventListener('abort', stop, { once: true })
  child.on('error', (error) => { problem = error })
  const closed = new Promise<void>((resolve, reject) => child.once('close', (code, exitSignal) => {
    clearTimeout(timer); signal.removeEventListener('abort', stop)
    if (signal.aborted) reject(failure('CANCELLED', 'Export cancelled'))
    else if (problem) reject(failure('SPAWN_FAILED', 'Could not start export process', { diagnostic: problem.message.slice(-8192) }))
    else if (code !== 0) reject(failure('TOOL_FAILED', 'Export process failed', { exitCode: code, signal: exitSignal, diagnostic }))
    else resolve()
  }))
  closed.catch(() => {})
  return { child, closed, stop }
}
export async function writeBounded(stream: Writable, bytes: Buffer | string): Promise<void> {
  await new Promise<void>((resolve, reject) => stream.write(bytes, (error) => error ? reject(error) : resolve()))
}
/** Pull-based reader bounds each PNG and retains at most one frame plus a pipe chunk. */
export class PngReader {
  private pending: Buffer<ArrayBufferLike> = Buffer.alloc(0)
  private readonly iterator: AsyncIterator<Buffer<ArrayBufferLike>>
  constructor(stream: AsyncIterable<Buffer<ArrayBufferLike>>) { this.iterator = stream[Symbol.asyncIterator]() }
  private async read(size: number): Promise<Buffer> {
    const output = Buffer.allocUnsafe(size)
    let offset = 0
    while (offset < size) {
      if (!this.pending.length) {
        const next = await this.iterator.next()
        if (next.done) throw failure('TOOL_FAILED', 'Caption renderer closed before completing a frame')
        this.pending = next.value
      }
      const count = Math.min(size - offset, this.pending.length)
      this.pending.copy(output, offset, 0, count)
      this.pending = this.pending.subarray(count); offset += count
    }
    return output
  }
  private started = false
  async frame(): Promise<Buffer> {
    let header = await this.read(4)
    // Electron.exe on Windows writes a stray "\r\n" to stdout at startup. As a length it would be
    // >200 MiB, above the frame limit, so it is unambiguous: drop it once, before the first frame.
    if (!this.started && header[0] === 0x0d && header[1] === 0x0a) header = Buffer.concat([header.subarray(2), await this.read(2)])
    this.started = true
    const size = header.readUInt32BE()
    if (size < 8 || size > 64 * 1024 * 1024) throw failure('OUTPUT_LIMIT', 'Caption PNG exceeded its limit')
    const bytes = await this.read(size)
    if (!bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw failure('TOOL_FAILED', 'Invalid caption PNG')
    return bytes
  }
}
