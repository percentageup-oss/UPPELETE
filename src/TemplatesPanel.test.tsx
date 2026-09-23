import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CaptionWord, Cue } from './core/model'
import { TemplatesPanel, templateDemoFor, templatePreviewTimestampUs } from './TemplatesPanel'
import { DEFAULT_CAPTION_STYLE } from './captions/style'
import { CAPTION_TEMPLATES } from './captions/templates'

const noop = () => {}
const timedWords: CaptionWord[] = [{ id: 'w0', text: 'hi', startUs: 0, endUs: 500, timingSource: 'model', needsReview: false }]
const wordCue: Cue = { id: 'c1', text: 'hi', startUs: 0, endUs: 1000, timingSource: 'model', needsReview: false, textSource: 'model', words: timedWords }
const plainCue: Cue = { id: 'c2', text: 'plain', startUs: 0, endUs: 1000, timingSource: 'imported', needsReview: false, textSource: 'imported', words: [] }

function render(props: Partial<Parameters<typeof TemplatesPanel>[0]> = {}) {
  return renderToStaticMarkup(<TemplatesPanel style={DEFAULT_CAPTION_STYLE} cues={[]} activeCue={null} presets={[]}
    onApplyTemplate={noop} onCommitMotion={noop} onSavePreset={noop} onApplyPreset={noop} onDeletePreset={noop} {...props} />)
}

function motionLabel(html: string, value: string): string {
  const labels = html.match(/<label[^>]*>.*?<\/label>/g) ?? []
  const match = labels.find((label) => label.includes(`value="${value}"`))
  if (!match) throw new Error(`Motion option not found: ${value}`)
  return match
}

it('disables the three word-dependent motion options and explains why when no cue has usable word timing', () => {
  const html = render({ cues: [plainCue] })
  expect(html).toContain('No cue in this project currently has usable word timing')
  for (const value of ['active-word-highlight', 'word-pop', 'progressive-word-reveal']) expect(motionLabel(html, value)).toContain('disabled')
  expect(motionLabel(html, 'static-clean')).not.toContain('disabled')
  expect(motionLabel(html, 'phrase-fade')).not.toContain('disabled')
})

it('presents title styles and decorative word animation independently of caption timing', () => {
  const html = render({ target: 'text', cues: [plainCue], style: { ...DEFAULT_CAPTION_STYLE, motion: 'word-pop' } })
  expect(html).toContain('Title styles')
  expect(html).toContain('Word animation')
  expect(html).toContain('Position, word animation, and layer transitions stay as set.')
  expect(html).toContain('Word animation is decorative and does not use or alter speech caption timing.')
  expect(motionLabel(html, 'word-pop')).not.toContain('disabled')
})

it('enables word-dependent motion and shows counts once a cue has complete word timing', () => {
  const html = render({ cues: [wordCue, plainCue] })
  expect(motionLabel(html, 'word-pop')).not.toContain('disabled')
  expect(html).toContain('1 cue with aligned/model/manual word timing')
  expect(html).toContain('1 without usable word timing')
})

it('labels estimated word timing as estimated, never as aligned', () => {
  const estimatedCue: Cue = { ...wordCue, words: timedWords.map((w) => ({ ...w, timingSource: 'estimated' })) }
  const html = render({ cues: [estimatedCue], activeCue: estimatedCue })
  expect(html).toContain('estimated timing (labelled, not aligned to audio)')
  expect(html).toContain('Estimated word timing')
})

it('prompts to estimate word timing when a word-dependent style is active but the selected caption has none', () => {
  const html = render({ style: { ...DEFAULT_CAPTION_STYLE, motion: 'progressive-word-reveal' }, cues: [wordCue, plainCue], activeCue: plainCue, onEstimate: noop })
  expect(html).toContain('needs word timing to build word by word')
  expect(html).toContain('Estimate word timing for this caption')
})

it('does not prompt to estimate word timing for a static-clean style, even without usable timing', () => {
  const html = render({ style: DEFAULT_CAPTION_STYLE, cues: [plainCue], activeCue: plainCue })
  expect(html).not.toContain('needs word timing to build word by word')
})

it('does not prompt to estimate word timing once the selected caption already has it', () => {
  const html = render({ style: { ...DEFAULT_CAPTION_STYLE, motion: 'progressive-word-reveal' }, cues: [wordCue], activeCue: wordCue })
  expect(html).not.toContain('needs word timing to build word by word')
})

it('mint reveal uses a regular (non-bold) base font weight', () => {
  const mintReveal = CAPTION_TEMPLATES.find((template) => template.id === 'mint-reveal')!
  expect(mintReveal.style.appearance.fontWeight).toBe(400)
})

it('lists Malayalam Gold with its localized two-line gallery sample', () => {
  const gold = CAPTION_TEMPLATES.find((template) => template.id === 'malayalam-gold')!
  expect(gold).toMatchObject({
    name: 'Malayalam Gold',
    tags: expect.arrayContaining(['Malayalam', 'Gold', 'Outlined', 'Title']),
    demo: { text: 'മലയാളം ടൈറ്റിൽ\nടെംപ്ലേറ്റ്' },
  })
  expect(templateDemoFor(gold)).toEqual(gold.demo)
  expect(render()).toContain('Apply Malayalam Gold')
})

it('lists saved presets with apply and delete actions, and disables saving an empty name', () => {
  const html = render({ presets: [{ id: 'p1', name: 'Bold pop', style: DEFAULT_CAPTION_STYLE }] })
  expect(html).toContain('Bold pop')
  expect(html).toContain('Apply')
  expect(html).toContain('Delete')
  expect(html).toMatch(/Save current style<\/button>/)
})

it('keeps a template preview timestamp valid when the first animation frame predates its performance sample', () => {
  expect(templatePreviewTimestampUs(99.75, 100)).toBe(0)
  expect(templatePreviewTimestampUs(100.25, 100)).toBe(250)
  expect(templatePreviewTimestampUs(3_100.25, 100)).toBe(250)
})
