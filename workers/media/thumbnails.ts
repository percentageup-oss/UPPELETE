import path from 'node:path'
import { THUMBNAIL_EXTRACTION_VERSION } from '../../src/core/thumbnails'
import { decimalSecondsToUs } from './probe'
import { runExecutableCapture } from './process'
import { sourceTimeArgument } from './waveform'
import { failure, type MediaResult, type MediaTask, type ProgressMessage } from './protocol'

export { THUMBNAIL_EXTRACTION_VERSION }
const MAX_DIAGNOSTIC_OUTPUT_BYTES = 262_144

type ThumbnailsTask = Extract<MediaTask, { operation: 'thumbnails' }>
type ThumbnailsResult = Extract<MediaResult, { operation: 'thumbnails' }>
type Progress = (value: ProgressMessage['progress']) => void
type ToolRunner = typeof runExecutableCapture

/** Parses the `showinfo` filter's stderr line for the frame FFmpeg actually decoded, not the requested seek time. */
export function parseShowinfo(stderrText: string): { ptsUs: number; width: number; height: number } | null {
  const ptsMatch = stderrText.match(/pts_time:(-?\d+(?:\.\d+)?)/)
  const sizeMatch = stderrText.match(/\bs:(\d+)x(\d+)\b/)
  if (!ptsMatch || !sizeMatch) return null
  const ptsUs = decimalSecondsToUs(ptsMatch[1], true)
  const width = Number(sizeMatch[1])
  const height = Number(sizeMatch[2])
  if (ptsUs === null || !Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0) return null
  return { ptsUs, width, height }
}

export async function extractThumbnails(ffmpegPath: string, task: ThumbnailsTask, signal: AbortSignal, progress: Progress,
  dependencies: { runTool?: ToolRunner } = {}): Promise<ThumbnailsResult> {
  const total = task.timestampsUs.length
  const images: ThumbnailsResult['images'] = []
  for (let index = 0; index < total; index += 1) {
    if (signal.aborted) throw failure('CANCELLED', 'Operation cancelled')
    const requestedUs = task.timestampsUs[index]
    const outputPath = path.join(task.outputDirectory, `thumb-${index}.jpg`)
    const { stderr } = await (dependencies.runTool ?? runExecutableCapture)(ffmpegPath, [
      '-hide_banner', '-loglevel', 'info', '-nostdin', '-nostats',
      // -copyts: input seeking otherwise rebases decoded pts near zero, which would make every reported actualUs wrong.
      '-ss', sourceTimeArgument(requestedUs), '-copyts', '-i', task.inputPath,
      '-frames:v', '1', '-vf', `scale=${task.width}:-2,showinfo`,
      '-c:v', 'mjpeg', '-q:v', '3', '-f', 'image2', outputPath,
    ], signal, MAX_DIAGNOSTIC_OUTPUT_BYTES)
    if (signal.aborted) throw failure('CANCELLED', 'Operation cancelled')
    const info = parseShowinfo(stderr)
    if (!info) throw failure('TOOL_FAILED', 'FFmpeg did not report a decoded thumbnail frame timestamp', { diagnostic: stderr.slice(-8192) })
    images.push({ requestedUs, actualUs: Math.max(0, info.ptsUs), path: outputPath, width: info.width, height: info.height })
    progress({ kind: 'measured', phase: 'thumbnails', completed: index + 1, total, unit: 'items' })
  }
  return { operation: 'thumbnails', images }
}
