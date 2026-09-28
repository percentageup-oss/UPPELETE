import { describe, expect, test } from 'vitest'
import { DEFAULT_CAPTION_STYLE, type CaptionStyle } from '../captions/style'
import { emphasisStyleRanges } from './textPlusStyleRanges'

const appearance = (overrides: Partial<CaptionStyle['appearance']> = {}): CaptionStyle['appearance'] => ({
  ...DEFAULT_CAPTION_STYLE.appearance, ...overrides,
})

describe('emphasisStyleRanges', () => {
  test('no emphasized words -> no ranges, text unchanged', () => {
    const result = emphasisStyleRanges('Sam ആൾട്ട്മാൻ', undefined, appearance(), 'codepoint')
    expect(result).toEqual({ text: 'Sam ആൾട്ട്മാൻ', ranges: [] })
  })

  test('colours an emphasized English word, converted to 0-based code points with an inclusive end', () => {
    const text = 'Hello Sam there'
    const result = emphasisStyleRanges(text, [{ text: 'Sam', textStart: 6, textEnd: 9 }], appearance({ secondaryColor: '#ff0000' }), 'codepoint')
    // "Sam" starts at code point 6 and its last code point (m) is index 8.
    expect(result.ranges).toEqual([{ start: 6, end: 8, color: { r: 1, g: 0, b: 0 } }])
    expect(result.text).toBe(text)
  })

  test('locates a Malayalam conjunct word without splitting its grapheme cluster', () => {
    const text = 'പ്രൈം മിനിസ്റ്റർ Sam ആൾട്ട്മാനെ പറഞ്ഞത്'
    const word = 'ആൾട്ട്മാനെ'
    const utf16Start = text.indexOf(word)
    const result = emphasisStyleRanges(text, [{ text: word, textStart: utf16Start, textEnd: utf16Start + word.length }], appearance(), 'codepoint')
    expect(result.ranges).toHaveLength(1)
    const [...codePoints] = text
    const range = result.ranges[0]
    // The located word, read back out of the code-point array, is exactly the emphasized word — no partial
    // grapheme, no off-by-one into the following space or a neighbouring conjunct.
    expect(codePoints.slice(range.start, range.end + 1).join('')).toBe(word)
  })

  test('a word that cannot be found verbatim is dropped, not partially styled', () => {
    const result = emphasisStyleRanges('Hello there', [{ text: 'Sam', textStart: 0, textEnd: 3 }], appearance(), 'codepoint')
    expect(result.ranges).toEqual([])
  })

  test('sizeScale, style and underline are only sent when they differ from the base', () => {
    const text = 'plain WORD plain'
    const emphasized = [{ text: 'WORD', textStart: 6, textEnd: 10 }]
    const base = appearance({ emphasisScale: 1, emphasisWeight: 700, emphasisItalic: false, fontWeight: 700, fontItalic: false, emphasisUnderline: false })
    expect(emphasisStyleRanges(text, emphasized, base, 'codepoint').ranges[0]).toEqual({ start: 6, end: 9, color: expect.any(Object) })

    const styled = appearance({ emphasisScale: 1.5, emphasisWeight: 400, fontWeight: 700, emphasisUnderline: true })
    expect(emphasisStyleRanges(text, emphasized, styled, 'codepoint').ranges[0]).toMatchObject({ sizeScale: 1.5, style: 'Regular', underline: true })
  })

  test('spotlight mode dims every non-emphasized stretch but never covers a newline', () => {
    const text = 'one TWO\nthree FOUR five'
    const emphasized = [{ text: 'TWO', textStart: 4, textEnd: 7 }, { text: 'FOUR', textStart: 14, textEnd: 18 }]
    const result = emphasisStyleRanges(text, emphasized, appearance({ emphasisMode: 'spotlight' }), 'codepoint')
    const dim = result.ranges.filter((range) => range.alpha !== undefined)
    for (const range of dim) {
      const [...codePoints] = result.text
      expect(codePoints.slice(range.start, range.end + 1).join('')).not.toContain('\n')
    }
    // 'one ' before TWO, '\nthree ' after TWO up to FOUR (split around the newline), and ' five' after FOUR.
    expect(dim.length).toBeGreaterThanOrEqual(3)
  })

  test('applies a length-preserving emphasis text transform to just that word', () => {
    const text = 'hello sam there'
    const emphasized = [{ text: 'sam', textStart: 6, textEnd: 9 }]
    const result = emphasisStyleRanges(text, emphasized, appearance({ emphasisTextTransform: 'uppercase' }), 'codepoint')
    expect(result.text).toBe('hello SAM there')
  })
})
