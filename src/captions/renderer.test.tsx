import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { graphemeBoundaries, graphemes } from '../core/captionText'
import { captionFixtures } from './fixtures'
import { CaptionView } from './CaptionPreview'
import { captionFrame, defaultCaptionInputs, layoutCaption, projectCaptionViewport, type CaptionFont, type LayoutInputs } from './renderer'

// Synthetic metrics exercise geometry only; real DOM shaping is tested by smoke:captions.
const measure = (text: string, font: CaptionFont) => ({ width: graphemes(text).length * font.size * .5, height: font.size * font.lineHeight })
const inputs = (): LayoutInputs => {
  const value = defaultCaptionInputs({ width: 1080, height: 1920 })
  return { ...value, font: { ...value.font, readiness: 'ready' } }
}

describe('Malayalam-safe shared renderer', () => {
  for (const fixture of captionFixtures) it(`preserves exact text and whole clusters: ${fixture.id}`, () => {
    const layout = layoutCaption(fixture.text, inputs(), measure)
    expect(layout.lines.map((line) => line.text + line.separator).join('')).toBe(fixture.text)
    const boundaries = graphemeBoundaries(fixture.text)
    for (const line of layout.lines) {
      expect(boundaries.has(line.textStart)).toBe(true)
      expect(boundaries.has(line.textEnd)).toBe(true)
      expect(line.clusters.join('')).toBe(line.text)
    }
    for (const cluster of fixture.clusters) expect(graphemes(fixture.text)).toContain(cluster)
    expect(layout.bounds.x).toBeGreaterThanOrEqual(layout.safeRect.x)
    expect(layout.bounds.y).toBeGreaterThanOrEqual(layout.safeRect.y)
    expect(layout.bounds.x + layout.bounds.width).toBeLessThanOrEqual(layout.safeRect.x + layout.safeRect.width + 1e-8)
    expect(layout.bounds.y + layout.bounds.height).toBeLessThanOrEqual(layout.safeRect.y + layout.safeRect.height + 1e-8)
  })

  it('keeps semantic line layout and normalized geometry at multiple preview sizes', () => {
    const layout = layoutCaption(captionFixtures[3].text, inputs(), measure)
    const original = structuredClone(layout)
    for (const preview of [{ width: 270, height: 480 }, { width: 540, height: 960 }, { width: 1080, height: 1920 }, { width: 800, height: 600 }]) {
      const projection = projectCaptionViewport(layout.inputs.viewport, preview)
      expect((layout.bounds.x * projection.scale) / (1080 * projection.scale)).toBeCloseTo(layout.bounds.x / 1080)
      expect(projection.x).toBeGreaterThanOrEqual(0)
      expect(projection.y).toBeGreaterThanOrEqual(0)
      expect(layout).toEqual(original)
    }
    expect({ fontSize: layout.font.size, lines: layout.lines.map(({ text, x, y, width, height }) => ({ text, x, y, width, height })), bounds: layout.bounds }).toMatchSnapshot()
  })

  it('uses half-open safe integer source times, independent of seeking order', () => {
    const layout = layoutCaption('മലയാളം API', inputs(), measure)
    const cue = { startUs: 3_600_000_007, endUs: 3_600_900_013 }
    const at = cue.startUs + 456_789
    const expected = captionFrame(layout, cue, at)
    captionFrame(layout, cue, cue.endUs)
    captionFrame(layout, cue, 0)
    expect(captionFrame(layout, cue, at)).toEqual(expected)
    expect(expected.elapsedUs).toBe(456_789)
    expect(captionFrame(layout, cue, cue.startUs - 1).visible).toBe(false)
    expect(captionFrame(layout, cue, cue.startUs).visible).toBe(true)
    expect(captionFrame(layout, cue, cue.endUs - 1).visible).toBe(true)
    expect(captionFrame(layout, cue, cue.endUs).visible).toBe(false)
    expect(() => captionFrame(layout, cue, at + .5)).toThrow()
  })

  it('gates metrics and frames on explicit font readiness and changes layouts for fallback metrics', () => {
    const value = inputs()
    for (const readiness of ['loading', 'failed'] as const) {
      const layout = layoutCaption('കി React', { ...value, font: { ...value.font, readiness } }, () => { throw new Error('must not measure') })
      expect(layout.lines).toEqual([])
      expect(captionFrame(layout, { startUs: 0, endUs: 10 }, 5).visible).toBe(false)
    }
    const text = captionFixtures[3].text
    const primary = layoutCaption(text, value, measure)
    const fallback = layoutCaption(text, { ...value, font: { ...value.font, stack: '"Missing Font", sans-serif', revision: 'fallback' } }, (t, f) => ({ ...measure(t, f), width: measure(t, f).width * 1.4 }))
    expect(fallback.lines.map((line) => line.text)).not.toEqual(primary.lines.map((line) => line.text))
    expect(fallback.inputs.font.revision).toBe('fallback')
  })

  it('never splits long tokens or NBSP pairs, fits without dropping explicit lines', () => {
    const value = inputs()
    const layout = layoutCaption(captionFixtures[6].text, value, (t, f) => ({ ...measure(t, f), width: measure(t, f).width * 20 }))
    expect(layout.lines).toHaveLength(1)
    expect(layout.fitScale).toBeLessThan(1)
    const explicit = layoutCaption(captionFixtures[5].text, { ...value, maxLines: 1, wrapping: 'explicit' }, measure)
    expect(explicit.lines).toHaveLength(4)
    expect(explicit.warnings).toContain('max-lines-exceeded: explicit breaks/text preserved')
    expect(layoutCaption('A\u00a0B A\u202fB', value, measure).lines.flatMap((line) => line.clusters)).toContain('\u00a0')
  })

  it('measures full shaping runs rather than adding isolated grapheme widths', () => {
    const value = inputs()
    const layout = layoutCaption('ക്ഷ API', value, (text, font) => ({ width: text === 'ക്ഷ API' ? 123 : measure(text, font).width, height: 100 }))
    expect(layout.lines[0].width).toBe(123)
    expect(layout.lines[0].height).toBe(100)
  })

  it('paints a single text node per full line, never per grapheme or code unit', () => {
    const layout = layoutCaption('ക്ഷ കി React!', inputs(), measure)
    const html = renderToStaticMarkup(<CaptionView frame={captionFrame(layout, { startUs: 0, endUs: 100 }, 50)} />)
    expect(html).toContain('>ക്ഷ കി React!</div>')
    expect(html).not.toContain('<span')
    expect(html).toMatchSnapshot()
    expect(renderToStaticMarkup(<CaptionView frame={captionFrame(layout, { startUs: 0, endUs: 100 }, 100)} />)).toBe('')
  })

  it('validates geometry, padding, timestamps and metrics', () => {
    const value = inputs()
    expect(() => layoutCaption('കി', { ...value, maxLines: 0 }, measure)).toThrow()
    expect(() => layoutCaption('കി', { ...value, viewport: { width: NaN, height: 10 } }, measure)).toThrow()
    expect(() => layoutCaption('കി', { ...value, appearance: { ...value.appearance, padding: 1000 } }, measure)).toThrow()
    expect(() => layoutCaption('കി', value, () => ({ width: NaN, height: 10 }))).toThrow()
    expect(() => projectCaptionViewport(value.viewport, { width: 0, height: 10 })).toThrow()
  })

  it('honors safe area, explicit wrapping, position and appearance without truncation', () => {
    const value = inputs()
    value.safeArea = { left: .2, right: .15, top: .1, bottom: .2 }
    value.position = { horizontal: 0, vertical: 0 }
    value.alignment = 'left'
    value.appearance = { ...value.appearance, padding: 12, color: '#ff00ff', background: '#102030' }
    value.wrapping = 'explicit'
    const layout = layoutCaption('മലയാളം API\nകി English', value, measure)
    expect(layout.bounds.x).toBe(216)
    expect(layout.bounds.y).toBe(192)
    expect(layout.lines.map((line) => line.text)).toEqual(['മലയാളം API', 'കി English'])
    expect(layout.lines[0].x).toBe(13)
    expect(renderToStaticMarkup(<CaptionView frame={captionFrame(layout, { startUs: 0, endUs: 10 }, 5)} />)).toContain('background:#102030;color:#ff00ff')
    const hardBreaks = layoutCaption('കി\nകീ\nകു\nകൂ', { ...inputs(), maxLines: 2 }, measure)
    expect(hardBreaks.font.size).toBe(inputs().font.size)
    expect(hardBreaks.lines).toHaveLength(4)
  })
})
