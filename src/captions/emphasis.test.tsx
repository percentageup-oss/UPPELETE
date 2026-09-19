import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { captionFrame, layoutCaption, type MeasureText } from './renderer'
import { captionStyleInputs, captionStyleSchema, DEFAULT_CAPTION_STYLE } from './style'
import { CaptionView } from './CaptionPreview'
import { CAPTION_TEMPLATES, TEMPLATE_DEMO } from './templates'

const measure: MeasureText = (text, font, emphasis) => ({ width: text.length * font.size / 2 + (emphasis?.spans.length ?? 0) * 20, height: font.size * font.lineHeight })
function frame(timestampUs: number, motion = CAPTION_TEMPLATES[0].style.motion, timed = true) {
  const inputs = { ...captionStyleInputs(CAPTION_TEMPLATES[1].style, { width: 1080, height: 540 }), emphasized: TEMPLATE_DEMO.emphasized }
  inputs.font.readiness = 'ready'
  const cue = { ...TEMPLATE_DEMO, words: timed ? TEMPLATE_DEMO.words : [] }
  return captionFrame(layoutCaption(cue.text, inputs, measure), cue, timestampUs, motion)
}
it('reveals selected words only at their source start, reserves geometry, and repeats exactly after backwards seeks', () => {
  const before = frame(999_999), current = frame(1_100_000), after = frame(2_500_000)
  expect(before.layout).toEqual(current.layout)
  expect(after.layout).toEqual(current.layout)
  const markup = (timestamp: number) => renderToStaticMarkup(<CaptionView frame={frame(timestamp)} />)
  expect(markup(999_999)).toMatch(/data-caption-emphasis="true"[^>]*opacity:0/)
  expect(markup(1_100_000)).toMatch(/data-caption-emphasis="true"[^>]*opacity:1[^>]*scale\(1\.\d+\)/)
  expect(markup(2_500_000)).toMatch(/data-caption-emphasis="true"[^>]*opacity:1/)
  expect(current).toEqual(frame(1_100_000))
  expect(markup(1_100_000)).toContain('Impact')
})
it('preserves chosen font/color in untimed SRT fallback without inventing timestamps', () => {
  const value = frame(1_100_000, 'progressive-word-reveal', false)
  expect(value.motion).toBe('static-clean')
  expect(value.words).toEqual([])
  const html = renderToStaticMarkup(<CaptionView frame={value} />)
  expect(html).toContain('data-caption-emphasis="true"')
  expect(html).toContain('color:#edff39')
  expect(html).not.toContain('opacity:0')
})
it('animates selected emphasis independently of static/phrase motion when timed', () => {
  for (const motion of ['static-clean', 'phrase-fade'] as const) {
    expect(frame(1_100_000, motion).words?.[2].scale).toBe(1.12)
  }
})
it('validates all template styles and migrates older saved appearances with safe defaults', () => {
  for (const template of CAPTION_TEMPLATES) expect(captionStyleSchema.parse(template.style)).toEqual(template.style)
  const { emphasisFontFamily: _family, emphasisMotion: _motion, ...legacy } = DEFAULT_CAPTION_STYLE.appearance
  expect(captionStyleSchema.parse({ motion: 'static-clean', appearance: legacy }).appearance).toMatchObject({ emphasisFontFamily: '', emphasisMotion: 'pop' })
})

it('renders an emphasized word at its scaled font-size, with its own glow shadow and underline, leaving non-emphasized runs unchanged', () => {
  const style = { ...DEFAULT_CAPTION_STYLE, appearance: { ...DEFAULT_CAPTION_STYLE.appearance,
    emphasisScale: 1.5, emphasisGlowEnabled: true, emphasisGlowColor: '#ff00ff', emphasisUnderline: true } }
  const inputs = { ...captionStyleInputs(style, { width: 1080, height: 540 }), emphasized: TEMPLATE_DEMO.emphasized }
  inputs.font.readiness = 'ready'
  const cue = { ...TEMPLATE_DEMO, words: [] }
  const layout = layoutCaption(cue.text, inputs, measure)
  const frame = captionFrame(layout, cue, 0, 'static-clean')
  const html = renderToStaticMarkup(<CaptionView frame={frame} />)
  // The emphasized run's font-size is fitted-base-size * emphasisScale; at fitScale 1 that is base*1.5.
  const expectedSize = layout.font.size * 1.5
  expect(html).toMatch(new RegExp(`data-caption-emphasis="true"[^>]*font-size:${expectedSize}px`))
  expect(html).toMatch(/data-caption-emphasis="true"[^>]*text-decoration:underline/)
  expect(html).toMatch(/data-caption-emphasis="true"[^>]*text-shadow:[^;"]*#ff00ff/)
  // A non-emphasized word run (the base line is otherwise plain here) gets neither the emphasis underline nor its glow inline.
  const quickRun = html.match(/<span[^>]*>quick<\/span>/)?.[0] ?? ''
  expect(quickRun).not.toContain('data-caption-emphasis')
  expect(quickRun).not.toContain('text-decoration:underline')
  expect(quickRun).not.toContain('#ff00ff')
})
