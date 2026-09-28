import { graphemes } from '../core/captionText'
import type { CaptionAlignment, TextTransform } from '../captions/style'

/**
 * Text+ input IDs confirmed by the Resolve spike (docs/decisions/0008-resolve-textplus.md, "Text+ input IDs").
 * `LUA_INPUT_WHITELIST` (below) is the only set of IDs the Lua bridge (06) will ever write — it never applies an
 * arbitrary input name from a request.
 */
export const TEXT_PLUS_INPUTS = {
  text: 'StyledText',
  font: 'Font',
  style: 'Style',
  size: 'Size',
  fillEnabled: 'Enabled1', fillRed: 'Red1', fillGreen: 'Green1', fillBlue: 'Blue1', fillAlpha: 'Alpha1',
  outlineEnabled: 'Enabled2', outlineRed: 'Red2', outlineGreen: 'Green2', outlineBlue: 'Blue2', outlineThickness: 'Thickness2',
  shadowEnabled: 'Enabled3',
  backgroundEnabled: 'Enabled4',
  center: 'Center',
  lineSpacing: 'LineSpacing',
  characterSpacing: 'CharacterSpacing',
  horizontalJustification: 'HorizontalJustificationNew',
  // Write-on (ADR 0008 deviation: the real IDs are `Start`/`End`, not `WriteOnStart`/`WriteOnEnd`). Keyframing
  // `End` is confirmed working (ADR 0009, E9); `progressive-word-reveal` (07) is the only motion that keys it.
  writeOnStart: 'Start', writeOnEnd: 'End',
} as const

export const LUA_INPUT_WHITELIST: readonly string[] = Object.values(TEXT_PLUS_INPUTS)

/**
 * The laid-out font size (composition px: `layoutCaption`'s `font.size`, i.e. after the max-lines shrink, times its
 * `fitScale`) -> Text+'s `Size`. The composition has the timeline's aspect ratio (`compositionFor`), so one uniform
 * scale maps it onto the timeline frame.
 *
 * Fusion's `Size` is relative to the frame *width*: em = `Size` × width × 9/16. ADR 0009, E8: `Size = 0.08` gave a
 * 0.0583 h cap height with Open Sans (a 0.0817 h = 0.046 w em) on 16:9, where width × 9/16 is the height. Dividing
 * by the height instead drew portrait captions ~0.32× too small on a 9:16 timeline. The timeline width cancels out, so
 * `Size` depends only on the composition size. **UNVERIFIED** off 16:9 beyond that one visual report.
 */
export function textPlusSize(fontPx: number, compositionWidth: number): number {
  return fontPx / (compositionWidth * 9 / 16)
}

/**
 * The laid-out caption block (`layoutCaption`'s `bounds`, composition px) -> Text+'s `Center`: the block's centre as
 * a frame fraction. The preview positions that block inside the safe area with `position` as a fraction of the
 * *free* space, so the raw `horizontal`/`vertical` fractions are not the text's centre.
 * `Center` y points up (ADR 0009, E8: y = 0.2 rendered 0.8 of the way down), hence `1 - y`.
 */
export function centerFor(bounds: { x: number; y: number; width: number; height: number }, composition: { width: number; height: number }): { x: number; y: number } {
  return {
    x: (bounds.x + bounds.width / 2) / composition.width,
    y: 1 - (bounds.y + bounds.height / 2) / composition.height,
  }
}

/**
 * KathaCut `letterSpacing` (composition px added between glyphs) -> Text+'s `CharacterSpacing`, a multiplier whose
 * default is `1` (ADR 0008). Sending the px value raw (usually `0`) collapsed glyph advances, so Malayalam words
 * rendered overlapped and right-to-left. **UNVERIFIED** scale: assumes Text+ adds `(value - 1)` em per glyph.
 */
export function textPlusCharacterSpacing(letterSpacingPx: number, fontSizePx: number): number {
  return fontSizePx > 0 ? 1 + letterSpacingPx / fontSizePx : 1
}

/**
 * Natural line height (ascender - descender + line gap, in em) of Anek Malayalam, KathaCut's default caption font:
 * 2865 / 2000 units from its hhea and OS/2 typo metrics (identical in every installed static and variable file).
 */
const NATURAL_LINE_HEIGHT_EM = 1.4325

/**
 * KathaCut `lineHeight` (line pitch as a multiple of the font size, as the preview lays it out) -> Text+'s
 * `LineSpacing`, a multiplier of the font's own natural line height (default `1`, ADR 0008). Sending `1.6` raw
 * spaced lines 1.6 x 1.43 em apart and pushed the second and third lines off the frame. **UNVERIFIED** that
 * `LineSpacing` scales the natural line height; other fonts' metrics differ, so their spacing is approximate.
 */
export function textPlusLineSpacing(lineHeight: number): number {
  return lineHeight / NATURAL_LINE_HEIGHT_EM
}

/**
 * KathaCut `outlineWidth` (composition px) -> Text+'s `Thickness2`. Sending the px value raw (1-8) drew a huge
 * black outline blob. **UNVERIFIED** scale: assumes thickness is relative to the em size, like `Size`'s em basis.
 */
export function textPlusOutlineThickness(outlineWidthPx: number, fontSizePx: number): number {
  return fontSizePx > 0 ? outlineWidthPx / fontSizePx : 0
}

/**
 * `captionAppearanceSchema`'s color fields are always a 6-hex-digit `#rrggbb` string (see `style.ts`'s `color`
 * schema) — there is no alpha channel on a stored color; background translucency is the separate
 * `backgroundOpacity` field, applied by the caller. `a` is always `1` here.
 */
export function colorToRgba01(css: string): { r: number; g: number; b: number; a: number } {
  const match = /^#([\da-fA-F]{2})([\da-fA-F]{2})([\da-fA-F]{2})$/.exec(css)
  if (!match) throw new Error(`Unsupported color format for Text+: ${css}`)
  const [, r, g, b] = match
  return { r: parseInt(r, 16) / 255, g: parseInt(g, 16) / 255, b: parseInt(b, 16) / 255, a: 1 }
}

/**
 * **UNVERIFIED** placeholder (0 = left, 1 = center, 2 = right). ADR 0009, E8: values 0/1/2 render a single line
 * identically (centred on `Center`); the mapping only matters for multi-line text and is still unmeasured.
 */
export function horizontalJustificationFor(alignment: CaptionAlignment): number {
  return { left: 0, center: 1, right: 2 }[alignment]
}

const MALAYALAM = /[ഀ-ൿ]/u
/** Families in KathaCut's font stack (`DEFAULT_FONT_STACK`) that carry Malayalam glyphs, in stack order. */
const MALAYALAM_FAMILIES = ['Anek Malayalam', 'Noto Sans Malayalam', 'Malayalam Sangam MN', 'Kartika', 'Nirmala UI']

/**
 * The family Text+ should use for `text`. The preview asks for `"<family>", <DEFAULT_FONT_STACK>`, so when the
 * chosen family has no Malayalam (e.g. Arial) the browser draws each Malayalam character in the stack's first
 * Malayalam font. Text+ has no per-character fallback and draws Malayalam in Arial as broken glyphs, so Malayalam
 * text in such a family is sent in that stack font instead. `substituted` marks it for the support report. A family
 * counts as Malayalam-capable when it's in the stack's Malayalam list or has "Malayalam" in its name.
 */
export function textPlusFontFamily(family: string, text: string): { family: string; substituted: boolean } {
  if (!MALAYALAM.test(text)) return { family, substituted: false }
  const capable = MALAYALAM_FAMILIES.some((name) => name.toLowerCase() === family.toLowerCase()) || /malayalam/i.test(family)
  return capable ? { family, substituted: false } : { family: MALAYALAM_FAMILIES[0], substituted: true }
}

/**
 * **UNVERIFIED** (ADR 0008, "Text+ input IDs"): `Style` is free text with no server-side validation — "an invalid
 * style name won't error... rely on the visual check, not the return value." This best-effort mapping from
 * KathaCut's weight/italic pair to a common style name may not match the chosen font's actual named styles.
 */
export function styleNameFor(weight: number, italic: boolean): string {
  const bold = weight >= 600
  if (bold && italic) return 'Bold Italic'
  if (bold) return 'Bold'
  if (italic) return 'Italic'
  return 'Regular'
}

/**
 * Applies a KathaCut text transform to the literal string sent to Text+ (which has no CSS-style `text-transform`
 * of its own — the preview applies it as a paint-time CSS property instead, so this is the export-side
 * equivalent). Case mapping goes through `toLocaleUpperCase`/`toLocaleLowerCase` on the whole string, which is
 * Unicode-aware and leaves Malayalam (a caseless script) unaffected. `capitalize` walks grapheme clusters (never
 * UTF-16 code units) so a combining vowel sign or conjunct is never split from its base consonant.
 */
export function applyTextTransform(text: string, transform: TextTransform): string {
  if (transform === 'none') return text
  if (transform === 'uppercase') return text.toLocaleUpperCase()
  if (transform === 'lowercase') return text.toLocaleLowerCase()
  let atWordStart = true
  return graphemes(text).map((cluster) => {
    if (/^\s$/u.test(cluster)) { atWordStart = true; return cluster }
    const mapped = atWordStart ? cluster.toLocaleUpperCase() : cluster
    atWordStart = false
    return mapped
  }).join('')
}
