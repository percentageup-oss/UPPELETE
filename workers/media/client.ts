import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { MessageDecoder, encodeMessage } from './wire'
import { cancelSchema, requestSchema, serverMessageSchema, toolchainSchema, PROTOCOL_VERSION,
  failure, MediaWorkerError, type MediaTask, type ProgressMessage, type ResultFor, type MediaResult, type Toolchain } from './protocol'

export interface MediaWorkerOptions {
  /** Absolute built server.cjs path, outside app.asar when packaged. Main-process owned. */
  workerPath: string
  executable?: string
  tools?: Toolchain
  timeoutMs?: number
}
export interface MediaJob<T extends MediaTask> {
  id: string
  result: Promise<ResultFor<T>>
  cancel(): void
}

/** Main/Node only. One short-lived worker per job; T1 owns future resource scheduling. */
export class MediaWorkerClient {
  private readonly jobs = new Set<MediaJob<MediaTask>>()
  private closed = false
  private readonly options: MediaWorkerOptions
  constructor(options: MediaWorkerOptions) {
    for (const value of [options.workerPath, options.executable ?? process.execPath]) {
      if (!path.isAbsolute(value) || value.includes('\0')) throw failure('INVALID_MESSAGE', 'Worker and runtime paths must be absolute native paths')
    }
    if (options.timeoutMs !== undefined && (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 86400000)) {
      throw failure('INVALID_MESSAGE', 'Worker timeout must be between 1 ms and 24 hours')
    }
    this.options = { ...options, tools: options.tools ? toolchainSchema.parse(options.tools) : undefined }
  }

  /** `timeoutMs` overrides the client deadline for one long job (for example transcription), up to 24 hours. */
  start<T extends MediaTask>(task: T, options: { signal?: AbortSignal; onProgress?: (message: ProgressMessage) => void; timeoutMs?: number } = {}): MediaJob<T> {
    if (this.closed) throw failure('WORKER_EXITED', 'Media worker client is closed')
    if (options.timeoutMs !== undefined && (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 86400000)) {
      throw failure('INVALID_MESSAGE', 'Worker timeout must be between 1 ms and 24 hours')
    }
    if (this.jobs.size >= 4) throw failure('BUSY', 'Media worker capacity reached', { retryable: true })
    const id = randomUUID()
    const request = requestSchema.parse({ version: PROTOCOL_VERSION, type: 'request', id, task })
    const input = encodeMessage(request)
    let cancel = () => {}
    const result = new Promise<ResultFor<T>>((resolve, reject) => {
      if (options.signal?.aborted) { reject(failure('CANCELLED', 'Operation cancelled')); return }
      const env: NodeJS.ProcessEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
      // No incidental Node flags or inherited media-tool configuration.
      delete env.NODE_OPTIONS
      delete env.NODE_PATH
      delete env.CAPTION_STUDIO_MEDIA_TOOLS
      if (this.options.tools) env.CAPTION_STUDIO_MEDIA_TOOLS = JSON.stringify(this.options.tools)
      const child = spawn(this.options.executable ?? process.execPath, [this.options.workerPath], {
        shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env,
      })
      const decoder = new MessageDecoder()
      let terminal: MediaResult | MediaWorkerError | undefined
      let problem: MediaWorkerError | undefined
      let stderr = ''
      let killTimer: ReturnType<typeof setTimeout> | undefined
      const stop = (reason: MediaWorkerError) => {
        if (problem) return
        problem = reason
        const message = cancelSchema.parse({ version: PROTOCOL_VERSION, type: 'cancel', id })
        if (child.stdin.writable) child.stdin.end(encodeMessage(message))
        // Server cancellation gives direct tool children 500 ms to exit before SIGKILL.
        killTimer = setTimeout(() => child.kill('SIGKILL'), 2000)
      }
      cancel = () => { if (!terminal) stop(failure('CANCELLED', 'Operation cancelled')) }
      const abort = () => cancel()
      options.signal?.addEventListener('abort', abort, { once: true })
      const timer = setTimeout(() => stop(failure('TIMEOUT', 'Media worker exceeded its deadline', { retryable: true })), options.timeoutMs ?? this.options.timeoutMs ?? 30000)
      child.stdin.on('error', () => { stop(failure('WORKER_EXITED', 'Worker input pipe closed unexpectedly', { retryable: true })) })
      child.on('error', (error) => { problem ??= failure('SPAWN_FAILED', 'Could not start media worker', { diagnostic: error.message.slice(0,8192) }) })
      child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString('utf8')).slice(-8192) })
      child.stdout.on('data', (chunk: Buffer) => {
        try {
          decoder.push(chunk, (value) => {
            const message = serverMessageSchema.parse(value)
            if (terminal) throw failure('INVALID_MESSAGE', 'Worker sent a message after its terminal response')
            if (message.type === 'fatal') { terminal = new MediaWorkerError(message.error); return }
            if (message.id !== id) throw failure('INVALID_MESSAGE', 'Worker response has the wrong request ID')
            const operation = message.type === 'result' ? message.result.operation : message.operation
            if (operation !== request.task.operation) throw failure('INVALID_MESSAGE', 'Worker response has the wrong operation')
            switch (message.type) {
              case 'progress': if (!problem) options.onProgress?.(message); break
              case 'result': terminal = message.result; break
              case 'error': terminal = new MediaWorkerError(message.error); break
              case 'cancelled': terminal = failure('CANCELLED', 'Operation cancelled'); break
            }
          })
        } catch (error) {
          stop(error instanceof MediaWorkerError ? error : failure('INVALID_MESSAGE', 'Invalid worker response or progress callback failure'))
        }
      })
      child.on('close', (code, signal) => {
        clearTimeout(timer)
        clearTimeout(killTimer)
        options.signal?.removeEventListener('abort', abort)
        try { decoder.finish() } catch (error) { problem ??= error as MediaWorkerError }
        if (problem) reject(problem)
        else if (code !== 0) reject(failure('WORKER_EXITED', 'Media worker exited unexpectedly', { exitCode: code, signal, diagnostic: stderr, retryable: true }))
        else if (terminal instanceof MediaWorkerError) reject(terminal)
        else if (!terminal) reject(failure('WORKER_EXITED', 'Media worker exited without a result', { diagnostic: stderr, retryable: true }))
        // Both discriminants and the full result were validated above.
        else resolve(terminal as ResultFor<T>)
      })
      child.stdin.write(input)
    })
    const job = { id, result, cancel: () => cancel() }
    this.jobs.add(job)
    void result.then(() => this.jobs.delete(job), () => this.jobs.delete(job))
    return job
  }

  async close(): Promise<void> {
    this.closed = true
    const jobs = [...this.jobs]
    jobs.forEach((job) => job.cancel())
    await Promise.allSettled(jobs.map((job) => job.result))
  }
}
