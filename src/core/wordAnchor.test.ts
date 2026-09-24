import { describe, expect, it } from 'vitest'
import type { CaptionSummary } from './agentProtocol'
import { resolveWordAnchor } from './wordAnchor'

const word = (id: string, text: string, startUs: number, endUs: number, timingSource: 'model' | 'aligned' | 'manual' | 'estimated' = 'aligned') => ({ id, text, startUs, endUs, timingSource })
const cue = (id: string, startUs: number, endUs: number, words: ReturnType<typeof word>[]): CaptionSummary =>
  ({ id, mediaAssetId: 'v', startUs, endUs, text: words.map((entry) => entry.text).join(' '), timingSource: 'aligned', needsReview: false, words })

const cues = [
  cue('c1', 0, 3_000_000, [word('a', 'Back', 0, 400_000), word('b', 'in', 400_000, 600_000), word('c', 'the', 600_000, 800_000), word('d', 'day,', 800_000, 1_400_000)]),
  cue('c2', 3_000_000, 6_000_000, [word('e', 'We', 3_000_000, 3_300_000), word('f', 'played', 3_300_000, 3_900_000, 'estimated'), word('g', 'the', 3_900_000, 4_100_000), word('h', 'day', 4_100_000, 4_600_000)]),
]

describe('resolveWordAnchor', () => {
  it('finds a single word ignoring case and surrounding punctuation', () => {
    const found = resolveWordAnchor(cues, { text: 'DAY' })
    expect(found).toMatchObject({ cueId: 'c1', startUs: 800_000, endUs: 1_400_000, matchedText: 'day,', estimated: false, totalMatches: 2 })
  })

  it('picks the requested occurrence', () => {
    expect(resolveWordAnchor(cues, { text: 'day', occurrence: 2 })).toMatchObject({ cueId: 'c2', startUs: 4_100_000 })
    expect(() => resolveWordAnchor(cues, { text: 'day', occurrence: 3 })).toThrow(/occurs 2/)
  })

  it('matches a phrase across words and spans its first start to its last end', () => {
    expect(resolveWordAnchor(cues, { text: 'back in the day' })).toMatchObject({ startUs: 0, endUs: 1_400_000, matchedText: 'Back in the day,', totalMatches: 1 })
  })

  it('flags estimated timing instead of presenting it as aligned', () => {
    expect(resolveWordAnchor(cues, { text: 'played' }).estimated).toBe(true)
    expect(resolveWordAnchor(cues, { text: 'the day', occurrence: 2 }).estimated).toBe(false)
  })

  it('resolves by cue id and word index, with an optional word count', () => {
    expect(resolveWordAnchor(cues, { cueId: 'c2', wordIndex: 1, wordCount: 2 })).toMatchObject({ startUs: 3_300_000, endUs: 4_100_000 })
    expect(() => resolveWordAnchor(cues, { cueId: 'c2', wordIndex: 3, wordCount: 2 })).toThrow(/out of range/)
    expect(() => resolveWordAnchor(cues, { cueId: 'missing', wordIndex: 0 })).toThrow(/No cue/)
  })

  it('reports a missing word and missing word timing', () => {
    expect(() => resolveWordAnchor(cues, { text: 'spaceship' })).toThrow(/not found/)
    expect(() => resolveWordAnchor(cues, { text: '   ' })).toThrow(/empty/)
    expect(() => resolveWordAnchor([{ ...cues[0], words: undefined }], { text: 'day' })).toThrow(/words: true/)
  })

  it('compares Malayalam words whole, without splitting vowel signs from their clusters', () => {
    const ml = [cue('m1', 0, 2_000_000, [word('x', 'കേരളം', 0, 700_000), word('y', 'ഇന്ന്', 700_000, 1_200_000)])]
    expect(resolveWordAnchor(ml, { text: 'കേരളം' })).toMatchObject({ startUs: 0, endUs: 700_000 })
    expect(() => resolveWordAnchor(ml, { text: 'കേര' })).toThrow(/not found/)
    // a decomposed spelling still matches the composed one (NFC)
    expect(resolveWordAnchor(ml, { text: 'കേരളം'.normalize('NFD') }).cueId).toBe('m1')
  })
})
