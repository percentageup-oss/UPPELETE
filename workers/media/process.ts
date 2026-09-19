import { spawn } from 'node:child_process'
import path from 'node:path'
import { failure, MediaWorkerError } from './protocol'

export type ExecutableOutput = { stdout: string; stderr: string }
export type ExecutableObserver = {
  onStdout?(chunk: Buffer): void
  onStderr?(chunk: Buffer): void
}

/** Internal worker helper. Executable/arguments never come from renderer requests. */
export function runExecutableCapture(executable: string, args: readonly string[], signal: AbortSignal, maxBytes = 65536,
  observer: ExecutableObserver = {}): Promise<ExecutableOutput> {
  if (!path.isAbsolute(executable) || executable.includes('\0')) return Promise.reject(failure('SPAWN_FAILED', 'Tool executable must be an absolute native path'))
  if (signal.aborted) return Promise.reject(failure('CANCELLED', 'Operation cancelled'))
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [...args], { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let bytes = 0
    let problem: MediaWorkerError | undefined
    let killTimer: ReturnType<typeof setTimeout> | undefined
    const stop = () => {
      child.kill('SIGTERM')
      killTimer ??= setTimeout(() => child.kill('SIGKILL'), 500)
    }
    const cancel = () => { problem ??= failure('CANCELLED', 'Operation cancelled'); stop() }
    signal.addEventListener('abort', cancel, { once: true })
    const consume = (target: Buffer[], chunk: Buffer, observe?: (chunk: Buffer) => void) => {
      bytes += chunk.length
      if (bytes > maxBytes) { problem ??= failure('OUTPUT_LIMIT', 'Tool output exceeded the diagnostic limit'); stop() }
      else {
        target.push(chunk)
        try { observe?.(chunk) }
        catch { problem ??= failure('INTERNAL_ERROR', 'Tool output observer failed'); stop() }
      }
    }
    child.stdout.on('data', (chunk: Buffer) => consume(stdoutChunks, chunk, observer.onStdout))
    child.stderr.on('data', (chunk: Buffer) => consume(stderrChunks, chunk, observer.onStderr))
    child.on('error', (error) => { problem ??= failure('SPAWN_FAILED', 'Could not start local media tool', { diagnostic: error.message.slice(0,8192) }) })
    child.on('close', (exitCode, exitSignal) => {
      clearTimeout(killTimer)
      signal.removeEventListener('abort', cancel)
      const stdout = Buffer.concat(stdoutChunks).toString('utf8')
      const stderr = Buffer.concat(stderrChunks).toString('utf8')
      if (problem) reject(problem)
      else if (exitCode !== 0) reject(failure('TOOL_FAILED', 'Local media tool failed', { exitCode, signal: exitSignal, diagnostic: `${stderr}${stdout}`.slice(-8192) }))
      else resolve({ stdout, stderr })
    })
  })
}

export async function runExecutable(executable: string, args: readonly string[], signal: AbortSignal, maxBytes = 65536): Promise<string> {
  const output = await runExecutableCapture(executable, args, signal, maxBytes)
  return `${output.stdout}${output.stderr}`
}
