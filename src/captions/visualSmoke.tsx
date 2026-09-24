// Test-only Vite entry point; never imported by the application.
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { CaptionPreview } from './CaptionPreview'
import { StylePanel } from '../StylePanel'
import { TemplatesPanel } from '../TemplatesPanel'
import { captionFixtures } from './fixtures'
import { defaultCaptionInputs, DEFAULT_FONT_STACK, type LayoutInputs, type MotionCue } from './renderer'
import { captionStyleInputs, DEFAULT_CAPTION_STYLE, MOTIONS, type CaptionMotion, type CaptionStyle, type SavedCaptionPreset } from './style'
import type { CaptionWord } from '../core/model'

const compositions = [{ width: 1080, height: 1920 }, { width: 1920, height: 1080 }]

// R1 static/geometry fixtures ------------------------------------------------------------------

function StaticFixtures() {
  return <>
    <h1 style={{ fontSize: 18 }}>R1 — actual Chromium Malayalam shaping / scale / fallback fixtures</h1>
    <p>Fixed source timestamp: 3,600,456,796 µs. System fonts only; no network fonts.</p>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
      {compositions.flatMap((composition, aspect) => captionFixtures.flatMap((fixture) => [1, .65].map((scale) => {
        const width = (aspect === 0 ? 270 : 480) * scale, height = (aspect === 0 ? 480 : 270) * scale
        const inputs = defaultCaptionInputs(composition)
        const fallback = fixture.id === 'decomposed' || fixture.id === 'punctuation'
        inputs.font.stack = fallback ? `"R1 nonexistent font", Arial, ${DEFAULT_FONT_STACK}` : DEFAULT_FONT_STACK
        return <section key={`${aspect}:${fixture.id}:${scale}`} data-case={fixture.id} data-aspect={aspect} data-scale={scale}>
          <p style={{ fontSize: 12 }}>{fixture.id} / {aspect ? 'landscape' : 'portrait'} / {scale} {fallback ? '/ fallback' : ''}</p>
          <div style={{ position: 'relative', width, height, background: 'linear-gradient(145deg,#344656,#11151e)', border: '1px solid #536171' }}>
            <div style={{ position: 'absolute', left: '10%', right: '10%', top: '8%', bottom: '12%', border: '1px dashed #687382' }} />
            <CaptionPreview composition={composition} inputs={inputs} cue={{ text: fixture.text, startUs: 3_600_000_007, endUs: 3_600_900_013 }} timestampUs={3_600_456_796} />
          </div>
        </section>
      })))}
    </div>
  </>
}

// R2 motion grid ---------------------------------------------------------------------------------
// A mixed Malayalam/English cue with model word timing, matching the fixture used by motion.test.tsx.
const MOTION_TEXT = 'മലയാളം subtitles ഉപയോഗിച്ച് React API'
const MOTION_TOKENS = [
  { text: 'മലയാളം', textStart: 0, textEnd: 6 }, { text: 'subtitles', textStart: 7, textEnd: 16 },
  { text: 'ഉപയോഗിച്ച്', textStart: 17, textEnd: 27 }, { text: 'React', textStart: 28, textEnd: 33 }, { text: 'API', textStart: 34, textEnd: 37 },
]
const MOTION_WORD_START = 3_600_000_000, MOTION_WORD_DURATION = 200_000, MOTION_GAP = 50_000, MOTION_LEAD_IN = 100_000
const motionWords: CaptionWord[] = MOTION_TOKENS.map((token, index) => {
  const startUs = MOTION_WORD_START + index * (MOTION_WORD_DURATION + MOTION_GAP)
  return { id: `mw${index}`, text: token.text, textStart: token.textStart, textEnd: token.textEnd, startUs, endUs: startUs + MOTION_WORD_DURATION, timingSource: 'model', needsReview: false }
})
const MOTION_CUE_START = MOTION_WORD_START - MOTION_LEAD_IN
const MOTION_CUE_END = motionWords.at(-1)!.endUs
const motionCue: MotionCue = { text: MOTION_TEXT, startUs: MOTION_CUE_START, endUs: MOTION_CUE_END, words: motionWords }
const midWordTimestamp = motionWords[2].startUs + MOTION_WORD_DURATION / 2 // inside "ഉപയോഗിച്ച്"
const gapTimestamp = motionWords[0].endUs + MOTION_GAP / 2 // between "മലയാളം" and "subtitles"

// Deliberately non-default appearance so appearance controls are visibly exercised alongside motion.
function styledMotionInputs(composition: { width: number; height: number }): LayoutInputs {
  const inputs = defaultCaptionInputs(composition)
  return { ...inputs, maxLines: 2, position: { horizontal: 0, vertical: 0 },
    appearance: { color: '#ffe9a8', secondaryColor: '#ff3d6c', outlineColor: '#220000', outlineWidth: 2,
      shadow: '0 4px 6px #000c', background: '#10131aE6', padding: 14, rotation: 0 } }
}

function MotionGrid() {
  return <>
    <h1 style={{ fontSize: 18 }}>R2 — motion preset grid, portrait and landscape</h1>
    <p>Mixed Malayalam/English model word timing. Mid-word timestamp {midWordTimestamp.toLocaleString('en-US')} µs; gap timestamp {gapTimestamp.toLocaleString('en-US')} µs.</p>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
      {compositions.flatMap((composition, aspect) => MOTIONS.flatMap((motion) => [
        { label: 'mid-word', timestampUs: midWordTimestamp }, { label: 'gap', timestampUs: gapTimestamp },
      ].map(({ label, timestampUs }) => {
        const width = aspect === 0 ? 270 : 480, height = aspect === 0 ? 480 : 270
        return <section key={`motion:${aspect}:${motion.id}:${label}`} data-motion-case={motion.id} data-aspect={aspect} data-moment={label}>
          <p style={{ fontSize: 12 }}>{motion.label} / {aspect ? 'landscape' : 'portrait'} / {label}</p>
          <div style={{ position: 'relative', width, height, background: 'linear-gradient(145deg,#344656,#11151e)', border: '1px solid #536171' }}>
            <div style={{ position: 'absolute', left: '10%', right: '10%', top: '8%', bottom: '12%', border: '1px dashed #687382' }} />
            <CaptionPreview composition={composition} inputs={styledMotionInputs(composition)} cue={motionCue} timestampUs={timestampUs} motion={motion.id} />
          </div>
        </section>
      })))}
      <MotionEdgeCase id="estimated-timing" label="Estimated word timing (labelled, not aligned)" motion="word-pop"
        cue={{ ...motionCue, words: motionWords.map((word) => ({ ...word, timingSource: 'estimated' as const })) }} timestampUs={midWordTimestamp} />
      <MotionEdgeCase id="cue-only-fallback" label="Cue timing only — word preset falls back to static clean" motion="active-word-highlight"
        cue={{ ...motionCue, words: [] }} timestampUs={midWordTimestamp} />
      <MotionEdgeCase id="phrase-fade-start" label="Phrase fade — opacity ramps from 0 at absolute cue start" motion="phrase-fade"
        cue={motionCue} timestampUs={MOTION_CUE_START} />
    </div>
  </>
}

function MotionEdgeCase({ id, label, motion, cue, timestampUs }: { id: string; label: string; motion: CaptionMotion; cue: MotionCue; timestampUs: number }) {
  const composition = compositions[0]
  return <section data-motion-case={id} data-aspect="0" data-moment="mid-word">
    <p style={{ fontSize: 12 }}>{label}</p>
    <div style={{ position: 'relative', width: 270, height: 480, background: 'linear-gradient(145deg,#344656,#11151e)', border: '1px solid #536171' }}>
      <div style={{ position: 'absolute', left: '10%', right: '10%', top: '8%', bottom: '12%', border: '1px dashed #687382' }} />
      <CaptionPreview composition={composition} inputs={styledMotionInputs(composition)} cue={cue} timestampUs={timestampUs} motion={motion} />
    </div>
  </section>
}

// Interactive demo: real StylePanel + CaptionPreview sharing one state, exactly as App.tsx wires
// them, so the smoke runner can drive each control via real DOM events and confirm the preview moves.
function InteractiveDemo() {
  const [style, setStyle] = useState<CaptionStyle>({ ...DEFAULT_CAPTION_STYLE, appearance: { ...DEFAULT_CAPTION_STYLE.appearance, backgroundEnabled: true } })
  const [presets, setPresets] = useState<SavedCaptionPreset[]>([])
  const composition = compositions[0]
  const inputs = captionStyleInputs(style, composition)
  return <section data-interactive-demo="1" style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
    <div data-interactive-caption style={{ position: 'relative', width: 270, height: 480, background: 'linear-gradient(145deg,#344656,#11151e)', border: '1px solid #536171', flex: 'none' }}>
      <div style={{ position: 'absolute', left: '10%', right: '10%', top: '8%', bottom: '12%', border: '1px dashed #687382' }} />
      <CaptionPreview composition={composition} inputs={inputs} motion={style.motion} cue={motionCue} timestampUs={midWordTimestamp} />
    </div>
    <div style={{ width: 320, color: '#ccc' }}>
      <StylePanel style={style} onDraft={setStyle} onCommit={setStyle} />
      <TemplatesPanel onApplyTemplate={setStyle} style={style} cues={[motionCue]} activeCue={motionCue} presets={presets}
        onCommitMotion={(motion) => setStyle((current) => ({ ...current, motion }))}
        onSavePreset={(name: string) => setPresets((current) => [...current, { id: `preset-${current.length}`, name, style }])}
        onApplyPreset={(id: string) => setStyle(presets.find((preset) => preset.id === id)?.style ?? style)}
        onDeletePreset={(id: string) => setPresets((current) => current.filter((preset) => preset.id !== id))} />
    </div>
  </section>
}

createRoot(document.getElementById('root')!).render(<main style={{ padding: 16 }}>
  <StaticFixtures />
  <MotionGrid />
  <h1 style={{ fontSize: 18 }}>R2 — controls driving the real preview</h1>
  <InteractiveDemo />
</main>)

// Smoke runner waits for actual fonts and ResizeObserver, then checks real DOM text geometry.
Object.assign(window, {
  inspectCaptionFixtures: () => {
    const results: { id: string; aspect: string; scale: string; lines: string[]; widths: number[] }[] = []
    for (const section of document.querySelectorAll<HTMLElement>('[data-case]')) {
      const renderer = section.querySelector<HTMLElement>('[data-caption-renderer]')
      if (!renderer) throw new Error(`Caption not ready: ${section.dataset.case}`)
      const preview = section.querySelector<HTMLElement>('[data-caption-preview]')!.getBoundingClientRect()
      const bounds = renderer.getBoundingClientRect()
      const epsilon = 1
      if (bounds.left < preview.left + preview.width * .1 - epsilon || bounds.right > preview.right - preview.width * .1 + epsilon
        || bounds.top < preview.top + preview.height * .08 - epsilon || bounds.bottom > preview.bottom - preview.height * .12 + epsilon) throw new Error(`Unsafe geometry: ${section.dataset.case}`)
      const lines = [...renderer.querySelectorAll<HTMLElement>('[data-caption-line]')]
      const widths: number[] = []
      for (const line of lines) {
        if (line.children.length) throw new Error('Shaping run fragmented into elements')
        const range = document.createRange()
        range.selectNodeContents(line)
        const ink = range.getBoundingClientRect(), box = line.getBoundingClientRect()
        if (line.textContent && (Math.abs(ink.width - box.width) > epsilon || ink.top < box.top - epsilon || ink.bottom > box.bottom + epsilon)) throw new Error(`Text escapes line box: ${section.dataset.case}`)
        widths.push(box.width / preview.width)
      }
      results.push({ id: section.dataset.case!, aspect: section.dataset.aspect!, scale: section.dataset.scale!, lines: lines.map((line) => line.textContent!), widths })
    }
    let maxNormalizedWidthDelta = 0
    for (const result of results.filter((entry) => entry.scale === '1')) {
      const small = results.find((entry) => entry.id === result.id && entry.aspect === result.aspect && entry.scale === '0.65')!
      if (JSON.stringify(small.lines) !== JSON.stringify(result.lines)) throw new Error('Preview resize changed semantic wrapping')
      if (small.widths.some((width, index) => Math.abs(width - result.widths[index]) > .001)) throw new Error('Normalized geometry changed across scales')
      maxNormalizedWidthDelta = Math.max(maxNormalizedWidthDelta, ...small.widths.map((width, index) => Math.abs(width - result.widths[index])))
    }
    return { platform: navigator.userAgent, cases: results.length, maxNormalizedWidthDelta, results }
  },

  // Checks every motion/aspect/moment case for shaping integrity, correct effect presence and
  // Malayalam grapheme-cluster preservation (whole-line text nodes, never per-grapheme spans).
  inspectMotionGrid: () => {
    const results: Record<string, unknown>[] = []
    for (const section of document.querySelectorAll<HTMLElement>('[data-motion-case]')) {
      const id = section.dataset.motionCase!
      const renderer = section.querySelector<HTMLElement>('[data-caption-renderer]')
      if (!renderer) throw new Error(`Motion case not rendered: ${id}`)
      const lines = [...renderer.querySelectorAll<HTMLElement>('[data-caption-line]')]
      for (const line of lines) if (line.children.length) throw new Error(`Shaping run fragmented into elements: ${id}`)
      const effects = renderer.querySelectorAll('[data-caption-word-effect]')
      for (const effect of effects) if (effect.children.length !== 1 || effect.children[0].children.length) throw new Error(`Word effect overlay fragmented: ${id}`)
      const motionAttr = renderer.dataset.captionMotion
      const opacity = Number(getComputedStyle(renderer).opacity)
      const clipPath = lines.some((line) => getComputedStyle(line).clipPath !== 'none')
      const notice = section.querySelector('[data-caption-timing-notice]')?.textContent ?? null
      results.push({ id, aspect: section.dataset.aspect, moment: section.dataset.moment, motion: motionAttr, opacity, effectCount: effects.length, clipPath, notice, lineCount: lines.length })
    }
    return results
  },

  // Drives the real StylePanel with genuine DOM events and confirms the shared preview moved.
  driveInteractiveControls: async () => {
    const host = document.querySelector<HTMLElement>('[data-interactive-demo]')!
    const renderer = () => host.querySelector<HTMLElement>('[data-interactive-caption] [data-caption-renderer]')!
    const setNativeValue = (element: HTMLInputElement | HTMLSelectElement, value: string) => {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')!.set!
      setter.call(element, value)
    }
    let waitStep = 0
    const wait = async () => {
      waitStep++
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      const deadline = performance.now() + 5000
      while (!renderer()) {
        if (performance.now() > deadline) throw new Error(`Interactive caption readiness timeout at step ${waitStep}: ${host.querySelector('[data-interactive-caption]')?.innerHTML}`)
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      }
    }
    const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

    const results: Record<string, unknown> = {}

    const before1 = getComputedStyle(renderer()).color
    const primary = byId<HTMLInputElement>('style-primary-color')
    primary.focus(); setNativeValue(primary, '#ff0044'); primary.dispatchEvent(new Event('input', { bubbles: true })); await wait(); primary.blur()
    await wait()
    results.primaryColor = { before: before1, after: getComputedStyle(renderer()).color }

    const strokeWidth = () => getComputedStyle(renderer()).getPropertyValue('-webkit-text-stroke-width')
    const before2 = strokeWidth()
    const outlineWidth = byId<HTMLInputElement>('style-outline-width')
    outlineWidth.focus(); setNativeValue(outlineWidth, '6'); outlineWidth.dispatchEvent(new Event('input', { bubbles: true }))
    await wait()
    outlineWidth.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
    await wait()
    results.outlineWidth = { before: before2, after: strokeWidth() }

    const before3 = renderer().style.background
    const bgOpacity = byId<HTMLInputElement>('style-bg-opacity')
    bgOpacity.focus(); setNativeValue(bgOpacity, '.8'); bgOpacity.dispatchEvent(new Event('input', { bubbles: true }))
    await wait()
    bgOpacity.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
    await wait()
    results.backgroundOpacity = { before: before3, after: renderer().style.background }

    const before4 = renderer().getBoundingClientRect()
    const padding = byId<HTMLInputElement>('style-bg-padding')
    padding.focus(); setNativeValue(padding, '38'); padding.dispatchEvent(new Event('input', { bubbles: true }))
    await wait()
    padding.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
    await wait()
    results.padding = { widthBefore: before4.width, widthAfter: renderer().getBoundingClientRect().width }

    const before5 = renderer().getBoundingClientRect()
    const positionX = byId<HTMLInputElement>('style-position-h')
    positionX.focus(); setNativeValue(positionX, '0'); positionX.dispatchEvent(new Event('input', { bubbles: true })); await wait(); positionX.blur()
    const positionY = byId<HTMLInputElement>('style-position-v')
    positionY.focus(); setNativeValue(positionY, '0'); positionY.dispatchEvent(new Event('input', { bubbles: true })); await wait(); positionY.blur()
    await wait()
    results.position = { xBefore: before5.x, xAfter: renderer().getBoundingClientRect().x, yBefore: before5.y, yAfter: renderer().getBoundingClientRect().y }

    const before6 = renderer().querySelectorAll('[data-caption-line]').length
    const maxLines = byId<HTMLInputElement>('style-max-lines')
    maxLines.focus(); setNativeValue(maxLines, '1'); maxLines.dispatchEvent(new Event('input', { bubbles: true })); await wait(); maxLines.blur()
    await wait()
    results.maxLines = { before: before6, after: renderer().querySelectorAll('[data-caption-line]').length }

    byId<HTMLButtonElement>('style-font-family').click()
    await wait()
    ;[...document.querySelectorAll<HTMLElement>('.ins-select-popover [role="option"]')].find((option) => option.textContent === 'Arial')!.click()
    await wait()
    results.fontFamily = { after: getComputedStyle(renderer()).fontFamily }

    const before7 = renderer().dataset.captionMotion
    document.querySelector<HTMLInputElement>('input[name="caption-motion"][value="word-pop"]')!.click()
    await wait()
    results.motion = { before: before7, after: renderer().dataset.captionMotion, effectCount: renderer().querySelectorAll('[data-caption-word-effect]').length }

    // Alignment: switching to "left" moves the first line's own left edge.
    const beforeAlign = renderer().querySelector<HTMLElement>('[data-caption-line]')!.getBoundingClientRect().left
    document.querySelector<HTMLButtonElement>('#style-alignment button[title="left"]')!.click()
    await wait()
    results.alignment = { before: beforeAlign, after: renderer().querySelector<HTMLElement>('[data-caption-line]')!.getBoundingClientRect().left }

    // Letter spacing widens the rendered line box.
    const beforeSpacing = renderer().querySelector<HTMLElement>('[data-caption-line]')!.getBoundingClientRect().width
    const letterSpacing = byId<HTMLInputElement>('style-letter-spacing')
    letterSpacing.focus(); setNativeValue(letterSpacing, '10'); letterSpacing.dispatchEvent(new Event('input', { bubbles: true }))
    await wait()
    letterSpacing.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
    await wait()
    results.letterSpacing = { before: beforeSpacing, after: renderer().querySelector<HTMLElement>('[data-caption-line]')!.getBoundingClientRect().width }

    // Text transform is a paint-time CSS property; the underlying stored text is untouched.
    document.querySelector<HTMLElement>('#style-text-transform button[title="uppercase"]')!.click()
    await wait()
    results.textTransform = { computed: getComputedStyle(renderer().querySelector('[data-caption-line]')!).textTransform }

    // Gradient fill adds a second, background-clip:text line copy alongside the solid one.
    document.querySelector<HTMLButtonElement>('#style-fill-mode button:nth-child(2)')!.click() // "Gradient"
    await wait()
    results.gradient = { fillLayerPresent: !!renderer().querySelector('[style*="background-clip: text"], [style*="background-clip:text"]') }
    document.querySelector<HTMLButtonElement>('#style-fill-mode button:nth-child(1)')!.click() // back to "Solid"
    await wait()

    // Emphasis face: a bold/italic active-word face is measured and painted distinctly from the base line.
    const overlayFont = () => getComputedStyle(renderer().querySelector('[data-caption-word-effect] > div')!).fontWeight
    const beforeEmphasis = overlayFont()
    const emphasisFace = byId<HTMLSelectElement>('style-emphasis-face')
    setNativeValue(emphasisFace, '900:false'); emphasisFace.dispatchEvent(new Event('change', { bubbles: true }))
    await wait()
    results.emphasisFace = { before: beforeEmphasis, after: overlayFont() }

    const name = byId<HTMLInputElement>('style-preset-name')
    name.focus(); setNativeValue(name, 'Smoke preset'); name.dispatchEvent(new Event('input', { bubbles: true }))
    await wait()
    document.querySelector<HTMLElement>('.style-preset-save button')!.click()
    await wait()
    results.presetSaved = document.querySelector('.style-preset-list')?.textContent?.includes('Smoke preset') ?? false

    document.querySelector<HTMLInputElement>('input[name="caption-motion"][value="static-clean"]')!.click()
    await wait()
    const applyButton = [...document.querySelectorAll<HTMLButtonElement>('.style-preset-actions button')].find((button) => button.textContent === 'Apply')!
    applyButton.click()
    await wait()
    results.presetApplied = document.querySelector<HTMLInputElement>('input[name="caption-motion"][value="word-pop"]')!.checked

    return results
  },
})
