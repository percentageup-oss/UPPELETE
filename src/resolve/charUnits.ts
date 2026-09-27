import { graphemes, graphemeBoundaries } from '../core/captionText'

/**
 * Character-counting units a Text+ range boundary could conceivably use. **No unit is confirmed by the spike**
 * (ADR 0008/0009: Character Level Styling's data format and counting unit are both "no data" / unconfirmed) — this
 * type exists for the day that changes, not because KathaCut currently writes ranges in any of them.
 */
export type CharUnit = 'codepoint' | 'utf8byte' | 'grapheme'

/** Count of whole `unit`s in `text` from its start up to the UTF-16 index `utf16Index`. Never call this with an
 * index that doesn't land on a grapheme boundary of `text` — a Text+ range must never split a Malayalam conjunct
 * or vowel-sign cluster (AGENTS.md); check with `isGraphemeBoundary` first. */
export function offsetInUnit(text: string, utf16Index: number, unit: CharUnit): number {
  const slice = text.slice(0, utf16Index)
  if (unit === 'grapheme') return graphemes(slice).length
  if (unit === 'codepoint') return [...slice].length
  return new TextEncoder().encode(slice).length
}

export function isGraphemeBoundary(text: string, utf16Index: number): boolean {
  return graphemeBoundaries(text).has(utf16Index)
}

export type WordRange = { wordIndex: number; start: number; end: number }

/**
 * Locates each word's `[start, end)` UTF-16 range inside `specText` — the text actually sent to Text+, which may
 * differ from the cue's own text after line-wrap ('\n' replacing whatever whitespace/line-break separated the
 * words) and after `transform` (KathaCut's export-side `textTransform`, applied per word here the same way
 * `applyTextTransform` applies it to the whole string). Words are matched **strictly in order** — a repeated word
 * is never matched to an earlier occurrence — so this doubles as the disambiguation `words[].textStart/textEnd`
 * gives for the original cue text (those offsets aren't valid in `specText` once transform/wrap have run, so they
 * aren't reused directly; matching in cue order reconstructs the same disambiguation).
 *
 * A word that can't be found verbatim (a transform that changes a grapheme's length, e.g. `ß` → `SS`) or whose
 * match doesn't land on a grapheme boundary at both ends is **dropped**, never partially placed — never split a
 * grapheme cluster.
 */
export function wordRanges(
  words: readonly { text: string }[],
  specText: string,
  transform: (word: string) => string,
): { ranges: WordRange[]; dropped: number[] } {
  const boundaries = graphemeBoundaries(specText)
  const ranges: WordRange[] = []
  const dropped: number[] = []
  let cursor = 0
  words.forEach((word, wordIndex) => {
    const needle = transform(word.text)
    const at = needle.length ? specText.indexOf(needle, cursor) : -1
    const end = at + needle.length
    if (at < 0 || !boundaries.has(at) || !boundaries.has(end)) { dropped.push(wordIndex); return }
    ranges.push({ wordIndex, start: at, end })
    cursor = end
  })
  return { ranges, dropped }
}
