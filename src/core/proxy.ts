import { z } from 'zod'
import { mediaFingerprintSchema } from './media'

/** WebM/VP8/Opus: formats the embedded Chromium player is guaranteed to decode, and libvpx/libopus stay outside the project's GPL exclusion. */
export const PROXY_CONVERSION_VERSION = 'ffmpeg-vp8-opus-webm-v1'

export const proxyCreateRequestSchema = z.strictObject({
  requestId: z.uuid(),
  fingerprint: mediaFingerprintSchema,
})
export type ProxyCreateRequest = z.infer<typeof proxyCreateRequestSchema>

export type ProxySupport = { supported: boolean; reason: string | null }

/**
 * Parses FFmpeg's own reported `-version` configuration line for the encoder libraries this proxy profile
 * needs. This inspects the actual configured tool rather than guessing, mirroring how ADR 0001 already treats
 * that configuration string as authoritative evidence.
 */
export function proxySupportFromConfiguration(ffmpegVersionOutput: string): ProxySupport {
  const hasVideoEncoder = /--enable-libvpx\b/.test(ffmpegVersionOutput)
  const hasAudioEncoder = /--enable-libopus\b/.test(ffmpegVersionOutput)
  if (hasVideoEncoder && hasAudioEncoder) return { supported: true, reason: null }
  const missing = [!hasVideoEncoder && 'VP8/VP9 (libvpx)', !hasAudioEncoder && 'Opus (libopus)'].filter(Boolean).join(' and ')
  return { supported: false, reason: `The configured FFmpeg build does not report ${missing} encoder support, so local proxy conversion is unavailable.` }
}
