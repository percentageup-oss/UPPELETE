import { useEffect, useState } from 'react'
import { THUMB_WIDTH } from '../color/lookThumbnail'
import type { PixelImage } from '../color/referenceMatch'

/**
 * A downscaled RGBA copy of the frame a pooled `<video>` is showing, or null when it has no decoded
 * frame yet or the canvas is unreadable. The `media:` scheme is CORS-enabled and pooled videos set
 * `crossOrigin = 'anonymous'` (`useProjectPlayback.ts`), so `getImageData` is not blocked; the
 * try/catch still guards a tainted canvas rather than letting it throw into a render. The pixels are
 * the ungraded source frame (what an adjustment layer would receive), possibly from a lower-resolution
 * playback proxy — fine for a thumbnail or for statistics.
 */
export function captureFrame(video: HTMLVideoElement | null, width = THUMB_WIDTH): PixelImage | null {
  if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return null
  const height = Math.max(1, Math.round((width * video.videoHeight) / video.videoWidth))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return null
  try {
    context.drawImage(video, 0, 0, width, height)
    return context.getImageData(0, 0, width, height)
  } catch { return null }
}

/** Re-captures the playhead frame while `enabled`, once the playhead has been still for `settleMs`
 * — so scrubbing and playback never pay for it. `deps` are whatever should trigger a fresh capture
 * (playhead time, which clip is under it, the video pool version). */
export function useColorFrame(enabled: boolean, getElement: () => HTMLVideoElement | null, deps: readonly unknown[], settleMs = 250): PixelImage | null {
  const [frame, setFrame] = useState<PixelImage | null>(null)
  useEffect(() => {
    if (!enabled) return
    const timer = window.setTimeout(() => setFrame(captureFrame(getElement())), settleMs)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `getElement` is a fresh closure each render; `deps` carries what matters
  }, [enabled, settleMs, ...deps])
  return frame
}
