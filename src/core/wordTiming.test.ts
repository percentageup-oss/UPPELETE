import { describe, expect, it } from 'vitest'
import { captionTokens, graphemeBoundaries, graphemes, locateWordSpans } from './captionText'
import { cuesNeedingWordTiming, estimateMissingWordTimings, estimateWordTimings, retainSafeWordTimings, untimedTokenCount } from './wordTiming'
import { cueSchema, createProject, projectSchema, type CaptionWord, type Cue } from './model'
import { applyCaptionCommand } from './captionCommands'

const words = (text: string): CaptionWord[] => captionTokens(text).map((token, index) => ({ ...token, id: `w${index}`, startUs: 100 + index * 100, endUs: 180 + index * 100, timingSource: 'aligned', needsReview: false }))
const cue = (text: string): Cue => ({ id: 'c', text, startUs: 0, endUs: 10_000, words: words(text), textSource: 'model', timingSource: 'model', needsReview: false })

describe('safe word identities through corrections', () => {
  it.each([
    ['one two three', 'one new two three', ['w0', 'w1', 'w2']],
    ['one two three', 'one three', ['w0', 'w2']],
    ['one two three', 'one new three', ['w0', 'w2']],
    ['one two three four', 'one third three fourth', ['w0', 'w2']],
    ['go go home', 'go home', ['w2']],
    ['go home', 'go go home', ['w1']],
    ['go go home', 'go now go home', ['w2']],
    ['go go home', 'go, go home!', ['w0', 'w1', 'w2']],
    ['one two three', 'two one three', ['w2']],
  ])('%s → %s retains only safe matches', (before, after, ids) => {
    const original = words(before)
    const result = retainSafeWordTimings(original, before, after)
    expect(result.map((word) => word.id)).toEqual(ids)
    for (const word of result) {
      expect(word).toMatchObject({ ...original.find((item) => item.id === word.id)!, textStart: word.textStart, textEnd: word.textEnd })
      expect(after.slice(word.textStart, word.textEnd)).toBe(word.text)
    }
  })

  it('retains partial timings through a second edit, without reattaching removed IDs', () => {
    const initial = cue('one two three')
    const first = applyCaptionCommand({ ...createProject(), cues: [initial] }, { type: 'update-text', cueId: 'c', text: 'one new three' })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const second = applyCaptionCommand(first.project, { type: 'update-text', cueId: 'c', text: 'one newer three!' })
    if (!second.ok) throw new Error('Correction failed')
    expect(second.project.cues[0].words.map((word) => word.id)).toEqual(['w0', 'w2'])
    expect(untimedTokenCount(second.project.cues[0])).toBe(1)
    expect(second.project.cues[0]).toMatchObject({ textSource: 'user', needsReview: true, startUs: 0, endUs: 10_000 })
    expect(projectSchema.parse(second.project)).toEqual(second.project)
  })

  it('drops ambiguous partial legacy repeated-word timings', () => {
    const partial = [{ id: 'second-go', text: 'go', startUs: 300, endUs: 400, timingSource: 'aligned' as const, needsReview: false }]
    expect(retainSafeWordTimings(partial, 'go go', 'go, go')).toEqual([])
    expect(retainSafeWordTimings([{ ...partial[0], textStart: 3, textEnd: 5 }], 'go go', 'go, go')[0]).toMatchObject({ id: 'second-go', textStart: 4, startUs: 300 })
  })

  it('preserves Malayalam combining marks, conjuncts and mixed English text exactly', () => {
    const before = 'ഞാൻ React പഠിക്കുന്നു കൈ കൊ ക്\u200dഷേ';
    const after = 'ഞാൻ, React പഠിക്കുന്നു! കൈ കൊ ക്\u200dഷേ';
    const result = retainSafeWordTimings(words(before), before, after)
    expect(result.map((word) => word.id)).toEqual(words(before).map((word) => word.id))
    const boundaries = graphemeBoundaries(after)
    for (const word of result) {
      expect(boundaries.has(word.textStart!)).toBe(true)
      expect(boundaries.has(word.textEnd!)).toBe(true)
      expect(after.slice(word.textStart, word.textEnd)).toBe(word.text)
    }
    const changed = retainSafeWordTimings(words('ക React'), 'ക React', 'കി React')
    expect(changed.map((word) => word.text)).toEqual(['React'])
    expect(graphemes('കൊ')).toEqual(['കൊ'])
  })

  it('rejects substrings and split Malayalam vowel clusters as word evidence', () => {
    expect(locateWordSpans('കി React', [{ text: 'ക' }])).toBeNull()
    expect(locateWordSpans('React', [{ text: 'act' }])).toBeNull()
    expect(locateWordSpans('“React!”', [{ text: 'React!' }])).toEqual([{ text: 'React!', textStart: 1, textEnd: 7 }])
  })
})

describe('explicit estimates and schema boundaries', () => {
  it('uses absolute integer fractions with a final exact boundary even near MAX_SAFE_INTEGER', () => {
    let id = 0
    const startUs = Number.MAX_SAFE_INTEGER - 1_000_001, endUs = Number.MAX_SAFE_INTEGER
    const estimated = estimateWordTimings({ text: 'കി React മലയാളം', startUs, endUs }, () => `e${++id}`)
    expect(estimated[0].startUs).toBe(startUs)
    expect(estimated.at(-1)!.endUs).toBe(endUs)
    expect(estimated.every((word) => Number.isSafeInteger(word.endUs) && word.endUs > word.startUs && word.needsReview && word.timingSource === 'estimated')).toBe(true)
    expect(estimated.map((word) => word.id)).toEqual(['e1', 'e2', 'e3'])
    expect(() => estimateWordTimings({ text: 'one two', startUs: 0, endUs: 1 }, () => 'e')).toThrow('too short')
  })

  it('reserves a readable final hold for progressive reveal estimates', () => {
    let id = 0
    const estimated = estimateWordTimings({ text: 'one two three', startUs: 1_000_000, endUs: 5_000_000 }, () => `h${++id}`)
    expect(estimated.at(-1)?.endUs).toBe(5_000_000)
    expect(5_000_000 - estimated.at(-1)!.startUs).toBeGreaterThanOrEqual(600_000)
    expect(estimated.every((word) => word.timingSource === 'estimated' && word.needsReview)).toBe(true)
  })

  it('rejects unsafe, uncontained, overlapping, duplicate and text-mismatched word records', () => {
    const valid = cue('one two')
    expect(cueSchema.safeParse(valid).success).toBe(true)
    for (const patch of [
      { startUs: -1 }, { endUs: 10_001 }, { endUs: Number.MAX_SAFE_INTEGER + 1 },
      { endUs: 100 }, { text: 'on' }, { textStart: 1 },
    ]) expect(cueSchema.safeParse({ ...valid, words: [{ ...valid.words[0], ...patch }] }).success).toBe(false)
    expect(cueSchema.safeParse({ ...valid, words: [valid.words[0], { ...valid.words[1], startUs: 170 }] }).success).toBe(false)
    expect(cueSchema.safeParse({ ...valid, words: [valid.words[0], { ...valid.words[1], id: 'w0' }] }).success).toBe(false)
    const duplicate = { ...valid, id: 'other', words: [valid.words[0]] }
    expect(projectSchema.safeParse({ ...createProject(), cues: [valid, duplicate] }).success).toBe(false)
  })
})

describe('filling in only the missing word timing', () => {
  it('estimates the whole cue when it has no word timing at all, same as a full estimate', () => {
    const draft = { text: 'one two three', startUs: 0, endUs: 10_000, words: [] }
    let firstId = 0, secondId = 0
    expect(estimateMissingWordTimings(draft, () => `e${++firstId}`)).toEqual(estimateWordTimings(draft, () => `e${++secondId}`))
  })

  it('fills only a middle gap, leaving kept words’ id and timing source untouched', () => {
    const text = 'one two three four'
    const tokens = captionTokens(text)
    const kept: CaptionWord[] = [
      { ...tokens[0], id: 'k0', startUs: 0, endUs: 1_000, timingSource: 'model', needsReview: false },
      { ...tokens[3], id: 'k3', startUs: 4_000, endUs: 5_000, timingSource: 'model', needsReview: false },
    ]
    const draft = { text, startUs: 0, endUs: 5_000, words: kept }
    const result = estimateMissingWordTimings(draft, (() => { let n = 0; return () => `g${++n}` })())
    expect(result.map((word) => word.id)).toEqual(['k0', 'g1', 'g2', 'k3'])
    expect(result[0]).toMatchObject({ id: 'k0', startUs: 0, endUs: 1_000, timingSource: 'model' })
    expect(result[3]).toMatchObject({ id: 'k3', startUs: 4_000, endUs: 5_000, timingSource: 'model' })
    expect(result[1].timingSource).toBe('estimated')
    expect(result[1].needsReview).toBe(true)
    expect(result[2].timingSource).toBe('estimated')
    expect(result[1].startUs).toBeGreaterThanOrEqual(1_000)
    expect(result[2].endUs).toBeLessThanOrEqual(4_000)
    for (const word of result) expect(text.slice(word.textStart, word.textEnd)).toBe(word.text)
    expect(locateWordSpans(text, result)).not.toBeNull()
  })

  it('fills a leading gap before the first kept word', () => {
    const text = 'one two'
    const tokens = captionTokens(text)
    const kept: CaptionWord[] = [{ ...tokens[1], id: 'k1', startUs: 500, endUs: 1_000, timingSource: 'aligned', needsReview: false }]
    const draft = { text, startUs: 0, endUs: 1_000, words: kept }
    const result = estimateMissingWordTimings(draft, () => 'g0')
    expect(result.map((word) => word.id)).toEqual(['g0', 'k1'])
    expect(result[0].startUs).toBe(0)
    expect(result[0].endUs).toBeLessThanOrEqual(500)
  })

  it('fills a trailing gap after the last kept word', () => {
    const text = 'one two'
    const tokens = captionTokens(text)
    const kept: CaptionWord[] = [{ ...tokens[0], id: 'k0', startUs: 0, endUs: 500, timingSource: 'aligned', needsReview: false }]
    const draft = { text, startUs: 0, endUs: 1_000, words: kept }
    const result = estimateMissingWordTimings(draft, () => 'g0')
    expect(result.map((word) => word.id)).toEqual(['k0', 'g0'])
    expect(result[1].endUs).toBe(1_000)
  })

  it('throws when a gap is too short to hold positive-duration estimates for its tokens', () => {
    const text = 'one two three four'
    const tokens = captionTokens(text)
    // The middle gap ("two three", 2 tokens) spans only 1 µs — too short for a positive-duration
    // estimate per token.
    const kept: CaptionWord[] = [
      { ...tokens[0], id: 'k0', startUs: 0, endUs: 0, timingSource: 'model', needsReview: false },
      { ...tokens[3], id: 'k3', startUs: 1, endUs: 2, timingSource: 'model', needsReview: false },
    ]
    const draft = { text, startUs: 0, endUs: 2, words: kept }
    expect(() => estimateMissingWordTimings(draft, () => 'g')).toThrow('too short')
  })
})

describe('cuesNeedingWordTiming', () => {
  it('selects only cues with word-worthy tokens that are not fully timed', () => {
    const timed = cue('one two three')
    const untimed: Cue = { ...cue('four five'), id: 'untimed', words: [] }
    const empty: Cue = { ...cue(''), id: 'empty', words: [] }
    expect(cuesNeedingWordTiming([timed, untimed, empty]).map((item) => item.id)).toEqual(['untimed'])
  })
})
