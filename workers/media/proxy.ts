import { PROXY_CONVERSION_VERSION } from '../../src/core/proxy'
import { runExecutableCapture } from './process'
import { failure, type MediaResult, type MediaTask, type ProgressMessage } from './protocol'

export { PROXY_CONVERSION_VERSION }
const MAX_PROGRESS_OUTPUT_BYTES = 4 * 1024 * 1024
/** Bounds proxy dimensions; the proxy exists to be decodable and editable, not to match source quality. */
const PROXY_MAX_DIMENSION = 1280

type ProxyTask = Extract<MediaTask, { operation: 'proxy' }>
type ProxyResult = Extract<MediaResult, { operation: 'proxy' }>
type Progress = (value: ProgressMessage['progress']) => void
type ToolRunner = typeof runExecutableCapture

function progressObserver(totalUs: number, progress: Progress) {
  let text = ''
  let lastReported = -1
  let lastMeasuredUs = 0
  const report = (completed: number) => {
    lastMeasuredUs = completed
    const bounded = Math.max(0, Math.min(totalUs, completed))
    if (bounded === lastReported) return
    const threshold = Math.max(100_000, Math.floor(totalUs / 100))
    if (bounded !== totalUs && bounded - lastReported < threshold) return
    lastReported = bounded
    progress({ kind: 'measured', phase: 'proxy', completed: bounded, total: totalUs, unit: 'sourceUs' })
  }
  return {
    push(chunk: Buffer) {
      text += chunk.toString('utf8')
      if (text.length > 8192) throw failure('OUTPUT_LIMIT', 'FFmpeg progress line exceeded its limit')
      let newline = text.indexOf('\n')
      while (newline >= 0) {
        const line = text.slice(0, newline).trim()
        text = text.slice(newline + 1)
        if (line.startsWith('out_time_us=')) {
          const value = Number(line.slice('out_time_us='.length))
          if (Number.isSafeInteger(value) && value >= 0) report(value)
        }
        newline = text.indexOf('\n')
      }
    },
    finish() { report(totalUs) },
    lastMeasuredUs() { return lastMeasuredUs },
  }
}

export async function createProxy(ffmpegPath: string, task: ProxyTask, signal: AbortSignal, progress: Progress,
  dependencies: { runTool?: ToolRunner } = {}): Promise<ProxyResult> {
  const observer = progressObserver(task.durationUs, progress)
  await (dependencies.runTool ?? runExecutableCapture)(ffmpegPath, [
    '-v', 'error', '-nostdin', '-stats_period', '1', '-i', task.inputPath,
    '-map', '0:v:0', '-map', '0:a:0?',
    '-vf', `scale='min(${PROXY_MAX_DIMENSION},iw)':-2`,
    '-c:v', 'libvpx', '-crf', '30', '-b:v', '0', '-deadline', 'realtime', '-cpu-used', '5',
    '-c:a', 'libopus', '-b:a', '128k',
    '-f', 'webm', '-progress', 'pipe:1', task.outputPath,
  ], signal, MAX_PROGRESS_OUTPUT_BYTES, { onStdout: (chunk) => observer.push(chunk) })
  if (signal.aborted) throw failure('CANCELLED', 'Operation cancelled')
  observer.finish()
  return { operation: 'proxy', path: task.outputPath, durationUs: observer.lastMeasuredUs() || task.durationUs }
}
