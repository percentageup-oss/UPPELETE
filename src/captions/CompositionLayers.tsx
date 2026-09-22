import { useLayoutEffect, useRef, type CSSProperties } from 'react'
import type { CompositionRect } from '../core/edit'
import { compositionScale } from '../core/composition'
import type { Size } from './renderer'

type Fit = 'contain' | 'cover' | 'stretch'

/** An image, already resolved to a concrete URL (or `null` for a missing asset, shown as a
 * placeholder in the editor preview — the export harness never sees `null`, since export refuses
 * before the job starts when an image is not registered). */
export type CompositionLayerImage = { kind?: 'image'; id: string; url: string | null; label: string; rect: CompositionRect | null; opacity: number; fit: Fit }
/** A pooled `<video>` owned by the playback transport, mounted — never created — by `VideoSlot`. */
export type CompositionLayerVideo = { kind: 'video'; id: string; element: HTMLVideoElement | null; label: string; rect: CompositionRect | null; opacity: number; fit: Fit }
/** An effect over everything painted below it (`backdrop-filter` blurs what is under the div). */
export type CompositionLayerBlur = { kind: 'blur'; id: string; rect: CompositionRect; radius: number }
export type CompositionLayer = CompositionLayerImage | CompositionLayerVideo | CompositionLayerBlur

/**
 * Mounts a pooled `<video>` into the composition. Letting React create and destroy `<video>` as the
 * layer list changes would reload the media on every change; appending the transport's element
 * keeps it decoding. Moving it between slots in one commit never pauses it.
 */
function VideoSlot({ element, style, fit }: { element: HTMLVideoElement | null; style: CSSProperties; fit: Fit }) {
  const host = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const parent = host.current
    if (!parent || !element) return
    Object.assign(element.style, { width: '100%', height: '100%', display: 'block', objectFit: fit === 'stretch' ? 'fill' : fit })
    parent.appendChild(element)
    return () => { if (element.parentNode === parent) parent.removeChild(element) }
  }, [element, fit])
  return <div ref={host} data-video-layer style={style} />
}

/**
 * Everything painted under the captions, in the same composition-unit space `CaptionView` draws in,
 * back to front in the order given: visual clips in track order, then blur. A `rect` of `null` fills
 * the frame. The caller does the time-visibility filtering and asset lookup (`App.tsx`'s
 * `CaptionStage` for the live preview, `frameHarness.tsx` from the already-resolved export frame
 * request) so this stays a pure paint of whatever list it is given. `composition` may be the fixed
 * 1080-unit preview space (scale 1) or an export harness's output-pixel composition
 * (`compositionScale`, matching `compositionToPixels`).
 */
export function CompositionLayers({ layers, composition }: { layers: readonly CompositionLayer[]; composition: Size }) {
  const scale = compositionScale(composition)
  if (!layers.length) return null
  const box = (rect: CompositionRect | null): CSSProperties => rect
    ? { position: 'absolute', left: rect.x * scale, top: rect.y * scale, width: rect.width * scale, height: rect.height * scale }
    : { position: 'absolute', left: 0, top: 0, width: composition.width, height: composition.height }
  return <>{layers.map((layer) => {
    if (layer.kind === 'blur') {
      const blur = `blur(${layer.radius * scale}px)`
      return <div key={layer.id} data-blur-id={layer.id} style={{ ...box(layer.rect), backdropFilter: blur, WebkitBackdropFilter: blur }} />
    }
    if (layer.kind === 'video') return <VideoSlot key={layer.id} element={layer.element} fit={layer.fit} style={{ ...box(layer.rect), opacity: layer.opacity }} />
    const style: CSSProperties = { ...box(layer.rect), opacity: layer.opacity, objectFit: layer.fit === 'stretch' ? 'fill' : layer.fit }
    if (!layer.url) return <div key={layer.id} data-overlay-missing={layer.id} style={{ ...style, boxSizing: 'border-box',
      border: '1px dashed #ffda8b', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
      color: '#ffda8b', fontSize: 11, textAlign: 'center', background: '#10101066' }}>{layer.label}</div>
    return <img key={layer.id} data-overlay-id={layer.id} src={layer.url} draggable={false} alt="" style={style} />
  })}</>
}
