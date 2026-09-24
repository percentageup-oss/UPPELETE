import { describe, expect, it } from 'vitest'
import { applyCaptionCommand, validateCaptions } from './captionCommands'
import { captionTokens } from './captionText'
import { cueSchema, type CaptionProject, type CaptionWord, type Cue } from './model'
import { CAPTION_TEMPLATES } from '../captions/templates'
import { wordMotionAvailability } from '../captions/renderer'

const cue = (id: string, startUs: number, endUs: number, text: string, extra: Partial<Cue> = {}): Cue => ({
  id,
  startUs,
  endUs,
  text,
  timingSource: 'imported',
  needsReview: false,
  textSource: 'imported',
  words: [],
  ...extra,
})

/** Fully-timed words for every token in `text`, model timing, sequential and contained. */
const timedWords = (text: string, idPrefix = 'w'): CaptionWord[] => captionTokens(text).map((token, index) => ({
  ...token, id: `${idPrefix}${index}`, startUs: index * 1_000, endUs: index * 1_000 + 900, timingSource: 'model', needsReview: false,
}))

const project = (...cues: Cue[]): CaptionProject => ({
  schemaVersion: 16,
  tracks: [],
  clips: [],
  assets: [],
  captionTracks: [], blurRegions: [], zoomRegions: [], effects: [], textOverlays: [], markers: [],
  id: 'project',
  title: 'Test',
  cues,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})

describe('caption editing commands', () => {
  it('applies a word-motion template with usable timing and preserves caption overrides', () => {
    const mint = CAPTION_TEMPLATES.find((template) => template.id === 'mint-reveal')!
    const untimed = cue('a', 0, 3_000_000, 'ഒരു mint caption', { motionOverride: { motion: 'word-pop' } })
    const aligned = cue('b', 4_000_000, 5_000_000, 'kept', { words: [
      { id: 'kept-word', text: 'kept', startUs: 4_000_000, endUs: 5_000_000, timingSource: 'aligned', needsReview: false },
    ] })
    const result = applyCaptionCommand(project(untimed, aligned), { type: 'apply-template', style: mint.style, idPrefix: 'mint' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project.captionStyle).toEqual(mint.style)
    expect(result.project.cues[0].motionOverride).toEqual({ motion: 'word-pop' })
    expect(result.project.cues[0].words.length).toBe(3)
    expect(result.project.cues[0].words.every((word) => word.timingSource === 'estimated' && word.needsReview)).toBe(true)
    expect(result.project.cues[0].needsReview).toBe(true)
    expect(wordMotionAvailability(result.project.cues[0]).enabled).toBe(true)
    expect(result.project.cues[1].words).toEqual(aligned.words)
  })

  it('applies Malayalam Gold without changing cue text, timings, or word data', () => {
    const gold = CAPTION_TEMPLATES.find((template) => template.id === 'malayalam-gold')!
    const original = cue('a', 1_000_000, 4_000_000, 'മലയാളം Gold ടൈറ്റിൽ', {
      words: timedWords('മലയാളം Gold ടൈറ്റിൽ', 'gold-').map((word) => ({ ...word, startUs: word.startUs + 1_000_000, endUs: word.endUs + 1_000_000 })),
    })
    const result = applyCaptionCommand(project(original), { type: 'apply-template', style: gold.style, idPrefix: 'gold' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project.captionStyle).toEqual(gold.style)
    expect(result.project.cues[0]).toEqual(original)
  })

  it('makes mixed Malayalam/English corrections authoritative without changing cue timing', () => {
    const original = cue('a', 1_000_000, 4_000_000, 'ഇത് React tutorial ആണ്', {
      words: [
        { id: 'w1', startUs: 1_000_000, endUs: 1_400_000, text: 'ഇത്', timingSource: 'aligned', needsReview: false },
        { id: 'w2', startUs: 1_500_000, endUs: 2_100_000, text: 'React', timingSource: 'aligned', needsReview: false },
        { id: 'w3', startUs: 2_200_000, endUs: 3_100_000, text: 'tutorial', timingSource: 'aligned', needsReview: false },
        { id: 'w4', startUs: 3_200_000, endUs: 3_900_000, text: 'ആണ്', timingSource: 'aligned', needsReview: false },
      ],
    })
    const result = applyCaptionCommand(project(original), { type: 'update-text', cueId: 'a', text: 'ഇത് React guide ആണ്' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project.cues[0]).toMatchObject({ id: 'a', startUs: 1_000_000, endUs: 4_000_000, textSource: 'user', needsReview: true })
    expect(result.project.cues[0].words.map((word) => word.id)).toEqual(['w1', 'w2', 'w4'])
    expect(original.textSource).toBe('imported')
  })

  it('updates timing manually while preserving the stable cue ID', () => {
    const result = applyCaptionCommand(project(cue('a', 1_000_000, 2_000_000, 'hello')), { type: 'update-time', cueId: 'a', startUs: 500_000, endUs: 2_500_000 })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.project.cues[0]).toMatchObject({ id: 'a', startUs: 500_000, endUs: 2_500_000, timingSource: 'manual' })
  })

  it.each([
    [{ startUs: 2_000_000, endUs: 2_000_000 }, 'after'],
    [{ startUs: -1, endUs: 2_000_000 }, 'non-negative'],
    [{ startUs: 1_000_000, endUs: 6_000_000 }, 'media'],
  ])('rejects invalid or out-of-bounds timing %#', (times, message) => {
    const original = project(cue('a', 1_000_000, 2_000_000, 'hello'))
    const result = applyCaptionCommand(original, { type: 'update-time', cueId: 'a', ...times }, { mediaDurationUs: 5_000_000 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.some((error) => error.message.includes(message))).toBe(true)
    expect(original.cues[0].startUs).toBe(1_000_000)
  })

  it('rejects moving a cue boundary across a contained word', () => {
    const original = cue('a', 1_000_000, 3_000_000, 'hello', {
      words: [{ id: 'w1', startUs: 1_200_000, endUs: 2_800_000, text: 'hello', timingSource: 'model', needsReview: false }],
    })
    const result = applyCaptionCommand(project(original), { type: 'update-time', cueId: 'a', startUs: 1_500_000, endUs: 3_000_000 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[0].kind).toBe('word-containment')
  })

  it('adds and deletes cues without changing surviving IDs', () => {
    const initial = project(cue('a', 0, 1_000_000, 'one'))
    const added = applyCaptionCommand(initial, { type: 'add', cue: cue('b', 2_000_000, 3_000_000, 'two', { timingSource: 'manual', textSource: 'user' }) })
    expect(added.ok).toBe(true)
    if (!added.ok) return
    expect(added.selectedId).toBe('b')
    const deleted = applyCaptionCommand(added.project, { type: 'delete', cueId: 'a' })
    expect(deleted.ok).toBe(true)
    if (deleted.ok) expect(deleted.project.cues.map((item) => item.id)).toEqual(['b'])
  })

  it('splits at the playhead without breaking Malayalam grapheme clusters', () => {
    const result = applyCaptionCommand(project(cue('a', 0, 4_000_000, 'ഞാൻ React പഠിക്കുന്നു')), { type: 'split', cueId: 'a', atUs: 2_000_000, rightCueId: 'b' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project.cues.map((item) => item.id)).toEqual(['a', 'b'])
    expect(result.project.cues.map((item) => item.text).join(' ')).toBe('ഞാൻ React പഠിക്കുന്നു')
    expect(result.project.cues[0].endUs).toBe(2_000_000)
    expect(result.project.cues[1].startUs).toBe(2_000_000)
    expect(result.project.cues.every((item) => item.needsReview)).toBe(true)
  })

  it('rejects a split at either boundary', () => {
    const initial = project(cue('a', 1_000_000, 2_000_000, 'hello world'))
    expect(applyCaptionCommand(initial, { type: 'split', cueId: 'a', atUs: 1_000_000, rightCueId: 'b' }).ok).toBe(false)
    expect(applyCaptionCommand(initial, { type: 'split', cueId: 'a', atUs: 2_000_000, rightCueId: 'b' }).ok).toBe(false)
  })

  it('merges adjacent cues into the first stable ID', () => {
    const result = applyCaptionCommand(project(cue('a', 0, 1_000_000, 'hello'), cue('b', 1_200_000, 2_000_000, 'ലോകം')), { type: 'merge-next', cueId: 'a' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.project.cues).toEqual([expect.objectContaining({ id: 'a', endUs: 2_000_000, text: 'hello ലോകം' })])
  })

  it('reports overlaps as warnings and preserves both imported cues', () => {
    const cues = [cue('a', 0, 2_000_000, 'one'), cue('b', 1_500_000, 3_000_000, 'two')]
    const validation = validateCaptions(cues)
    expect(validation.errors).toEqual([])
    expect(validation.warnings).toEqual([expect.objectContaining({ kind: 'overlap', cueIds: ['a', 'b'] })])
    expect(cues).toHaveLength(2)
  })
})

describe('word-boundary caption editing', () => {
  it('keeps timeline mode as a preference without changing caption display or timings', () => {
    const c = cue('a', 0, 3_000, 'one two', { words: timedWords('one two') })
    const result = applyCaptionCommand(project(c), { type: 'set-timeline-display', display: 'word' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project.timelineDisplay).toBe('word')
    expect(result.project.captionDisplay).toBeUndefined()
    expect(result.project.cues[0]).toBe(c)
  })

  it('adds a grapheme-safe visual line break without changing word IDs or timing', () => {
    const text = 'മലയാളം React tutorial'
    const c = cue('a', 0, 3_000, text, { words: timedWords(text) })
    const result = applyCaptionCommand(project(c), { type: 'line-break-before-word', cueId: 'a', target: { wordId: 'w1' } })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project.cues[0].text).toBe('മലയാളം\nReact tutorial')
    expect(result.project.cues[0].words.map((word) => word.id)).toEqual(['w0', 'w1', 'w2'])
    expect(cueSchema.safeParse(result.project.cues[0]).success).toBe(true)
  })

  it('splits exactly before a selected timed word and keeps its motion override', () => {
    const text = 'one two three'
    const c = cue('a', 0, 3_000, text, { words: timedWords(text), motionOverride: { motion: 'word-pop', motionSpeed: 2 } })
    const result = applyCaptionCommand(project(c), { type: 'split-before-word', cueId: 'a', wordId: 'w1', rightCueId: 'b' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project.cues.map((item) => [item.text, item.startUs, item.endUs])).toEqual([['one', 0, 1_000], ['two three', 1_000, 3_000]])
    expect(result.project.cues[1].motionOverride).toEqual(c.motionOverride)
  })

  it('moves a selected suffix to the adjacent caption while retaining valid word timing', () => {
    const source = cue('a', 0, 3_000, 'one two three', { words: timedWords('one two three') })
    const next = cue('b', 3_000, 4_000, 'four', { words: [{ ...timedWords('four', 'n')[0], startUs: 3_000, endUs: 3_900 }] })
    const result = applyCaptionCommand(project(source, next), { type: 'move-from-word-to-next', cueId: 'a', wordId: 'w1' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project.cues.map((item) => item.text)).toEqual(['one', 'two three four'])
    expect(result.project.cues.every((item) => cueSchema.safeParse(item).success)).toBe(true)
  })
})

describe('update-text with estimateIfUntimed (keeps word-driven motion working through an edit)', () => {
  it('gap-fills only what changed, leaving retained model timing and a motion override untouched', () => {
    const original = cue('a', 0, 5_000, 'one two three', { words: timedWords('one two three'), motionOverride: { motion: 'word-pop' } })
    const result = applyCaptionCommand(project(original), { type: 'update-text', cueId: 'a', text: 'one TWO three', estimateIfUntimed: 'e' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const updated = result.project.cues[0]
    expect(updated.motionOverride).toEqual({ motion: 'word-pop' })
    expect(updated.words.find((word) => word.id === 'w0')).toMatchObject({ timingSource: 'model' })
    expect(updated.words.find((word) => word.id === 'w2')).toMatchObject({ timingSource: 'model' })
    expect(updated.words.some((word) => word.timingSource === 'estimated' && word.needsReview)).toBe(true)
    // The whole cue is fully timed again, so the word-pop motion this cue is set to keeps animating
    // instead of the renderer silently falling back to static-clean.
    const availability = wordMotionAvailability(updated)
    expect(availability.enabled).toBe(true)
    expect(availability.estimated).toBe(true)
  })

  it('never invents word timing for a cue that had none to begin with (e.g. imported SRT)', () => {
    const c = cue('a', 0, 5_000, '')
    const result = applyCaptionCommand(project(c), { type: 'update-text', cueId: 'a', text: 'one two', estimateIfUntimed: 'e' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.project.cues[0].words).toEqual([])
  })

  it('does not estimate when the flag is absent', () => {
    const original = cue('a', 0, 5_000, 'one two three', { words: timedWords('one two three') })
    const result = applyCaptionCommand(project(original), { type: 'update-text', cueId: 'a', text: 'one TWO three' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project.cues[0].words.find((word) => word.id === 'w1')).toBeUndefined()
    expect(result.project.cues[0].words).toHaveLength(2)
  })

  it('reports estimate-skipped instead of silently leaving the animation on static-clean', () => {
    const original = cue('a', 0, 2_000, 'one two', { words: [
      { id: 'w0', text: 'one', startUs: 0, endUs: 1_000, timingSource: 'model', needsReview: false },
      { id: 'w1', text: 'two', startUs: 1_000, endUs: 2_000, timingSource: 'model', needsReview: false },
    ] })
    // Inserting a word into a zero-width gap between two adjacent kept words leaves no room for a
    // positive-duration estimate.
    const result = applyCaptionCommand(project(original), { type: 'update-text', cueId: 'a', text: 'one X two', estimateIfUntimed: 'e' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings.some((warning) => warning.kind === 'estimate-skipped' && warning.cueIds.includes('a'))).toBe(true)
    expect(result.project.cues[0].words.map((word) => word.id).sort()).toEqual(['w0', 'w1'])
  })
})

describe('caption display mode', () => {
  it('estimates only cues missing word timing when switching to word display, leaving fully-timed cues untouched', () => {
    const timed = cue('a', 0, 5_000, 'one two', { words: timedWords('one two') })
    const untimed = cue('b', 10_000, 20_000, 'three four')
    const result = applyCaptionCommand(project(timed, untimed), { type: 'set-display', display: 'word', idPrefix: 'e' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project.captionDisplay).toBe('word')
    expect(result.project.cues[0]).toBe(timed) // referentially unchanged — nothing to estimate
    expect(result.project.cues[1].words).toHaveLength(2)
    expect(result.project.cues[1].words.every((word) => word.timingSource === 'estimated' && word.needsReview)).toBe(true)
    expect(result.selectedId).toBeUndefined()
  })

  it('reports a skip warning and leaves a too-short cue untouched instead of failing the whole toggle', () => {
    const tooShort = cue('a', 0, 1, 'one two') // 1 µs total, cannot fit two positive-duration estimates
    const result = applyCaptionCommand(project(tooShort), { type: 'set-display', display: 'word', idPrefix: 'e' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project.cues[0]).toBe(tooShort)
    expect(result.warnings).toEqual([expect.objectContaining({ kind: 'estimate-skipped', cueIds: ['a'] })])
  })

  it('keeps existing word timing untouched when switching back to line display', () => {
    const timed = cue('a', 0, 5_000, 'one two', { words: timedWords('one two') })
    const result = applyCaptionCommand({ ...project(timed), captionDisplay: 'word' }, { type: 'set-display', display: 'line', idPrefix: 'e' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project.captionDisplay).toBe('line')
    expect(result.project.cues[0].words).toHaveLength(2)
  })

  it('is a no-op when the display is already set and nothing needs estimating, so no history entry is created', () => {
    const timed = cue('a', 0, 5_000, 'one two', { words: timedWords('one two') })
    const initial = { ...project(timed), captionDisplay: 'word' as const }
    const result = applyCaptionCommand(initial, { type: 'set-display', display: 'word', idPrefix: 'e' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.project).toBe(initial)
  })
})

describe('deleting a single word from a caption', () => {
  it('collapses a middle word together with its trailing space', () => {
    const c = cue('a', 0, 5_000, 'hello brave world', { words: timedWords('hello brave world') })
    const result = applyCaptionCommand(project(c), { type: 'delete-word', cueId: 'a', target: { wordId: 'w1' } })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const updated = result.project.cues[0]
    expect(updated.text).toBe('hello world')
    expect(updated.words.map((word) => word.id)).toEqual(['w0', 'w2'])
    for (const word of updated.words) expect(updated.text.slice(word.textStart, word.textEnd)).toBe(word.text)
    expect(cueSchema.safeParse(updated).success).toBe(true)
  })

  it('collapses the last word together with the space before it', () => {
    const c = cue('a', 0, 5_000, 'hello world', { words: timedWords('hello world') })
    const result = applyCaptionCommand(project(c), { type: 'delete-word', cueId: 'a', target: { wordId: 'w1' } })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project.cues[0].text).toBe('hello')
    expect(result.project.cues[0].words.map((word) => word.id)).toEqual(['w0'])
  })

  it('swallows parenthesised punctuation attached to the deleted word', () => {
    const text = '(hello) world'
    const c = cue('a', 0, 5_000, text, { words: timedWords(text) })
    const result = applyCaptionCommand(project(c), { type: 'delete-word', cueId: 'a', target: { wordId: 'w0' } })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.project.cues[0].text).toBe('world')
  })

  it('swallows a trailing comma attached to the deleted word', () => {
    const text = 'hello, world'
    const c = cue('a', 0, 5_000, text, { words: timedWords(text) })
    const result = applyCaptionCommand(project(c), { type: 'delete-word', cueId: 'a', target: { wordId: 'w0' } })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.project.cues[0].text).toBe('world')
  })

  it('deletes a Malayalam conjunct word without mangling the remaining grapheme clusters', () => {
    const text = 'ഒന്ന് ഉപയോഗിച്ച് മൂന്ന്'
    const c = cue('a', 0, 5_000, text, { words: timedWords(text) })
    const result = applyCaptionCommand(project(c), { type: 'delete-word', cueId: 'a', target: { wordId: 'w1' } })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const updated = result.project.cues[0]
    expect(updated.text).toBe('ഒന്ന് മൂന്ന്')
    for (const word of updated.words) expect(updated.text.slice(word.textStart, word.textEnd)).toBe(word.text)
    expect(cueSchema.safeParse(updated).success).toBe(true)
  })

  it('keeps the first occurrence’s timing and emphasis when deleting a repeated word', () => {
    const text = 'the cat and the dog'
    const words = timedWords(text)
    const emphasized = [{ text: 'the', textStart: words[0].textStart!, textEnd: words[0].textEnd! }]
    const c = cue('a', 0, 5_000, text, { words, emphasized })
    const result = applyCaptionCommand(project(c), { type: 'delete-word', cueId: 'a', target: { wordId: 'w3' } }) // the second "the"
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const updated = result.project.cues[0]
    expect(updated.text).toBe('the cat and dog')
    expect(updated.words.map((word) => word.id)).toEqual(['w0', 'w1', 'w2', 'w4'])
    expect(updated.words[0]).toMatchObject({ id: 'w0', startUs: words[0].startUs, endUs: words[0].endUs })
    expect(updated.emphasized).toEqual([{ text: 'the', textStart: 0, textEnd: 3 }])
  })

  it('removes the line break when the deleted word was alone on its own line', () => {
    const text = 'hello\nworld\nagain'
    const c = cue('a', 0, 5_000, text, { words: timedWords(text) })
    const result = applyCaptionCommand(project(c), { type: 'delete-word', cueId: 'a', target: { wordId: 'w1' } })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.project.cues[0].text).toBe('hello\nagain')
  })

  it('deletes the whole cue when its only word is removed, selecting a neighbour', () => {
    const before = cue('a', 0, 1_000, 'hello', { words: timedWords('hello') })
    const after = cue('b', 2_000, 3_000, 'next')
    const result = applyCaptionCommand(project(before, after), { type: 'delete-word', cueId: 'a', target: { wordId: 'w0' } })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project.cues.map((item) => item.id)).toEqual(['b'])
    expect(result.selectedId).toBe('b')
  })

  it('fails cleanly for an unknown word ID', () => {
    const c = cue('a', 0, 1_000, 'hello', { words: timedWords('hello') })
    expect(applyCaptionCommand(project(c), { type: 'delete-word', cueId: 'a', target: { wordId: 'missing' } }).ok).toBe(false)
  })
})

describe('captions of several videos', () => {
  const videoAsset = (id: string, durationUs: number | null) => ({
    id, kind: 'video' as const, name: `${id}.mp4`, reference: { relativePath: null, absolutePath: `/${id}.mp4` }, fingerprint: null,
    metadata: { durationUs, width: 1920, height: 1080, rotationDegrees: 0, frameRate: null, nominalFrameRate: null, streams: [] },
  })
  const clip = (id: string, assetId: string, timelineStartUs: number, sourceEndUs: number) => ({ kind: 'video' as const, id, trackId: 'V1', assetId, timelineStartUs, sourceStartUs: 0, sourceEndUs, opacity: 1, fit: 'contain' as const, gain: 1 })
  const twoVideos = (...cues: Cue[]): CaptionProject => ({
    ...project(...cues), assets: [videoAsset('v1', 10_000_000), videoAsset('v2', 5_000_000)],
    tracks: [{ id: 'V1', kind: 'video', name: '', muted: false, hidden: false, locked: false }],
    clips: [clip('k1', 'v1', 0, 10_000_000), clip('k2', 'v2', 10_000_000, 5_000_000)],
  })

  it('does not report an overlap between cues of different videos, since their times are on different timelines', () => {
    const a = cue('a', 0, 2_000_000, 'one', { mediaAssetId: 'v1' })
    const b = cue('b', 1_000_000, 3_000_000, 'two', { mediaAssetId: 'v2' })
    expect(validateCaptions([a, b]).warnings).toEqual([])
    expect(validateCaptions([a, { ...b, mediaAssetId: 'v1' }]).warnings).toEqual([expect.objectContaining({ kind: 'overlap', cueIds: ['a', 'b'] })])
  })

  it('bounds a cue by the duration of its own video', () => {
    const late = cue('a', 4_000_000, 6_000_000, 'late', { mediaAssetId: 'v2' })
    const durations: Record<string, number> = { v1: 10_000_000, v2: 5_000_000 }
    const context = { assetDurationUs: (id: string) => durations[id] }
    expect(validateCaptions([late], context).errors).toEqual([expect.objectContaining({ kind: 'media-bounds' })])
    expect(validateCaptions([{ ...late, mediaAssetId: 'v1' }], context).errors).toEqual([])
    // A cue with no video is bounded by the caller's own media duration instead.
    expect(validateCaptions([{ ...late, mediaAssetId: undefined }], { ...context, mediaDurationUs: 5_000_000 }).errors).toHaveLength(1)
  })

  it('takes each video’s duration from the project when the caller supplies no lookup', () => {
    const base = twoVideos(cue('a', 0, 1_000_000, 'one', { mediaAssetId: 'v2' }))
    const result = applyCaptionCommand(base, { type: 'update-time', cueId: 'a', startUs: 4_000_000, endUs: 6_000_000 })
    expect(result.ok).toBe(false)
  })

  it('binds a cue added without a video to the sequence’s only video, and to an explicit default when there are several', () => {
    const one = { ...twoVideos(), clips: [clip('k1', 'v1', 0, 10_000_000)] }
    const added = applyCaptionCommand(one, { type: 'add', cue: cue('new', 0, 1_000_000, 'new') })
    expect(added.ok && added.project.cues[0].mediaAssetId).toBe('v1')
    const both = applyCaptionCommand(twoVideos(), { type: 'add', cue: cue('new', 0, 1_000_000, 'new') }, { defaultAssetId: 'v2' })
    expect(both.ok && both.project.cues[0].mediaAssetId).toBe('v2')
    // With several videos and no default the cue stays unbound rather than being guessed onto one.
    const ambiguous = applyCaptionCommand(twoVideos(), { type: 'add', cue: cue('new', 0, 1_000_000, 'new') })
    expect(ambiguous.ok && ambiguous.project.cues[0].mediaAssetId).toBeUndefined()
  })

  it('leaves a project without clips unbound', () => {
    const added = applyCaptionCommand(project(), { type: 'add', cue: cue('new', 0, 1_000_000, 'new') })
    expect(added.ok && added.project.cues[0].mediaAssetId).toBeUndefined()
  })

  it('refuses to merge captions, or move a word between captions, of different videos', () => {
    const a = cue('a', 0, 1_000_000, 'one two', { mediaAssetId: 'v1', words: timedWords('one two', 'a') })
    const b = cue('b', 2_000_000, 3_000_000, 'three four', { mediaAssetId: 'v2', words: timedWords('three four', 'b').map((word) => ({ ...word, startUs: word.startUs + 2_000_000, endUs: word.endUs + 2_000_000 })) })
    const base = twoVideos(a, b)
    const merged = applyCaptionCommand(base, { type: 'merge-next', cueId: 'a' })
    expect(merged.ok).toBe(false)
    if (!merged.ok) expect(merged.errors[0].message).toContain('different videos')
    expect(applyCaptionCommand(base, { type: 'move-from-word-to-next', cueId: 'a', wordId: 'a1' }).ok).toBe(false)
    // The same command on captions of one video still merges.
    expect(applyCaptionCommand(twoVideos({ ...a }, { ...b, mediaAssetId: 'v1' }), { type: 'merge-next', cueId: 'a' }).ok).toBe(true)
  })

  it('keeps the video when a caption is split', () => {
    const base = twoVideos(cue('a', 0, 4_000_000, 'one two three four', { mediaAssetId: 'v2' }))
    const split = applyCaptionCommand(base, { type: 'split', cueId: 'a', atUs: 2_000_000, rightCueId: 'a2' })
    expect(split.ok && split.project.cues.map((item) => item.mediaAssetId)).toEqual(['v2', 'v2'])
  })
})

describe('word-menu actions on a caption with no word timing', () => {
  it('deletes a plain text token addressed by its offset, with no word entries involved', () => {
    const c = cue('a', 0, 5_000_000, 'hello brave world')
    const target = captionTokens('hello brave world')[1] // "brave"
    const result = applyCaptionCommand(project(c), { type: 'delete-word', cueId: 'a', target: { textStart: target.textStart } })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.project.cues[0].text).toBe('hello world')
  })

  it('adds a line break before a plain text token addressed by its offset', () => {
    const text = 'one two three'
    const c = cue('a', 0, 5_000_000, text)
    const target = captionTokens(text)[1] // "two"
    const result = applyCaptionCommand(project(c), { type: 'line-break-before-word', cueId: 'a', target: { textStart: target.textStart } })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.project.cues[0].text).toBe('one\ntwo three')
  })

  it('refuses a line break before the caption’s first token, whether addressed by word or offset', () => {
    const text = 'one two'
    const untimed = cue('a', 0, 5_000_000, text)
    const byOffset = applyCaptionCommand(project(untimed), { type: 'line-break-before-word', cueId: 'a', target: { textStart: 0 } })
    expect(byOffset.ok).toBe(false)
    const timed = cue('b', 0, 5_000_000, text, { words: timedWords(text) })
    const byWord = applyCaptionCommand(project(timed), { type: 'line-break-before-word', cueId: 'b', target: { wordId: 'w0' } })
    expect(byWord.ok).toBe(false)
  })

  it('emphasizes a caption typed into a cue that started empty (word: []), independent of word timing', () => {
    const added = cue('a', 0, 5_000_000, '')
    const edited = applyCaptionCommand(project(added), { type: 'update-text', cueId: 'a', text: 'ഇത് React ആണ്' })
    expect(edited.ok).toBe(true)
    if (!edited.ok) return
    expect(edited.project.cues[0].words).toEqual([]) // no timing was fabricated
    const secondToken = captionTokens(edited.project.cues[0].text)[1] // "React"
    const emphasized = applyCaptionCommand(edited.project, { type: 'toggle-emphasis', cueId: 'a', textStart: secondToken.textStart })
    expect(emphasized.ok).toBe(true)
    if (emphasized.ok) expect(emphasized.project.cues[0].emphasized).toEqual([{ text: 'React', textStart: secondToken.textStart, textEnd: secondToken.textEnd }])
  })
})

describe('estimate-words with missingOnly', () => {
  it('fills only the untimed gap, leaving already-timed words and their provenance untouched', () => {
    const text = 'one two three'
    const c = cue('a', 0, 5_000, text, { words: [timedWords(text)[0], timedWords(text)[2]] })
    const result = applyCaptionCommand(project(c), { type: 'estimate-words', cueId: 'a', idPrefix: 'e', missingOnly: true })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const words = result.project.cues[0].words
    expect(words.find((word) => word.id === 'w0')).toMatchObject({ timingSource: 'model' })
    expect(words.find((word) => word.id === 'w2')).toMatchObject({ timingSource: 'model' })
    expect(words.find((word) => word.text === 'two')).toMatchObject({ timingSource: 'estimated', needsReview: true })
  })

  it('replaces every word when missingOnly is not set, unlike missingOnly', () => {
    const text = 'one two three'
    const c = cue('a', 0, 5_000, text, { words: [timedWords(text)[0], timedWords(text)[2]] })
    const result = applyCaptionCommand(project(c), { type: 'estimate-words', cueId: 'a', idPrefix: 'e' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.project.cues[0].words.every((word) => word.timingSource === 'estimated')).toBe(true)
  })
})
