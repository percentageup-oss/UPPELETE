export type ExportSupport = { supported: boolean; reason: string | null }

/**
 * Parses FFmpeg's own reported `-version` configuration line for the exact profile MP4 export
 * needs, mirroring how `proxySupportFromConfiguration` treats that string as authoritative
 * evidence for the configured tool rather than an assumed build. Export is macOS-only in this
 * slice: `h264_videotoolbox` has no equivalent enabled here on other platforms (see ADR 0004).
 */
export function exportSupportFromConfiguration(ffmpegVersionOutput: string, platform: NodeJS.Platform): ExportSupport {
  if (platform !== 'darwin') return { supported: false, reason: 'MP4 export currently requires macOS and its VideoToolbox hardware encoder; this platform is not yet supported.' }
  const forbidden = ['--enable-gpl', '--enable-version3', '--enable-nonfree']
  const required = ['--disable-gpl', '--disable-version3', '--disable-nonfree', '--disable-autodetect', '--disable-network', '--enable-zlib', '--enable-videotoolbox']
  if (!/version 9\.0\.1(?:\s|[-])/.test(ffmpegVersionOutput)) return { supported: false, reason: 'Configure the pinned FFmpeg 9.0.1 build; export needs its exact profile and encoder set.' }
  if (forbidden.some((flag) => ffmpegVersionOutput.includes(flag)) || !required.every((flag) => ffmpegVersionOutput.includes(flag))) {
    return { supported: false, reason: 'Configure the pinned FFmpeg 9.0.1 LGPL/no-network build with --enable-zlib and --enable-videotoolbox; this tool pair is outside the selected export profile.' }
  }
  return { supported: true, reason: null }
}
