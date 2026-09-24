import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import type { LayerMask } from '../core/edit'
import { activeMask } from '../core/layerMask'
import { maskStyle } from './maskStyle'
import { captionFrame, defaultCaptionInputs, fittedEmphasisFont, layoutCaption, layoutCaptionWords, projectCaptionViewport, SPOTLIGHT_DIM, type CaptionFill, type CaptionFont, type CaptionFrame, type LayoutInputs, type MeasureText, type MeasureRange, type MotionCue, type Size, type WordRegion } from './renderer'
import { emphasisRuns, sliceEmphasis } from '../core/emphasis'
import { locateWordSpans } from '../core/captionText'
import type { CaptionMotion } from './style'
import type { TitleMotion } from '../core/edit'
import { decorativeTextCue, titleMotionAt, titleVisualAt } from './textMotion'

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
type TitlePaintState = { kind: TitleMotion['kind']; progress: number }

export function CaptionView({ frame, titleMotion }: { frame: CaptionFrame; titleMotion?: TitlePaintState | null }) {
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
  const rotation = appearance.rotation
  // Rotation is applied here, after layout, around the block's own center — never fed into
  // `layoutCaption`'s wrap/fit math (`renderer.ts`), which stays axis-aligned so line breaking and
  // export parity are unaffected by it. Skipping the wrapper at 0deg keeps unrotated output exactly
  // what it was before this existed (the export parity fixture's byte-pinned case included).
  const renderer = <div data-caption-renderer="1" data-caption-motion={frame.motion ?? 'static-clean'} lang="ml" aria-label={layout.lines.map((line) => line.text + line.separator).join('')}
    data-warnings={layout.warnings.join(';')} style={{ position: 'absolute', left: rotation ? 0 : layout.bounds.x, top: rotation ? 0 : layout.bounds.y,
      width: layout.bounds.width / layout.fitScale, height: layout.bounds.height / layout.fitScale,
      transform: `scale(${layout.fitScale})`, transformOrigin: 'top left', opacity: frame.opacity,
      background: appearance.background, color: appearance.color, textShadow: appearance.shadow,
      WebkitTextStroke: `${appearance.outlineWidth}px ${appearance.outlineColor}`, paintOrder: 'stroke fill',
      ...captionTypography(layout.font) }}>
    {layout.lines.map((line, index) => {
      if (titleMotion && (titleMotion.kind === 'cascade' || titleMotion.kind === 'accent'))
        return <TitleMotionLine key={index} frame={frame} lineIndex={index} motion={titleMotion} />
      if (layout.inputs.emphasized?.length) return titleMotion?.kind === 'wipe'
        ? <div key={index} style={{ position: 'absolute', left: line.x, top: line.y, width: line.width, height: line.height,
          clipPath: `inset(-20px ${(1 - titleMotion.progress) * 100}% -20px -20px)` }}>
          <SelectedEmphasisLine frame={frame} lineIndex={index} relative />
        </div>
        : <SelectedEmphasisLine key={index} frame={frame} lineIndex={index} />
      const regions = layout.wordRegions?.filter((region) => region.lineIndex === index) ?? []
      const active = regions.filter((region) => frame.words?.[region.wordIndex]?.active)
      const pop = frame.motion === 'word-pop'
      const highlight = frame.motion === 'active-word-highlight'
      const reveal = frame.motion === 'progressive-word-reveal'
      const revealed = regions.filter((region) => frame.words?.[region.wordIndex]?.revealed)
      const revealRight = Math.max(line.x, ...revealed.map((region) => region.revealRight))
      const lineStyle: CSSProperties = { position: 'absolute', left: line.x, top: line.y, width: line.width,
        height: line.height, lineHeight: `${line.height}px`, whiteSpace: 'pre',
        clipPath: titleMotion?.kind === 'wipe' ? `inset(-20px ${(1 - titleMotion.progress) * 100}% -20px -20px)` : undefined }
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
          clipPath: reveal ? `inset(-30px ${Math.max(0, line.width - (revealRight - line.x))}px -30px -30px)` : lineStyle.clipPath,
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
  if (!rotation) return renderer
  return <div style={{ position: 'absolute', left: layout.bounds.x, top: layout.bounds.y,
    width: layout.bounds.width, height: layout.bounds.height, transform: `rotate(${rotation}deg)`, transformOrigin: 'center' }}>
    {renderer}
  </div>
}

/** Each moving word is a crop of the complete shaped line. No Unicode substring becomes its own
 * text run, so Malayalam marks, conjuncts and mixed-script shaping retain the measured geometry. */
function TitleMotionLine({ frame, lineIndex, motion }: { frame: CaptionFrame; lineIndex: number; motion: TitlePaintState }) {
  const { layout } = frame, line = layout.lines[lineIndex]
  const regions = layout.wordRegions?.filter((region) => region.lineIndex === lineIndex) ?? []
  const lineStyle: CSSProperties = { position: 'absolute', left: line.x, top: line.y, width: line.width,
    height: line.height, lineHeight: `${line.height}px`, whiteSpace: 'pre' }
  const paint = (color?: string) => layout.inputs.emphasized?.length
    ? <SelectedEmphasisLine frame={frame} lineIndex={lineIndex} relative staticPaint forceColor={color} />
    : <LineText text={line.text} fill={color ? undefined : layout.inputs.appearance.fill} />
  const fullLine = (color?: string) => <div style={{ ...lineStyle, left: 0, top: 0, color }}>{paint(color)}</div>
  if (!regions.length) return <div data-caption-line={lineIndex} aria-hidden="true" style={lineStyle}>{paint()}</div>
  if (motion.kind === 'accent') {
    const finalIndex = Math.max(...(layout.wordRegions ?? []).map((region) => region.wordIndex))
    const last = regions.find((region) => region.wordIndex === finalIndex)
    if (!last) return <div data-caption-line={lineIndex} aria-hidden="true" style={lineStyle}>{paint()}</div>
    const reveal = Math.max(0, Math.min(1, (motion.progress - .32) / .68))
    return <div data-caption-line={lineIndex} aria-hidden="true" style={lineStyle}>
      {fullLine()}
      <div data-title-accent style={{ position: 'absolute', left: last.x - line.x, top: 0,
        width: last.width * reveal, height: line.height, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', left: -(last.x - line.x), top: 0, width: line.width, height: line.height,
          color: layout.inputs.appearance.secondaryColor }}>{paint(layout.inputs.appearance.secondaryColor)}</div>
      </div>
    </div>
  }
  const count = layout.wordRegions?.length ?? regions.length
  return <div data-caption-line={lineIndex} aria-hidden="true" style={lineStyle}>
    {motion.progress >= 1 && fullLine()}
    {motion.progress < 1 && regions.map((region) => {
      const local = Math.max(0, Math.min(1, (motion.progress - region.wordIndex * .48 / Math.max(1, count - 1)) / .52))
      if (local <= 0) return null
      return <div key={`${region.wordIndex}:${region.x}`} data-title-word={region.wordIndex} style={{ position: 'absolute',
        left: region.x - line.x - 2, top: 0, width: region.width + 4, height: line.height + 3, overflow: 'hidden',
        opacity: local, filter: `blur(${(1 - local) * 5}px)`, transform: `translateY(${(1 - local) * 12}px)` }}>
        <div style={{ position: 'absolute', left: -(region.x - line.x) + 2, top: 0, width: line.width, height: line.height }}>
          {paint()}
        </div>
      </div>
    })}
  </div>
}

/** Selected words use complete lexical runs, with precisely the same spans and fonts as measurement.
 * Stable reserved widths mean revealing or popping a word never reflows the caption. */
function SelectedEmphasisLine({ frame, lineIndex, relative = false, staticPaint = false, forceColor }: {
  frame: CaptionFrame; lineIndex: number; relative?: boolean; staticPaint?: boolean; forceColor?: string
}) {
  const { layout } = frame, line = layout.lines[lineIndex], { appearance } = layout.inputs
  const emphasisFont = fittedEmphasisFont(layout.inputs, layout.font)
  const spans = sliceEmphasis(layout.inputs.emphasized, line.textStart, line.textEnd)
  const reveal = !staticPaint && frame.motion === 'progressive-word-reveal'
  return <div data-caption-line={lineIndex} aria-hidden="true" style={{ position: 'absolute', left: relative ? 0 : line.x, top: relative ? 0 : line.y,
    width: line.width, height: line.height, lineHeight: `${line.height}px`, whiteSpace: 'pre' }}>
    {emphasisRuns(line.text, spans).map((run) => {
      const start = run.textStart + line.textStart, end = run.textEnd + line.textStart
      const index = frame.wordSpans?.findIndex((span) => span.textStart <= start && span.textEnd >= end) ?? -1
      // Separators follow the preceding word, including punctuation and the spaces before the next word.
      const previousIndex = frame.wordSpans?.reduce((found, span, i) => span.textStart < end ? i : found, -1) ?? -1
      const state = frame.words?.[index >= 0 ? index : previousIndex]
      const hidden = reveal && !state?.revealed
      const dimmed = appearance.spotlight && !run.emphasized
      const requestedScale = !staticPaint && run.word && state?.active && (frame.motion === 'word-pop' || (run.emphasized && layout.inputs.emphasisMotion === 'pop')) ? state.scale : 1
      const fit = layout.fitScale, safe = layout.safeRect
      const cx = layout.bounds.x + (line.x + line.width / 2) * fit, cy = layout.bounds.y + (line.y + line.height / 2) * fit
      const scale = Math.max(1, Math.min(requestedScale, 2 * (cx - safe.x) / (line.width * fit),
        2 * (safe.x + safe.width - cx) / (line.width * fit), 2 * (cy - safe.y) / (line.height * fit),
        2 * (safe.y + safe.height - cy) / (line.height * fit)))
      const font = run.emphasized ? emphasisFont : layout.font
      const fill = forceColor ? undefined : run.emphasized ? appearance.secondaryFill : appearance.fill
      return <span key={run.textStart} data-caption-emphasis={run.emphasized || undefined}
        style={{ ...(run.emphasized ? captionTypography(font) : {}), position: 'relative', display: run.word ? 'inline-block' : undefined,
          lineHeight: 'inherit', verticalAlign: 'baseline', color: forceColor ?? (run.emphasized ? appearance.secondaryColor : appearance.color),
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
    // An empty string has no runs, so the emphasis branch below would leave the span empty and measure
    // 0 x 0 — which layout rejects as invalid metrics. Trailing whitespace that overflows the line
    // legitimately produces an empty last line, so empty text takes the plain path with the base font.
    if (!emphasis || !text) { span.textContent = text || '\u200b'; return }
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
  }, measureRange(text, start, end, font, emphasis) {
    setText(text, font, emphasis)
    const range = doc.createRange()
    const nodes: Text[] = []
    const walker = doc.createTreeWalker(span, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text)
    const point = (offset: number): { node: Text; offset: number } => {
      let remaining = offset
      for (const node of nodes) {
        if (remaining <= node.length) return { node, offset: remaining }
        remaining -= node.length
      }
      const last = nodes.at(-1)!
      return { node: last, offset: last.length }
    }
    const from = point(start), to = point(end)
    range.setStart(from.node, from.offset); range.setEnd(to.node, to.offset)
    const origin = span.getBoundingClientRect()
    return [...range.getClientRects()].map((rect) => ({ x: rect.x - origin.x, y: rect.y - origin.y, width: rect.width, height: rect.height }))
  }, dispose: () => span.remove() }
}

/**
 * How the fixed composition (1080 wide) is fitted into an element's box: the offset and scale
 * `CaptionPreview` positions its composition wrapper with, and the one the stage editor maps pointer
 * pixels back through, so a handle always sits exactly on what is painted. The composition's size
 * comes from the sequence format, never from a measured `<video>`.
 */
export function useCompositionProjection(ref: RefObject<HTMLElement | null>, composition: Size) {
  const [preview, setPreview] = useState<Size | null>(null)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const resize = new ResizeObserver(([entry]) => setPreview({ width: entry.contentRect.width, height: entry.contentRect.height }))
    resize.observe(element)
    return () => resize.disconnect()
  }, [])
  return preview && preview.width > 0 && preview.height > 0 ? projectCaptionViewport(composition, preview) : null
}

export function CaptionPreview({ cue, timestampUs, composition, inputs: supplied, motion = 'static-clean', motionSpeed = 1, diagnostics = true, onFrame, fontSample, layers, overCaption, captionMask, titleMotion }: {
  cue: MotionCue | null
  timestampUs: number; composition: Size; inputs?: LayoutInputs; motion?: CaptionMotion; motionSpeed?: number
  /** Observe the actual preview evaluation; export excludes editor notices from caption pixels. */
  diagnostics?: boolean; onFrame?: (frame: CaptionFrame | null) => void
  /** Text to key/load fonts against instead of `cue.text` — pass the enclosing line's text in WORD
   * display so switching between a line's own words never re-triggers the font-loading effect
   * (which would otherwise show nothing for a frame at every word boundary). */
  fontSample?: string
  /** Video, image, blur and pinned frame-paint (vignette/letterbox) layers, painted inside the same
   * scaled composition wrapper, below captions. */
  layers?: ReactNode
  /** Fade/flash: the one frame-paint effect that must cover the captions too (docs/EDITING.md
   * "Frame-paint effects"), painted inside the same scaled wrapper but after `CaptionView`. */
  overCaption?: ReactNode
  /** Schema 12: the active caption track's layer mask, applied to the caption plane only. */
  captionMask?: LayerMask | null
  titleMotion?: TitlePaintState | null
}) {
  const ref = useRef<HTMLDivElement>(null)
  const projection = useCompositionProjection(ref, composition)
  const [fontState, setFontState] = useState<{ key: string; status: CaptionFont['readiness']; revision: number }>({ key: '', status: 'loading', revision: 0 })
  const [measurer, setMeasurer] = useState<ReturnType<typeof createDomMeasurer> | null>(null)
  const inputs = useMemo(() => {
    const value = supplied ?? defaultCaptionInputs(composition)
    return { ...value, emphasized: cue?.emphasized, emphasisFont: value.emphasisFont && !cue?.emphasized?.length
      ? { ...value.emphasisFont, stack: value.font.stack } : value.emphasisFont }
  }, [supplied, composition.width, composition.height, cue?.emphasized])
  const resolvedTitleMotion = titleMotion !== undefined ? titleMotion : cue && inputs.titleMotion
    ? titleMotionAt({ startUs: cue.startUs, endUs: cue.endUs, titleMotion: inputs.titleMotion }, timestampUs) : null
  const titleVisual = titleVisualAt(resolvedTitleMotion)
  const fontKey = JSON.stringify([inputs.font, inputs.emphasisFont ?? null, fontSample ?? cue?.text ?? ''])
  useEffect(() => {
    const owner = ref.current!.ownerDocument
    const metrics = createDomMeasurer(owner)
    setMeasurer(metrics)
    return () => metrics.dispose()
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
  const needsWords = motion !== 'static-clean' && motion !== 'phrase-fade' || resolvedTitleMotion?.kind === 'cascade' || resolvedTitleMotion?.kind === 'accent'
  const titleWordMotion = resolvedTitleMotion?.kind === 'cascade' || resolvedTitleMotion?.kind === 'accent'
  const layoutCue = useMemo(() => cue && titleWordMotion
    ? decorativeTextCue({ id: 'title-motion', text: cue.text, startUs: cue.startUs, endUs: cue.endUs }) : cue,
  [cue, titleWordMotion])
  const wordLayout = useMemo(() => layout && cue && measurer && needsWords
    ? layoutCaptionWords(layout, layoutCue!, measurer.measureRange) : layout, [layout, cue, layoutCue, measurer, needsWords])
  const frame = useMemo(() => wordLayout && cue ? captionFrame(wordLayout, cue, timestampUs, motion, motionSpeed) : null, [wordLayout, cue, timestampUs, motion, motionSpeed])
  const paintedCaption = frame && <CaptionView key={`${motion}:${timestampUs}`} frame={frame} titleMotion={resolvedTitleMotion} />
  const animatedCaption = paintedCaption && resolvedTitleMotion ? <div style={{ position: 'absolute', inset: 0,
    opacity: titleVisual.opacity, transform: `translateY(${titleVisual.y}px) scale(${titleVisual.scale})`,
    transformOrigin: `${frame!.layout.bounds.x + frame!.layout.bounds.width / 2}px ${frame!.layout.bounds.y + frame!.layout.bounds.height / 2}px`,
    filter: titleVisual.blur ? `blur(${titleVisual.blur}px)` : undefined }}>{paintedCaption}</div> : paintedCaption
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
      {animatedCaption && (activeMask(captionMask)
        ? <div data-caption-mask style={{ position: 'absolute', inset: 0, ...maskStyle(captionMask, composition, null) }}>{animatedCaption}</div>
        : animatedCaption)}
      {overCaption}
    </div>}
  </div>
}
