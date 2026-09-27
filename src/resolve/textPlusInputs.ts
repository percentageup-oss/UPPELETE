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
} as const

export const LUA_INPUT_WHITELIST: readonly string[] = Object.values(TEXT_PLUS_INPUTS)

/**
 * KathaCut px (1080-composition-wide units, `captionAppearanceSchema.fontSize` after `captionStyleInputs`'
 * viewport scale) -> Text+'s `Size`.
 *
 * **UNVERIFIED** (ADR 0008, "Size calibration"): the spike's still-frame export came back blank, so no pixel
 * measurement of a known `Size` value exists, and which axis `Size` scales against (frame width or height) was
 * never confirmed either. This assumes the common Fusion normalized-coordinate convention — `Size` as a fraction
 * of the composition's own height — scaled from KathaCut's 1080-wide reference to the real timeline pixel size.
 * Treat the result as a placeholder only; re-derive once a follow-up spike measures an actual rendered frame
 * (see the ADR's "Open items before later briefs proceed").
 */
export function textPlusSize(px: number, compositionWidth: number, timelineWidth: number, timelineHeight: number): number {
  const outputPx = px * (timelineWidth / compositionWidth)
  return outputPx / timelineHeight
}

/**
 * KathaCut's `horizontal`/`vertical` position fractions (0..1, y-down: 0 = top, 1 = bottom,
 * `captionAppearanceSchema`) -> Text+'s `Center` point.
 *
 * **UNVERIFIED** (ADR 0008, "Placement"): "Y-axis direction (up vs. down) is unconfirmed — the still that would
 * show the resulting position came back blank... treat the README's 'y up' claim as unverified." This flips
 * vertical accordingly (`1 - vFraction`); confirm against a real rendered frame before trusting captions land in
 * the right place and aren't vertically mirrored.
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
 * **UNVERIFIED** (ADR 0008, "Text+ input IDs"): `HorizontalJustificationNew`'s input ID is confirmed present,
 * but "the enum mapping (which number = left/center/right) is unconfirmed — needs an explicit per-value test with
 * a visual check before Brief 05 encodes it." This is a placeholder guess (0 = left, 1 = center, 2 = right), kept
 * so 06 has something to send; every caption's alignment needs a visual re-check once a real spike confirms the
 * actual enum.
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
