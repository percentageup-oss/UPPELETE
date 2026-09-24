import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { TitlesPanel } from './TitlesPanel'
import { DEFAULT_CAPTION_STYLE } from './captions/style'

const noop = () => {}

it('renders the caption motion picker (same content as TemplatesPanel, at its new left-rail home)', () => {
  const html = renderToStaticMarkup(<TitlesPanel style={DEFAULT_CAPTION_STYLE} cues={[]} activeCue={null} presets={[]}
    onApplyTemplate={noop} onCommitMotion={noop} onSavePreset={noop} onApplyPreset={noop} onDeletePreset={noop} />)
  expect(html).toContain('Templates')
  expect(html).toContain('Motion preset')
})
