import { extractAudio } from './audio'
import { renderVideo } from './export'
import { runExecutable } from './process'
import { probeMedia } from './probe'
import { createProxy } from './proxy'
import { detectSilence } from './silence'
import { extractThumbnails } from './thumbnails'
import { extractWaveform } from './waveform'
import { inspectWhisper, transcribeWithWhisper, writeSpeechChunks } from './whisper'
import { failure, type MediaResult, type MediaTask, type ProgressMessage, type Toolchain } from './protocol'

const WHISPER_NOT_CONFIGURED = 'Configure an explicit local whisper-cli executable path (CAPTION_STUDIO_WHISPER_CLI_PATH) together with the ffmpeg/ffprobe pair; no speech engine is bundled or downloaded automatically'

export async function execute(task: MediaTask, tools: Toolchain | undefined, signal: AbortSignal,
  progress: (value: ProgressMessage['progress']) => void): Promise<MediaResult> {
  if (signal.aborted) throw failure('CANCELLED', 'Operation cancelled')
  switch (task.operation) {
    case 'runtime':
      return { operation: 'runtime', pid: process.pid, platform: process.platform, architecture: process.arch, nodeVersion: process.versions.node }
    case 'inspectToolchain': {
      if (!tools) throw failure('TOOL_NOT_CONFIGURED', 'Configure explicit local ffmpeg and ffprobe executable paths; no binaries are bundled or downloaded automatically')
      progress({ kind: 'indeterminate', phase: 'inspecting-tools' })
      const inspect = async (executable: string) => ({
        versionOutput: await runExecutable(executable, ['-version'], signal),
        licenseOutput: await runExecutable(executable, ['-L'], signal),
      })
      const ffmpeg = await inspect(tools.ffmpegPath)
      const ffprobe = await inspect(tools.ffprobePath)
      return { operation: 'inspectToolchain', ffmpeg, ffprobe }
    }
    case 'probe': {
      if (!tools) throw failure('TOOL_NOT_CONFIGURED', 'Configure the selected local ffmpeg and ffprobe pair before opening media; no binaries are downloaded automatically')
      progress({ kind: 'indeterminate', phase: 'probing' })
      return probeMedia(tools.ffprobePath, task.inputPath, signal)
    }
    case 'waveform': {
      if (!tools) throw failure('TOOL_NOT_CONFIGURED', 'Configure the selected local ffmpeg and ffprobe pair before extracting a waveform; no binaries are downloaded automatically')
      return extractWaveform(tools.ffmpegPath, task, signal, progress)
    }
    case 'thumbnails': {
      if (!tools) throw failure('TOOL_NOT_CONFIGURED', 'Configure the selected local ffmpeg and ffprobe pair before extracting thumbnails; no binaries are downloaded automatically')
      return extractThumbnails(tools.ffmpegPath, task, signal, progress)
    }
    case 'proxy': {
      if (!tools) throw failure('TOOL_NOT_CONFIGURED', 'Configure the selected local ffmpeg and ffprobe pair before creating a local proxy; no binaries are downloaded automatically')
      return createProxy(tools.ffmpegPath, task, signal, progress)
    }
    case 'extractAudio': {
      if (!tools) throw failure('TOOL_NOT_CONFIGURED', 'Configure the selected local ffmpeg and ffprobe pair before extracting audio; no binaries are downloaded automatically')
      return extractAudio(tools.ffmpegPath, task, signal, progress)
    }
    case 'detectSilence': {
      if (!tools) throw failure('TOOL_NOT_CONFIGURED', 'Configure the selected local ffmpeg and ffprobe pair before detecting silence; no binaries are downloaded automatically')
      return detectSilence(tools.ffmpegPath, task, signal, progress)
    }
    case 'inspectWhisper': {
      if (!tools?.whisperCliPath) throw failure('TOOL_NOT_CONFIGURED', WHISPER_NOT_CONFIGURED)
      return inspectWhisper(tools.whisperCliPath, task, signal, progress)
    }
    case 'whisperTranscribe': {
      if (!tools?.whisperCliPath) throw failure('TOOL_NOT_CONFIGURED', WHISPER_NOT_CONFIGURED)
      return transcribeWithWhisper(tools.whisperCliPath, task, signal, progress)
    }
    case 'speechChunks':
      return writeSpeechChunks(task, signal, progress)
    case 'export': {
      if (!tools) throw failure('TOOL_NOT_CONFIGURED', 'Configure the selected local ffmpeg and ffprobe pair before exporting video; no binaries are downloaded automatically')
      return renderVideo(task, tools, signal, progress)
    }
    default: {
      // Every operation defined in the protocol is now handled above; this only guards
      // against a future task variant being added here without a matching case.
      const unhandled: never = task
      throw failure('UNSUPPORTED_OPERATION', `${(unhandled as MediaTask).operation} is not implemented yet`)
    }
  }
}
