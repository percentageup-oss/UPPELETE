import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { captionFrame, defaultCaptionInputs, fittedEmphasisFont, layoutCaption, layoutCaptionWords, projectCaptionViewport, SPOTLIGHT_DIM, type CaptionFill, type CaptionFont, type CaptionFrame, type LayoutInputs, type MeasureText, type MeasureRange, type MotionCue, type Size, type WordRegion } from './renderer'
import { emphasisRuns, sliceEmphasis } from '../core/emphasis'
import { locateWordSpans } from '../core/captionText'
import type { CaptionMotion } from './style'

/** A gradient fill is painted as a second complete text copy (background-clip:text, transparent
 * fill) stacked exactly over a solid copy that carries shadow/glow/depth/stroke — Chromium paints
 * text-shadow above a background-clip:text fill, so those effects must live on the layer underneath.
 * Both copies are the same unbroken shaping run; this never fragments a line into per-word spans. */
function LineText({ text, fill }: { text: string; fill?: CaptionFill }) {
  if (!fill) return <>{text}</>
  const fillStyle: CSSProperties = { position: 'absolute', inset: 0,
    backgroundImage: `linear-gradient(${fill.angle}deg, ${fill.from}, ${fill.to})`,
    backgroundClip: 'text', WebkitBackgroundClip: 'text', color: 'transparent', WebkitTextFillColor: 'transparent',
    WebkitTextStroke: '0px transparent', textShadow: 'none' }
  return <>
    <div style={{ position: 'absolute', inset: 0 }}>{text}</div>
    <div style={fillStyle}>{text}</div>
  </>
}

/** Shared full-line DOM painter: export must reuse this, not FFmpeg drawtext or per-letter spans. */
export function CaptionView({ frame }: { frame: CaptionFrame }) {
  const { layout } = frame
  if (!frame.visible) return null
  const { appearance } = layout.inputs
  // Union of the word's regular-face and emphasis-face rects, padded by the stroke bleed. Used both
  // to punch the word fully out of the base line and to size/center the word-effect crop box, so a
  // bolder/italic emphasis face (different glyph advances) never leaves regular glyphs peeking out.
  const wordBox = (region: WordRegion) => {
    const emphLeft = region.emphasis?.x ?? region.x, emphWidth = region.emphasis?.width ?? region.width
    const left = Math.min(region.x, emphLeft) - appearance.outlineWidth
    const right = Math.max(region.x + region.width, emphLeft + emphWidth) + appearance.outlineWidth
    return { left, width: right - left }
  }
  return <div data-caption-renderer="1" data-caption-motion={frame.motion ?? 'static-clean'} lang="ml" aria-label={layout.lines.map((line) => line.text + line.separator).join('')}
    data-warnings={layout.warnings.join(';')} style={{ position: 'absolute', left: layout.bounds.x, top: layout.bounds.y,
      width: layout.bounds.width / layout.fitScale, height: layout.bounds.height / layout.fitScale,
      transform: `scale(${layout.fitScale})`, transformOrigin: 'top left', opacity: frame.opacity,
      background: appearance.background, color: appearance.color, textShadow: appearance.shadow,
      WebkitTextStroke: `${appearance.outlineWidth}px ${appearance.outlineColor}`, paintOrder: 'stroke fill',
      ...captionTypography(layout.font) }}>
    {layout.lines.map((line, index) => {
      if (layout.inputs.emphasized?.length) return <SelectedEmphasisLine key={index} frame={frame} lineIndex={index} />
      const regions = layout.wordRegions?.filter((region) => region.lineIndex === index) ?? []
      const active = regions.filter((region) => frame.words?.[region.wordIndex]?.active)
      const pop = frame.motion === 'word-pop'
      const highlight = frame.motion === 'active-word-highlight'
      const reveal = frame.motion === 'progressive-word-reveal'
      const revealed = regions.filter((region) => frame.words?.[region.wordIndex]?.revealed)
      const revealRight = Math.max(line.x, ...revealed.map((region) => region.revealRight))
      const lineStyle: CSSProperties = { position: 'absolute', left: line.x, top: line.y, width: line.width,
        height: line.height, lineHeight: `${line.height}px`, whiteSpace: 'pre' }
      // Mask complete shaping runs; never replace them with raw characters or token spans. A distinct
      // emphasis face also needs the punch-out (not only word-pop), since its glyphs may not align
      // with the regular-face glyphs sitting underneath. Only punch out words the effect layer below
      // actually repaints — progressive reveal draws no effect layer, so masking there would leave the
      // active word (and the final word, active until the cue ends) permanently blank.
      const paintsEffect = !reveal && (pop || highlight)
      const needsMask = paintsEffect && (pop || active.some((region) => !!region.emphasis)) && active.length
      const mask = needsMask ? `linear-gradient(to right, ${active.flatMap((region) => {
        const box = wordBox(region)
        const left = Math.max(0, box.left - line.x), right = box.left - line.x + box.width
        return [`black ${left}px`, `transparent ${left}px`, `transparent ${right}px`, `black ${right}px`]
      }).join(', ')})` : undefined
      const spotlightDim = appearance.spotlight && (pop || highlight)
      return <div key={index} aria-hidden="true">
        <div data-caption-line={index} style={{ ...lineStyle, maskImage: mask, WebkitMaskImage: mask,
          clipPath: reveal ? `inset(-30px ${Math.max(0, line.width - (revealRight - line.x))}px -30px -30px)` : undefined,
          textDecoration: appearance.underline ? 'underline' : undefined,
          opacity: reveal && !revealed.length ? 0 : (spotlightDim ? SPOTLIGHT_DIM : 1) }}>
          <LineText text={line.text} fill={appearance.fill} />
        </div>
        {paintsEffect && active.map((region, regionIndex) => {
          const box = wordBox(region)
          const left = box.left, width = box.width
          const centerX = left + width / 2, centerY = region.y + region.height / 2
          const safe = layout.safeRect, fit = layout.fitScale
          const x = layout.bounds.x + centerX * fit, y = layout.bounds.y + centerY * fit
          const maxScale = Math.min(2 * (x - safe.x) / (width * fit), 2 * (safe.x + safe.width - x) / (width * fit),
            2 * (y - safe.y) / (region.height * fit), 2 * (safe.y + safe.height - y) / (region.height * fit))
          const scale = Math.max(1, Math.min(frame.words![region.wordIndex].scale, maxScale))
          const innerFont = region.emphasis && layout.emphasisFont ? layout.emphasisFont : layout.font
          return <div key={`${region.wordIndex}:${regionIndex}`} data-caption-word-effect={region.wordIndex} style={{
            position: 'absolute', left, top: region.y, width, height: region.height, overflow: 'hidden',
            transform: `scale(${scale})`, transformOrigin: 'center', color: appearance.secondaryColor ?? appearance.color,
            textShadow: region.emphasis ? appearance.emphasisShadow : undefined }}>
            <div style={{ ...lineStyle, left: line.x - left, top: 0, ...captionTypography(innerFont) }}>
              <LineText text={line.text} fill={appearance.secondaryFill} />
            </div>
          </div>
        })}
      </div>
    })}
  </div>
}

/** Selected words use complete lexical runs, with precisely the same spans and fonts as measurement.
 * Stable reserved widths mean revealing or popping a word never reflows the caption. */
function SelectedEmphasisLine({ frame, lineIndex }: { frame: CaptionFrame; lineIndex: number }) {
  const { layout } = frame, line = layout.lines[lineIndex], { appearance } = layout.inputs
  const emphasisFont = fittedEmphasisFont(layout.inputs, layout.font)
  const spans = sliceEmphasis(layout.inputs.emphasized, line.textStart, line.textEnd)
  const reveal = frame.motion === 'progressive-word-reveal'
  return <div data-caption-line={lineIndex} aria-hidden="true" style={{ position: 'absolute', left: line.x, top: line.y,
    width: line.width, height: line.height, lineHeight: `${line.height}px`, whiteSpace: 'pre' }}>
    {emphasisRuns(line.text, spans).map((run) => {
      const start = run.textStart + line.textStart, end = run.textEnd + line.textStart
      const index = frame.wordSpans?.findIndex((span) => span.textStart <= start && span.textEnd >= end) ?? -1
      // Separators follow the preceding word, including punctuation and the spaces before the next word.
      const previousIndex = frame.wordSpans?.reduce((found, span, i) => span.textStart < end ? i : found, -1) ?? -1
      const state = frame.words?.[index >= 0 ? index : previousIndex]
      const hidden = reveal && !state?.revealed
      const dimmed = appearance.spotlight && !run.emphasized
      const requestedScale = run.word && state?.active && (frame.motion === 'word-pop' || (run.emphasized && layout.inputs.emphasisMotion === 'pop')) ? state.scale : 1
      const fit = layout.fitScale, safe = layout.safeRect
      const cx = layout.bounds.x + (line.x + line.width / 2) * fit, cy = layout.bounds.y + (line.y + line.height / 2) * fit
      const scale = Math.max(1, Math.min(requestedScale, 2 * (cx - safe.x) / (line.width * fit),
        2 * (safe.x + safe.width - cx) / (line.width * fit), 2 * (cy - safe.y) / (line.height * fit),
        2 * (safe.y + safe.height - cy) / (line.height * fit)))
      const font = run.emphasized ? emphasisFont : layout.font
      const fill = run.emphasized ? appearance.secondaryFill : appearance.fill
      return <span key={run.textStart} data-caption-emphasis={run.emphasized || undefined}
        style={{ ...(run.emphasized ? captionTypography(font) : {}), position: 'relative', display: run.word ? 'inline-block' : undefined,
          lineHeight: 'inherit', verticalAlign: 'baseline', color: run.emphasized ? appearance.secondaryColor : appearance.color,
          textDecoration: (run.emphasized ? appearance.emphasisUnderline : appearance.underline) ? 'underline' : undefined,
          textShadow: run.emphasized ? appearance.emphasisShadow : undefined,
          opacity: hidden ? 0 : dimmed ? SPOTLIGHT_DIM : 1, transform: scale !== 1 ? `scale(${scale})` : undefined }}>
        {fill ? <><span style={{ visibility: 'hidden' }}>{run.text}</span><LineText text={run.text} fill={fill} /></> : run.text}
      </span>
    })}
  </div>
}

export function captionTypography(font: CaptionFont): CSSProperties {
  return { fontFamily: font.stack, fontSize: font.size, fontWeight: font.weight, lineHeight: font.lineHeight,
    fontKerning: 'normal', fontVariantLigatures: 'normal', letterSpacing: `${font.letterSpacing}px`, wordSpacing: `${font.wordSpacing}px`,
    textTransform: font.textTransform, fontStyle: font.italic ? 'italic' : 'normal', fontSynthesis: 'none' }
}

function fontLoadSpec(font: CaptionFont): string {
  return `${font.italic ? 'italic ' : ''}${font.weight} ${font.size}px ${font.stack}`
}

/** Measure complete shaped runs with precisely the painter's typography, not summed glyph widths. */
export function createDomMeasurer(doc: Document): { measure: MeasureText; measureRange: MeasureRange; dispose: () => void } {
  const span = doc.createElement('span')
  Object.assign(span.style, { position: 'absolute', visibility: 'hidden', pointerEvents: 'none', whiteSpace: 'pre', left: '-100000px', top: '0' })
  span.lang = 'ml'
  doc.body.append(span)
  const cache = new Map<string, Size>()
  const setText = (text: string, font: CaptionFont, emphasis?: Parameters<MeasureText>[2]) => {
    Object.assign(span.style, captionTypography(font), { fontSize: `${font.size}px` })
    span.replaceChildren()
    if (!emphasis) { span.textContent = text || '\u200b'; return }
    for (const run of emphasisRuns(text, emphasis.spans)) {
      const node = doc.createElement('span')
      node.textContent = run.text
      if (run.emphasized) Object.assign(node.style, captionTypography(emphasis.font), { fontSize: `${emphasis.font.size}px` })
      Object.assign(node.style, { display: run.word ? 'inline-block' : 'inline', lineHeight: 'inherit', verticalAlign: 'baseline' })
      span.append(node)
    }
  }
  return { measure(text, font, emphasis) {
    const key = JSON.stringify([text, font, emphasis])
    const cached = cache.get(key)
    if (cached) return cached
    setText(text, font, emphasis)
    const rect = span.getBoundingClientRect()
    const size = { width: text ? rect.width : 0, height: rect.height }
    if (cache.size >= 4096) cache.clear()
    cache.set(key, size)
    return size
  }, measureRange(text, start, end, font) {
    Object.assign(span.style, captionTypography(font), { fontSize: `${font.size}px` })
    span.textContent = text
    const range = doc.createRange()
    range.setStart(span.firstChild!, start); range.setEnd(span.firstChild!, end)
    const origin = span.getBoundingClientRect()
    return [...range.getClientRects()].map((rect) => ({ x: rect.x - origin.x, y: rect.y - origin.y, width: rect.width, height: rect.height }))
  }, dispose: () => span.remove() }
}

export function CaptionPreview({ cue, timestampUs, composition, inputs: supplied, motion = 'static-clean', motionSpeed = 1, diagnostics = true, onFrame, fontSample, layers }: {
  cue: MotionCue | null
  timestampUs: number; composition: Size; inputs?: LayoutInputs; motion?: CaptionMotion; motionSpeed?: number
  /** Observe the actual preview evaluation; export excludes editor notices from caption pixels. */
  diagnostics?: boolean; onFrame?: (frame: CaptionFrame | null) => void
  /** Text to key/load fonts against instead of `cue.text` — pass the enclosing line's text in WORD
   * display so switching between a line's own words never re-triggers the font-loading effect
   * (which would otherwise show nothing for a frame at every word boundary). */
  fontSample?: string
  /** Image overlays (V2), painted inside the same scaled composition wrapper, below captions. */
  layers?: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [preview, setPreview] = useState<Size | null>(null)
  const [fontState, setFontState] = useState<{ key: string; status: CaptionFont['readiness']; revision: number }>({ key: '', status: 'loading', revision: 0 })
  const [measurer, setMeasurer] = useState<ReturnType<typeof createDomMeasurer> | null>(null)
  const inputs = useMemo(() => {
    const value = supplied ?? defaultCaptionInputs(composition)
    return { ...value, emphasized: cue?.emphasized, emphasisFont: value.emphasisFont && !cue?.emphasized?.length
      ? { ...value.emphasisFont, stack: value.font.stack } : value.emphasisFont }
  }, [supplied, composition.width, composition.height, cue?.emphasized])
  const fontKey = JSON.stringify([inputs.font, inputs.emphasisFont ?? null, fontSample ?? cue?.text ?? ''])
  useEffect(() => {
    const owner = ref.current!.ownerDocument
    const metrics = createDomMeasurer(owner)
    setMeasurer(metrics)
    const resize = new ResizeObserver(([entry]) => setPreview({ width: entry.contentRect.width, height: entry.contentRect.height }))
    resize.observe(ref.current!)
    return () => { resize.disconnect(); metrics.dispose() }
  }, [])
  useEffect(() => {
    let cancelled = false
    const fonts = ref.current!.ownerDocument.fonts
    const update = async () => {
      setFontState((state) => ({ key: fontKey, status: 'loading', revision: state.revision + 1 }))
      try {
        const sample = fontSample || cue?.text || 'മലയാളം English'
        await Promise.all([fonts.load(fontLoadSpec(inputs.font), sample), ...(inputs.emphasisFont ? [fonts.load(fontLoadSpec(inputs.emphasisFont), sample)] : [])])
        await fonts.ready
        if (!cancelled) setFontState((state) => ({ key: fontKey, status: 'ready', revision: state.revision + 1 }))
      } catch {
        if (!cancelled) setFontState((state) => ({ key: fontKey, status: 'failed', revision: state.revision + 1 }))
      }
    }
    void update()
    fonts.addEventListener('loading', update)
    return () => { cancelled = true; fonts.removeEventListener('loading', update) }
  }, [fontKey])
  const readyInputs = useMemo(() => ({ ...inputs, font: { ...inputs.font,
    readiness: fontState.key === fontKey ? fontState.status : 'loading' as const,
    revision: `${inputs.font.revision}:${fontState.revision}` } }), [inputs, fontState, fontKey])
  const layout = useMemo(() => cue && measurer ? layoutCaption(cue.text, readyInputs, measurer.measure) : null, [cue?.text, readyInputs, measurer])
  const wordLayout = useMemo(() => layout && cue && measurer && motion !== 'static-clean' && motion !== 'phrase-fade'
    ? layoutCaptionWords(layout, cue, measurer.measureRange) : layout, [layout, cue, measurer, motion])
  const frame = useMemo(() => wordLayout && cue ? captionFrame(wordLayout, cue, timestampUs, motion, motionSpeed) : null, [wordLayout, cue, timestampUs, motion, motionSpeed])
  const projection = preview && preview.width > 0 && preview.height > 0 ? projectCaptionViewport(composition, preview) : null
  useEffect(() => { if (projection) onFrame?.(frame) }, [frame, projection?.scale, onFrame])
  return <div ref={ref} data-caption-preview="1" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 2 }}>
    {diagnostics && cue && readyInputs.font.readiness !== 'ready' && <span role="status" style={{ position: 'absolute', bottom: 8, left: 8, fontSize: 12 }}>
      {readyInputs.font.readiness === 'failed' ? 'Caption font failed to load.' : 'Preparing caption fonts…'}
    </span>}
    {diagnostics && frame?.timingNotice && <span role="status" data-caption-timing-notice style={{ position: 'absolute', top: 40, left: 8, right: 8,
      fontSize: 11, color: '#ffda8b', background: '#101010cc', padding: 4 }}>{frame.timingNotice}</span>}
    {diagnostics && !!layout?.warnings.length && <span role="status" style={{ position: 'absolute', top: 70, left: 8, fontSize: 11, color: '#ffda8b' }}>
      {layout.warnings.includes('caption-uniformly-fitted') ? 'Caption fitted to safe area. ' : ''}
      {layout.warnings.some((warning) => warning.startsWith('max-lines')) ? 'Max lines cannot be met without dropping text; explicit breaks are preserved.' : ''}
    </span>}
    {/* Rebuild paint nodes per requested time: retained transform layers otherwise change word-pop rasterization after seeks. Metrics stay memoized. */}
    {projection && <div style={{ position: 'absolute', left: projection.x, top: projection.y, width: composition.width,
      height: composition.height, transform: `scale(${projection.scale})`, transformOrigin: 'top left' }}>
      {layers}
      {frame && <CaptionView key={`${motion}:${timestampUs}`} frame={frame} />}
    </div>}
  </div>
}
