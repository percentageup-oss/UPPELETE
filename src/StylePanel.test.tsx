import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { StylePanel } from './StylePanel'
import { DEFAULT_CAPTION_STYLE, type CaptionStyle } from './captions/style'

const noop = () => {}

function render(style: CaptionStyle = DEFAULT_CAPTION_STYLE) {
  return renderToStaticMarkup(<StylePanel style={style} onDraft={noop} onCommit={noop} />)
}

it('renders every always-on appearance control with an accessible label', () => {
  const html = render()
  for (const id of ['style-font-family', 'style-font-face', 'style-font-size', 'style-emphasis-face',
    'style-max-lines', 'style-position-h', 'style-position-v', 'style-primary-color', 'style-secondary-color',
    'style-letter-spacing', 'style-word-spacing', 'style-line-height',
    'style-shadow-color', 'style-shadow-blur', 'style-shadow-offset', 'style-outline-color', 'style-outline-width']) {
    expect(html).toContain(`id="${id}"`)
    expect(html).toContain(`for="${id}"`)
  }
})

it('hides an effect’s sub-controls until its toggle is on, and shows them once enabled', () => {
  const off = render()
  expect(off).not.toContain('id="style-glow-color"')
  expect(off).not.toContain('id="style-depth-color"')
  expect(off).not.toContain('id="style-bg-color"')

  const on = render({ ...DEFAULT_CAPTION_STYLE, appearance: { ...DEFAULT_CAPTION_STYLE.appearance,
    glowEnabled: true, depthEnabled: true, backgroundEnabled: true } })
  for (const id of ['style-glow-color', 'style-glow-radius', 'style-depth-color', 'style-depth-amount', 'style-bg-color', 'style-bg-opacity', 'style-bg-padding']) {
    expect(on).toContain(`id="${id}"`)
  }
})

it('shows gradient stops instead of a solid swatch once a fill is set to gradient', () => {
  const solid = render()
  expect(solid).not.toContain('id="style-gradient-from"')

  const gradient = render({ ...DEFAULT_CAPTION_STYLE, appearance: { ...DEFAULT_CAPTION_STYLE.appearance, gradientEnabled: true } })
  expect(gradient).toContain('id="style-gradient-from"')
  expect(gradient).toContain('id="style-gradient-to"')
  expect(gradient).toContain('id="style-gradient-angle"')
  expect(gradient).not.toContain('id="style-primary-color"')
})

it('renders a reset button for each resettable row, disabled only when already at its default', () => {
  const html = render()
  expect((html.match(/class="style-reset"/g) ?? []).length).toBeGreaterThan(5)
  expect(html).toContain('disabled')
})

it('renders the new emphasis Size/Glow/Styles/Animation controls, with the glow color hidden until enabled', () => {
  const off = render()
  for (const id of ['style-emphasis-size', 'style-emphasis-glow-enabled', 'style-emphasis-text-transform', 'style-emphasis-underline', 'style-emphasis-animation']) {
    expect(off).toContain(`id="${id}"`)
  }
  expect(off).not.toContain('id="style-emphasis-glow-color"')

  const on = render({ ...DEFAULT_CAPTION_STYLE, appearance: { ...DEFAULT_CAPTION_STYLE.appearance, emphasisGlowEnabled: true } })
  expect(on).toContain('id="style-emphasis-glow-color"')
})

it('offers "Same as caption font" as the emphasis family stepper’s first option', () => {
  const html = render()
  expect(html).toMatch(/id="style-emphasis-family"[^]*?<option value=""[^>]*>Same as caption font<\/option>/)
})

it('offers Anek Malayalam in the default font dropdown without loading the system catalog', () => {
  expect(render()).toMatch(/id="style-font-family"[^]*?<option value="Anek Malayalam"[^>]*>Anek Malayalam<\/option>/)
})
