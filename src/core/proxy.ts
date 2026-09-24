import { z } from 'zod'
import { mediaFingerprintSchema } from './media'

/** WebM/VP8/Opus: formats the embedded Chromium player is guaranteed to decode, and libvpx/libopus stay outside the project's GPL exclusion. */
export const PROXY_CONVERSION_VERSION = 'ffmpeg-vp8-opus-webm-v2'

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

/**
 * Automatic *playback* proxies (docs/STATUS.md): a background, cached transcode of large source
 * video routed only into the preview `<video>` element, never into export, transcription,
 * waveform extraction, thumbnails or export parity — those always resolve the original file
 * through their own paths and never call anything in this section. This is a different concern
 * from the manual, save-dialog-driven conversion above (`proxyCreateRequestSchema`), which exists
 * for a source Chromium cannot decode at all; that path is unaffected by any of this.
 */
export const playbackProxyModeSchema = z.enum(['off', 'auto', 'always'])
export type PlaybackProxyMode = z.infer<typeof playbackProxyModeSchema>

/** 'auto' skips generating a proxy for a source whose short edge is already at or below this —
 * such a source already plays smoothly, so a proxy would only cost disk and CPU for no benefit. */
export const PLAYBACK_PROXY_AUTO_THRESHOLD = 1080

export function shouldRequestPlaybackProxy(mode: PlaybackProxyMode, metadata: { width: number | null; height: number | null } | null): boolean {
  if (mode === 'off' || !metadata?.width || !metadata.height) return false
  if (mode === 'always') return true
  return Math.min(metadata.width, metadata.height) > PLAYBACK_PROXY_AUTO_THRESHOLD
}

export const playbackProxyStateSchema = z.enum(['queued', 'generating', 'ready', 'failed', 'unavailable'])
export type PlaybackProxyState = z.infer<typeof playbackProxyStateSchema>

export const playbackProxyStatusSchema = z.strictObject({
  fingerprint: mediaFingerprintSchema,
  state: playbackProxyStateSchema,
  url: z.string().min(1).nullable(),
  reason: z.string().max(2048).nullable(),
})
export type PlaybackProxyStatus = z.infer<typeof playbackProxyStatusSchema>

export const playbackProxyEnsureRequestSchema = z.strictObject({
  fingerprint: mediaFingerprintSchema,
  durationUs: z.number().int().nonnegative(),
})
export type PlaybackProxyEnsureRequest = z.infer<typeof playbackProxyEnsureRequestSchema>

export type PlaybackProxyOverride = 'proxy' | 'original' | null

/**
 * What the preview `<video>` element should actually load. A proxy is only ever returned once its
 * status is 'ready' with a URL — a queued, still-generating or failed proxy never interrupts
 * playback of the original, so preview never blocks on, or breaks because of, background transcode
 * work. `override` is the per-viewer "Proxy / Original" toggle; 'original' always wins (checking
 * full-quality framing), 'proxy' uses a ready proxy even under a mode that would not normally have
 * requested one (e.g. a stale one from a previous 'always' session), and `null` just follows `mode`.
 */
export function playbackUrlFor(originalUrl: string | null, proxy: PlaybackProxyStatus | undefined, mode: PlaybackProxyMode, override: PlaybackProxyOverride): string | null {
  const ready = proxy?.state === 'ready' && proxy.url ? proxy.url : null
  if (override === 'original') return originalUrl
  if (override === 'proxy') return ready ?? originalUrl
  if (mode === 'off') return originalUrl
  return ready ?? originalUrl
}
