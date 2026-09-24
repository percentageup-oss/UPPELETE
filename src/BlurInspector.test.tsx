import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { BlurInspector } from './BlurInspector'
import type { BlurRegion } from './core/edit'

const region = (extra: Partial<BlurRegion> = {}): BlurRegion =>
  ({ id: 'b1', startUs: 1_000_000, endUs: 3_000_000, rect: { x: 270, y: 151.875, width: 540, height: 303.75 }, radius: 24, enabled: true, ...extra })

const noop = () => false
const render = (r: BlurRegion) => renderToStaticMarkup(<BlurInspector region={r}
  onMove={noop} onLength={noop} onEnabledChange={() => {}} onRadiusDraft={() => {}} onRadiusCommit={() => {}} onDelete={() => {}} onInvalid={() => {}} />)

describe('BlurInspector', () => {
  it('renders the enabled toggle, timing fields and the radius at its own value', () => {
    const html = render(region())
    expect(html).toContain('Blur effect')
    expect(html).toContain('aria-checked="true"')
    expect(html).toContain('On')
    expect(html).toContain('id="blur-start"')
    expect(html).toContain('id="blur-length"')
    expect(html).toMatch(/id="blur-radius-value"[^>]*value="24"/)
  })

  it('labels a bypassed region and explains what bypass does', () => {
    const html = render(region({ enabled: false }))
    expect(html).toContain('aria-checked="false"')
    expect(html).toContain('Bypassed')
    expect(html).toContain('the region keeps its place on the timeline')
  })

  it('has no ease or zoom-amount controls — blur has neither ramps nor an aspect-locked target', () => {
    const html = render(region())
    expect(html).not.toContain('Ease in')
    expect(html).not.toContain('Zoom amount')
    expect(html).not.toContain('Reset framing')
  })
})
