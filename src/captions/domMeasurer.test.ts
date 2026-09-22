import { describe, expect, it } from 'vitest'
import { createDomMeasurer } from './CaptionPreview'
import { layoutCaption } from './renderer'
import { captionStyleInputs, DEFAULT_CAPTION_STYLE } from './style'

/**
 * The smallest Document `createDomMeasurer` needs: elements that hold text or children and report a
 * box like a real one does — an element with no content is 0 x 0, which is what makes an empty
 * emphasis measurement observable without a browser.
 */
function fakeElement(): any {
  return {
    style: {}, children: [] as any[], own: '', lang: '',
    set textContent(value: string) { this.own = value; this.children = [] },
    get textContent(): string { return this.own + this.children.map((child: any) => child.textContent).join('') },
    append(...nodes: any[]) { this.children.push(...nodes) },
    replaceChildren() { this.own = ''; this.children = [] },
    remove() {},
    getBoundingClientRect() { const length = this.textContent.length; return { x: 0, y: 0, width: length * 10, height: length ? 20 : 0 } },
  }
}
const fakeDocument = () => ({ createElement: () => fakeElement(), body: fakeElement() }) as unknown as Document

describe('createDomMeasurer', () => {
  const style = { ...DEFAULT_CAPTION_STYLE, appearance: { ...DEFAULT_CAPTION_STYLE.appearance, emphasisWeight: 900 } }
  const inputs = { ...captionStyleInputs(style, { width: 1080, height: 1920 }), font: { ...captionStyleInputs(style, { width: 1080, height: 1920 }).font, readiness: 'ready' as const } }

  it('measures empty text with emphasis as an empty line of the base font, not as 0 x 0', () => {
    const { measure } = createDomMeasurer(fakeDocument())
    const size = measure('', inputs.font, { spans: [], font: inputs.emphasisFont ?? inputs.font })
    expect(size.width).toBe(0)
    expect(size.height).toBeGreaterThan(0)
  })

  it('lays out emphasised text whose trailing space overflows the line, which leaves an empty last line', () => {
    // A trailing space counts toward the line's width. When it is the character that overflows, the
    // break lands at the end of the text and the final line is empty. This is what stopped a real
    // export: the emphasis path measured that empty line as 0 x 0 and layout threw, unmounting the tree.
    const { safeArea: a, viewport: v, appearance } = inputs
    const available = v.width * (1 - a.left - a.right) - 2 * (appearance.padding + appearance.outlineWidth)
    const word = 'a'.repeat(Math.floor(available / 10))
    const { measure } = createDomMeasurer(fakeDocument())
    const layout = layoutCaption(`${word} `, { ...inputs, emphasized: [{ text: word, textStart: 0, textEnd: word.length }] }, measure)
    expect(layout.lines.map((line) => line.text)).toEqual([`${word} `, ''])
    expect(layout.lines.every((line) => line.height > 0)).toBe(true)
  })
})
