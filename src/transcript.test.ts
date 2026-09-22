import { describe, expect, it } from 'vitest'
import type { Cue } from './core/model'
import { transcriptSpans, wordActionCommand, wordMenuAvailability } from './transcript'

const imported: Cue = {
  id: 'imported',
  text: 'ഇൻകം ടാക്സ് English',
  startUs: 0,
  endUs: 2_000_000,
  words: [],
  timingSource: 'imported',
  textSource: 'imported',
  needsReview: false,
}

describe('transcriptSpans', () => {
  it('exposes every caption token as an untimed, clickable span when a cue has no word timing', () => {
    const spans = transcriptSpans(imported)
    expect(spans.every((span) => span.word === null)).toBe(true)
    expect(spans.map((span) => span.text)).toEqual(['ഇൻകം', 'ടാക്സ്', 'English'])
    // Malayalam grapheme clusters (conjuncts/vowel marks) stay whole, matching captionTokens.
    expect(spans[0]).toEqual({ text: 'ഇൻകം', textStart: 0, textEnd: 4, word: null })
  })

  it('returns no spans for an empty caption', () => {
    expect(transcriptSpans({ ...imported, text: '' })).toEqual([])
  })

  it('attaches the timed word when word entries exist', () => {
    const word = 'ഇൻകം'
    const cue: Cue = {
      ...imported,
      words: [{ id: 'word-1', text: word, startUs: 0, endUs: 1_000_000,
        timingSource: 'manual', needsReview: false, textStart: 0, textEnd: word.length }],
    }
    const spans = transcriptSpans(cue)
    expect(spans).toHaveLength(3)
    expect(spans[0]).toEqual({ text: word, textStart: 0, textEnd: word.length, word: cue.words[0] })
    expect(spans[1].word).toBeNull()
    expect(spans[2].word).toBeNull()
  })

  it('merges timed and untimed spans in text order for a partially-timed cue', () => {
    const text = 'one two three'
    const cue: Cue = {
      ...imported,
      text,
      words: [{ id: 'w2', text: 'two', startUs: 0, endUs: 1_000_000,
        timingSource: 'manual', needsReview: false, textStart: 4, textEnd: 7 }],
    }
    const spans = transcriptSpans(cue)
    expect(spans.map((span) => [span.text, span.word !== null])).toEqual([
      ['one', false],
      ['two', true],
      ['three', false],
    ])
  })
})

const timedCue = (): Cue => {
  const text = 'one two three'
  return {
    ...imported,
    text,
    words: [
      { id: 'w0', text: 'one', startUs: 0, endUs: 500_000, timingSource: 'model', needsReview: false, textStart: 0, textEnd: 3 },
      { id: 'w1', text: 'two', startUs: 500_000, endUs: 1_000_000, timingSource: 'model', needsReview: false, textStart: 4, textEnd: 7 },
      { id: 'w2', text: 'three', startUs: 1_000_000, endUs: 1_500_000, timingSource: 'model', needsReview: false, textStart: 8, textEnd: 13 },
    ],
  }
}

describe('wordMenuAvailability', () => {
  it('enables only the text-only actions that can run for an untimed token', () => {
    const cue: Cue = { ...imported, text: 'one two three' }
    const spans = transcriptSpans(cue)
    expect(wordMenuAvailability(cue, spans, 1, 3)).toEqual({ lineBreak: true, split: false, previous: false, next: false, timed: false })
    // A line break needs a preceding token, so the first word cannot start one.
    expect(wordMenuAvailability(cue, spans, 0, 3).lineBreak).toBe(false)
  })

  it('enables boundary-moving actions for timed words, by their index in the word list', () => {
    const cue = timedCue()
    const spans = transcriptSpans(cue)
    expect(wordMenuAvailability(cue, spans, 1, 2)).toEqual({ lineBreak: true, split: true, previous: true, next: true, timed: true })
    expect(wordMenuAvailability(cue, spans, 0, 2)).toMatchObject({ split: false, previous: false })
    expect(wordMenuAvailability(cue, spans, 2, 2)).toMatchObject({ next: false })
    // Previous line needs an earlier caption to move into.
    expect(wordMenuAvailability(cue, spans, 1, 0).previous).toBe(false)
  })

  it('bounds timed actions by the word list when only some tokens are timed', () => {
    const cue: Cue = { ...timedCue(), words: [timedCue().words[1]] } // only "two" is timed
    const spans = transcriptSpans(cue)
    // "two" is the sole timed word: nothing to split before or move past, though it is the 2nd token.
    expect(wordMenuAvailability(cue, spans, 1, 2)).toEqual({ lineBreak: true, split: false, previous: false, next: false, timed: true })
  })
})

describe('wordActionCommand', () => {
  const ids = () => 'new-id'

  it('emphasizes by the span offset, not a legacy word’s missing textStart', () => {
    // A schema-2 word with no textStart used to emphasize the first token (`textStart ?? 0`).
    const cue: Cue = { ...timedCue(), words: timedCue().words.map(({ textStart: _s, textEnd: _e, ...word }) => word) }
    const spans = transcriptSpans(cue)
    expect(spans[2].word).not.toBeNull()
    expect(wordActionCommand('c', 'emphasis', spans[2], ids)).toEqual({ type: 'toggle-emphasis', cueId: 'c', textStart: 8 })
  })

  it('addresses text-only actions by offset for an untimed token and by word id for a timed one', () => {
    const untimed = transcriptSpans({ ...imported, text: 'one two' })[1]
    expect(wordActionCommand('c', 'delete', untimed, ids)).toEqual({ type: 'delete-word', cueId: 'c', target: { textStart: 4 } })
    expect(wordActionCommand('c', 'line-break', untimed, ids)).toEqual({ type: 'line-break-before-word', cueId: 'c', target: { textStart: 4 } })
    const timed = transcriptSpans(timedCue())[1]
    expect(wordActionCommand('c', 'delete', timed, ids)).toEqual({ type: 'delete-word', cueId: 'c', target: { wordId: 'w1' } })
  })

  it('needs timing for split/next/previous: null for an untimed token, a word-id command otherwise', () => {
    const untimed = transcriptSpans({ ...imported, text: 'one two' })[1]
    for (const type of ['split', 'next', 'previous'] as const) expect(wordActionCommand('c', type, untimed, ids)).toBeNull()
    const timed = transcriptSpans(timedCue())[1]
    expect(wordActionCommand('c', 'split', timed, ids)).toEqual({ type: 'split-before-word', cueId: 'c', wordId: 'w1', rightCueId: 'new-id' })
    expect(wordActionCommand('c', 'next', timed, ids)).toEqual({ type: 'move-from-word-to-next', cueId: 'c', wordId: 'w1' })
    expect(wordActionCommand('c', 'previous', timed, ids)).toEqual({ type: 'move-through-word-to-previous', cueId: 'c', wordId: 'w1' })
  })
})
