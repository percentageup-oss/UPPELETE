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
/**
 * Frame-paint effects (docs/EDITING.md "Frame-paint effects"): pinned to the output frame, painted
 * by this same component in preview and export — no FFmpeg filter on either side, so parity is
 * exact rather than measured. Vignette and letterbox are meant for the `layers` slot (under
 * captions, like a host-painted overlay); fade is meant for `CaptionPreview`'s `overCaption` slot,
 * since a fade must cover the captions too.
 */
export type CompositionLayerVignette = { kind: 'vignette'; id: string; amount: number; softness: number }
export type CompositionLayerLetterbox = { kind: 'letterbox'; id: string; orientation: 'horizontal' | 'vertical'; barPx: number; color: string }
export type CompositionLayerFade = { kind: 'fade'; id: string; color: string; opacity: number }
export type CompositionLayer = CompositionLayerImage | CompositionLayerVideo | CompositionLayerBlur
  | CompositionLayerVignette | CompositionLayerLetterbox | CompositionLayerFade

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
    if (layer.kind === 'vignette') {
      // Softer (higher `softness`) starts darkening closer to the center; harder stays transparent
      // until near the rim. Painted the same way in preview and export — no FFmpeg equivalent needed.
      const innerStopPercent = 85 - layer.softness * 50
      return <div key={layer.id} data-vignette-id={layer.id} style={{ ...box(null),
        background: `radial-gradient(ellipse at center, transparent ${innerStopPercent}%, rgba(0,0,0,${layer.amount}) 100%)` }} />
    }
    if (layer.kind === 'letterbox') {
      const barPx = layer.barPx * scale
      if (barPx <= 0.5) return null
      const bars = layer.orientation === 'horizontal'
        ? [{ top: 0, left: 0, right: 0, height: barPx }, { bottom: 0, left: 0, right: 0, height: barPx }]
        : [{ top: 0, bottom: 0, left: 0, width: barPx }, { top: 0, bottom: 0, right: 0, width: barPx }]
      return <div key={layer.id} data-letterbox-id={layer.id} style={box(null)}>
        {bars.map((bar, index) => <div key={index} style={{ position: 'absolute', background: layer.color, ...bar }} />)}
      </div>
    }
    if (layer.kind === 'fade') return <div key={layer.id} data-fade-id={layer.id} style={{ ...box(null), background: layer.color, opacity: layer.opacity }} />
    if (layer.kind === 'video') return <VideoSlot key={layer.id} element={layer.element} fit={layer.fit} style={{ ...box(layer.rect), opacity: layer.opacity }} />
    const style: CSSProperties = { ...box(layer.rect), opacity: layer.opacity, objectFit: layer.fit === 'stretch' ? 'fill' : layer.fit }
    if (!layer.url) return <div key={layer.id} data-overlay-missing={layer.id} style={{ ...style, boxSizing: 'border-box',
      border: '1px dashed #ffda8b', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
      color: '#ffda8b', fontSize: 11, textAlign: 'center', background: '#10101066' }}>{layer.label}</div>
    return <img key={layer.id} data-overlay-id={layer.id} src={layer.url} draggable={false} alt="" style={style} />
  })}</>
}
