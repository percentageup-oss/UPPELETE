import { describe, expect, it } from 'vitest'
import { createProject, projectSchema } from '../core/model'
import { captionAppearanceSchema, captionStyleInputs, captionStyleSchema, DEFAULT_CAPTION_STYLE, savedCaptionPresetSchema, type CaptionStyle } from './style'

describe('caption style schema', () => {
  it('accepts the default style', () => {
    expect(captionStyleSchema.parse(DEFAULT_CAPTION_STYLE)).toEqual(DEFAULT_CAPTION_STYLE)
  })

  it('rejects a font family carrying CSS injection attempts, not just plain punctuation', () => {
    for (const fontFamily of ['Arial, url(evil.css)', 'Arial; background:url(x)', 'expression(alert(1))', 'Arial</style>', ''])
      expect(captionStyleSchema.safeParse({ ...DEFAULT_CAPTION_STYLE, appearance: { ...DEFAULT_CAPTION_STYLE.appearance, fontFamily } }).success).toBe(false)
  })

  it('accepts a legitimate multi-word local font name', () => {
    expect(captionStyleSchema.safeParse({ ...DEFAULT_CAPTION_STYLE, appearance: { ...DEFAULT_CAPTION_STYLE.appearance, fontFamily: 'Noto Sans Malayalam UI' } }).success).toBe(true)
  })

  it('rejects non-hex colors and out-of-range numbers', () => {
    const cases: Partial<CaptionStyle['appearance']>[] = [
      { primaryColor: 'red' }, { primaryColor: '#fff' }, { outlineWidth: -1 }, { outlineWidth: 9 },
      { backgroundOpacity: 1.5 }, { maxLines: 0 }, { maxLines: 7 }, { horizontal: 1.1 }, { fontSize: 10 }, { fontSize: 200 },
    ]
    for (const patch of cases) expect(captionStyleSchema.safeParse({ ...DEFAULT_CAPTION_STYLE, appearance: { ...DEFAULT_CAPTION_STYLE.appearance, ...patch } }).success).toBe(false)
  })

  it('rejects unknown motion ids and unknown appearance keys', () => {
    expect(captionStyleSchema.safeParse({ ...DEFAULT_CAPTION_STYLE, motion: 'glitch' }).success).toBe(false)
    expect(captionStyleSchema.safeParse({ ...DEFAULT_CAPTION_STYLE, appearance: { ...DEFAULT_CAPTION_STYLE.appearance, extra: 1 } }).success).toBe(false)
  })

  it('requires a non-empty preset name', () => {
    expect(savedCaptionPresetSchema.safeParse({ id: 'a', name: '  ', style: DEFAULT_CAPTION_STYLE }).success).toBe(false)
  })

  it('fills every new appearance field with a default when parsing a pre-slice flat style', () => {
    const legacy = {
      fontFamily: 'Arial', fontSize: 40, primaryColor: '#ffffff', secondaryColor: '#c8ff3d',
      outlineColor: '#000000', outlineWidth: 1, shadowColor: '#000000', shadowBlur: 3, shadowOffset: 2,
      backgroundColor: '#000000', backgroundOpacity: 0, padding: 6, horizontal: .5, vertical: 1, maxLines: 3,
    }
    const parsed = captionStyleSchema.parse({ motion: 'static-clean', appearance: legacy })
    expect(parsed.appearance.fontWeight).toBe(700)
    expect(parsed.appearance.alignment).toBe('center')
    expect(parsed.appearance.textTransform).toBe('none')
    expect(parsed.appearance.gradientEnabled).toBe(false)
    expect(parsed.appearance.emphasisScale).toBe(1)
    expect(parsed.appearance.emphasisGlowEnabled).toBe(false)
    expect(parsed.appearance.emphasisGlowColor).toBe('#ffffff')
    expect(parsed.appearance.emphasisTextTransform).toBe('none')
    expect(parsed.appearance.emphasisUnderline).toBe(false)
  })

  it('infers legacy on/off toggles from the values a pre-slice style already carried', () => {
    const legacyOn = captionStyleSchema.parse({ motion: 'static-clean', appearance: { ...DEFAULT_CAPTION_STYLE.appearance, backgroundEnabled: undefined, backgroundOpacity: .5 } })
    expect(legacyOn.appearance.backgroundEnabled).toBe(true)
    const legacyOff = captionStyleSchema.parse({ motion: 'static-clean', appearance: { ...DEFAULT_CAPTION_STYLE.appearance, backgroundEnabled: undefined, backgroundOpacity: 0 } })
    expect(legacyOff.appearance.backgroundEnabled).toBe(false)
  })

  it('rejects out-of-range values for the new font-face, format, spacing, color and effects fields', () => {
    const cases: Partial<CaptionStyle['appearance']>[] = [
      { fontWeight: 750 }, { letterSpacing: 31 }, { wordSpacing: -11 }, { lineHeight: 3 },
      { depthAmount: 13 }, { glowRadius: 41 }, { gradientAngle: 361 },
      { textTransform: 'sideways' as never }, { alignment: 'justify' as never }, { emphasisMode: 'glow' as never },
    ]
    for (const patch of cases) expect(captionStyleSchema.safeParse({ ...DEFAULT_CAPTION_STYLE, appearance: { ...DEFAULT_CAPTION_STYLE.appearance, ...patch } }).success).toBe(false)
  })

  it('rejects out-of-range values for the new emphasis size/glow/styles fields', () => {
    const cases: Partial<CaptionStyle['appearance']>[] = [
      { emphasisScale: .9 }, { emphasisScale: 2.1 }, { emphasisGlowColor: 'white' as never }, { emphasisTextTransform: 'sideways' as never },
    ]
    for (const patch of cases) expect(captionStyleSchema.safeParse({ ...DEFAULT_CAPTION_STYLE, appearance: { ...DEFAULT_CAPTION_STYLE.appearance, ...patch } }).success).toBe(false)
  })
})

describe('captionStyleInputs', () => {
  it('scales font size and padding identically by composition width at portrait and landscape', () => {
    const portrait = captionStyleInputs(DEFAULT_CAPTION_STYLE, { width: 1080, height: 1920 })
    const landscape = captionStyleInputs(DEFAULT_CAPTION_STYLE, { width: 1080, height: 607.5 })
    expect(portrait.font.size).toBe(landscape.font.size)
    expect(portrait.appearance.padding).toBe(landscape.appearance.padding)
    expect(portrait.appearance.outlineWidth).toBe(landscape.appearance.outlineWidth)
    const wide = captionStyleInputs(DEFAULT_CAPTION_STYLE, { width: 1920, height: 1080 })
    expect(wide.font.size).toBeCloseTo(DEFAULT_CAPTION_STYLE.appearance.fontSize * (1920 / 1080))
  })

  it('never resets appearance when only motion changes', () => {
    const withMotion = (motion: CaptionStyle['motion']): CaptionStyle => ({ ...DEFAULT_CAPTION_STYLE, motion })
    const a = captionStyleInputs(withMotion('static-clean'), { width: 1080, height: 1920 })
    const b = captionStyleInputs(withMotion('word-pop'), { width: 1080, height: 1920 })
    expect(a.appearance).toEqual(b.appearance)
    expect(a.font.size).toBe(b.font.size)
  })

  it('maps position, background opacity and max lines through unchanged', () => {
    const style: CaptionStyle = { ...DEFAULT_CAPTION_STYLE, appearance: { ...DEFAULT_CAPTION_STYLE.appearance, horizontal: 0, vertical: 0, maxLines: 2, backgroundEnabled: true, backgroundColor: '#112233', backgroundOpacity: .5 } }
    const inputs = captionStyleInputs(style, { width: 1080, height: 1920 })
    expect(inputs.position).toEqual({ horizontal: 0, vertical: 0 })
    expect(inputs.maxLines).toBe(2)
    expect(inputs.appearance.background).toBe('#11223380')
  })

  it('omits the shadow entirely when blur and offset are both zero', () => {
    const style: CaptionStyle = { ...DEFAULT_CAPTION_STYLE, appearance: { ...DEFAULT_CAPTION_STYLE.appearance, shadowBlur: 0, shadowOffset: 0 } }
    expect(captionStyleInputs(style, { width: 1080, height: 1920 }).appearance.shadow).toBe('none')
  })

  it('builds no emphasis font at defaults, and maps emphasisScale onto emphasisFont.size at the scaled composition size', () => {
    expect(captionStyleInputs(DEFAULT_CAPTION_STYLE, { width: 1080, height: 1920 }).emphasisFont).toBeUndefined()
    const scaled: CaptionStyle = { ...DEFAULT_CAPTION_STYLE, appearance: { ...DEFAULT_CAPTION_STYLE.appearance, emphasisScale: 1.5 } }
    const inputs = captionStyleInputs(scaled, { width: 1080, height: 1920 })
    expect(inputs.emphasisFont?.size).toBeCloseTo(DEFAULT_CAPTION_STYLE.appearance.fontSize * 1.5)
  })

  it('builds an emphasis font when only emphasisTextTransform overrides the base transform', () => {
    const style: CaptionStyle = { ...DEFAULT_CAPTION_STYLE, appearance: { ...DEFAULT_CAPTION_STYLE.appearance, emphasisTextTransform: 'uppercase' } }
    const inputs = captionStyleInputs(style, { width: 1080, height: 1920 })
    expect(inputs.emphasisFont?.textTransform).toBe('uppercase')
  })

  it('follows the base textTransform when emphasisTextTransform is none', () => {
    const style: CaptionStyle = { ...DEFAULT_CAPTION_STYLE, appearance: { ...DEFAULT_CAPTION_STYLE.appearance, textTransform: 'lowercase', emphasisScale: 1.2 } }
    const inputs = captionStyleInputs(style, { width: 1080, height: 1920 })
    expect(inputs.emphasisFont?.textTransform).toBe('lowercase')
  })

  it('composes emphasisShadow with the emphasis glow color, leaving it undefined when it matches the base shadow', () => {
    const noGlow = captionStyleInputs(DEFAULT_CAPTION_STYLE, { width: 1080, height: 1920 })
    expect(noGlow.appearance.emphasisShadow).toBeUndefined()
    const withEmphasisGlow: CaptionStyle = { ...DEFAULT_CAPTION_STYLE, appearance: { ...DEFAULT_CAPTION_STYLE.appearance, emphasisGlowEnabled: true, emphasisGlowColor: '#ff00ff' } }
    const inputs = captionStyleInputs(withEmphasisGlow, { width: 1080, height: 1920 })
    expect(inputs.appearance.emphasisShadow).toContain('#ff00ff')
    expect(inputs.appearance.emphasisShadow).not.toBe(inputs.appearance.shadow)
    // Base glow alone (no emphasis-specific override) reuses the exact same shadow for both.
    const withBaseGlow: CaptionStyle = { ...DEFAULT_CAPTION_STYLE, appearance: { ...DEFAULT_CAPTION_STYLE.appearance, glowEnabled: true } }
    const baseGlowInputs = captionStyleInputs(withBaseGlow, { width: 1080, height: 1920 })
    expect(baseGlowInputs.appearance.emphasisShadow).toBeUndefined()
  })

  it('ORs emphasisUnderline with the base underline', () => {
    const neither = captionStyleInputs(DEFAULT_CAPTION_STYLE, { width: 1080, height: 1920 })
    expect(neither.appearance.emphasisUnderline).toBe(false)
    const baseOnly: CaptionStyle = { ...DEFAULT_CAPTION_STYLE, appearance: { ...DEFAULT_CAPTION_STYLE.appearance, underline: true } }
    expect(captionStyleInputs(baseOnly, { width: 1080, height: 1920 }).appearance.emphasisUnderline).toBe(true)
    const emphasisOnly: CaptionStyle = { ...DEFAULT_CAPTION_STYLE, appearance: { ...DEFAULT_CAPTION_STYLE.appearance, emphasisUnderline: true } }
    const emphasisInputs = captionStyleInputs(emphasisOnly, { width: 1080, height: 1920 })
    expect(emphasisInputs.appearance.emphasisUnderline).toBe(true)
    expect(emphasisInputs.appearance.underline).toBe(false)
  })
})

describe('project round trip with style and presets', () => {
  it('parses a project carrying a captionStyle and saved presets', () => {
    const project = { ...createProject(), captionStyle: DEFAULT_CAPTION_STYLE,
      savedCaptionPresets: [{ id: 'p1', name: 'Bold', style: { ...DEFAULT_CAPTION_STYLE, motion: 'word-pop' as const } }] }
    const parsed = projectSchema.parse(project)
    expect(parsed.captionStyle).toEqual(DEFAULT_CAPTION_STYLE)
    expect(parsed.savedCaptionPresets?.[0].name).toBe('Bold')
  })

  it('rejects duplicate saved preset IDs', () => {
    const project = { ...createProject(), savedCaptionPresets: [
      { id: 'dup', name: 'A', style: DEFAULT_CAPTION_STYLE },
      { id: 'dup', name: 'B', style: DEFAULT_CAPTION_STYLE },
    ] }
    expect(projectSchema.safeParse(project).success).toBe(false)
  })

  it('loads an existing schema-2 project with no captionStyle/presets at all', () => {
    const project = createProject()
    expect(projectSchema.parse(project).captionStyle).toBeUndefined()
    expect(projectSchema.parse(project).savedCaptionPresets).toBeUndefined()
  })
})
