import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ShapeActor } from './ShapeActor'
import { defaultShape } from '../core/shapeCommands'

const composition = { width: 1080, height: 1080 }
const shape = { ...defaultShape('box', 's1', 0, 3_000_000), blendMode: 'multiply' as const }
const timestampUs = 1_000_000 // past the draw-on, before the exit fade

describe('ShapeActor blend', () => {
  it('spreads the blend style on the shape wrapper by default, and skips it when blend is false', () => {
    const on = renderToStaticMarkup(<ShapeActor shape={shape} timestampUs={timestampUs} composition={composition} />)
    expect(on).toMatch(/data-shape-id="s1" style="[^"]*mix-blend-mode:multiply/)
    const off = renderToStaticMarkup(<ShapeActor shape={shape} timestampUs={timestampUs} composition={composition} blend={false} />)
    expect(off).not.toContain('mix-blend-mode')
  })

  it('has no blend style at all for a normal shape', () => {
    const { blendMode: _blendMode, ...plain } = shape
    const html = renderToStaticMarkup(<ShapeActor shape={plain} timestampUs={timestampUs} composition={composition} />)
    expect(html).not.toContain('mix-blend-mode')
  })

  it('puts the blend style on the outer mask wrapper, not the inner shape div, when the shape is masked', () => {
    const mask = { enabled: true, invert: false, feather: 0, density: 1, shape: { kind: 'ellipse' as const, rect: { x: 0, y: 0, width: 100, height: 100 } } }
    const html = renderToStaticMarkup(<ShapeActor shape={{ ...shape, mask }} timestampUs={timestampUs} composition={composition} />)
    expect(html).toMatch(/data-shape-mask="s1" style="[^"]*mix-blend-mode:multiply/)
    expect(html).not.toMatch(/data-shape-id="s1" style="[^"]*mix-blend-mode/)
  })
})
