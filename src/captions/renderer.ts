import { sliceEmphasis } from '../core/emphasis'
import { captionTokens, graphemes, locateWordSpans, type TextSpan } from '../core/captionText'
import type { CaptionWord } from '../core/model'
import type { CaptionMotion } from './style'

export type Size = { width: number; height: number }
export type Rect = Size & { x: number; y: number }
export type CaptionFont = {
  stack: string; size: number; weight: number; lineHeight: number
  readiness: 'loading' | 'ready' | 'failed'; revision: string
  italic: boolean; letterSpacing: number; wordSpacing: number; textTransform: 'none' | 'uppercase' | 'lowercase' | 'capitalize'
}
export type CaptionFill = { from: string; to: string; angle: number }
export type CaptionAppearance = {
  color: string; outlineColor: string; outlineWidth: number
  shadow: string; background: string; padding: number
  secondaryColor?: string
  fill?: CaptionFill; secondaryFill?: CaptionFill
  underline?: boolean; spotlight?: boolean
  /** Only set when it differs from `shadow` (docs/CAPTION_RENDERER.md); undefined means "inherit `shadow`". */
  emphasisShadow?: string
  emphasisUnderline?: boolean
  /** Degrees, applied after layout around the painted block's own center (`CaptionView`); never
   * fed into `layoutCaption`'s wrap/fit math, which stays axis-aligned. */
  rotation: number
}
export type LayoutInputs = {
  /** Stable composition/media space, independent of preview pixels. */
  viewport: Size
  safeArea: { top: number; right: number; bottom: number; left: number }
  font: CaptionFont
  /** Optional measured local font for selected words. */
  emphasized?: TextSpan[]
  emphasisMotion?: 'none' | 'pop'
  emphasisFont?: CaptionFont
  maxLines: number
  position: { horizontal: number; vertical: number }
  /** Horizontal text alignment within the caption block; independent of the block's own position. */
  alignment: 'left' | 'center' | 'right'
  wrapping: 'whitespace' | 'explicit'
  appearance: CaptionAppearance
}
export type RunEmphasis = { spans: TextSpan[]; font: CaptionFont }
export type MeasureText = (text: string, font: CaptionFont, emphasis?: RunEmphasis) => Size
export type CaptionLine = Rect & { text: string; clusters: string[]; textStart: number; textEnd: number; separator: string }
export type CaptionLayout = {
  version: 1; inputs: LayoutInputs; font: CaptionFont; lines: CaptionLine[]
  safeRect: Rect; bounds: Rect; fitScale: number; warnings: string[]
  status: CaptionFont['readiness']
  wordRegions?: WordRegion[]
  /** The emphasis font actually used to measure word regions, resized to match the fitted `font`. */
  emphasisFont?: CaptionFont
}
export type MotionCueWord = Omit<CaptionWord, 'timingSource'> & { timingSource: CaptionWord['timingSource'] | 'decorative' }
export type MotionCue = { text: string; startUs: number; endUs: number; words?: MotionCueWord[]; emphasized?: TextSpan[] }
export type WordRegion = Rect & {
  lineIndex: number; wordIndex: number; textStart: number; textEnd: number; revealRight: number
  /** Position/width measured with the emphasis font's own shaping run, when it differs from the base font. */
  emphasis?: { x: number; width: number }
}
export type MeasureRange = (text: string, start: number, end: number, font: CaptionFont, emphasis?: RunEmphasis) => Rect[]

export type WordMotionReason = 'no-words' | 'incomplete' | 'invalid' | 'needs-review' | 'estimated' | 'decorative' | 'ok'
/** No invented timings. A partial or stale word list must not drive a word animation. */
export function wordMotionAvailability(cue: MotionCue | null): { enabled: boolean; estimated: boolean; reason: WordMotionReason; explanation: string } {
  const words = cue?.words ?? []
  const spans = cue && locateWordSpans(cue.text, words)
  const tokens = cue ? captionTokens(cue.text) : []
  const complete = !!spans && words.length > 0 && tokens.length > 0
    && tokens.every((token) => spans.some((span) => span.textStart <= token.textStart && span.textEnd >= token.textEnd))
  const valid = complete && words.every((word, index) => Number.isSafeInteger(word.startUs) && Number.isSafeInteger(word.endUs)
    && word.startUs >= cue!.startUs && word.endUs <= cue!.endUs && word.endUs > word.startUs
    && (index === 0 || word.startUs >= words[index - 1].endUs))
  const estimated = words.some((word) => word.timingSource === 'estimated')
  const decorative = words.length > 0 && words.every((word) => word.timingSource === 'decorative')
  const stale = words.some((word) => word.needsReview && word.timingSource !== 'estimated')
  const reason: WordMotionReason = words.length === 0 ? 'no-words'
    : !complete ? 'incomplete'
      : !valid ? 'invalid'
        : stale ? 'needs-review'
          : decorative ? 'decorative' : estimated ? 'estimated' : 'ok'
  return { enabled: valid && !stale, estimated, reason,
    explanation: !valid ? 'Word effects unavailable: complete word timing is required. Cue timing alone uses static clean; no words are estimated by rendering.'
      : stale ? 'Word effects unavailable: word timing needs review. Preview uses static clean.'
          : decorative ? 'Decorative word timing for this text animation; not aligned to audio.'
          : estimated ? 'Estimated word timing — not aligned to audio; needs review.'
          : `Word timing: ${[...new Set(words.map((word) => word.timingSource))].join(', ')}.`,
  }
}

/** Project-wide counts for the style panel: how many cues can actually drive a word preset. */
export function summarizeWordMotion(cues: readonly MotionCue[]): { complete: number; estimated: number; unavailable: number; total: number } {
  let complete = 0, estimated = 0, unavailable = 0
  for (const cue of cues) {
    const availability = wordMotionAvailability(cue)
    if (!availability.enabled) unavailable++
    else if (availability.estimated) estimated++
    else complete++
  }
  return { complete, estimated, unavailable, total: cues.length }
}

/** The unfitted emphasis face, resized to track `fitted` (the base font after the max-lines fitting
 * loop may have shrunk it) while preserving the emphasis face's own size ratio to the base font —
 * e.g. a 1.5x emphasis scale stays 1.5x of whatever size the base line actually ends up at. Falls
 * back to `fitted` itself (ratio 1) when no distinct emphasis font is configured. */
export function fittedEmphasisFont(inputs: LayoutInputs, fitted: CaptionFont): CaptionFont {
  return { ...(inputs.emphasisFont ?? fitted), size: fitted.size * ((inputs.emphasisFont?.size ?? inputs.font.size) / inputs.font.size) }
}

/** Range metrics come from complete shaped lines, not isolated token measurements. */
export function layoutCaptionWords(layout: CaptionLayout, cue: MotionCue, measure: MeasureRange): CaptionLayout {
  if (layout.status !== 'ready' || !wordMotionAvailability(cue).enabled || layout.inputs.emphasized?.length) return layout
  const spans = locateWordSpans(cue.text, cue.words!)!
  // The layout's own font may have been shrunk to fit maxLines; the emphasis face must track that
  // fitted size (keeping its own ratio to the base font), or its word rects would be measured
  // against a size the base line never uses.
  const emphasisFont = layout.inputs.emphasisFont ? fittedEmphasisFont(layout.inputs, layout.font) : undefined
  const wordRegions = spans.flatMap((span, wordIndex) => layout.lines.flatMap((line, lineIndex) => {
    const start = Math.max(span.textStart, line.textStart), end = Math.min(span.textEnd, line.textEnd)
    if (end <= start) return []
    const revealEnd = Math.min(line.textEnd, spans[wordIndex + 1]?.textStart ?? cue.text.length)
    const prefix = measure(line.text, 0, revealEnd - line.textStart, layout.font)
    const revealRight = line.x + Math.max(0, ...prefix.map((rect) => rect.x + rect.width))
    // Measure the emphasis face against the *same complete line*, not a scaled copy of the regular
    // rect: a bolder/italic face has different glyph advances, so cropping a bold shaping run with
    // the regular rect would clip the wrong glyphs (docs/CAPTION_RENDERER.md).
    const emphasisRects = emphasisFont ? measure(line.text, start - line.textStart, end - line.textStart, emphasisFont) : null
    const emphasisRect = emphasisRects?.[0]
    return measure(line.text, start - line.textStart, end - line.textStart, layout.font).map((rect) => ({
      ...rect, x: line.x + rect.x, y: line.y, height: line.height, lineIndex, wordIndex,
      textStart: start, textEnd: end, revealRight,
      emphasis: emphasisRect ? { x: line.x + emphasisRect.x, width: emphasisRect.width } : undefined,
    }))
  }))
  return { ...layout, wordRegions, emphasisFont }
}

/** Base-line opacity when Emphasis mode is "spotlight" — non-active words are dimmed, not hidden. */
export const SPOTLIGHT_DIM = .35

export const DEFAULT_FONT_STACK = '"Noto Sans Malayalam", "Malayalam Sangam MN", "Kartika", "Nirmala UI", Arial, sans-serif'
export function defaultCaptionInputs(viewport: Size): LayoutInputs {
  return {
    viewport, safeArea: { top: .08, right: .1, bottom: .12, left: .1 },
    font: { stack: DEFAULT_FONT_STACK, size: viewport.width * .055, weight: 700, lineHeight: 1.6, readiness: 'loading', revision: 'system',
      italic: false, letterSpacing: 0, wordSpacing: 0, textTransform: 'none' },
    maxLines: 3, position: { horizontal: .5, vertical: 1 }, alignment: 'center', wrapping: 'whitespace',
    appearance: { color: '#ffffff', outlineColor: '#000000', outlineWidth: 1, shadow: '0 2px 3px #000', background: 'transparent', padding: 6, rotation: 0 },
  }
}

const ALIGN_FACTOR: Record<LayoutInputs['alignment'], number> = { left: 0, center: .5, right: 1 }

function validate(inputs: LayoutInputs) {
  const positive = [inputs.viewport.width, inputs.viewport.height, inputs.font.size, inputs.font.lineHeight]
  if (positive.some((n) => !Number.isFinite(n) || n <= 0)) throw new Error('Caption dimensions and font metrics must be positive and finite.')
  if (inputs.emphasisFont && (!Number.isFinite(inputs.emphasisFont.size) || inputs.emphasisFont.size <= 0)) throw new Error('Invalid emphasis font size.')
  const fractions = [...Object.values(inputs.safeArea), ...Object.values(inputs.position)]
  if (fractions.some((n) => !Number.isFinite(n) || n < 0 || n > 1)
    || inputs.safeArea.left + inputs.safeArea.right >= 1 || inputs.safeArea.top + inputs.safeArea.bottom >= 1) throw new Error('Invalid caption safe area or position.')
  if (!Number.isInteger(inputs.maxLines) || inputs.maxLines < 1 || !inputs.font.stack.trim()
    || !Number.isFinite(inputs.font.weight) || inputs.font.weight < 1 || inputs.font.weight > 1000
    || !Number.isFinite(inputs.font.letterSpacing) || !Number.isFinite(inputs.font.wordSpacing)
    || [inputs.appearance.padding, inputs.appearance.outlineWidth].some((n) => !Number.isFinite(n) || n < 0)) throw new Error('Invalid caption typography or appearance.')
}

/** Whitespace-only soft breaks keep Malayalam shaping runs and punctuation intact.
 * No emergency code-unit/grapheme break inside a word: long words are uniformly fitted.
 * Each line plus its separator reconstructs the exact input (including CRLF and spaces).
 */
function breakLines(text: string, font: CaptionFont, width: number, wrapping: LayoutInputs['wrapping'], measure: (text: string, font: CaptionFont, offset?: number) => Size) {
  const lines: Omit<CaptionLine, keyof Rect>[] = []
  let start = 0, end = 0, softBreak = 0
  const push = (at: number, separator = '') => {
    const lineText = text.slice(start, at)
    lines.push({ text: lineText, clusters: graphemes(lineText), textStart: start, textEnd: at, separator })
    start = at + separator.length; softBreak = start
  }
  for (const cluster of graphemes(text)) {
    if (/^(?:\r\n|\r|\n)$/.test(cluster)) { push(end, cluster); end += cluster.length; continue }
    end += cluster.length
    // NBSP/NNBSP are not break opportunities. Offsets are storage addresses only.
    if (/^[\t \u2000-\u200a\u3000]+$/u.test(cluster)) softBreak = end
    if (wrapping === 'whitespace' && measure(text.slice(start, end), font, start).width > width && softBreak > start) {
      push(softBreak)
    }
  }
  push(text.length)
  return lines
}

/** Pure given the supplied full-run font metrics. No clock, frame count, DOM or mutation. */
export function layoutCaption(text: string, inputs: LayoutInputs, measure: MeasureText): CaptionLayout {
  validate(inputs)
  const { viewport: v, safeArea: a, appearance } = inputs
  const safeRect = { x: v.width * a.left, y: v.height * a.top, width: v.width * (1 - a.left - a.right), height: v.height * (1 - a.top - a.bottom) }
  const padding = appearance.padding + appearance.outlineWidth
  const width = safeRect.width - padding * 2
  if (width <= 0 || safeRect.height <= padding * 2) throw new Error('Caption padding exceeds the safe area.')
  const base = { version: 1 as const, inputs, font: inputs.font, safeRect, bounds: { ...safeRect, width: 0, height: 0 }, fitScale: 1, warnings: [] as string[], status: inputs.font.readiness }
  if (inputs.font.readiness !== 'ready') return { ...base, lines: [] }
  const checkedMeasure = (value: string, font: CaptionFont, offset = 0) => {
    const emphasis = inputs.emphasized?.length ? { spans: sliceEmphasis(inputs.emphasized, offset, offset + value.length), font: fittedEmphasisFont(inputs, font) } : undefined
    const size = measure(value, font, emphasis)
    if (!Number.isFinite(size.width) || size.width < 0 || !Number.isFinite(size.height) || size.height <= 0) throw new Error(`Invalid shaped text metrics (measured ${size.width} x ${size.height}, ${value.length} UTF-16 units${emphasis ? ', with emphasis' : ''}).`)
    return size
  }
  let font = { ...inputs.font }
  let broken = breakLines(text, font, width, inputs.wrapping, checkedMeasure)
  const hardLineCount = graphemes(text).filter((cluster) => /^(?:\r\n|\r|\n)$/.test(cluster)).length + 1
  // Deterministic reference-space fitting, never a preview-size-driven reflow.
  for (let step = 1; hardLineCount <= inputs.maxLines && broken.length > inputs.maxLines && inputs.wrapping === 'whitespace' && step <= 10; step++) {
    font = { ...inputs.font, size: inputs.font.size * (1 - step * .05) }
    broken = breakLines(text, font, width, inputs.wrapping, checkedMeasure)
  }
  const sizes = broken.map((line) => checkedMeasure(line.text, font, line.textStart))
  const lineHeight = Math.max(font.size * font.lineHeight, ...sizes.map((size) => size.height))
  const blockWidth = Math.max(0, ...sizes.map((size) => size.width)) + 2 * padding
  const blockHeight = broken.length * lineHeight + 2 * padding
  const fitScale = Math.min(1, safeRect.width / blockWidth, safeRect.height / blockHeight)
  const bounds = { x: safeRect.x + (safeRect.width - blockWidth * fitScale) * inputs.position.horizontal,
    y: safeRect.y + (safeRect.height - blockHeight * fitScale) * inputs.position.vertical,
    width: blockWidth * fitScale, height: blockHeight * fitScale }
  const warnings = broken.length > inputs.maxLines ? ['max-lines-exceeded: explicit breaks/text preserved'] : []
  if (fitScale < 1) warnings.push('caption-uniformly-fitted')
  const alignFactor = ALIGN_FACTOR[inputs.alignment]
  return { ...base, font, bounds, fitScale, warnings, lines: broken.map((line, index) => ({ ...line,
    x: padding + (blockWidth - padding * 2 - sizes[index].width) * alignFactor,
    y: padding + index * lineHeight, width: sizes[index].width, height: lineHeight })) }
}

export type CaptionFrame = { visible: boolean; opacity: number; elapsedUs: number; layout: CaptionLayout
  wordSpans?: TextSpan[]; motion?: CaptionMotion; timingNotice?: string; words?: { wordIndex: number; active: boolean; revealed: boolean; scale: number }[] }
/** Pure absolute-source-time evaluation: no CSS animation, elapsed playback clock or seek history. */
export function captionFrame(layout: CaptionLayout, cue: { startUs: number; endUs: number; text?: string; words?: MotionCueWord[] }, timestampUs: number,
  requested: CaptionMotion = 'static-clean', motionSpeed = 1): CaptionFrame {
  if (![cue.startUs, cue.endUs, timestampUs].every(Number.isSafeInteger) || cue.startUs < 0 || cue.endUs <= cue.startUs || timestampUs < 0) throw new Error('Expected safe integer source timestamps and positive cue duration.')
  if (!Number.isFinite(motionSpeed) || motionSpeed < .25 || motionSpeed > 4) throw new Error('Motion speed must be between 0.25× and 4×.')
  const visible = layout.status === 'ready' && timestampUs >= cue.startUs && timestampUs < cue.endUs
  const elapsedUs = timestampUs - cue.startUs
  // Selected emphasis can animate independently of the overall phrase motion, from actual word timing.
  const selected = layout.inputs.emphasized?.length && cue.text && wordMotionAvailability({ ...cue, text: cue.text }).enabled
    ? { wordSpans: locateWordSpans(cue.text, cue.words!)!, timingNotice: wordMotionAvailability({ ...cue, text: cue.text }).explanation,
      words: cue.words!.map((word, wordIndex) => {
        const active = timestampUs >= word.startUs && timestampUs < word.endUs
        const phase = (timestampUs - word.startUs) / Math.min(200_000 / motionSpeed, word.endUs - word.startUs)
        return { wordIndex, active, revealed: timestampUs >= word.startUs,
          scale: layout.inputs.emphasisMotion === 'pop' && active ? 1 + .12 * Math.sin(Math.PI * Math.min(1, phase)) : 1 }
      }) } : {}
  // Preserve R1's public static frame shape for existing callers/snapshots.
  if (requested === 'static-clean') return { visible, opacity: visible ? 1 : 0, elapsedUs, layout, ...selected }
  if (requested === 'phrase-fade') {
    const ramp = Math.min(200_000 / motionSpeed, (cue.endUs - cue.startUs) / 2)
    return { visible, opacity: visible ? Math.max(0, Math.min(1, elapsedUs / ramp, (cue.endUs - timestampUs) / ramp)) : 0,
      elapsedUs, layout, motion: requested, ...selected }
  }
  const availability = wordMotionAvailability({ ...cue, text: cue.text ?? layout.lines.map((line) => line.text + line.separator).join('') })
  const motion = availability.enabled ? requested : 'static-clean'
  return { visible, opacity: visible ? 1 : 0, elapsedUs, layout, motion,
    timingNotice: availability.explanation,
    ...(layout.inputs.emphasized?.length ? { wordSpans: locateWordSpans(cue.text ?? '', cue.words ?? []) ?? [] } : {}),
    words: availability.enabled ? cue.words!.map((word, wordIndex) => {
      const active = timestampUs >= word.startUs && timestampUs < word.endUs
      const phase = (timestampUs - word.startUs) / Math.min(200_000 / motionSpeed, word.endUs - word.startUs)
      const selectedPop = layout.inputs.emphasized?.length && layout.inputs.emphasisMotion === 'pop'
      const scale = (motion === 'word-pop' || selectedPop) && active ? 1 + .12 * Math.sin(Math.PI * Math.min(1, phase)) : 1
      return { wordIndex, active, revealed: timestampUs >= word.startUs, scale }
    }) : [],
  }
}

export function projectCaptionViewport(composition: Size, preview: Size) {
  if ([composition.width, composition.height, preview.width, preview.height].some((n) => !Number.isFinite(n) || n <= 0)) throw new Error('Invalid caption projection dimensions.')
  const scale = Math.min(preview.width / composition.width, preview.height / composition.height)
  return { scale, x: (preview.width - composition.width * scale) / 2, y: (preview.height - composition.height * scale) / 2 }
}
