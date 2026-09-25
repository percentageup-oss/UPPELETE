import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { TextOverlayActor } from './TextOverlayActor'
import { defaultTextOverlay } from '../core/textCommands'

const composition = { width: 1080, height: 1080 }
const wrapperOpacity = (html: string) => Number(/data-text-overlay-id="[^"]*" style="[^"]*?opacity:([\d.]+)/.exec(html)?.[1])

describe('TextOverlayActor opacity', () => {
  const item = defaultTextOverlay('t1', 0, 3_000_000, 'Hello')
  it('paints the item opacity on the actor wrapper, multiplied with the motion opacity', () => {
    const full = wrapperOpacity(renderToStaticMarkup(<TextOverlayActor item={item} timestampUs={1_500_000} composition={composition} />))
    const half = wrapperOpacity(renderToStaticMarkup(<TextOverlayActor item={{ ...item, opacity: 0.5 }} timestampUs={1_500_000} composition={composition} />))
    expect(full).toBeGreaterThan(0)
    expect(half).toBeCloseTo(full * 0.5, 5)
  })
})
