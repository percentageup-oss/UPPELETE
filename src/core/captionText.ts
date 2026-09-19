/** Offsets address whole grapheme clusters in the original string; text is never normalized. */
export type TextSpan = { text: string; textStart: number; textEnd: number }
const graphemeSegmenter = new Intl.Segmenter('und', { granularity: 'grapheme' })
const wordSegmenter = new Intl.Segmenter('und', { granularity: 'word' })

export function graphemes(text: string): string[] {
  return Array.from(graphemeSegmenter.segment(text), (part) => part.segment)
}

export function graphemeBoundaries(text: string): Set<number> {
  return new Set([...Array.from(graphemeSegmenter.segment(text), (part) => part.index), text.length])
}

export function captionTokens(text: string): TextSpan[] {
  const boundaries = [...graphemeBoundaries(text)]
  const result: TextSpan[] = []
  for (const part of wordSegmenter.segment(text)) {
    if (!part.isWordLike) continue
    // ICU word boundaries must never become a split inside a Malayalam conjunct/vowel cluster.
    const start = boundaries.filter((offset) => offset <= part.index).at(-1) ?? 0
    const end = boundaries.find((offset) => offset >= part.index + part.segment.length) ?? text.length
    const previous = result.at(-1)
    if (previous && start < previous.textEnd) {
      previous.textEnd = end
      previous.text = text.slice(previous.textStart, end)
    } else result.push({ text: text.slice(start, end), textStart: start, textEnd: end })
  }
  return result
}

/** Exact ordered matching, including punctuation-bearing backend words. No substring of a word/cluster. */
export function locateWordSpans(text: string, words: readonly { text: string; textStart?: number; textEnd?: number }[]): TextSpan[] | null {
  const boundaries = graphemeBoundaries(text)
  const tokens = captionTokens(text)
  let cursor = 0
  const spans: TextSpan[] = []
  for (const word of words) {
    const candidates: number[] = []
    let at = text.indexOf(word.text, cursor)
    while (word.text.length && at >= 0) {
      const end = at + word.text.length
      if (boundaries.has(at) && boundaries.has(end)
        && !tokens.some((token) => (token.textStart < at && at < token.textEnd) || (token.textStart < end && end < token.textEnd))) candidates.push(at)
      at = text.indexOf(word.text, at + 1)
    }
    const explicit = word.textStart !== undefined || word.textEnd !== undefined
    if (explicit && (word.textStart === undefined || word.textEnd !== word.textStart + word.text.length)) return null
    const start = explicit ? word.textStart! : candidates[0]
    if (start === undefined || !candidates.includes(start)) return null
    spans.push({ text: word.text, textStart: start, textEnd: start + word.text.length })
    cursor = start + word.text.length
  }
  return spans
}
