import type { CaptionWord, Cue } from './model'
import { captionTokens, graphemes, locateWordSpans } from './captionText'

/** Estimates are opt-in for imported/edited captions. Absolute fractions prevent accumulated rounding drift. */
export function estimateWordTimings(cue: Pick<Cue, 'text' | 'startUs' | 'endUs'>, newId: () => string): CaptionWord[] {
  const tokens = captionTokens(cue.text)
  const duration = cue.endUs - cue.startUs
  if (!Number.isSafeInteger(cue.startUs) || cue.startUs < 0 || !Number.isSafeInteger(cue.endUs) || duration <= 0) throw new Error('Invalid source microsecond range.')
  if (duration < tokens.length) throw new Error('Caption is too short to assign positive word estimates.')
  if (!tokens.length) return []
  const weights = tokens.map((token) => graphemes(token.text).length)
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  // Leave the final estimated token visibly held at the end of the cue. Estimates remain
  // explicitly review-required and are never presented as audio alignment.
  const finalHoldUs = Math.min(600_000, Math.floor(duration * 0.2), duration - tokens.length)
  const revealDurationUs = duration - finalHoldUs
  let consumed = 0
  // Reserve one µs per token, distribute start edges over the reveal period by grapheme weight.
  const edge = (index: number) => cue.startUs + index + Number(BigInt(revealDurationUs - tokens.length) * BigInt(consumed) / BigInt(total))
  return tokens.map((token, index) => {
    const startUs = edge(index)
    consumed += weights[index]
    return { ...token, id: newId(), startUs, endUs: index === tokens.length - 1 ? cue.endUs : edge(index + 1), timingSource: 'estimated', needsReview: true }
  })
}

/**
 * Retain only exact, unambiguous lexical matches in unchanged order. Repeated tokens are
 * retained positionally only if the entire lexical sequence is unchanged (punctuation edits).
 * Partial legacy lists with repeated text cannot identify an occurrence and are discarded.
 * Inserted/replaced/ambiguous words stay untimed; we never silently manufacture alignment.
 */
export function retainSafeWordTimings(words: readonly CaptionWord[], previousText: string, nextText: string): CaptionWord[] {
  if (previousText === nextText) return [...words]
  const before = captionTokens(previousText)
  const after = captionTokens(nextText)
  const spans = locateWordSpans(previousText, words)
  if (!spans) return []
  const sameSequence = before.length === after.length && before.every((token, index) => token.text === after[index].text)
  const counts = (tokens: typeof before) => {
    const map = new Map<string, number>()
    for (const token of tokens) map.set(token.text, (map.get(token.text) ?? 0) + 1)
    return map
  }
  const oldCounts = counts(before), newCounts = counts(after)
  const candidates = words.flatMap((word, index) => {
    const span = spans[index]
    const tokenIndex = before.findIndex((token) => token.textStart === span.textStart && token.textEnd === span.textEnd)
    if (tokenIndex < 0) return [] // punctuation-bearing/multi-token legacy words are deliberately conservative
    const repeated = oldCounts.get(word.text)! > 1 || (newCounts.get(word.text) ?? 0) > 1
    if (repeated && (!sameSequence || (word.textStart === undefined && words.length !== before.length))) return []
    const nextIndex = sameSequence ? tokenIndex : after.findIndex((token) => token.text === word.text)
    if (nextIndex < 0) return []
    return [{ word, oldIndex: tokenIndex, nextIndex }]
  })
  // Crossing matches indicate reordered words; neither can safely inherit audio timing.
  return candidates.filter((candidate) => !candidates.some((other) =>
    (candidate.oldIndex - other.oldIndex) * (candidate.nextIndex - other.nextIndex) < 0))
    .map(({ word, nextIndex }) => ({ ...word, ...after[nextIndex] }))
}

export function untimedTokenCount(cue: Pick<Cue, 'text' | 'words'>): number {
  const spans = locateWordSpans(cue.text, cue.words) ?? []
  return captionTokens(cue.text).filter((token) => !spans.some((span) => span.textStart <= token.textStart && span.textEnd >= token.textEnd)).length
}

/**
 * Fills in timing only where none exists, leaving every already-timed word untouched — unlike
 * `estimateWordTimings`, which replaces a cue's whole word list. An empty `words` list is simply
 * the full-cue estimate. Otherwise each maximal run of untimed tokens between two kept words (or a
 * cue boundary) is estimated over its own bounded window, and the run's offsets are shifted back
 * into the cue's text. Existing words keep their id/timing/provenance; only the new words are
 * `estimated`/`needsReview`. Throws (same message as `estimateWordTimings`) if a gap is too short
 * to hold positive-duration estimates for the tokens inside it.
 */
export function estimateMissingWordTimings(cue: Pick<Cue, 'text' | 'startUs' | 'endUs' | 'words'>, newId: () => string): CaptionWord[] {
  if (!cue.words.length) return estimateWordTimings(cue, newId)
  const spans = locateWordSpans(cue.text, cue.words)
  if (!spans) throw new Error('Word timing no longer matches the caption text.')
  const tokens = captionTokens(cue.text)
  const kept = cue.words.map((word, index) => ({ word, span: spans[index] }))
  const result: CaptionWord[] = []
  let cursor = 0, cursorUs = cue.startUs
  const fillGap = (untimedEnd: number, boundaryUs: number) => {
    if (cursor >= untimedEnd) return
    const runTokens = tokens.filter((token) => token.textStart >= cursor && token.textEnd <= untimedEnd)
    if (!runTokens.length) return
    const runStart = runTokens[0].textStart, runEnd = runTokens.at(-1)!.textEnd
    const estimated = estimateWordTimings({ text: cue.text.slice(runStart, runEnd), startUs: cursorUs, endUs: boundaryUs }, newId)
    result.push(...estimated.map((word) => ({ ...word, textStart: word.textStart! + runStart, textEnd: word.textEnd! + runStart })))
  }
  for (const { word, span } of kept) {
    fillGap(span.textStart, word.startUs)
    result.push({ ...word, textStart: span.textStart, textEnd: span.textEnd })
    cursor = span.textEnd
    cursorUs = word.endUs
  }
  fillGap(cue.text.length, cue.endUs)
  return result.sort((a, b) => a.startUs - b.startUs)
}

/** Cues that have at least one word-worthy token with no timing yet — the set `set-display('word')` estimates. */
export function cuesNeedingWordTiming(cues: readonly Cue[]): Cue[] {
  return cues.filter((cue) => captionTokens(cue.text).length > 0 && untimedTokenCount(cue) > 0)
}
