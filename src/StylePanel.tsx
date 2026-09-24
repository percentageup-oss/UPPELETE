import { useEffect, useState } from 'react'
import { HexColorField, NumberField, Row, Section, Segmented, Select, SliderWithNumber, TextField, Toggle } from './style/controls'
import { AlignCenterIcon, AlignLeftIcon, AlignRightIcon, DropIcon, PaletteIcon, UnderlineIcon } from './style/icons'
import { fallbackCatalog, loadLocalFontCatalog, resetLocalFontCatalogCache, type LocalFontCatalogState } from './style/localFonts'
import {
  ALIGNMENTS, captionAppearanceSchema, EMPHASIS_MODES, FONT_FAMILY_CHOICES, RESET_KEYS,
  DEFAULT_CAPTION_STYLE, type CaptionStyle,
} from './captions/style'

type Appearance = CaptionStyle['appearance']
const DEFAULTS = DEFAULT_CAPTION_STYLE.appearance

// Same shape as style/localFonts.ts's `FontFace`, so the fallback and a loaded family's real
// faces can share one code path regardless of which one is in use.
const FACE_OPTIONS: { style: string; postscriptName: string; weight: number; italic: boolean }[] = [
  { style: 'Regular', postscriptName: '', weight: 400, italic: false }, { style: 'Italic', postscriptName: '', weight: 400, italic: true },
  { style: 'Medium', postscriptName: '', weight: 500, italic: false },
  { style: 'Semibold', postscriptName: '', weight: 600, italic: false },
  { style: 'Bold', postscriptName: '', weight: 700, italic: false }, { style: 'Bold Italic', postscriptName: '', weight: 700, italic: true },
  { style: 'Black', postscriptName: '', weight: 900, italic: false },
]
// Text-glyph "icons" standing in for a real Tt/T/t icon set, in the order the reference shows them.
const TEXT_STYLE_BUTTONS: { transform: Exclude<Appearance['textTransform'], 'none'>; glyph: string }[] = [
  { transform: 'capitalize', glyph: 'Tt' }, { transform: 'uppercase', glyph: 'T' }, { transform: 'lowercase', glyph: 't' },
]

function faceKey(weight: number, italic: boolean) { return `${weight}:${italic}` }

export function StylePanel({ style, onDraft, onCommit }: {
  style: CaptionStyle
  onDraft: (style: CaptionStyle) => void
  onCommit: (style: CaptionStyle) => void
}) {
  const [draft, setDraft] = useState(style)
  const [customFont, setCustomFont] = useState(() => FONT_FAMILY_CHOICES.includes(style.appearance.fontFamily as (typeof FONT_FAMILY_CHOICES)[number]) ? '' : style.appearance.fontFamily)
  const [fontError, setFontError] = useState<string | null>(null)
  const [fonts, setFonts] = useState<LocalFontCatalogState>({ status: 'idle' })
  useEffect(() => {
    setDraft(style)
    setCustomFont(FONT_FAMILY_CHOICES.includes(style.appearance.fontFamily as (typeof FONT_FAMILY_CHOICES)[number]) ? '' : style.appearance.fontFamily)
    setFontError(null)
  }, [style])

  const patch = (nextAppearance: Partial<Appearance>) => setDraft((current) => ({ ...current, appearance: { ...current.appearance, ...nextAppearance } }))
  const change = (nextAppearance: Partial<Appearance>) => {
    const next = { ...draft, appearance: { ...draft.appearance, ...nextAppearance } }
    setDraft(next)
    onDraft(next)
  }
  const commit = (next: CaptionStyle = draft) => {
    const result = captionAppearanceSchema.safeParse(next.appearance)
    if (!result.success) return
    onCommit({ ...next, appearance: result.data })
  }
  const commitNow = (nextAppearance: Partial<Appearance>) => {
    const next = { ...draft, appearance: { ...draft.appearance, ...nextAppearance } }
    setDraft(next)
    onDraft(next)
    commit(next)
  }
  const reset = (keys: readonly (keyof Appearance)[]) => {
    const patch: Partial<Appearance> = {}
    for (const key of keys) (patch as Record<string, unknown>)[key] = DEFAULTS[key]
    commitNow(patch)
  }
  const isDefault = (keys: readonly (keyof Appearance)[]) => keys.every((key) => draft.appearance[key] === DEFAULTS[key])

  const applyCustomFont = (value: string) => {
    setCustomFont(value)
    const candidate = { ...draft.appearance, fontFamily: value }
    if (captionAppearanceSchema.shape.fontFamily.safeParse(value).success && captionAppearanceSchema.safeParse(candidate).success) { setFontError(null); change({ fontFamily: value }) }
    else setFontError('Font name must be plain letters, numbers, spaces, hyphens or underscores — matching an installed system font.')
  }

  // Called from the dropdown's click, so Chromium's transient-activation requirement for
  // `queryLocalFonts()` is met. The catalog is cached, so later opens are instant.
  const loadFonts = async () => {
    if (fonts.status === 'loading' || fonts.status === 'ready' || (fonts.status === 'unavailable' && fonts.reason !== 'needs-gesture')) return
    resetLocalFontCatalogCache()
    setFonts({ status: 'loading' })
    setFonts(await loadLocalFontCatalog())
  }

  const groupedFamily = (family: { family: string }) => ({
    value: family.family, label: family.family,
    group: (FONT_FAMILY_CHOICES as readonly string[]).includes(family.family) ? 'Favourites' : 'System fonts',
  })
  // Try to have the full list ready before the menu is opened; if Chromium refuses without a
  // click (`needs-gesture`) the menu's own open click retries.
  useEffect(() => { void loadFonts() }, [])
  const families = fonts.status === 'ready' || fonts.status === 'unavailable' ? fonts.families : fallbackCatalog()
  const currentFamily = families.find((family) => family.family === draft.appearance.fontFamily)
  const faceOptions = fonts.status === 'ready' && currentFamily?.faces.length ? currentFamily.faces : FACE_OPTIONS
  const emphasisFamily = families.find((family) => family.family === (draft.appearance.emphasisFontFamily || draft.appearance.fontFamily))
  const emphasisFaceOptions = fonts.status === 'ready' && emphasisFamily?.faces.length ? emphasisFamily.faces : FACE_OPTIONS

  return <section className="style-panel" aria-label="Text style">
    <Section id="fonts" title="Text">
      <Row label="Font" htmlFor="style-font-family" onReset={() => reset(RESET_KEYS.fontFamily)} isDefault={isDefault(RESET_KEYS.fontFamily)}>
        <Select id="style-font-family"
          value={FONT_FAMILY_CHOICES.includes(draft.appearance.fontFamily as (typeof FONT_FAMILY_CHOICES)[number]) ? draft.appearance.fontFamily : 'custom'}
          options={[...families.map(groupedFamily), { value: 'custom', label: 'Custom local font…' }]} onOpen={loadFonts} searchable
          onChange={(value) => { if (value === 'custom') { setCustomFont(draft.appearance.fontFamily); return } commitNow({ fontFamily: value }) }} />
      </Row>
      <Row label="Font Face" htmlFor="style-font-face" labelHidden onReset={() => reset(RESET_KEYS.fontFace)} isDefault={isDefault(RESET_KEYS.fontFace)}>
        <Select id="style-font-face" value={faceKey(draft.appearance.fontWeight, draft.appearance.fontItalic)}
          options={faceOptions.map((face) => ({ value: faceKey(face.weight, face.italic), label: face.style }))}
          onChange={(value) => { const [weight, italic] = value.split(':'); commitNow({ fontWeight: Number(weight), fontItalic: italic === 'true' }) }} />
      </Row>
      {!FONT_FAMILY_CHOICES.includes(draft.appearance.fontFamily as (typeof FONT_FAMILY_CHOICES)[number]) && <Row label="Custom font name" htmlFor="style-font-custom">
        <TextField id="style-font-custom" value={customFont} onChange={applyCustomFont} onBlur={() => commit()}
          invalid={!!fontError} describedBy={fontError ? 'style-font-error' : undefined} />
      </Row>}
      {fontError && <p id="style-font-error" role="alert" className="style-error">{fontError}</p>}
      {fonts.status === 'loading' && <p className="style-hint">Reading installed fonts…</p>}
      {fonts.status === 'unavailable' && <p className="style-hint" data-font-catalog-reason={fonts.reason}>
        {fonts.reason === 'needs-gesture' ? 'Open the font menu again to grant access to installed fonts.'
          : fonts.reason === 'denied' ? 'Font access was denied; using the built-in font list.'
            : 'Installed-font listing is unavailable on this platform; using the built-in font list.'}
      </p>}
      <p className="style-hint">Installed system fonts are listed the first time you open the font menu; nothing is downloaded. Missing glyphs fall back per script.</p>
      <Row label="Size" htmlFor="style-font-size" onReset={() => reset(RESET_KEYS.fontSize)} isDefault={isDefault(RESET_KEYS.fontSize)}>
        <SliderWithNumber id="style-font-size" min={20} max={120} value={draft.appearance.fontSize} unit="px"
          onDraft={(value) => change({ fontSize: value })} onCommit={() => commit()} />
      </Row>
      <Row label="Tracking" htmlFor="style-letter-spacing" onReset={() => reset(RESET_KEYS.spacing)} isDefault={isDefault(RESET_KEYS.spacing)}>
        <SliderWithNumber id="style-letter-spacing" min={-5} max={30} value={draft.appearance.letterSpacing} unit="px"
          onDraft={(value) => change({ letterSpacing: value })} onCommit={() => commit()} />
      </Row>
      <Row label="Word spacing" htmlFor="style-word-spacing">
        <SliderWithNumber id="style-word-spacing" min={-10} max={60} value={draft.appearance.wordSpacing} unit="px"
          onDraft={(value) => change({ wordSpacing: value })} onCommit={() => commit()} />
      </Row>
      <Row label="Line Spacing" htmlFor="style-line-height">
        <SliderWithNumber id="style-line-height" min={.8} max={2.5} step={.05} value={draft.appearance.lineHeight}
          onDraft={(value) => change({ lineHeight: value })} onCommit={() => commit()} />
      </Row>
    </Section>

    <Section id="layout" title="Layout">
      <Row label="Styles" onReset={() => reset([...RESET_KEYS.textTransform, ...RESET_KEYS.underline])} isDefault={isDefault([...RESET_KEYS.textTransform, ...RESET_KEYS.underline])}>
        <div className="segmented icons" role="group" id="style-text-transform">
          {TEXT_STYLE_BUTTONS.map(({ transform, glyph }) => <button key={transform} type="button"
            className={draft.appearance.textTransform === transform ? 'active' : ''} aria-pressed={draft.appearance.textTransform === transform}
            title={transform} onClick={() => commitNow({ textTransform: draft.appearance.textTransform === transform ? 'none' : transform })}>
            {glyph}
          </button>)}
          <button type="button" id="style-underline" className={draft.appearance.underline ? 'active' : ''} aria-pressed={draft.appearance.underline}
            title="underline" onClick={() => commitNow({ underline: !draft.appearance.underline })}><UnderlineIcon /></button>
        </div>
      </Row>
      <Row label="Text Alignment" onReset={() => reset(RESET_KEYS.alignment)} isDefault={isDefault(RESET_KEYS.alignment)}>
        <Segmented id="style-alignment" value={draft.appearance.alignment} variant="icons"
          options={ALIGNMENTS.map((alignment) => ({ value: alignment, label: alignment, title: alignment,
            icon: alignment === 'left' ? <AlignLeftIcon /> : alignment === 'center' ? <AlignCenterIcon /> : <AlignRightIcon /> }))}
          onChange={(value) => commitNow({ alignment: value })} />
      </Row>
      <Row label="Max lines" htmlFor="style-max-lines" onReset={() => reset(RESET_KEYS.maxLines)} isDefault={isDefault(RESET_KEYS.maxLines)}>
        <NumberField id="style-max-lines" min={1} max={6} step={1} value={draft.appearance.maxLines}
          onDraft={(value) => patch({ maxLines: Math.round(value) })}
          onCommit={(value) => commitNow({ maxLines: Math.max(1, Math.min(6, Math.round(value))) })} />
      </Row>
      <Row label="Position X" htmlFor="style-position-h" onReset={() => reset(RESET_KEYS.positionX)} isDefault={isDefault(RESET_KEYS.positionX)}>
        <SliderWithNumber id="style-position-h" min={0} max={100} step={.1} unit="%" endLabels={['Left', 'Right']}
          value={Math.round(draft.appearance.horizontal * 1000) / 10}
          onDraft={(percent) => change({ horizontal: percent / 100 })} onCommit={(percent) => commitNow({ horizontal: Math.max(0, Math.min(100, percent)) / 100 })} />
      </Row>
      <Row label="Position Y" htmlFor="style-position-v" onReset={() => reset(RESET_KEYS.positionY)} isDefault={isDefault(RESET_KEYS.positionY)}>
        <SliderWithNumber id="style-position-v" min={0} max={100} step={.1} unit="%" endLabels={['Top', 'Bottom']}
          value={Math.round(draft.appearance.vertical * 1000) / 10}
          onDraft={(percent) => change({ vertical: percent / 100 })} onCommit={(percent) => commitNow({ vertical: Math.max(0, Math.min(100, percent)) / 100 })} />
      </Row>
      <Row label="Rotation" htmlFor="style-rotation" onReset={() => reset(RESET_KEYS.rotation)} isDefault={isDefault(RESET_KEYS.rotation)}>
        <SliderWithNumber id="style-rotation" min={-180} max={180} step={1} unit="°" value={draft.appearance.rotation}
          onDraft={(rotation) => change({ rotation })} onCommit={(rotation) => commitNow({ rotation })} />
      </Row>
    </Section>

    <Section id="color" title="Fill">
      <Row label="Fill" onReset={() => reset(RESET_KEYS.color)} isDefault={isDefault(RESET_KEYS.color)}>
        <Segmented id="style-fill-mode" value={draft.appearance.gradientEnabled ? 'gradient' : 'solid'}
          options={[{ value: 'solid', label: 'Solid', icon: <DropIcon /> }, { value: 'gradient', label: 'Gradient', icon: <PaletteIcon /> }]}
          onChange={(value) => commitNow({ gradientEnabled: value === 'gradient' })} />
      </Row>
      {!draft.appearance.gradientEnabled && <Row label="Color" htmlFor="style-primary-color">
        <HexColorField id="style-primary-color" value={draft.appearance.primaryColor} onDraft={(value) => change({ primaryColor: value })} onCommit={() => commit()} />
      </Row>}
      {draft.appearance.gradientEnabled && <>
        <Row label="From" htmlFor="style-gradient-from">
          <HexColorField id="style-gradient-from" value={draft.appearance.gradientFrom} onDraft={(value) => change({ gradientFrom: value })} onCommit={() => commit()} />
        </Row>
        <Row label="To" htmlFor="style-gradient-to">
          <HexColorField id="style-gradient-to" value={draft.appearance.gradientTo} onDraft={(value) => change({ gradientTo: value })} onCommit={() => commit()} />
        </Row>
        <Row label="Angle" htmlFor="style-gradient-angle">
          <SliderWithNumber id="style-gradient-angle" min={0} max={360} value={draft.appearance.gradientAngle} unit="°"
            onDraft={(value) => change({ gradientAngle: value })} onCommit={() => commit()} />
        </Row>
      </>}
    </Section>

    <Section id="emphasis" title="Emphasis" defaultOpen={false}>
      <p className="style-hint" style={{ marginTop: 0 }}>Selected words keep this font and color. With word timing, they animate when spoken.</p>
      <Row label="Font" htmlFor="style-emphasis-family">
        <Select id="style-emphasis-family" value={draft.appearance.emphasisFontFamily}
          options={[{ value: '', label: 'Same as caption font' }, ...families.map(groupedFamily)]} onOpen={loadFonts} searchable
          onChange={(value) => commitNow({ emphasisFontFamily: value })} />
      </Row>
      <Row label="Font Face" htmlFor="style-emphasis-face" labelHidden onReset={() => reset(RESET_KEYS.emphasisFace)} isDefault={isDefault(RESET_KEYS.emphasisFace)}>
        <Select id="style-emphasis-face" value={faceKey(draft.appearance.emphasisWeight, draft.appearance.emphasisItalic)}
          options={emphasisFaceOptions.map((face) => ({ value: faceKey(face.weight, face.italic), label: face.style }))}
          onChange={(value) => { const [weight, italic] = value.split(':'); commitNow({ emphasisWeight: Number(weight), emphasisItalic: italic === 'true' }) }} />
      </Row>
      <Row label="Mode" onReset={() => reset(RESET_KEYS.emphasis)} isDefault={isDefault(RESET_KEYS.emphasis)}>
        <Segmented id="style-emphasis-mode" value={draft.appearance.emphasisMode}
          options={EMPHASIS_MODES.map((mode) => ({ value: mode, label: mode === 'emphasize' ? 'Emphasize' : 'Spotlight' }))}
          onChange={(value) => commitNow({ emphasisMode: value })} />
      </Row>
      <Row label="Fill">
        <Segmented id="style-emphasis-fill-mode" value={draft.appearance.emphasisGradientEnabled ? 'gradient' : 'solid'}
          options={[{ value: 'solid', label: 'Solid', icon: <DropIcon /> }, { value: 'gradient', label: 'Gradient', icon: <PaletteIcon /> }]}
          onChange={(value) => commitNow({ emphasisGradientEnabled: value === 'gradient' })} />
      </Row>
      {!draft.appearance.emphasisGradientEnabled && <Row label="Color" htmlFor="style-secondary-color">
        <HexColorField id="style-secondary-color" value={draft.appearance.secondaryColor} onDraft={(value) => change({ secondaryColor: value })} onCommit={() => commit()} />
      </Row>}
      {draft.appearance.emphasisGradientEnabled && <>
        <Row label="From" htmlFor="style-emphasis-gradient-from">
          <HexColorField id="style-emphasis-gradient-from" value={draft.appearance.emphasisGradientFrom} onDraft={(value) => change({ emphasisGradientFrom: value })} onCommit={() => commit()} />
        </Row>
        <Row label="To" htmlFor="style-emphasis-gradient-to">
          <HexColorField id="style-emphasis-gradient-to" value={draft.appearance.emphasisGradientTo} onDraft={(value) => change({ emphasisGradientTo: value })} onCommit={() => commit()} />
        </Row>
      </>}
      <Row label="Size" htmlFor="style-emphasis-size" onReset={() => reset(RESET_KEYS.emphasisSize)} isDefault={isDefault(RESET_KEYS.emphasisSize)}>
        <SliderWithNumber id="style-emphasis-size" min={1} max={2} step={.05} value={draft.appearance.emphasisScale}
          onDraft={(value) => change({ emphasisScale: value })} onCommit={() => commit()} />
      </Row>
      <Row label="Glow" onReset={() => reset(RESET_KEYS.emphasisGlow)} isDefault={isDefault(RESET_KEYS.emphasisGlow)}>
        <Toggle id="style-emphasis-glow-enabled" checked={draft.appearance.emphasisGlowEnabled} label="Emphasis glow" hideLabel
          onChange={(value) => commitNow({ emphasisGlowEnabled: value })} />
      </Row>
      {draft.appearance.emphasisGlowEnabled && <div className="toggle-row-body">
        <Row label="Color" htmlFor="style-emphasis-glow-color">
          <HexColorField id="style-emphasis-glow-color" value={draft.appearance.emphasisGlowColor} onDraft={(value) => change({ emphasisGlowColor: value })} onCommit={() => commit()} />
        </Row>
      </div>}
      <Row label="Styles" onReset={() => reset(RESET_KEYS.emphasisStyles)} isDefault={isDefault(RESET_KEYS.emphasisStyles)}>
        <div className="segmented icons" role="group" id="style-emphasis-text-transform">
          {TEXT_STYLE_BUTTONS.map(({ transform, glyph }) => <button key={transform} type="button"
            className={draft.appearance.emphasisTextTransform === transform ? 'active' : ''} aria-pressed={draft.appearance.emphasisTextTransform === transform}
            title={transform} onClick={() => commitNow({ emphasisTextTransform: draft.appearance.emphasisTextTransform === transform ? 'none' : transform })}>
            {glyph}
          </button>)}
          <button type="button" id="style-emphasis-underline" className={draft.appearance.emphasisUnderline ? 'active' : ''} aria-pressed={draft.appearance.emphasisUnderline}
            title="underline" onClick={() => commitNow({ emphasisUnderline: !draft.appearance.emphasisUnderline })}><UnderlineIcon /></button>
        </div>
      </Row>
      <Row label="Animation" onReset={() => reset(RESET_KEYS.emphasisAnimation)} isDefault={isDefault(RESET_KEYS.emphasisAnimation)}>
        <Segmented id="style-emphasis-animation" value={draft.appearance.emphasisMotion}
          options={[{ value: 'pop', label: 'Pop' }, { value: 'none', label: 'None' }]}
          onChange={(value) => commitNow({ emphasisMotion: value })} />
      </Row>
    </Section>

    <Section id="effects" title="Effects" defaultOpen={false}>
      <Row label="Drop Shadow" onReset={() => reset(RESET_KEYS.shadow)} isDefault={isDefault(RESET_KEYS.shadow)}>
        <Toggle id="style-shadow-enabled" checked={draft.appearance.shadowEnabled} label="Drop Shadow" hideLabel onChange={(value) => commitNow({ shadowEnabled: value })} />
      </Row>
      {draft.appearance.shadowEnabled && <div className="toggle-row-body">
        <Row label="Color" htmlFor="style-shadow-color"><HexColorField id="style-shadow-color" value={draft.appearance.shadowColor} onDraft={(value) => change({ shadowColor: value })} onCommit={() => commit()} /></Row>
        <Row label="Blur" htmlFor="style-shadow-blur"><SliderWithNumber id="style-shadow-blur" min={0} max={20} value={draft.appearance.shadowBlur} onDraft={(value) => change({ shadowBlur: value })} onCommit={() => commit()} /></Row>
        <Row label="Offset" htmlFor="style-shadow-offset"><SliderWithNumber id="style-shadow-offset" min={0} max={15} value={draft.appearance.shadowOffset} onDraft={(value) => change({ shadowOffset: value })} onCommit={() => commit()} /></Row>
      </div>}

      <Row label="Glow" onReset={() => reset(RESET_KEYS.glow)} isDefault={isDefault(RESET_KEYS.glow)}>
        <Toggle id="style-glow-enabled" checked={draft.appearance.glowEnabled} label="Glow" hideLabel onChange={(value) => commitNow({ glowEnabled: value })} />
      </Row>
      {draft.appearance.glowEnabled && <div className="toggle-row-body">
        <Row label="Color" htmlFor="style-glow-color"><HexColorField id="style-glow-color" value={draft.appearance.glowColor} onDraft={(value) => change({ glowColor: value })} onCommit={() => commit()} /></Row>
        <Row label="Radius" htmlFor="style-glow-radius"><SliderWithNumber id="style-glow-radius" min={0} max={40} value={draft.appearance.glowRadius} onDraft={(value) => change({ glowRadius: value })} onCommit={() => commit()} /></Row>
      </div>}

      <Row label="3D Depth" onReset={() => reset(RESET_KEYS.depth)} isDefault={isDefault(RESET_KEYS.depth)}>
        <Toggle id="style-depth-enabled" checked={draft.appearance.depthEnabled} label="3D Depth" hideLabel onChange={(value) => commitNow({ depthEnabled: value })} />
      </Row>
      {draft.appearance.depthEnabled && <div className="toggle-row-body">
        <Row label="Color" htmlFor="style-depth-color"><HexColorField id="style-depth-color" value={draft.appearance.depthColor} onDraft={(value) => change({ depthColor: value })} onCommit={() => commit()} /></Row>
        <Row label="Amount" htmlFor="style-depth-amount"><SliderWithNumber id="style-depth-amount" min={1} max={12} value={draft.appearance.depthAmount} onDraft={(value) => change({ depthAmount: Math.round(value) })} onCommit={() => commit()} /></Row>
      </div>}

      <Row label="Text Stroke" onReset={() => reset(RESET_KEYS.stroke)} isDefault={isDefault(RESET_KEYS.stroke)}>
        <Toggle id="style-outline-enabled" checked={draft.appearance.strokeEnabled} label="Text Stroke" hideLabel onChange={(value) => commitNow({ strokeEnabled: value })} />
      </Row>
      {draft.appearance.strokeEnabled && <div className="toggle-row-body">
        <Row label="Color" htmlFor="style-outline-color"><HexColorField id="style-outline-color" value={draft.appearance.outlineColor} onDraft={(value) => change({ outlineColor: value })} onCommit={() => commit()} /></Row>
        <Row label="Width" htmlFor="style-outline-width"><SliderWithNumber id="style-outline-width" min={0} max={8} step={.5} value={draft.appearance.outlineWidth} onDraft={(value) => change({ outlineWidth: value })} onCommit={() => commit()} /></Row>
      </div>}

      <Row label="Background" onReset={() => reset(RESET_KEYS.background)} isDefault={isDefault(RESET_KEYS.background)}>
        <Toggle id="style-bg-enabled" checked={draft.appearance.backgroundEnabled} label="Background" hideLabel onChange={(value) => commitNow({ backgroundEnabled: value })} />
      </Row>
      {draft.appearance.backgroundEnabled && <div className="toggle-row-body">
        <Row label="Color" htmlFor="style-bg-color"><HexColorField id="style-bg-color" value={draft.appearance.backgroundColor} onDraft={(value) => change({ backgroundColor: value })} onCommit={() => commit()} /></Row>
        <Row label="Opacity" htmlFor="style-bg-opacity"><SliderWithNumber id="style-bg-opacity" min={0} max={1} step={.05} value={draft.appearance.backgroundOpacity} onDraft={(value) => change({ backgroundOpacity: value })} onCommit={() => commit()} /></Row>
        <Row label="Padding" htmlFor="style-bg-padding"><SliderWithNumber id="style-bg-padding" min={0} max={40} value={draft.appearance.padding} onDraft={(value) => change({ padding: value })} onCommit={() => commit()} /></Row>
      </div>}
      <p className="style-hint">Glow and 3D Depth extend past the caption's own line box; leave room in Position/safe area for the effect to show fully.</p>
    </Section>
  </section>
}
