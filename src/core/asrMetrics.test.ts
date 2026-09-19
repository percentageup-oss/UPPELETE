import { describe, expect, it } from 'vitest'
import {
  benchmarkTranscript, characterErrorRate, cueDurationStats, detectRepetition, latinTokenRecall, normalizeForComparison, wordErrorRate,
} from './asrMetrics'

describe('normalizeForComparison', () => {
  it('strips punctuation, lowercases and collapses whitespace without touching script', () => {
    expect(normalizeForComparison('  Hello,   World!  ')).toBe('hello world')
    expect(normalizeForComparison('ഇന്ന്, കാലാവസ്ഥ വളരെ നല്ലതാണ്.')).toBe('ഇന്ന് കാലാവസ്ഥ വളരെ നല്ലതാണ്')
  })
})

describe('wordErrorRate', () => {
  it('is zero for an exact match', () => {
    expect(wordErrorRate('the quick brown fox', 'The quick brown fox.')).toMatchObject({ rate: 0, referenceLength: 4, substitutions: 0, deletions: 0, insertions: 0 })
  })

  it('counts one substitution', () => {
    expect(wordErrorRate('the quick brown fox', 'the slow brown fox')).toMatchObject({ rate: 0.25, substitutions: 1, deletions: 0, insertions: 0 })
  })

  it('counts one deletion and one insertion separately', () => {
    // "quick" is dropped and "today" is added; every other word still matches exactly, so the
    // minimal alignment is unambiguously one deletion plus one insertion, not two substitutions.
    expect(wordErrorRate('the quick brown fox jumps', 'the brown fox jumps today')).toMatchObject({ rate: 0.4, substitutions: 0, deletions: 1, insertions: 1 })
  })

  it('returns a null rate for an empty reference rather than dividing by zero', () => {
    expect(wordErrorRate('', 'some output')).toMatchObject({ rate: null, referenceLength: 0 })
  })

  it('scores completely wrong-script output as maximally wrong, not accidentally lenient', () => {
    const result = wordErrorRate('ഇന്ന് കാലാവസ്ഥ നല്ലതാണ്', 'இன்று வானிலை நன்றாக')
    expect(result.rate).toBe(1)
  })
})

describe('characterErrorRate', () => {
  it('is zero for an exact match', () => {
    expect(characterErrorRate('hello world', 'Hello, World!').rate).toBe(0)
  })

  it('never splits a Malayalam vowel sign from its base consonant', () => {
    // 'ക' + U+0D3F (vowel sign I) forms one grapheme cluster ('കി'); a hypothesis missing only
    // the vowel sign must count as exactly one edit, not a spurious multi-character mismatch.
    const reference = 'കി'
    const hypothesis = 'ക' // missing the vowel sign
    const result = characterErrorRate(reference, hypothesis)
    expect(result.substitutions + result.deletions + result.insertions).toBe(1)
  })

  it('returns a null rate for an empty reference', () => {
    expect(characterErrorRate('', 'x').rate).toBe(null)
  })
})

describe('latinTokenRecall', () => {
  it('returns null when the reference has no Latin-script tokens', () => {
    expect(latinTokenRecall('ഇന്ന് കാലാവസ്ഥ നല്ലതാണ്', 'ഇന്ന് കാലാവസ്ഥ')).toEqual({ recall: null, matched: 0, total: 0 })
  })

  it('measures recall of English technical terms mixed into Malayalam speech', () => {
    const reference = 'ഇന്ന് നമ്മൾ ഒരു React component ഉണ്ടാക്കാൻ npm install ഉപയോഗിച്ച് പോകുന്നു'
    const hypothesis = 'ഇന്ന് നമ്മൾ ഒരു react component ഉണ്ടാക്കാൻ ഇൻസ്റ്റാൾ ഉപയോഗിച്ച് പോകുന്നു' // drops "npm" and "install"
    const result = latinTokenRecall(reference, hypothesis)
    expect(result.total).toBe(4) // React, component, npm, install ("React"/"react" fold together, so 4 unique tokens)
    expect(result.matched).toBe(2) // only react, component survive
    expect(result.recall).toBe(0.5)
  })

  it('gives full recall when every Latin token survives', () => {
    expect(latinTokenRecall('use npm install now', 'use npm install now')).toEqual({ recall: 1, matched: 4, total: 4 })
  })
})

describe('detectRepetition', () => {
  it('passes normal varied text', () => {
    expect(detectRepetition(['the quick brown fox', 'jumps over the lazy dog'])).toEqual({ repeated: false, example: null })
  })

  it('flags a word looping within one segment', () => {
    const result = detectRepetition(['no no no no stop'])
    expect(result.repeated).toBe(true)
    expect(result.example).toBe('no')
  })

  it('flags consecutive duplicate segments', () => {
    const result = detectRepetition(['thank you for watching', 'thank you for watching'])
    expect(result.repeated).toBe(true)
  })

  it('does not flag consecutive empty-ish segments as a loop', () => {
    expect(detectRepetition(['', '']).repeated).toBe(false)
  })
})

describe('cueDurationStats', () => {
  it('reports null stats for no segments', () => {
    expect(cueDurationStats([])).toEqual({ count: 0, medianSeconds: null, maxSeconds: null, overThresholdCount: 0 })
  })

  it('computes median/max and flags cues over the threshold', () => {
    const segments = [
      { startUs: 0, endUs: 2_000_000 }, // 2s
      { startUs: 0, endUs: 4_000_000 }, // 4s
      { startUs: 0, endUs: 20_000_000 }, // 20s, over default 7s threshold
    ]
    expect(cueDurationStats(segments)).toEqual({ count: 3, medianSeconds: 4, maxSeconds: 20, overThresholdCount: 1 })
  })
})

describe('benchmarkTranscript', () => {
  it('combines every metric over joined segment text', () => {
    const segments = [
      { startUs: 0, endUs: 2_000_000, text: 'ഇന്ന് നമ്മൾ' },
      { startUs: 2_000_000, endUs: 4_000_000, text: 'React ഉണ്ടാക്കും' },
    ]
    const result = benchmarkTranscript('ഇന്ന് നമ്മൾ React ഉണ്ടാക്കും', segments)
    expect(result.wer.rate).toBe(0)
    expect(result.cer.rate).toBe(0)
    expect(result.latinRecall).toEqual({ recall: 1, matched: 1, total: 1 })
    expect(result.repetition.repeated).toBe(false)
    expect(result.cueDurations.count).toBe(2)
  })
})
