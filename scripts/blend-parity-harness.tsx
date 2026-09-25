import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { BLEND_BACKDROP_STYLE, CompositionLayers, hasBlendedLayer, type CompositionLayer } from '../src/captions/CompositionLayers'
import { TextOverlayActor } from '../src/captions/TextOverlayActor'
import { ShapeActor } from '../src/captions/ShapeActor'
import { compareLayered } from '../src/core/graphicsOrder'
import type { Shape, TextOverlay } from '../src/core/edit'
import type { CaptionFrame } from '../src/captions/renderer'

declare global {
  interface Window {
    renderBlendScene(layers: CompositionLayer[], composition: { width: number; height: number }, marker: number): Promise<void>
    renderShapeBlendScene(layers: CompositionLayer[], titles: TextOverlay[], shapes: Shape[], timestampUs: number, composition: { width: number; height: number }, marker: number): Promise<void>
  }
}

/** Mounts picture layers exactly as `CaptionStage` does (the isolated black backdrop only when a layer blends),
 * plus a one-pixel marker in the corner so the parity script can tell this paint from a stale one. */
let root: ReturnType<typeof createRoot> | null = null
window.renderBlendScene = async (layers, composition, marker) => {
  document.documentElement.style.background = '#000'
  document.body.style.cssText = 'margin:0;background:#000;overflow:hidden'
  const host = document.getElementById('root') ?? document.body.appendChild(Object.assign(document.createElement('div'), { id: 'root' }))
  host.style.cssText = `position:relative;width:${composition.width}px;height:${composition.height}px;overflow:hidden`
  root ??= createRoot(host)
  flushSync(() => root!.render(<>
    <div style={{ position: 'absolute', inset: 0 }}>{hasBlendedLayer(layers)
      ? <div style={BLEND_BACKDROP_STYLE}><CompositionLayers layers={layers} composition={composition} /></div>
      : <CompositionLayers layers={layers} composition={composition} />}</div>
    <div style={{ position: 'absolute', right: 0, bottom: 0, width: 1, height: 1, background: `rgb(${marker >> 16 & 255},${marker >> 8 & 255},${marker & 255})` }} />
  </>))
  await Promise.all([...document.images].map((image) => image.decode()))
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
}

/** Shapes that blend, mounted as the live stage does: picture, titles and shapes together in `CaptionPreview`'s stacking
 * context, sorted by the shared layer order, each blending shape carrying its own CSS `mix-blend-mode` (`ShapeActor`'s
 * default). Resolves once every title's font layout is ready, so the paint is the final one. */
let shapeRoot: ReturnType<typeof createRoot> | null = null
window.renderShapeBlendScene = async (layers, titles, shapes, timestampUs, composition, marker) => {
  document.documentElement.style.background = '#000'
  document.body.style.cssText = 'margin:0;background:#000;overflow:hidden'
  const host = document.getElementById('root') ?? document.body.appendChild(Object.assign(document.createElement('div'), { id: 'root' }))
  host.style.cssText = `position:relative;width:${composition.width}px;height:${composition.height}px;overflow:hidden`
  const ready = new Map<string, boolean>()
  const graphics = [
    ...titles.map((item) => ({ order: item, node: <TextOverlayActor key={item.id} item={item} timestampUs={timestampUs} composition={composition}
      onFrame={(frame: CaptionFrame | null) => { ready.set(item.id, frame?.layout.status === 'ready') }} /> })),
    ...shapes.map((shape) => ({ order: shape, node: <ShapeActor key={shape.id} shape={shape} timestampUs={timestampUs} composition={composition} /> })),
  ].sort((a, b) => compareLayered(a.order, b.order))
  shapeRoot ??= createRoot(host)
  flushSync(() => shapeRoot!.render(<>
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 2 }}>
      <CompositionLayers layers={layers} composition={composition} />
      {graphics.map((entry) => entry.node)}
    </div>
    <div style={{ position: 'absolute', right: 0, bottom: 0, width: 1, height: 1, zIndex: 3, background: `rgb(${marker >> 16 & 255},${marker >> 8 & 255},${marker & 255})` }} />
  </>))
  const start = performance.now()
  while (titles.some((item) => !ready.get(item.id))) {
    if (performance.now() - start > 10000) throw new Error('Title layout never became ready')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  await Promise.all([...document.images].map((image) => image.decode()))
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
}
