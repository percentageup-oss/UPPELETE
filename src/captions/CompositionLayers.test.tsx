import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { CompositionLayers, glowFilterStyle, pinnedEffectLayers } from './CompositionLayers'
import { frameEffectsAt } from '../core/frameEffects'

const composition = { width: 1080, height: 1080 }
const grainLayer = { kind: 'grain' as const, id: 'grain', amount: .4, size: 1.5, seed: 7 }
const vhsLayer = { kind: 'vhs' as const, id: 'vhs', amount: .6, scanlines: .5, tracking: .5, bandY: .4, jitter: .2, flicker: .5, seed: 9 }

describe('texture layers', () => {
  it('paints grain as seeded turbulence, white and black halves, at the requested cell size', () => {
    const html = renderToStaticMarkup(<CompositionLayers layers={[grainLayer]} composition={composition} />)
    expect(html).toContain('data-grain-id="grain"')
    expect(html).toContain('seed="7"')
    expect(html).toContain('feTurbulence')
    expect(html.match(/<feTurbulence/g)).toHaveLength(2)
    // 1080 / 1.5 units: the viewBox is what makes the grain 1.5 composition units coarse.
    expect(html).toContain('viewBox="0 0 720 720"')
  })

  it('scales the grain cell with the export composition, so 4K grain matches the 1080 preview', () => {
    const html = renderToStaticMarkup(<CompositionLayers layers={[grainLayer]} composition={{ width: 2160, height: 2160 }} />)
    expect(html).toContain('viewBox="0 0 720 720"')
  })

  it('paints nothing for zero-amount grain', () => {
    expect(renderToStaticMarkup(<CompositionLayers layers={[{ ...grainLayer, amount: 0 }]} composition={composition} />)).not.toContain('data-grain-id')
  })

  it('paints VHS scanlines, color bleed and a tracking band', () => {
    const html = renderToStaticMarkup(<CompositionLayers layers={[vhsLayer]} composition={composition} />)
    expect(html).toContain('data-vhs-id="vhs"')
    expect(html).toContain('repeating-linear-gradient')
    expect(html).toContain('feTurbulence')
  })

  it('drops the noise bands when tracking is off but keeps scanlines', () => {
    const html = renderToStaticMarkup(<CompositionLayers layers={[{ ...vhsLayer, tracking: 0 }]} composition={composition} />)
    expect(html).toContain('repeating-linear-gradient')
    expect(html).not.toContain('feTurbulence')
  })

  it('orders pinned effects vignette → VHS → grain → letterbox, shared by preview and export', () => {
    const effects = frameEffectsAt([
      { id: 'a', kind: 'letterbox', startUs: 0, endUs: 1_000_000, enabled: true, aspect: 2.39, color: '#000000', easeInUs: 0, easeOutUs: 0 },
      { id: 'b', kind: 'grain', startUs: 0, endUs: 1_000_000, enabled: true, amount: .3, size: 1 },
      { id: 'c', kind: 'vhs', startUs: 0, endUs: 1_000_000, enabled: true, amount: .5, scanlines: .5, tracking: .5 },
      { id: 'd', kind: 'vignette', startUs: 0, endUs: 1_000_000, enabled: true, amount: .5, softness: .5 },
    ], 500_000, composition)
    expect(pinnedEffectLayers(effects).map((layer) => layer.kind)).toEqual(['vignette', 'vhs', 'grain', 'letterbox'])
  })
})

describe('glowFilterStyle', () => {
  it('builds highlight pass, blur and screen composite from the glow parameters', () => {
    const { defs, style } = glowFilterStyle({ amount: .5, radius: 20, threshold: .5 }, 2, 'g')
    const html = renderToStaticMarkup(defs)
    expect(style.filter).toBe('url(#g)')
    expect(html).toContain('slope="2"')
    expect(html).toContain('intercept="-1"')
    expect(html).toContain('stdDeviation="40"')
    expect(html).toContain('k1="-0.5"')
    expect(html).toContain('k3="0.5"')
    expect(html).toContain('color-interpolation-filters="sRGB"')
  })
})

describe('layer masks', () => {
  const mask = { enabled: true, invert: false, feather: 0, density: 1, shape: { kind: 'ellipse' as const, rect: { x: 100, y: 100, width: 400, height: 300 } } }
  it('masks the element itself, offset to the frame, so a backdrop-filter blur keeps working', () => {
    const html = renderToStaticMarkup(<CompositionLayers composition={composition}
      layers={[{ kind: 'blur', id: 'b', rect: { x: 100, y: 200, width: 300, height: 300 }, radius: 10, mask }]} />)
    expect(html).toContain('backdrop-filter:blur(10px)')
    expect(html).toContain('mask-image:url(')
    expect(html).toContain('mask-size:1080px 1080px')
    expect(html).toContain('mask-position:-100px -200px')
  })
  it('scales the mask image with the export composition and skips disabled masks', () => {
    const grain = { ...grainLayer, mask }
    expect(renderToStaticMarkup(<CompositionLayers layers={[grain]} composition={{ width: 2160, height: 2160 }} />)).toContain('mask-size:2160px 2160px')
    expect(renderToStaticMarkup(<CompositionLayers layers={[{ ...grain, mask: { ...mask, enabled: false } }]} composition={composition} />)).not.toContain('mask-image')
  })
  it('carries an effect region mask through frameEffectsAt to its layer', () => {
    const effects = frameEffectsAt([{ id: 'v', kind: 'vignette', startUs: 0, endUs: 1_000_000, enabled: true, amount: .5, softness: .5, mask }], 10, composition)
    expect(pinnedEffectLayers(effects)[0]).toMatchObject({ kind: 'vignette', mask })
  })
})

