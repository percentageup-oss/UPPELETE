import { useCallback, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { CaptionPreview } from '../captions/CaptionPreview'
import { CompositionLayers, pinnedEffectLayers, type CompositionLayer } from '../captions/CompositionLayers'
import { captionStyleInputs, type CaptionStyle } from '../captions/style'
import type { CaptionFrame } from '../captions/renderer'
import { frameRequestSchema, parityState, type FrameRequest } from './frameRequest'
import { parityFixture } from './parityFixture'
import { isFragmentedLine } from './shaping'
import { emphasisRuns, sliceEmphasis } from '../core/emphasis'
import { captionFixtures } from '../captions/fixtures'
import { TextOverlayActor } from '../captions/TextOverlayActor'

let setRequest: (request: FrameRequest) => void
let evaluated: CaptionFrame | null = null
const evaluatedTexts = new Map<string, CaptionFrame | null>()
let current: FrameRequest = parityFixture
const interactive = new URLSearchParams(location.search).has('interactive')
/** `loading` events since the current frame was requested: a font that never settles and a font state
 * that keeps re-arming itself both read "fonts still loading" — this count tells them apart. */
let fontLoadingEvents = 0
document.fonts.addEventListener('loading', () => { fontLoadingEvents++ })
/** The last uncaught page error. React unmounts the whole tree when a render throws, which leaves the
 * previous (still `loading`) frame behind and otherwise looks exactly like a slow font. */
let pageError: string | null = null
window.addEventListener('error', (event) => { pageError = `${event.message}${event.error?.stack ? ` @ ${String(event.error.stack).split('\n').slice(1, 3).join(' ').trim()}` : ''}` })
window.addEventListener('unhandledrejection', (event) => { pageError = `unhandled rejection: ${String((event.reason as Error)?.message ?? event.reason)}` })

function Harness() {
  const [request, update] = useState(parityFixture)
  setRequest = update
  const observe = useCallback((frame: CaptionFrame | null) => { evaluated = frame }, [])
  const inputs = captionStyleInputs(request.style, request.composition)
  const edit = (style: CaptionStyle) => {
    current = { ...request, style }; evaluated = null; update(current)
  }
  // Already resolved and time-filtered by `frameRequestAt`/`frameRequestAtSequence` — every overlay
  // in a v2/v3 request is visible at exactly this frame's timestamp, so no further lookup or
  // filtering happens here.
  const images = request.version === 2 || request.version === 3 || request.version === 4
    ? request.overlays.map((overlay) => ({ id: overlay.id, url: overlay.assetUrl, label: overlay.id, rect: overlay.rect, opacity: overlay.opacity, fit: overlay.fit, mask: overlay.mask }))
    : []
  // Frame-paint effects (docs/EDITING.md "Frame-paint effects"): already evaluated by
  // `frameEffectsAt` server-side (`plan.ts`'s `frameRequestAtSequence`) — this only paints them,
  // with the same `CompositionLayers` component and pinned/over-caption split live preview uses.
  const frameEffects = request.version === 3 || request.version === 4 ? request.frameEffects : {}
  // v5 is a mask rasterization request: one opaque white fill through the mask, so alpha is the mask.
  const maskFill: CompositionLayer[] = request.version === 5 ? [{ kind: 'fade', id: 'mask-fill', color: '#ffffff', opacity: 1, mask: request.maskFill }] : []
  const pinnedLayers: CompositionLayer[] = [
    ...images,
    ...maskFill,
    ...pinnedEffectLayers(frameEffects),
  ]
  const fadeLayers: CompositionLayer[] = frameEffects.fade ? [{ kind: 'fade', id: 'fade', color: frameEffects.fade.color, opacity: frameEffects.fade.opacity, mask: frameEffects.fade.mask }] : []
  const textActors = request.version === 4 ? request.textActors : []
  const actorNode = (actor: (typeof textActors)[number]) => <TextOverlayActor key={actor.item.id} item={actor.item} timestampUs={actor.timestampUs} composition={request.composition}
    onFrame={(frame) => evaluatedTexts.set(actor.item.id, frame)} />
  const belowText = textActors.filter((actor) => actor.item.layerOrder < 0).map(actorNode)
  const aboveText = textActors.filter((actor) => actor.item.layerOrder >= 0).map(actorNode)
  return <>
    <div style={{ position: 'relative', ...request.composition }}>
      <CaptionPreview {...request} inputs={inputs} motion={request.style.motion} onFrame={observe} diagnostics={false} captionMask={request.captionMask}
        layers={<>{<CompositionLayers layers={pinnedLayers} composition={request.composition} />}{belowText}</>}
        overCaption={<>{aboveText}{fadeLayers.length ? <CompositionLayers layers={fadeLayers} composition={request.composition} /> : null}</>} />
    </div>
    {interactive && <div style={{ position: 'fixed', top: 0, left: 0 }}>
      <label>Primary color <input id="parity-color" type="color" value={request.style.appearance.primaryColor}
        onChange={(event) => edit({ ...request.style, appearance: { ...request.style.appearance, primaryColor: event.target.value } })} /></label>
    </div>}
    {/* Must stack above CaptionPreview's `zIndex: 2` context: full-frame layers (grain, VHS, vignette,
      * letterbox, corner overlays) otherwise hide the marker and the host never sees a committed paint. */}
    <div id="frame-marker" style={{ position: 'fixed', bottom: 0, right: 0, width: 1, height: 1, zIndex: 2147483647, pointerEvents: 'none' }} />
  </>
}

flushSync(() => createRoot(document.getElementById('root')!).render(<Harness />))

async function ready() {
  const start = performance.now()
  const projectionReady = () => {
    const painter = document.querySelector<HTMLElement>('[data-caption-preview] > div')
    if (!painter) return false
    const matrix = new DOMMatrixReadOnly(getComputedStyle(painter).transform)
    return matrix.a === 1 && matrix.d === 1 && painter.style.left === '0px' && painter.style.top === '0px'
  }
  while (!evaluated || evaluated.layout.status === 'loading' || (evaluated.layout.status === 'ready' && !projectionReady())
    || (current.version === 4 && current.textActors.some((actor) => {
      const frame = evaluatedTexts.get(actor.item.id)
      return !frame || frame.layout.status === 'loading'
    }))) {
    if (performance.now() - start > 10000) {
      // Which condition never held: no frame evaluated, fonts still loading, or the projection never reached 1:1.
      const unmet = !evaluated ? 'no frame evaluated' : evaluated.layout.status === 'loading' ? 'fonts still loading' : 'projection not 1:1'
      throw new Error(`Caption font/geometry readiness timeout after 10000 ms (${unmet}; document.fonts ${document.fonts.status}, ${fontLoadingEvents} loading events this frame${pageError ? `; page error: ${pageError}` : ''})`)
    }
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  if (evaluated.layout.status !== 'ready') throw new Error('Caption font failed; refusing frame')
  if (current.version === 4 && current.textActors.some((actor) => evaluatedTexts.get(actor.item.id)?.layout.status !== 'ready')) throw new Error('Text font failed; refusing frame')
  const overlayImages = [...document.querySelectorAll<HTMLImageElement>('[data-overlay-id]')]
  await Promise.all(overlayImages.map((img) => img.decode().catch(() => {
    throw new Error(`Overlay asset failed to load: ${img.src}`)
  })))
  for (const line of document.querySelectorAll('[data-caption-line]')) {
    const textId = line.closest<HTMLElement>('[data-text-overlay-id]')?.dataset.textOverlayId
    const frame = textId ? evaluatedTexts.get(textId) : evaluated
    if (!frame) throw new Error(`Missing text frame for shaping check: ${textId}`)
    const entry = frame.layout.lines[Number((line as HTMLElement).dataset.captionLine)]
    if (frame.layout.inputs.emphasized?.length) {
      const runs = emphasisRuns(entry.text, sliceEmphasis(frame.layout.inputs.emphasized, entry.textStart, entry.textEnd))
      if (line.children.length !== runs.length) throw new Error('Selected emphasis run count differs')
      for (const [index, child] of [...line.children].entries()) {
        const leaves = child.children.length ? [...child.querySelectorAll('*')].filter((element) => !element.children.length) : [child]
        if (leaves.some((leaf) => leaf.textContent !== runs[index].text)) throw new Error('Fragmented selected word/grapheme')
      }
    } else {
      const leaves = line.children.length ? [...line.querySelectorAll('*')].filter((element) => !element.children.length) : [line]
      if (isFragmentedLine(leaves.map((leaf) => leaf.textContent ?? ''), entry.text)) throw new Error('Fragmented shaping run')
    }
  }
  return { state: parityState(evaluated), readinessMs: performance.now() - start, fontsStatus: document.fonts.status }
}

// Only loaded by the separate local prototype. No production preload/IPC surface.
Object.assign(window, {
  x1: {
    sampleTexts: captionFixtures,
    async render(value: unknown, marker: number) {
      const request = frameRequestSchema.parse(value)
      evaluated = null; evaluatedTexts.clear(); current = request; fontLoadingEvents = 0; pageError = null
      flushSync(() => setRequest(request))
      const result = await ready()
      document.getElementById('frame-marker')!.style.background = `rgb(${marker & 255}, ${(marker >> 8) & 255}, ${(marker >> 16) & 255})`
      return result
    },
    async editedState() { await ready(); return current },
  },
})
