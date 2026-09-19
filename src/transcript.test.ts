import { describe, expect, it } from 'vitest'
import type { Cue } from './core/model'
import { interactiveTranscriptSpans } from './transcript'

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

describe('interactiveTranscriptSpans', () => {
  it('falls back to the authoritative text for imported cues without word timing', () => {
    expect(interactiveTranscriptSpans(imported)).toBeNull()
  })

  it('exposes whole word spans when word entries exist', () => {
    const word = 'ഇൻകം'
    const cue: Cue = {
      ...imported,
      words: [{ id: 'word-1', text: word, startUs: 0, endUs: 1_000_000,
        timingSource: 'manual', needsReview: false, textStart: 0, textEnd: word.length }],
    }
    expect(interactiveTranscriptSpans(cue)).toEqual([{ text: word, textStart: 0, textEnd: word.length }])
  })
})
