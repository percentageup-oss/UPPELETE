import { useEffect, useSyncExternalStore } from 'react'
import type { Clip, ProjectAsset } from '../core/edit'
import type { WaveformData } from '../core/waveform'
import { stripKey, type ThumbnailQueue } from './thumbnailQueue'
import { ClipWaveform } from './waveformPath'

const THUMBNAIL_PIXEL_WIDTH = 160
/** Tile counts are quantised so a small zoom or resize does not re-request a strip. */
const COUNTS = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64]

export function thumbnailCountFor(widthPx: number, heightPx: number): number {
  const tileWidthPx = Math.max(80, Math.round(heightPx * 16 / 9 / 40) * 40)
  const wanted = Math.max(1, Math.round(widthPx / tileWidthPx))
  return COUNTS.find((count) => count >= wanted) ?? COUNTS[COUNTS.length - 1]
}

/** A video clip's filmstrip of its own source range, with its sound as a band along the bottom. */
export function VideoClipContent({ clip, asset, widthPx, heightPx, visible, queue, waveform }: {
  clip: Clip; asset: ProjectAsset | null; widthPx: number; heightPx: number; visible: boolean
  queue: ThumbnailQueue | null; waveform: WaveformData | null
}) {
  const request = asset?.fingerprint && asset.kind !== 'audio' && clip.kind === 'video'
    ? { fingerprint: asset.fingerprint, sourceStartUs: clip.sourceStartUs, sourceEndUs: clip.sourceEndUs, ...(clip.speed ? { speed: clip.speed } : {}), count: thumbnailCountFor(widthPx, heightPx), width: THUMBNAIL_PIXEL_WIDTH }
    : null
  const key = request ? stripKey(request) : null
  // Asking is a side effect, so it happens here rather than while rendering; only visible clips ask.
  useEffect(() => { if (request && queue && visible) queue.get(request, true) }, [key, queue, visible])
  const state = useSyncExternalStore(
    (listener) => request && queue ? queue.subscribe(request, listener) : () => {},
    () => request && queue ? queue.get(request, false).state : 'idle',
    () => 'idle' as const,
  )
  const images = request && queue && state === 'ready' ? [...queue.get(request, false).images].sort((a, b) => a.requestedUs - b.requestedUs) : []
  return <>
    {images.length > 0 && <div className="thumbnail-strip">
      {images.map((image, index) => <img key={image.requestedUs} src={image.dataUrl} alt="" loading="lazy"
        style={{ left: `${index * 100 / images.length}%`, width: `${100 / images.length}%` }} />)}
    </div>}
    {/* Only a video that still carries its own sound draws it here; a detached video's waveform lives on its audio lane. */}
    {waveform && clip.kind === 'video' && !clip.detachedAudio && <ClipWaveform waveform={waveform} sourceStartUs={clip.sourceStartUs} sourceEndUs={clip.sourceEndUs} speed={clip.speed} className="waveform clip-audio-band" />}
  </>
}
