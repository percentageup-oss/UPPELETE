import { captionTokens, type TextSpan } from './captionText'

/** Explicit occurrence offsets: repeated words never inherit another occurrence's emphasis. */
export function sliceEmphasis(spans: readonly TextSpan[] | undefined, start: number, end: number): TextSpan[] {
  return (spans ?? []).filter((span) => span.textStart >= start && span.textEnd <= end)
    .map((span) => ({ ...span, textStart: span.textStart - start, textEnd: span.textEnd - start }))
}

/** Keep exact, unambiguous words after edits; preserve repeated occurrences only for an unchanged lexical sequence. */
export function retainEmphasis(spans: readonly TextSpan[] | undefined, before: string, after: string): TextSpan[] {
  const oldTokens = captionTokens(before), newTokens = captionTokens(after)
  const same = oldTokens.length === newTokens.length && oldTokens.every((token, i) => token.text === newTokens[i].text)
  return (spans ?? []).flatMap((span) => {
    const index = oldTokens.findIndex((token) => token.textStart === span.textStart && token.textEnd === span.textEnd)
    if (same && index >= 0) return [newTokens[index]]
    const candidates = newTokens.filter((token) => token.text === span.text)
    return candidates.length === 1 && oldTokens.filter((token) => token.text === span.text).length === 1 ? candidates : []
  }).sort((a, b) => a.textStart - b.textStart)
}

/** Whole lexical runs and untouched separators. Never split a Malayalam grapheme to animate it. */
export function emphasisRuns(text: string, spans: readonly TextSpan[]) {
  const runs: (TextSpan & { emphasized: boolean; word: boolean })[] = []
  let cursor = 0
  for (const token of captionTokens(text)) {
    if (token.textStart > cursor) runs.push({ text: text.slice(cursor, token.textStart), textStart: cursor, textEnd: token.textStart, emphasized: false, word: false })
    runs.push({ ...token, word: true, emphasized: spans.some((span) => span.textStart === token.textStart && span.textEnd === token.textEnd) })
    cursor = token.textEnd
  }
  if (cursor < text.length) runs.push({ text: text.slice(cursor), textStart: cursor, textEnd: text.length, emphasized: false, word: false })
  return runs
}
