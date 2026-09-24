import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { filePath, toolchainSchema, type Toolchain } from '../workers/media/protocol'

/** Gitignored, developer-only file at the app root; never read by packaged builds. */
export const LOCAL_TOOL_CONFIG_FILE = 'caption-studio.local.json'

export const localToolConfigSchema = z.strictObject({
  ffmpegPath: filePath.optional(),
  ffprobePath: filePath.optional(),
  whisperCliPath: filePath.optional(),
})

/** Returns the file's text, or undefined when it does not exist. Other read failures propagate. */
export function readLocalToolConfig(configPath: string): string | undefined {
  try {
    return readFileSync(configPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/** Tools shipped inside a packaged app, under <resources>/bin. Only files that exist are returned. */
export function bundledToolPaths(resourcesPath: string, platform: NodeJS.Platform): Partial<Record<'ffmpeg' | 'ffprobe' | 'whisperCli', string>> {
  const suffix = platform === 'win32' ? '.exe' : ''
  const found: Partial<Record<'ffmpeg' | 'ffprobe' | 'whisperCli', string>> = {}
  for (const [key, name] of [['ffmpeg', 'ffmpeg'], ['ffprobe', 'ffprobe'], ['whisperCli', 'whisper-cli']] as const) {
    const candidate = path.join(resourcesPath, 'bin', name + suffix)
    if (existsSync(candidate)) found[key] = candidate
  }
  return found
}

/**
 * Explicit absolute tool paths only: each CAPTION_STUDIO_* variable overrides the matching local-file
 * key. No PATH search. Malformed configuration fails loudly instead of silently disabling media tools.
 */
export function resolveToolchain(env: NodeJS.ProcessEnv, localConfigText: string | undefined, sourceLabel: string, bundled: Partial<Record<'ffmpeg' | 'ffprobe' | 'whisperCli', string>> = {}): Toolchain | undefined {
  let local: z.infer<typeof localToolConfigSchema> = {}
  if (localConfigText !== undefined) {
    let parsed: unknown
    try {
      parsed = JSON.parse(localConfigText)
    } catch (error) {
      throw new Error(`${sourceLabel} is not valid JSON: ${(error as Error).message}`)
    }
    const result = localToolConfigSchema.safeParse(parsed)
    if (!result.success) throw new Error(`${sourceLabel} is invalid:\n${z.prettifyError(result.error)}`)
    local = result.data
  }
  const ffmpegPath = env.CAPTION_STUDIO_FFMPEG_PATH || local.ffmpegPath || bundled.ffmpeg
  const ffprobePath = env.CAPTION_STUDIO_FFPROBE_PATH || local.ffprobePath || bundled.ffprobe
  const whisperCliPath = env.CAPTION_STUDIO_WHISPER_CLI_PATH || local.whisperCliPath || bundled.whisperCli
  if (Boolean(ffmpegPath) !== Boolean(ffprobePath)) throw new Error('Configure both media-tool executable paths')
  if (whisperCliPath && !ffmpegPath) throw new Error('Configure the FFmpeg/ffprobe pair together with whisper-cli; transcription extracts audio with FFmpeg')
  if (!ffmpegPath || !ffprobePath) return undefined
  return toolchainSchema.parse({ ffmpegPath, ffprobePath, ...(whisperCliPath ? { whisperCliPath } : {}) })
}
