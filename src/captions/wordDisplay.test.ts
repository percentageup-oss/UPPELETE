import { describe, expect, it } from 'vitest'
import { cueSchema } from '../core/model'
import { graphemeBoundaries, locateWordSpans } from '../core/captionText'
import { activeWordIndex, captionDisplaySchema, displayCue, wordDisplayCue } from './wordDisplay'
import type { MotionCue } from './renderer'
import type { CaptionWord } from '../core/model'

// Mixed Malayalam/English text; a fixed 5-token word list with model timing and small gaps between
// words, mirroring the fixture in captions/motion.test.tsx.
const TEXT = 'മലയാളം subtitles ഉപയോഗിച്ച് React API'
const TOKENS = [
  { text: 'മലയാളം', textStart: 0, textEnd: 6 },
  { text: 'subtitles', textStart: 7, textEnd: 16 },
  { text: 'ഉപയോഗിച്ച്', textStart: 17, textEnd: 27 },
  { text: 'React', textStart: 28, textEnd: 33 },
  { text: 'API', textStart: 34, textEnd: 37 },
]
const START_US = 3_600_000_000
const WORD_DURATION = 200_000
const GAP = 50_000
const words: CaptionWord[] = TOKENS.map((token, index) => {
  const startUs = START_US + index * (WORD_DURATION + GAP)
  return { id: `w${index}`, text: token.text, textStart: token.textStart, textEnd: token.textEnd,
    startUs, endUs: startUs + WORD_DURATION, timingSource: 'model', needsReview: false }
})
const END_US = words.at(-1)!.endUs
const LEAD_IN = 100_000
const CUE_START = START_US - LEAD_IN
const CUE: MotionCue = { text: TEXT, startUs: CUE_START, endUs: END_US, words }

describe('captionDisplaySchema', () => {
  it('accepts only line/word', () => {
    expect(captionDisplaySchema.safeParse('word').success).toBe(true)
    expect(captionDisplaySchema.safeParse('line').success).toBe(true)
    expect(captionDisplaySchema.safeParse('phrase').success).toBe(false)
  })
})

describe('activeWordIndex', () => {
  it('is null before the cue starts and at/after its half-open end', () => {
    expect(activeWordIndex(CUE, CUE.startUs - 1)).toBeNull()
    expect(activeWordIndex(CUE, CUE.endUs)).toBeNull()
  })

  it('folds the lead-in gap before the first word into word 0', () => {
    expect(activeWordIndex(CUE, CUE_START)).toBe(0)
    expect(activeWordIndex(CUE, words[0].startUs - 1)).toBe(0)
  })

  it('holds the earlier word through the gap until the next word starts', () => {
    for (const [index, word] of words.entries()) {
      expect(activeWordIndex(CUE, word.startUs)).toBe(index)
      expect(activeWordIndex(CUE, word.endUs - 1)).toBe(index)
      // Held through the trailing gap — except the last word, whose window ends at the cue's own
      // half-open end rather than a following word's start.
      if (index < words.length - 1) expect(activeWordIndex(CUE, word.endUs)).toBe(index)
    }
    expect(activeWordIndex(CUE, words[0].endUs + GAP / 2)).toBe(0)
    expect(activeWordIndex(CUE, words[1].startUs - 1)).toBe(0)
  })

  it('gives the last word the cue’s own end as its window close', () => {
    expect(activeWordIndex(CUE, CUE.endUs - 1)).toBe(words.length - 1)
  })

  it('returns null when the word list cannot drive word display', () => {
    expect(activeWordIndex({ ...CUE, words: [] }, START_US)).toBeNull()
    expect(activeWordIndex({ ...CUE, words: words.slice(0, 3) }, START_US)).toBeNull()
    const stale = words.map((word, index) => index === 2 ? { ...word, needsReview: true } : word)
    expect(activeWordIndex({ ...CUE, words: stale }, START_US)).toBeNull()
  })

  it('allows estimated (but not stale non-estimated) timing to drive word display', () => {
    const estimated = words.map((word) => ({ ...word, timingSource: 'estimated' as const }))
    expect(activeWordIndex({ ...CUE, words: estimated }, START_US)).toBe(0)
  })
})

describe('wordDisplayCue', () => {
  it('partitions [cue.startUs, cue.endUs) exactly across word windows, with no gaps or overlaps', () => {
    const windows = words.map((_, index) => {
      const shown = wordDisplayCue(CUE, index)
      return [shown.startUs, shown.endUs]
    })
    expect(windows[0][0]).toBe(CUE.startUs)
    expect(windows.at(-1)![1]).toBe(CUE.endUs)
    for (let i = 1; i < windows.length; i++) expect(windows[i][0]).toBe(windows[i - 1][1])
  })

  it('produces a self-contained cue whose word offsets are re-based to its own one-word text', () => {
    const shown = wordDisplayCue(CUE, 2)
    expect(shown.text).toBe('ഉപയോഗിച്ച്')
    expect(shown.words).toEqual([{ ...words[2], startUs: shown.startUs, endUs: shown.endUs, textStart: 0, textEnd: shown.text.length }])
    // Re-based, not the line-relative offsets — otherwise locateWordSpans/cueSchema would reject it.
    expect(locateWordSpans(shown.text, shown.words!)).toEqual([{ text: shown.text, textStart: 0, textEnd: shown.text.length }])
    expect(cueSchema.safeParse({ id: 'synthetic', ...shown }).success).toBe(true)
  })

  it('never splits a Malayalam grapheme cluster: every synthetic text is a whole token on grapheme boundaries', () => {
    const boundaries = graphemeBoundaries(TEXT)
    for (const [index, token] of TOKENS.entries()) {
      const shown = wordDisplayCue(CUE, index)
      expect(shown.text).toBe(token.text)
      expect(boundaries.has(token.textStart)).toBe(true)
      expect(boundaries.has(token.textEnd)).toBe(true)
    }
  })

  it('slices emphasis onto the shown word, dropping marks on other words', () => {
    const mark = { text: 'ഉപയോഗിച്ച്', textStart: 17, textEnd: 27 }
    const cue = { ...CUE, emphasized: [mark] }
    expect(wordDisplayCue(cue, 2).emphasized).toEqual([{ text: mark.text, textStart: 0, textEnd: mark.text.length }])
    expect(wordDisplayCue(cue, 0).emphasized).toBeUndefined()
  })
})

describe('displayCue', () => {
  it('returns the cue unchanged for line display, a null cue, or unusable word timing', () => {
    expect(displayCue(null, 'word', START_US)).toBeNull()
    expect(displayCue(CUE, 'line', START_US)).toBe(CUE)
    const noWords = { ...CUE, words: [] }
    expect(displayCue(noWords, 'word', START_US)).toBe(noWords)
  })

  it('returns the single active word for word display', () => {
    const shown = displayCue(CUE, 'word', words[2].startUs + 10_000)
    expect(shown!.text).toBe(words[2].text)
  })

  it('falls back to the line cue outside the cue’s own active range even in word display', () => {
    expect(displayCue(CUE, 'word', CUE.endUs)).toBe(CUE)
  })
})
