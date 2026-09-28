import type { TextSpan } from '../core/captionText'
import type { CaptionStyle } from '../captions/style'
import { SPOTLIGHT_DIM } from '../captions/renderer'
import { applyTextTransform, styleNameFor, colorToRgba01 } from './textPlusInputs'
import { wordRanges, offsetInUnit, type CharUnit } from './charUnits'

/** Character Level Styling range (ADR 0011 units: 0-based code points, end inclusive — converted by
 * `emphasisStyleRanges` below, never by a caller). No per-range font-family id: the ADR's property table has no
 * confirmed id for it (only `109`, a *style name* string), so `emphasisFontFamily` never reaches Resolve. */
export type TextPlusStyleRange = {
  start: number; end: number
  color?: { r: number; g: number; b: number }
  alpha?: number
  sizeScale?: number
  style?: string
  underline?: boolean
}

/**
 * Builds Character Level Styling ranges for one Text+ clip's emphasized words (ADR 0011, "Consequences for
 * 17/18"). `text` is the exact string already sent to Text+ — base `textTransform` baked in, lines already
 * joined with `\n` — so words are located with that *same* transform (`appearance.textTransform`), matching
 * what `wordRanges` actually has to find; a word using a distinct `emphasisTextTransform` therefore locates by
 * its base-transformed spelling, not the emphasis one. `wordRanges` drops anything it can't find verbatim or
 * that lands off a grapheme boundary — this function never guesses at those, only styles what it locates.
 *
 * For each located word, `emphasisTextTransform` (when it resolves to something other than the base transform)
 * is then applied to just that range **in the returned text**, but only when doing so keeps the substring's
 * exact UTF-16 length — a length change would invalidate every other range's offsets computed from the same
 * `text` — so a non-length-preserving transform (e.g. German 'ß' -> 'SS') is silently skipped for that one word:
 * it still gets colour/size/style/underline, just not the case change.
 *
 * Spotlight mode (`appearance.emphasisMode === 'spotlight'`) adds a dim range (`alpha: SPOTLIGHT_DIM`) over
 * every non-emphasized stretch, split so it never covers a literal '\n' — newline counting under the ADR's unit
 * is unconfirmed ("no data"), so KathaCut never sends a range that includes one.
 *
 * Pure: returns the possibly-edited text plus the ranges, already converted to `unit` (ADR 0011: pass
 * `TEXT_PLUS_CHAR_UNIT`). Never mutates `text` or `emphasized`.
 */
export function emphasisStyleRanges(
  text: string,
  emphasized: readonly TextSpan[] | undefined,
  appearance: CaptionStyle['appearance'],
  unit: CharUnit,
): { text: string; ranges: TextPlusStyleRange[] } {
  if (!emphasized?.length) return { text, ranges: [] }

  const { ranges: located } = wordRanges(emphasized, text, (word) => applyTextTransform(word, appearance.textTransform))
  if (!located.length) return { text, ranges: [] }

  const resolvedEmphasisTransform = appearance.emphasisTextTransform === 'none' ? appearance.textTransform : appearance.emphasisTextTransform
  const baseStyle = styleNameFor(appearance.fontWeight, appearance.fontItalic)
  const emphasisStyle = styleNameFor(appearance.emphasisWeight, appearance.emphasisItalic)
  const secondary = colorToRgba01(appearance.secondaryColor)

  // Same-length substitutions only, so every located range's [start, end) stays valid throughout.
  let outText = text
  if (resolvedEmphasisTransform !== appearance.textTransform) {
    for (const { wordIndex, start, end } of located) {
      const transformed = applyTextTransform(emphasized[wordIndex].text, resolvedEmphasisTransform)
      if (transformed.length === end - start) outText = outText.slice(0, start) + transformed + outText.slice(end)
    }
  }

  const ranges: { start: number; end: number }[] = []
  const emphasisRanges: TextPlusStyleRange[] = []
  for (const { start, end } of located) {
    ranges.push({ start, end })
    const range: TextPlusStyleRange = { start, end, color: { r: secondary.r, g: secondary.g, b: secondary.b } }
    if (appearance.emphasisScale !== 1) range.sizeScale = appearance.emphasisScale
    if (emphasisStyle !== baseStyle) range.style = emphasisStyle
    if (appearance.emphasisUnderline) range.underline = true
    emphasisRanges.push(range)
  }

  if (appearance.emphasisMode === 'spotlight') {
    let cursor = 0
    for (const { start, end } of ranges) {
      pushDimRanges(emphasisRanges, outText, cursor, start)
      cursor = end
    }
    pushDimRanges(emphasisRanges, outText, cursor, outText.length)
  }

  return {
    text: outText,
    ranges: emphasisRanges.map((range) => ({
      ...range,
      start: offsetInUnit(outText, range.start, unit),
      end: offsetInUnit(outText, range.end, unit) - 1,
    })),
  }
}

/** One dim range per stretch of `outText.slice(from, to)` that isn't a line break, so a spotlight range never
 * covers a literal '\n' (ADR 0011: newline counting under the confirmed unit is unconfirmed). */
function pushDimRanges(out: TextPlusStyleRange[], outText: string, from: number, to: number): void {
  let start = from
  for (let i = from; i < to; i++) {
    if (outText[i] === '\n') {
      if (i > start) out.push({ start, end: i, alpha: SPOTLIGHT_DIM })
      start = i + 1
    }
  }
  if (to > start) out.push({ start, end: to, alpha: SPOTLIGHT_DIM })
}

/**
 * Character Level Styling range for the single word at `index` in `words` (brief 18's full-line active-word
 * highlight/pop) — located in `text` the exact same way `emphasisStyleRanges` locates emphasized words
 * (`wordRanges`, grapheme-boundary only, `transform` applied per word). Returns null when the word isn't found
 * verbatim (never guesses at a boundary). `scale` is only carried as `sizeScale` when given and different from
 * `1` — word-pop passes `emphasisScale`, active-word-highlight passes `undefined`. Pure; already converted to
 * `unit` like `emphasisStyleRanges`'s own return, so the caller never mixes unit spaces.
 */
export function activeWordRange(
  text: string,
  words: readonly { text: string }[],
  index: number,
  transform: (word: string) => string,
  fill: { r: number; g: number; b: number },
  scale: number | undefined,
  unit: CharUnit,
): TextPlusStyleRange | null {
  const { ranges } = wordRanges(words, text, transform)
  const located = ranges.find((range) => range.wordIndex === index)
  if (!located) return null
  const range: TextPlusStyleRange = {
    start: offsetInUnit(text, located.start, unit),
    end: offsetInUnit(text, located.end, unit) - 1,
    color: fill,
  }
  if (scale !== undefined && scale !== 1) range.sizeScale = scale
  return range
}

/**
 * Merges the active word's range (above) into the cue's own emphasis ranges (brief 17), active word last so it
 * wins where they land on the exact same span. The only real conflict is spotlight dimming: a dim range
 * (`alpha`) that overlaps the active word's span is split to exclude it, so the word being spoken is never
 * dimmed. Every other emphasis range passes through unchanged — an active word that's also emphasized already
 * carries the same secondary colour/scale (both draw from `secondaryColor`/`emphasisScale`), so appending the
 * active range alongside it is redundant, not conflicting, and emphasis-only properties (style, underline) are
 * never touched.
 */
export function mergeActiveWordRange(ranges: readonly TextPlusStyleRange[], active: TextPlusStyleRange): TextPlusStyleRange[] {
  const out: TextPlusStyleRange[] = []
  for (const range of ranges) {
    if (range.alpha === undefined || range.end < active.start || range.start > active.end) { out.push(range); continue }
    if (range.start < active.start) out.push({ ...range, end: active.start - 1 })
    if (range.end > active.end) out.push({ ...range, start: active.end + 1 })
  }
  out.push(active)
  return out
}
