import { z } from 'zod'
import { defaultCaptionInputs, DEFAULT_FONT_STACK, type Size } from './renderer'

export const MOTIONS = [
  { id: 'static-clean', label: 'Static clean', words: false },
  { id: 'active-word-highlight', label: 'Active-word highlight', words: true },
  { id: 'word-pop', label: 'Word pop', words: true },
  { id: 'phrase-fade', label: 'Phrase fade', words: false },
  { id: 'progressive-word-reveal', label: 'Progressive word reveal', words: true },
] as const
export const motionSchema = z.enum(MOTIONS.map((motion) => motion.id))
export type CaptionMotion = z.infer<typeof motionSchema>
export const motionSpeedSchema = z.number().min(.25).max(4)

/** Local installed system faces only (CAPTION_RENDERER.md); no font is bundled or downloaded. */
export const FONT_FAMILY_CHOICES = ['Anek Malayalam', 'Noto Sans Malayalam', 'Malayalam Sangam MN', 'Kartika', 'Nirmala UI', 'Helvetica Neue', 'Arial'] as const
const color = z.string().regex(/^#[\da-fA-F]{6}$/)
const fontWeight = z.number().int().min(100).max(900).multipleOf(100)
export const TEXT_TRANSFORMS = ['none', 'uppercase', 'lowercase', 'capitalize'] as const
export const ALIGNMENTS = ['left', 'center', 'right'] as const
export const EMPHASIS_MODES = ['emphasize', 'spotlight'] as const
export const titleMotionSchema = z.strictObject({
  kind: z.enum(['focus', 'lift', 'cascade', 'wipe', 'accent', 'scale']),
  durationUs: z.number().int().min(100_000).max(5_000_000),
})
export type TitleMotion = z.infer<typeof titleMotionSchema>
export type TextTransform = (typeof TEXT_TRANSFORMS)[number]
export type CaptionAlignment = (typeof ALIGNMENTS)[number]
export type EmphasisMode = (typeof EMPHASIS_MODES)[number]

// Only bounded structured appearance data crosses project/IPC boundaries; no arbitrary CSS.
export const captionAppearanceSchema = z.strictObject({
  fontFamily: z.string().trim().min(1).max(100).regex(/^[\p{L}\p{N} _-]+$/u),
  fontSize: z.number().min(20).max(120),
  primaryColor: color, secondaryColor: color,
  outlineColor: color, outlineWidth: z.number().min(0).max(8),
  shadowColor: color, shadowBlur: z.number().min(0).max(20), shadowOffset: z.number().min(0).max(15),
  backgroundColor: color, backgroundOpacity: z.number().min(0).max(1), padding: z.number().min(0).max(40),
  horizontal: z.number().min(0).max(1), vertical: z.number().min(0).max(1),
  // Applied after layout, around the block's own center; wrap/fit stay axis-aligned (docs/CAPTION_RENDERER.md).
  rotation: z.number().min(-180).max(180).default(0),
  maxLines: z.number().int().min(1).max(6),
  // Font face (weight/italic only; family is the FONT_FAMILY_CHOICES/custom field above).
  fontWeight: fontWeight.default(700), fontItalic: z.boolean().default(false),
  // Empty family inherits the base face; selected words reserve their own measured width.
  emphasisFontFamily: z.string().trim().max(100).regex(/^[\p{L}\p{N} _-]*$/u).default(''),
  emphasisMotion: z.enum(['none', 'pop']).default('pop'),
  emphasisWeight: fontWeight.default(700), emphasisItalic: z.boolean().default(false),
  emphasisMode: z.enum(EMPHASIS_MODES).default('emphasize'),
  emphasisGradientEnabled: z.boolean().default(false),
  emphasisGradientFrom: color.default('#c8ff3d'), emphasisGradientTo: color.default('#ffffff'),
  // Static size multiplier for emphasized words (independent of the word-pop animation scale).
  emphasisScale: z.number().min(1).max(2).default(1),
  // Emphasis-only glow with its own radius.
  emphasisGlowEnabled: z.boolean().default(false), emphasisGlowColor: color.default('#ffffff'), emphasisGlowRadius: z.number().min(0).max(40).default(12),
  // 'none' follows the base textTransform; emphasisUnderline is OR-ed with the base underline.
  emphasisTextTransform: z.enum(TEXT_TRANSFORMS).default('none'), emphasisUnderline: z.boolean().default(false),
  // Format
  textTransform: z.enum(TEXT_TRANSFORMS).default('none'), underline: z.boolean().default(false),
  alignment: z.enum(ALIGNMENTS).default('center'),
  // Spacing (1080-composition-width units; lineHeight is a multiplier of font size)
  letterSpacing: z.number().min(-5).max(30).default(0), wordSpacing: z.number().min(-10).max(60).default(0),
  lineHeight: z.number().min(.8).max(2.5).default(1.6),
  // Color: solid or gradient fill for the primary text
  gradientEnabled: z.boolean().default(false),
  gradientFrom: color.default('#ffffff'), gradientTo: color.default('#c8ff3d'), gradientAngle: z.number().min(0).max(360).default(180),
  // Effects on/off toggles plus the two new effects (glow, 3D depth)
  shadowEnabled: z.boolean().default(true), strokeEnabled: z.boolean().default(true), backgroundEnabled: z.boolean().default(false),
  glowEnabled: z.boolean().default(false), glowColor: color.default('#c8ff3d'), glowRadius: z.number().min(0).max(40).default(12),
  depthEnabled: z.boolean().default(false), depthColor: color.default('#1a1a1a'), depthAmount: z.number().int().min(1).max(12).default(4),
})

/** Old saved styles/projects had no on/off toggles for background/shadow/stroke; infer them from
 * the values that existed so a style saved before this slice keeps looking the same. */
function fillLegacyToggles(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value
  const a = value as Record<string, unknown>
  return { ...a,
    backgroundEnabled: a.backgroundEnabled ?? (typeof a.backgroundOpacity === 'number' && a.backgroundOpacity > 0),
    shadowEnabled: a.shadowEnabled ?? true,
    strokeEnabled: a.strokeEnabled ?? true,
  }
}

export const captionStyleSchema = z.strictObject({
  motion: motionSchema,
  titleMotion: titleMotionSchema.optional(),
  // Motion is evaluated from source timestamps; this is a multiplier for its 200ms ramps, not a
  // playback rate and never changes cue/word timing.
  motionSpeed: motionSpeedSchema.default(1),
  appearance: z.preprocess(fillLegacyToggles, captionAppearanceSchema),
})
export type CaptionStyle = z.infer<typeof captionStyleSchema>

/** Title templates/presets define appearance and motion, not where an authored text item sits.
 * Keep its user-authored stage transform when applying a reusable style. */
export function applyCaptionTemplateToText(template: CaptionStyle, current: CaptionStyle): CaptionStyle {
  return { ...template, motion: current.motion, motionSpeed: current.motionSpeed, appearance: { ...template.appearance,
    horizontal: current.appearance.horizontal,
    vertical: current.appearance.vertical,
    rotation: current.appearance.rotation,
  } }
}

export const savedCaptionPresetSchema = z.strictObject({
  id: z.string().min(1).max(128), name: z.string().trim().min(1).max(80), style: captionStyleSchema,
})
export type SavedCaptionPreset = z.infer<typeof savedCaptionPresetSchema>
export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  motion: 'static-clean', motionSpeed: 1, appearance: {
    fontFamily: 'Anek Malayalam', fontSize: 59.4, primaryColor: '#ffffff', secondaryColor: '#c8ff3d',
    outlineColor: '#000000', outlineWidth: 1, shadowColor: '#000000', shadowBlur: 3, shadowOffset: 2,
    backgroundColor: '#000000', backgroundOpacity: .6, padding: 6, horizontal: .5, vertical: 1, rotation: 0, maxLines: 3,
    fontWeight: 700, fontItalic: false,
    emphasisFontFamily: '', emphasisMotion: 'pop', emphasisWeight: 700, emphasisItalic: false, emphasisMode: 'emphasize',
    emphasisGradientEnabled: false, emphasisGradientFrom: '#c8ff3d', emphasisGradientTo: '#ffffff',
    emphasisScale: 1, emphasisGlowEnabled: false, emphasisGlowColor: '#ffffff', emphasisGlowRadius: 12,
    emphasisTextTransform: 'none', emphasisUnderline: false,
    textTransform: 'none', underline: false, alignment: 'center',
    letterSpacing: 0, wordSpacing: 0, lineHeight: 1.6,
    gradientEnabled: false, gradientFrom: '#ffffff', gradientTo: '#c8ff3d', gradientAngle: 180,
    shadowEnabled: true, strokeEnabled: true, backgroundEnabled: false,
    glowEnabled: false, glowColor: '#c8ff3d', glowRadius: 12,
    depthEnabled: false, depthColor: '#1a1a1a', depthAmount: 4,
  },
}

/** Resolve an optional cue override once, then pass the result to preview and export alike. */
export function resolveCaptionMotion(style: CaptionStyle, override?: { motion?: CaptionMotion; motionSpeed?: number }) {
  return { motion: override?.motion ?? style.motion, motionSpeed: override?.motionSpeed ?? style.motionSpeed }
}

/** A cue's own placement override (a stage Alt-drag/resize/rotate); every field falls back to the
 * project style when absent. Structurally the same shape as `model.ts`'s `Cue['placementOverride']`
 * — kept independent here (rather than imported) so `style.ts` never depends on `model.ts`. */
export type CaptionPlacementOverride = { horizontal?: number; vertical?: number; fontSize?: number; rotation?: number }

/** Resolves a cue's motion *and* placement overrides into one complete style, so preview and export
 * both paint from a single already-resolved `CaptionStyle` (`resolveCaptionMotion` alone only
 * resolved motion; a caller needing placement too used to have to know to merge `appearance` itself). */
export function resolveCaptionStyle(style: CaptionStyle, cue?: { motionOverride?: { motion?: CaptionMotion; motionSpeed?: number }; placementOverride?: CaptionPlacementOverride } | null): CaptionStyle {
  const motion = resolveCaptionMotion(style, cue?.motionOverride)
  const placement = cue?.placementOverride
  return { ...style, ...motion, appearance: placement ? { ...style.appearance,
    horizontal: placement.horizontal ?? style.appearance.horizontal,
    vertical: placement.vertical ?? style.appearance.vertical,
    fontSize: placement.fontSize ?? style.appearance.fontSize,
    rotation: placement.rotation ?? style.appearance.rotation,
  } : style.appearance }
}

/** Which appearance keys a style-panel "reset" row restores to `DEFAULT_CAPTION_STYLE`. */
export const RESET_KEYS = {
  fontFamily: ['fontFamily'], fontFace: ['fontWeight', 'fontItalic'], fontSize: ['fontSize'],
  emphasisFace: ['emphasisFontFamily', 'emphasisWeight', 'emphasisItalic'], emphasisAnimation: ['emphasisMotion'],
  textTransform: ['textTransform'], underline: ['underline'], alignment: ['alignment'], maxLines: ['maxLines'],
  position: ['horizontal', 'vertical'], positionX: ['horizontal'], positionY: ['vertical'], rotation: ['rotation'],
  color: ['gradientEnabled', 'primaryColor', 'gradientFrom', 'gradientTo', 'gradientAngle'],
  emphasis: ['emphasisMode', 'emphasisGradientEnabled', 'secondaryColor', 'emphasisGradientFrom', 'emphasisGradientTo'],
  emphasisSize: ['emphasisScale'], emphasisGlow: ['emphasisGlowEnabled', 'emphasisGlowColor', 'emphasisGlowRadius'],
  emphasisStyles: ['emphasisTextTransform', 'emphasisUnderline'],
  spacing: ['letterSpacing', 'wordSpacing', 'lineHeight'],
  shadow: ['shadowEnabled', 'shadowColor', 'shadowBlur', 'shadowOffset'],
  glow: ['glowEnabled', 'glowColor', 'glowRadius'],
  depth: ['depthEnabled', 'depthColor', 'depthAmount'],
  stroke: ['strokeEnabled', 'outlineColor', 'outlineWidth'],
  background: ['backgroundEnabled', 'backgroundColor', 'backgroundOpacity', 'padding'],
} as const satisfies Record<string, readonly (keyof CaptionStyle['appearance'])[]>

const ALIGN_TO_HORIZONTAL: Record<CaptionAlignment, number> = { left: 0, center: .5, right: 1 }

/** Motion selection deliberately never resets appearance. Sizes are 1080-width composition units. */
export function captionStyleInputs(style: CaptionStyle, viewport: Size) {
  const inputs = defaultCaptionInputs(viewport), a = style.appearance, scale = viewport.width / 1080
  const emphasisFontDiffers = (a.emphasisFontFamily && a.emphasisFontFamily !== a.fontFamily) || a.emphasisWeight !== a.fontWeight || a.emphasisItalic !== a.fontItalic
  const resolvedEmphasisTransform = a.emphasisTextTransform === 'none' ? a.textTransform : a.emphasisTextTransform
  const emphasisFont = emphasisFontDiffers || a.emphasisScale !== 1 || resolvedEmphasisTransform !== a.textTransform
    ? { stack: `"${a.emphasisFontFamily || a.fontFamily}", ${DEFAULT_FONT_STACK}`, size: a.fontSize * a.emphasisScale * scale, weight: a.emphasisWeight, italic: a.emphasisItalic,
      lineHeight: a.lineHeight, letterSpacing: a.letterSpacing * scale, wordSpacing: a.wordSpacing * scale, textTransform: resolvedEmphasisTransform,
      readiness: 'loading' as const, revision: 'system' }
    : undefined
  // Depth/drop-shadow layers are shared; only the glow layer can differ between the base line and
  // emphasized words (emphasis glow has its own radius).
  const shadowFor = (glowOn: boolean, glowColor: string, glowRadius: number) => {
    const layers: string[] = []
    if (a.depthEnabled) for (let i = 1; i <= a.depthAmount; i++) layers.push(`${i * scale}px ${i * scale}px 0 ${a.depthColor}`)
    if (glowOn) { const r = glowRadius * scale; layers.push(`0 0 ${r}px ${glowColor}`, `0 0 ${r}px ${glowColor}`, `0 0 ${r * 2}px ${glowColor}`) }
    if (a.shadowEnabled && (a.shadowBlur || a.shadowOffset)) layers.push(`0 ${a.shadowOffset * scale}px ${a.shadowBlur * scale}px ${a.shadowColor}`)
    return layers.length ? layers.join(', ') : 'none'
  }
  const shadow = shadowFor(a.glowEnabled, a.glowColor, a.glowRadius)
  const emphasisShadowComposed = shadowFor(a.emphasisGlowEnabled || a.glowEnabled, a.emphasisGlowEnabled ? a.emphasisGlowColor : a.glowColor, a.emphasisGlowEnabled ? a.emphasisGlowRadius : a.glowRadius)
  return { ...inputs,
    ...(style.titleMotion ? { titleMotion: style.titleMotion } : {}),
    font: { ...inputs.font, stack: `"${a.fontFamily}", ${DEFAULT_FONT_STACK}`, size: a.fontSize * scale,
      weight: a.fontWeight, italic: a.fontItalic, lineHeight: a.lineHeight,
      letterSpacing: a.letterSpacing * scale, wordSpacing: a.wordSpacing * scale, textTransform: a.textTransform },
    emphasisFont, emphasisMotion: a.emphasisMotion,
    maxLines: a.maxLines, position: { horizontal: a.horizontal, vertical: a.vertical }, alignment: a.alignment,
    appearance: { color: a.primaryColor, secondaryColor: a.secondaryColor, outlineColor: a.outlineColor,
      outlineWidth: (a.strokeEnabled ? a.outlineWidth : 0) * scale,
      shadow, emphasisShadow: emphasisShadowComposed !== shadow ? emphasisShadowComposed : undefined,
      background: a.backgroundEnabled ? `${a.backgroundColor}${Math.round(a.backgroundOpacity * 255).toString(16).padStart(2, '0')}` : 'transparent',
      padding: a.padding * scale,
      fill: a.gradientEnabled ? { from: a.gradientFrom, to: a.gradientTo, angle: a.gradientAngle } : undefined,
      secondaryFill: a.emphasisGradientEnabled ? { from: a.emphasisGradientFrom, to: a.emphasisGradientTo, angle: a.gradientAngle } : undefined,
      underline: a.underline, emphasisUnderline: a.underline || a.emphasisUnderline, spotlight: a.emphasisMode === 'spotlight',
      rotation: a.rotation,
    },
  }
}

export function alignmentToHorizontalFactor(alignment: CaptionAlignment): number {
  return ALIGN_TO_HORIZONTAL[alignment]
}
