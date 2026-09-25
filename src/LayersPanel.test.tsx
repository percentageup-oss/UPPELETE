import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { LayersPanel } from './LayersPanel'
import type { LayerMask } from './core/edit'
import type { LayerRow } from './core/layerStack'

const units = { width: 1080, height: 608 }
const noop = () => undefined
const mask: LayerMask = { enabled: true, invert: false, feather: 12, density: 1, shape: { kind: 'ellipse', rect: { x: 100, y: 50, width: 400, height: 300 } } }
const row = (key: string, extra: Partial<LayerRow> = {}): LayerRow => ({
  key, kind: 'video', label: `${key}.mp4`, detail: 'Video · V1', target: { kind: 'clip', id: key }, mask: null, opacity: 1, blendMode: 'normal', selection: { kind: 'clip', id: key }, active: true, ...extra,
})
const render = (rows: LayerRow[], props: Partial<Parameters<typeof LayersPanel>[0]> = {}) => renderToStaticMarkup(
  <LayersPanel rows={rows} timeLabel="00:12.34" units={units} focusKey={null} editing={false} drawing={false} offscreenSelection={false}
    onFocus={noop} onAddMask={noop} onEditOnStage={noop} onStopEditing={noop} onDraft={noop} onCommit={noop} onLookDraft={noop} onLookCommit={noop} onBlendChange={noop} onRemove={noop} onReset={noop} onJumpToSelection={noop} {...props} />)

describe('Layers panel', () => {
  it('enables the blend menu for clip rows only, and names a non-normal mode in the row detail', () => {
    const clip = render([row('a', { blendMode: 'multiply' })], { focusKey: 'a' })
    expect(clip).not.toMatch(/<select[^>]*id="layer-blend"[^>]*disabled/)
    expect(clip).toContain('<option value="multiply" selected="">Multiply</option>')
    expect(clip).toContain('Video · V1 · Multiply')
    for (const dropped of ['color-dodge', 'color-burn', 'soft-light']) expect(clip).not.toContain(`value="${dropped}"`)
    const title = render([row('t', { kind: 'text', blendMode: null })], { focusKey: 't' })
    expect(title).toMatch(/<select[^>]*id="layer-blend"[^>]*disabled/)
  })

  it('lists layers in the order given, with a thumbnail only on masked ones', () => {
    const html = render([row('top', { mask }), row('bottom')])
    expect(html).toContain('at 00:12.34')
    expect(html.indexOf('top.mp4')).toBeLessThan(html.indexOf('bottom.mp4'))
    expect(html.match(/class="mask-thumb/g)).toHaveLength(1)
    expect(html).toContain('aria-label="top.mp4, Video · V1, masked"')
  })

  it('offers the three mask shapes on a focused layer that has none, and explains the caption plane', () => {
    const html = render([row('a'), row('cap', { kind: 'captions', label: 'C1', detail: 'Captions', target: { kind: 'captionTrack', id: 'cap' } })], { focusKey: 'cap' })
    for (const label of ['Rectangle', 'Ellipse', 'Pen']) expect(html).toMatch(new RegExp(`<svg[^>]*>.*?</svg> ${label}</button>`))
    expect(html).toContain('whole caption plane')
  })

  it('shows the mask controls for a focused masked layer, and rect-only corner radius', () => {
    const html = render([row('a', { mask })], { focusKey: 'a' })
    for (const id of ['mask-enabled', 'mask-shape', 'mask-invert', 'mask-feather', 'mask-density']) expect(html).toContain(`id="${id}"`)
    expect(html).not.toContain('mask-radius')
    expect(html).toContain('Edit on preview')
    expect(html).toContain('Delete mask')
    const rect = render([row('a', { mask: { ...mask, shape: { kind: 'rect', rect: { x: 0, y: 0, width: 100, height: 60 }, cornerRadius: 8 } } })], { focusKey: 'a' })
    expect(rect).toContain('id="mask-radius"')
  })

  it('says so when nothing is showing, or the selection is off-screen, and while drawing or editing', () => {
    expect(render([])).toContain('Nothing is showing at the playhead')
    expect(render([row('a')], { offscreenSelection: true })).toContain('Jump to it')
    expect(render([row('a')], { focusKey: 'a', drawing: true })).toContain('Click on the preview to place points')
    expect(render([row('a', { mask })], { focusKey: 'a', editing: true })).toContain('Done editing')
    expect(render([row('a', { mask: { ...mask, shape: { kind: 'path', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 9 }] } } })], { focusKey: 'a', editing: true })).toContain('Alt-click a point')
  })
})
