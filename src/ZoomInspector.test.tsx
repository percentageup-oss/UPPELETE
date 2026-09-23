import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ZoomInspector } from './ZoomInspector'
import type { ZoomRegion } from './core/edit'

const composition = { width: 1080, height: 607.5 }
const region = (extra: Partial<ZoomRegion> = {}): ZoomRegion =>
  ({ id: 'z1', startUs: 1_000_000, endUs: 3_000_000, rect: { x: 270, y: 151.875, width: 540, height: 303.75 }, easeInUs: 500_000, easeOutUs: 500_000, enabled: true, ...extra })

const noop = () => false
const render = (r: ZoomRegion, framing: 'start' | 'end' = 'end') => renderToStaticMarkup(<ZoomInspector region={r} composition={composition}
  framing={framing} onFramingChange={() => {}} onMove={noop} onLength={noop} onEnabledChange={() => {}} onDraft={() => {}} onCommit={() => {}} onReset={() => {}} onDelete={() => {}} onInvalid={() => {}} />)

describe('ZoomInspector', () => {
  it('renders the enabled toggle, timing fields and the zoom amount at the rect\'s own factor', () => {
    const html = render(region())
    expect(html).toContain('Zoom effect')
    expect(html).toContain('aria-checked="true"')
    expect(html).toContain('On')
    expect(html).toContain('id="zoom-start"')
    expect(html).toContain('id="zoom-length"')
    // 1080 / 540 = 2x
    expect(html).toMatch(/id="zoom-amount-value"[^>]*value="2"/)
  })

  it('labels a bypassed region and explains what bypass does', () => {
    const html = render(region({ enabled: false }))
    expect(html).toContain('aria-checked="false"')
    expect(html).toContain('Bypassed')
    expect(html).toContain('the region keeps its place on the timeline')
  })

  it('shows the clamped effective ease when the raw value exceeds half the region length', () => {
    // A 400ms region with a 5s ease-in: clamps to half its length, 200ms.
    const html = render(region({ startUs: 0, endUs: 400_000, easeInUs: 5_000_000 }))
    expect(html).toContain('Clamped to 200ms')
  })

  it('shows no clamp hint when ease already fits within half the region length', () => {
    const html = render(region({ startUs: 0, endUs: 4_000_000, easeInUs: 500_000, easeOutUs: 500_000 }))
    expect(html).not.toContain('Clamped to')
  })

  describe('pan regions', () => {
    const pan = region({ fromRect: { x: 0, y: 0, width: 1080, height: 607.5 }, easeInUs: 0, easeOutUs: 0 })

    it('shows the Start/End framing switch, Swap and Remove pan, and hides the ease rows', () => {
      const html = render(pan)
      expect(html).toContain('Pan effect')
      expect(html).toContain('id="pan-framing"')
      expect(html).toContain('Swap')
      expect(html).toContain('Remove pan')
      expect(html).not.toContain('zoom-ease-in')
    })

    it('reports the zoom amount of whichever framing is selected', () => {
      expect(render(pan, 'end')).toMatch(/id="zoom-amount-value"[^>]*value="2"/)
      expect(render(pan, 'start')).toMatch(/id="zoom-amount-value"[^>]*value="1"/)
    })

    it('does not show pan controls for a plain zoom region', () => {
      const html = render(region())
      expect(html).not.toContain('pan-framing')
      expect(html).not.toContain('Remove pan')
    })
  })
})
