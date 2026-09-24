import { encoderCandidates, hasEncoder, listedVideoEncoders } from './exportEncoder'

export type ExportSupport = { supported: boolean; reason: string | null }

const MIN_LOCAL_FFMPEG_MAJOR = 7

/**
 * Parses FFmpeg's own reported `-version` configuration line (and, off macOS, its `-encoders` list)
 * as authoritative evidence for the configured tool rather than an assumed build.
 *
 * macOS keeps the strict pinned profile (exact FFmpeg 9.0.1, LGPL/no-network, `--enable-videotoolbox`).
 * Windows/Linux are for local use: any FFmpeg >= 7 with the PNG codec and at least one candidate H.264
 * encoder (NVENC, Media Foundation) listed. A GPL build is accepted there only because nothing is
 * redistributed; the actual encoder is confirmed by a real test encode before an export starts.
 */
export function exportSupportFromConfiguration(ffmpegVersionOutput: string, platform: NodeJS.Platform, encodersOutput?: string): ExportSupport {
  if (platform === 'darwin') return macSupport(ffmpegVersionOutput)
  const major = /version\s+n?(\d+)\./.exec(ffmpegVersionOutput)?.[1]
  if (!major || Number(major) < MIN_LOCAL_FFMPEG_MAJOR) {
    return { supported: false, reason: `MP4 export needs FFmpeg ${MIN_LOCAL_FFMPEG_MAJOR} or newer; the configured build does not report a usable version.` }
  }
  if (encodersOutput === undefined) return { supported: false, reason: 'Could not read the FFmpeg encoder list.' }
  if (!hasEncoder(encodersOutput, 'png')) {
    return { supported: false, reason: 'The configured FFmpeg build has no PNG codec (zlib), which the caption-frame pipe needs.' }
  }
  const listed = listedVideoEncoders(encodersOutput)
  if (!encoderCandidates(platform).some((candidate) => listed.includes(candidate))) {
    return { supported: false, reason: `The configured FFmpeg build lists no usable H.264 hardware encoder (${encoderCandidates(platform).join(' or ')}). Use a build with NVENC or Media Foundation.` }
  }
  return { supported: true, reason: null }
}

function macSupport(ffmpegVersionOutput: string): ExportSupport {
  const forbidden = ['--enable-gpl', '--enable-version3', '--enable-nonfree']
  const required = ['--disable-gpl', '--disable-version3', '--disable-nonfree', '--disable-autodetect', '--disable-network', '--enable-zlib', '--enable-videotoolbox']
  if (!/version 9\.0\.1(?:\s|[-])/.test(ffmpegVersionOutput)) return { supported: false, reason: 'Configure the pinned FFmpeg 9.0.1 build; export needs its exact profile and encoder set.' }
  if (forbidden.some((flag) => ffmpegVersionOutput.includes(flag)) || !required.every((flag) => ffmpegVersionOutput.includes(flag))) {
    return { supported: false, reason: 'Configure the pinned FFmpeg 9.0.1 LGPL/no-network build with --enable-zlib and --enable-videotoolbox; this tool pair is outside the selected export profile.' }
  }
  return { supported: true, reason: null }
}
