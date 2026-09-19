import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { InspectorTabs } from './InspectorTabs'

it('marks only the active tab selected and renders only its panel', () => {
  const html = renderToStaticMarkup(<InspectorTabs active="style" onChange={() => {}}
    edit={<div data-panel="edit" />} style={<div data-panel="style" />} />)
  expect(html).toContain('data-panel="style"')
  expect(html).not.toContain('data-panel="edit"')
  expect(html).toMatch(/id="inspector-tab-style"[^>]*aria-selected="true"/)
  expect(html).toMatch(/id="inspector-tab-edit"[^>]*aria-selected="false"/)
  expect(html).toContain('role="tablist"')
  expect(html).toContain('role="tabpanel"')
})

it('gives every tab an accessible name and only the active tab a 0 tabIndex', () => {
  const html = renderToStaticMarkup(<InspectorTabs active="edit" onChange={() => {}}
    edit={<div />} style={<div />} />)
  for (const tab of ['edit', 'style']) expect(html).toContain(`id="inspector-tab-${tab}"`)
  expect(html).toMatch(/id="inspector-tab-edit"[^>]*tabindex="0"/i)
  expect(html).toMatch(/id="inspector-tab-style"[^>]*tabindex="-1"/i)
})

it('labels the style tab "Text" (its id stays "style" so tests/ids don’t churn)', () => {
  const html = renderToStaticMarkup(<InspectorTabs active="style" onChange={() => {}}
    edit={<div />} style={<div />} />)
  expect(html).toMatch(/id="inspector-tab-style"[^>]*>Text</)
})
