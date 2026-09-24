/**
 * H.264 encoder selection for MP4 export. The frame/filter pipeline is identical everywhere; only
 * the `-c:v` block differs. macOS keeps VideoToolbox byte-for-byte (its argument arrays are
 * snapshot-tested); Windows prefers NVIDIA NVENC and falls back to Media Foundation, which drives
 * whatever hardware encoder the machine has (Intel/AMD/NVIDIA) or a software one.
 */
export type VideoEncoderId = 'h264_videotoolbox' | 'h264_nvenc' | 'h264_mf'

export const VIDEO_ENCODER_IDS: readonly VideoEncoderId[] = ['h264_videotoolbox', 'h264_nvenc', 'h264_mf']

export const DEFAULT_VIDEO_ENCODER: VideoEncoderId = 'h264_videotoolbox'

/** Preference order for a platform. A candidate is only used if the build lists it AND a real test encode succeeds. */
export function encoderCandidates(platform: NodeJS.Platform): VideoEncoderId[] {
  if (platform === 'darwin') return ['h264_videotoolbox']
  if (platform === 'win32') return ['h264_nvenc', 'h264_mf']
  return ['h264_nvenc']
}

/** Encoders named in `ffmpeg -encoders` output (each row is ` V....D name  description`). */
export function listedVideoEncoders(encodersOutput: string): VideoEncoderId[] {
  return VIDEO_ENCODER_IDS.filter((id) => new RegExp(`^\\s*V\\S*\\s+${id}\\s`, 'm').test(encodersOutput))
}

export function hasEncoder(encodersOutput: string, name: string): boolean {
  return new RegExp(`^\\s*[VAS]\\S*\\s+${name}\\s`, 'm').test(encodersOutput)
}

export function isVideoEncoderId(value: unknown): value is VideoEncoderId {
  return typeof value === 'string' && (VIDEO_ENCODER_IDS as readonly string[]).includes(value)
}

/** The `-c:v ... -b:v ...` block. `bitrate` is FFmpeg's own spelling (e.g. `8M` or `8000k`). */
export function videoEncoderArguments(encoder: VideoEncoderId, bitrate: string): string[] {
  switch (encoder) {
    case 'h264_videotoolbox':
      return ['-c:v', 'h264_videotoolbox', '-allow_sw', '1', '-profile:v', 'high', '-b:v', bitrate]
    case 'h264_nvenc':
      return ['-c:v', 'h264_nvenc', '-preset', 'p5', '-tune', 'hq', '-rc', 'vbr', '-profile:v', 'high', '-b:v', bitrate, '-maxrate', scaleBitrate(bitrate, 1.5), '-bufsize', scaleBitrate(bitrate, 2)]
    case 'h264_mf':
      return ['-c:v', 'h264_mf', '-hw_encoding', '1', '-rate_control', 'cbr', '-b:v', bitrate]
  }
}

/**
 * Pixel format handed to the encoder. Hardware Media Foundation encoders only negotiate NV12 and
 * fail to open on yuv420p ("format negotiation failed"); NV12 is the same 8-bit 4:2:0, so the MP4
 * is unchanged. Everything else keeps yuv420p (VideoToolbox's arguments are snapshot-pinned).
 */
export function videoEncoderPixelFormat(encoder: VideoEncoderId): string {
  return encoder === 'h264_mf' ? 'nv12' : 'yuv420p'
}

function scaleBitrate(bitrate: string, factor: number): string {
  const match = /^(\d+(?:\.\d+)?)([kKmM]?)$/.exec(bitrate)
  if (!match) return bitrate
  const value = Number(match[1]) * factor
  return `${Number.isInteger(value) ? value : Math.round(value * 10) / 10}${match[2]}`
}

/**
 * Arguments for a tiny real test encode with the export's own encoder block and pixel format, so a
 * passing probe means the real export's flags open too (a bare `-c:v h264_mf` probe passed while
 * `-hw_encoding 1` with yuv420p then failed mid-export).
 */
export function encoderProbeArguments(encoder: VideoEncoderId): string[] {
  return ['-v', 'error', '-nostdin', '-f', 'lavfi', '-i', 'color=c=black:s=256x256:d=0.2:r=10', '-frames:v', '2',
    ...videoEncoderArguments(encoder, '2M'), '-pix_fmt', videoEncoderPixelFormat(encoder), '-f', 'null', '-']
}
