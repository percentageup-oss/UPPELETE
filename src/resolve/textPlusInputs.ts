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
 * KathaCut px (1080-composition-wide units, `captionAppearanceSchema.fontSize` after `captionStyleInputs`'
 * viewport scale) -> Text+'s `Size`.
 *
 * `Size` is the em size as a fraction of the frame height (ADR 0009, E8: `Size = 0.08` gave a 0.0583 h cap
 * height with Open Sans, i.e. a 0.0817 h em). Measured on one 16:9 still only; portrait is unmeasured.
 */
export function textPlusSize(px: number, compositionWidth: number, timelineWidth: number, timelineHeight: number): number {
  const outputPx = px * (timelineWidth / compositionWidth)
  return outputPx / timelineHeight
}

/**
 * KathaCut's `horizontal`/`vertical` position fractions (0..1, y-down: 0 = top, 1 = bottom,
 * `captionAppearanceSchema`) -> Text+'s `Center` point.
 * `Center` y points up (ADR 0009, E8: y = 0.2 rendered 0.8 of the way down), hence `1 - vFraction`.
 */
export function centerFor(hFraction: number, vFraction: number): { x: number; y: number } {
  return { x: hFraction, y: 1 - vFraction }
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
