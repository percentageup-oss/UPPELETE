import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { EffectsPanel } from './EffectsPanel'

describe('EffectsPanel', () => {
  it('groups the zoom presets under a Zoom section heading', () => {
    const html = renderToStaticMarkup(<EffectsPanel onAddAtPlayhead={() => {}} />)
    expect(html).toContain('Zoom')
    expect(html).toContain('Zoom in')
    expect(html).toContain('Zoom out')
  })

  it('groups the blur presets under a Blur section heading', () => {
    const html = renderToStaticMarkup(<EffectsPanel onAddAtPlayhead={() => {}} />)
    expect(html).toContain('Blur')
    expect(html).toContain('Blur area')
    expect(html).toContain('Blur frame')
  })

  it('offers click-and-drag for every preset tile', () => {
    const html = renderToStaticMarkup(<EffectsPanel onAddAtPlayhead={() => {}} />)
    expect([...html.matchAll(/draggable="true"/g)]).toHaveLength(13)
    expect(html).toContain('Add zoom in at the playhead')
    expect(html).toContain('Add zoom out at the playhead')
    expect(html).toContain('Add pan at the playhead')
    expect(html).toContain('Add ken burns at the playhead')
    expect(html).toContain('Add blur area at the playhead')
    expect(html).toContain('Add blur frame at the playhead')
    expect(html).toContain('Add vignette at the playhead')
    expect(html).toContain('Add letterbox 2.39 at the playhead')
    expect(html).toContain('Add flash at the playhead')
  })

  it('groups the frame-paint presets under Look and Transitions section headings', () => {
    const html = renderToStaticMarkup(<EffectsPanel onAddAtPlayhead={() => {}} />)
    expect(html).toContain('Look')
    expect(html).toContain('Vignette')
    expect(html).toContain('Letterbox 2.39')
    expect(html).toContain('Letterbox 1.85')
    expect(html).toContain('Transitions')
    expect(html).toContain('Fade in')
    expect(html).toContain('Fade out')
    expect(html).toContain('Dip to black')
    expect(html).toContain('Flash')
  })
})
