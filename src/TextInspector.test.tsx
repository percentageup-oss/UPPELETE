import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { defaultTextOverlay } from './core/textCommands'
import { TextInspector } from './TextInspector'

it('labels whole-layer In/Out transitions distinctly from word animation', () => {
  const noop = () => {}
  const html = renderToStaticMarkup(<TextInspector item={defaultTextOverlay('title', 0, 3_000_000)} onUpdate={noop} onMove={noop}
    onLength={noop} onDuplicate={noop} onDelete={noop} onInvalid={noop} />)
  expect(html).toContain('Layer transitions')
  expect(html).toContain('In transition')
  expect(html).toContain('Out transition')
  expect(html).toContain('whole title layer, not individual words')
})
