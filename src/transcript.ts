import { captionTokens, locateWordSpans, type TextSpan } from './core/captionText'
import type { CaptionWord, Cue } from './core/model'
import type { CaptionCommand } from './core/captionCommands'

/** One clickable unit in the transcript panel: a timed word, or a plain text token that has none. */
export type TranscriptSpan = TextSpan & { word: CaptionWord | null }

/**
 * Every caption token is clickable, whether or not it carries word timing. `locateWordSpans`
 * places the cue's timed words (including legacy punctuation-bearing/multi-token entries); any
 * `captionTokens` token none of those spans cover is added untimed (`word: null`). This is what
 * lets a freshly typed or newly added caption — which starts with `words: []` — still open the
 * word menu for text-only actions (emphasize, edit, new line, delete) immediately.
 */
export function transcriptSpans(cue: Cue): TranscriptSpan[] {
  const wordSpans = locateWordSpans(cue.text, cue.words) ?? []
  const timed: TranscriptSpan[] = wordSpans.map((span, index) => ({ ...span, word: cue.words[index] }))
  const covered = (start: number, end: number) => timed.some((span) => span.textStart < end && span.textEnd > start)
  const untimed: TranscriptSpan[] = captionTokens(cue.text)
    .filter((token) => !covered(token.textStart, token.textEnd))
    .map((token) => ({ ...token, word: null }))
  return [...timed, ...untimed].sort((a, b) => a.textStart - b.textStart)
}

export type WordActionType = 'emphasis' | 'line-break' | 'split' | 'next' | 'previous' | 'delete'

/**
 * Which word-menu actions are usable for the clicked span. Emphasize, Edit and Delete never depend
 * on timing. New line only needs a preceding token. Split / Previous line / Next line move a cue
 * boundary, so they read the word's own timing and are unavailable for an untimed token; their
 * bounds come from the word's index in `cue.words`, not from the span's position among all tokens.
 */
export function wordMenuAvailability(cue: Cue, spans: readonly TranscriptSpan[], spanIndex: number, cueIndex: number) {
  const word = spans[spanIndex]?.word ?? null
  const wordIndex = word ? cue.words.findIndex((entry) => entry.id === word.id) : -1
  return {
    lineBreak: spanIndex > 0,
    split: wordIndex > 0,
    previous: wordIndex > 0 && cueIndex > 0,
    next: wordIndex >= 0 && wordIndex < cue.words.length - 1,
    timed: word !== null,
  }
}

/**
 * The command for a word-menu action, or `null` when the action needs word timing the span lacks.
 * Text-only actions address the token by its offset from `locateWordSpans`/`captionTokens` — never a
 * legacy word's optional `textStart`, which would silently emphasize the first token instead.
 */
export function wordActionCommand(cueId: string, type: WordActionType, span: TranscriptSpan, newId: () => string): CaptionCommand | null {
  const target = span.word ? { wordId: span.word.id } : { textStart: span.textStart }
  if (type === 'emphasis') return { type: 'toggle-emphasis', cueId, textStart: span.textStart }
  if (type === 'line-break') return { type: 'line-break-before-word', cueId, target }
  if (type === 'delete') return { type: 'delete-word', cueId, target }
  if (!span.word) return null
  if (type === 'split') return { type: 'split-before-word', cueId, wordId: span.word.id, rightCueId: newId() }
  if (type === 'next') return { type: 'move-from-word-to-next', cueId, wordId: span.word.id }
  return { type: 'move-through-word-to-previous', cueId, wordId: span.word.id }
}
