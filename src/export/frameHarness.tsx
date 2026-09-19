import { useCallback, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { CaptionPreview } from '../captions/CaptionPreview'
import { CompositionLayers } from '../captions/CompositionLayers'
import { captionStyleInputs, type CaptionStyle } from '../captions/style'
import type { CaptionFrame } from '../captions/renderer'
import { frameRequestSchema, parityState, type FrameRequest } from './frameRequest'
import { parityFixture } from './parityFixture'
import { emphasisRuns, sliceEmphasis } from '../core/emphasis'
import { captionFixtures } from '../captions/fixtures'

let setRequest: (request: FrameRequest) => void
let evaluated: CaptionFrame | null = null
let current: FrameRequest = parityFixture
const interactive = new URLSearchParams(location.search).has('interactive')

function Harness() {
  const [request, update] = useState(parityFixture)
  setRequest = update
  const observe = useCallback((frame: CaptionFrame | null) => { evaluated = frame }, [])
  const inputs = captionStyleInputs(request.style, request.composition)
  const edit = (style: CaptionStyle) => {
    current = { ...request, style }; evaluated = null; update(current)
  }
  // Already resolved and time-filtered by `frameRequestAt` — every overlay in a v2 request is
  // visible at exactly this frame's timestamp, so no further lookup or filtering happens here.
  const images = request.version === 2
    ? request.overlays.map((overlay) => ({ id: overlay.id, url: overlay.assetUrl, label: overlay.id, rect: overlay.rect, opacity: overlay.opacity, fit: overlay.fit }))
    : []
  return <>
    <div style={{ position: 'relative', ...request.composition }}>
      <CaptionPreview {...request} inputs={inputs} motion={request.style.motion} onFrame={observe} diagnostics={false}
        layers={<CompositionLayers images={images} composition={request.composition} />} />
    </div>
    {interactive && <div style={{ position: 'fixed', top: 0, left: 0 }}>
      <label>Primary color <input id="parity-color" type="color" value={request.style.appearance.primaryColor}
        onChange={(event) => edit({ ...request.style, appearance: { ...request.style.appearance, primaryColor: event.target.value } })} /></label>
    </div>}
    <div id="frame-marker" style={{ position: 'fixed', bottom: 0, right: 0, width: 1, height: 1 }} />
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
  while (!evaluated || evaluated.layout.status === 'loading' || (evaluated.layout.status === 'ready' && !projectionReady())) {
    if (performance.now() - start > 10000) throw new Error('Caption font/geometry readiness timeout')
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  if (evaluated.layout.status !== 'ready') throw new Error('Caption font failed; refusing frame')
  const overlayImages = [...document.querySelectorAll<HTMLImageElement>('[data-overlay-id]')]
  await Promise.all(overlayImages.map((img) => img.decode().catch(() => {
    throw new Error(`Overlay asset failed to load: ${img.src}`)
  })))
  for (const line of document.querySelectorAll('[data-caption-line]')) {
    const entry = evaluated.layout.lines[Number((line as HTMLElement).dataset.captionLine)]
    if (evaluated.layout.inputs.emphasized?.length) {
      const runs = emphasisRuns(entry.text, sliceEmphasis(evaluated.layout.inputs.emphasized, entry.textStart, entry.textEnd))
      if (line.children.length !== runs.length) throw new Error('Selected emphasis run count differs')
      for (const [index, child] of [...line.children].entries()) {
        const leaves = child.children.length ? [...child.querySelectorAll('*')].filter((element) => !element.children.length) : [child]
        if (leaves.some((leaf) => leaf.textContent !== runs[index].text)) throw new Error('Fragmented selected word/grapheme')
      }
    } else {
      const leaves = line.children.length ? [...line.querySelectorAll('*')].filter((element) => !element.children.length) : [line]
      if (leaves.some((leaf) => leaf.textContent !== entry.text)) throw new Error('Fragmented shaping run')
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
      evaluated = null; current = request
      flushSync(() => setRequest(request))
      const result = await ready()
      document.getElementById('frame-marker')!.style.background = `rgb(${marker & 255}, ${(marker >> 8) & 255}, ${(marker >> 16) & 255})`
      return result
    },
    async editedState() { await ready(); return current },
  },
})
