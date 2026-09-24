import { encoderCandidates, encoderProbeArguments, isVideoEncoderId, listedVideoEncoders, type VideoEncoderId } from '../../src/core/exportEncoder'
import { runExecutable } from './process'

type ToolRunner = typeof runExecutable
export type EncoderSelection = { encoder: VideoEncoderId; encodersOutput: string; tried: string[] } | { reason: string }

const ENCODER_LIST_LIMIT_BYTES = 262_144
const selected = new Map<string, Extract<EncoderSelection, { encoder: VideoEncoderId }>>()

/**
 * Chooses the H.264 encoder for this machine. macOS is always VideoToolbox (unchanged, no probe).
 * Elsewhere each candidate the build lists gets a real tiny test encode — NVENC is routinely compiled
 * in yet unusable without an NVIDIA GPU/driver — and the first that succeeds wins for the session.
 * `CAPTION_STUDIO_EXPORT_ENCODER` (h264_nvenc | h264_mf) forces one candidate, e.g. to test the fallback.
 */
export async function selectVideoEncoder(ffmpegPath: string, signal: AbortSignal, runTool: ToolRunner = runExecutable,
  platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): Promise<EncoderSelection> {
  if (platform === 'darwin') return { encoder: 'h264_videotoolbox', encodersOutput: '', tried: [] }
  const forced = env.CAPTION_STUDIO_EXPORT_ENCODER
  const key = `${platform}|${ffmpegPath}|${forced ?? ''}`
  const cached = selected.get(key)
  if (cached) return cached
  const encodersOutput = await runTool(ffmpegPath, ['-hide_banner', '-encoders'], signal, ENCODER_LIST_LIMIT_BYTES)
  const listed = listedVideoEncoders(encodersOutput)
  let candidates = encoderCandidates(platform).filter((candidate) => listed.includes(candidate))
  if (forced) {
    if (!isVideoEncoderId(forced) || !candidates.includes(forced)) return { reason: `CAPTION_STUDIO_EXPORT_ENCODER=${forced} is not an available encoder here (${candidates.join(', ') || 'none listed'}).` }
    candidates = [forced]
  }
  const tried: string[] = []
  for (const candidate of candidates) {
    try {
      await runTool(ffmpegPath, encoderProbeArguments(candidate), signal)
      const result = { encoder: candidate, encodersOutput, tried }
      selected.set(key, result)
      return result
    } catch (error) {
      if (signal.aborted) throw error
      tried.push(candidate)
    }
  }
  const named = candidates.length ? `${candidates.join(' and ')} ${candidates.length > 1 ? 'were' : 'was'} listed but a test encode failed (no NVIDIA GPU/driver?)` : 'no NVENC or Media Foundation H.264 encoder is listed'
  return { reason: `MP4 export has no working H.264 encoder: ${named}.` }
}

export function resetVideoEncoderCacheForTests(): void { selected.clear() }
