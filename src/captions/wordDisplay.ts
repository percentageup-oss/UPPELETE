import { z } from 'zod'
import { sliceEmphasis } from '../core/emphasis'
import { locateWordSpans } from '../core/captionText'
import { wordMotionAvailability, type MotionCue } from './renderer'

export const captionDisplaySchema = z.enum(['line', 'word'])
export type CaptionDisplay = z.infer<typeof captionDisplaySchema>

/**
 * Index of the word shown at `timestampUs` under the hold-through-gaps rule, or null when the cue
 * is inactive at this timestamp or its word list cannot drive word display at all (see
 * `wordMotionAvailability` — no words, incomplete/invalid timing, or non-estimated needs-review).
 * Word windows partition `[cue.startUs, cue.endUs)` exactly: word 0's window starts at the cue's
 * own start (folding in any lead-in gap), each word's window ends where the next word's begins
 * (holding it visible through the gap), and the last word's window ends at the cue's end. So
 * whenever the line cue itself is active, exactly one word is shown — never a blank frame.
 */
export function activeWordIndex(cue: MotionCue, timestampUs: number): number | null {
  if (timestampUs < cue.startUs || timestampUs >= cue.endUs) return null
  if (!wordMotionAvailability(cue).enabled) return null
  const words = cue.words!
  for (let index = words.length - 1; index >= 0; index--) {
    if (timestampUs >= (index === 0 ? cue.startUs : words[index].startUs)) return index
  }
  return 0
}

/**
 * Synthetic single-word cue for `wordIndex`, self-contained rather than carrying the original
 * line-relative offsets: `locateWordSpans` treats an explicit `textStart`/`textEnd` as
 * authoritative, so a word copied with its line offsets would fail to locate against its own
 * one-word text and the cue would fail `cueSchema`/`frameRequestSchema`. The chosen text is the
 * word's span in the line — a whole token on grapheme boundaries, never inside another token — so
 * laying it out alone can neither split a Malayalam conjunct/vowel-sign cluster nor cut a shaping
 * run. Timing keeps the hold-through-gap window from `activeWordIndex` so preview and export never
 * show a blank frame mid-cue.
 */
export function wordDisplayCue(cue: MotionCue, wordIndex: number): MotionCue {
  const words = cue.words!
  const spans = locateWordSpans(cue.text, words)!
  const word = words[wordIndex], span = spans[wordIndex]
  const startUs = wordIndex === 0 ? cue.startUs : word.startUs
  const endUs = wordIndex === words.length - 1 ? cue.endUs : words[wordIndex + 1].startUs
  const emphasized = sliceEmphasis(cue.emphasized, span.textStart, span.textEnd)
  return {
    text: span.text,
    startUs, endUs,
    words: [{ ...word, startUs, endUs, textStart: 0, textEnd: span.text.length }],
    emphasized: emphasized.length ? emphasized : undefined,
  }
}

/**
 * Convenience for callers holding a possibly-null active line cue and a display mode: the line cue
 * unchanged in `'line'` display, when there is no cue, or when the cue's words cannot drive word
 * display — rendering never estimates missing timing, that stays an explicit user action (the
 * `set-display`/`estimate-missing-words` commands). Shared by the preview (`CaptionStage`) and
 * export (`frameRequestAt`) so both make the identical choice for a given timestamp.
 */
export function displayCue(cue: MotionCue | null, display: CaptionDisplay, timestampUs: number): MotionCue | null {
  if (!cue || display === 'line') return cue
  const index = activeWordIndex(cue, timestampUs)
  return index === null ? cue : wordDisplayCue(cue, index)
}
