import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { LeftRail } from './LeftRail'

describe('LeftRail', () => {
  it('renders exactly the five panel tabs, each with an accessible name', () => {
    const html = renderToStaticMarkup(<LeftRail active="media" onChange={() => {}} onSettings={() => {}} />)
    for (const tab of ['media', 'captions', 'overlays', 'titles', 'effects']) expect(html).toContain(`id="rail-tab-${tab}"`)
    expect(html).toContain('role="tablist"')
  })

  it('marks only the active tab selected and gives it the sole 0 tabIndex', () => {
    const html = renderToStaticMarkup(<LeftRail active="overlays" onChange={() => {}} onSettings={() => {}} />)
    expect(html).toMatch(/id="rail-tab-overlays"[^>]*aria-selected="true"/)
    expect(html).toMatch(/id="rail-tab-overlays"[^>]*tabindex="0"/i)
    expect(html).toMatch(/id="rail-tab-media"[^>]*aria-selected="false"/)
    expect(html).toMatch(/id="rail-tab-media"[^>]*tabindex="-1"/i)
  })

  it('renders Settings as a button outside the tablist, not a sixth tab', () => {
    const html = renderToStaticMarkup(<LeftRail active="media" onChange={() => {}} onSettings={() => {}} />)
    expect(html).toMatch(/<button[^>]*aria-label="Settings"/)
    expect([...html.matchAll(/role="tab"/g)]).toHaveLength(5)
  })
})
