import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { applyEditCommand } from '../core/commands'
import { createProject, type CaptionProject } from '../core/model'
import { defaultTextOverlay } from '../core/textCommands'
import { commitHistory, createHistory, undoHistory } from '../core/history'
import { captionFrame, layoutCaption, type MeasureText } from './renderer'
import { captionStyleInputs, captionStyleSchema } from './style'
import { decorativeTextCue, textMotionAt } from './textMotion'
import { CAPTION_TEMPLATES, titleTemplateChanges } from './templates'
import { CaptionView } from './CaptionPreview'
import { TemplatesPanel } from '../TemplatesPanel'

const keynote = CAPTION_TEMPLATES.filter((template) => template.id.startsWith('keynote-'))
const measure: MeasureText = (text, font) => ({ width: [...text].length * font.size * .5, height: font.size * font.lineHeight })

it('defines five valid built-in title and caption treatments with animated gallery cards', () => {
  expect(keynote.map((template) => template.name)).toEqual(['Quiet Reveal', 'Lift In', 'Staggered Words', 'Focus Scale', 'Product Callout'])
  for (const template of keynote) {
    expect(captionStyleSchema.parse(template.style)).toEqual(template.style)
    expect(captionStyleSchema.parse(template.title?.style)).toEqual(template.title?.style)
    expect(template.title?.enter.durationUs).toBeGreaterThan(0)
  }
  const html = renderToStaticMarkup(<TemplatesPanel style={keynote[0].style} cues={[]} activeCue={null} presets={[]}
    target="text" onApplyTemplate={() => {}} onCommitMotion={() => {}} onSavePreset={() => {}}
    onApplyPreset={() => {}} onDeletePreset={() => {}} />)
  for (const template of keynote) expect(html).toContain(`Apply ${template.name} template`)
  expect(html).toContain('data-title-enter="slide"')
  expect(html).toContain('data-title-enter="pop"')
})

it('applies a title treatment in one undo step while preserving authored content and placement', () => {
  const original = defaultTextOverlay('title', 1_000_000, 4_000_000, 'പുതിയ iPhone', keynote[0].style)
  original.style = { ...original.style, appearance: { ...original.style.appearance, horizontal: .21, vertical: .68, rotation: 13 } }
  original.layerOrder = 3
  const project: CaptionProject = { ...createProject(), cues: [{ id: 'cue', text: 'caption', startUs: 0, endUs: 5_000_000,
    timingSource: 'manual' as const, textSource: 'user' as const, needsReview: false, words: [] }], textOverlays: [original] }
  for (const template of keynote) {
    const result = applyEditCommand(project, { type: 'text-update', textId: 'title', changes: titleTemplateChanges(template, original) })
    expect(result.ok).toBe(true)
    if (!result.ok) continue
    const actual = result.project.textOverlays[0]
    expect(actual).toMatchObject({ id: original.id, text: original.text, startUs: original.startUs,
      endUs: original.endUs, layerOrder: original.layerOrder, enter: template.title?.enter, exit: template.title?.exit })
    expect(actual.style.motion).toBe(template.title?.style.motion)
    expect(actual.style.appearance).toMatchObject({ horizontal: .21, vertical: .68, rotation: 13 })
    const committed = commitHistory(createHistory(project), result.project)
    expect(committed.past).toHaveLength(1)
    expect(undoHistory(committed).present.textOverlays[0]).toEqual(original)
  }
})

it('uses the same deterministic title and caption frames at fixed times in portrait and landscape', () => {
  for (const template of keynote) for (const size of [{ width: 1080, height: 1920 }, { width: 1920, height: 1080 }]) {
    const item = defaultTextOverlay('title', 0, 3_000_000, 'മലയാളം and English', template.title!.style)
    item.enter = template.title!.enter
    item.exit = template.title!.exit
    const cue = decorativeTextCue(item)
    expect(cue.words?.map((word) => word.text)).toEqual(['മലയാളം', 'and', 'English'])
    for (const timestampUs of [0, 200_000, 1_500_000, 2_850_000]) {
      const motion = textMotionAt(item, timestampUs)
      expect(motion).toEqual(textMotionAt(item, timestampUs))
      const inputs = captionStyleInputs(template.title!.style, size)
      inputs.font.readiness = 'ready'
      const frame = captionFrame(layoutCaption(cue.text, inputs, measure), cue, timestampUs, template.title!.style.motion)
      expect(renderToStaticMarkup(<CaptionView frame={frame} />)).toContain('മലയാളം')
      expect(frame).toEqual(captionFrame(layoutCaption(cue.text, inputs, measure), cue, timestampUs, template.title!.style.motion))
    }
  }
})
