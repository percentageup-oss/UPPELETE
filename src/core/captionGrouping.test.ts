import { describe, expect, it } from 'vitest'
import { groupCaption, DEFAULT_GROUPING } from './captionGrouping'
import { captionTokens, graphemeBoundaries } from './captionText'
import { applyCaptionCommand } from './captionCommands'
import { commitHistory, createHistory, redoHistory, undoHistory } from './history'
import { createProject, projectSchema, type Cue } from './model'
import { parseSrt, serializeSrt } from './srt'

function fixture(text = 'ഇത് React tutorial ആണ്. Next sentence comes after silence!'): Cue {
  return { id: 'c', text, startUs: 1_000_007, endUs: 51_000_013, textSource: 'user', timingSource: 'aligned', needsReview: false,
    words: captionTokens(text).map((token, index) => ({ ...token, id: `w${index}`, startUs: 1_000_007 + index * 400_003 + (index >= 4 ? 20_000_011 : 0), endUs: 1_300_008 + index * 400_003 + (index >= 4 ? 20_000_011 : 0), timingSource: 'aligned', needsReview: false })) }
}
let serial = 0
const id = () => `g${++serial}`
const timing = (cues: Cue[]) => cues.flatMap((cue) => cue.words.map(({ id, text, startUs, endUs, timingSource, needsReview }) => ({ id, text, startUs, endUs, timingSource, needsReview })))

describe('readable grouping without retiming recognition', () => {
  it('keeps long pauses empty and retains exact text, punctuation, IDs and microseconds', () => {
    const original = fixture()
    const groups = groupCaption(original, id)
    expect(groups.length).toBeGreaterThan(1)
    expect(groups.map((cue) => cue.text).join('')).toBe(original.text)
    expect(timing(groups)).toEqual(timing([original]))
    const pauseStart = original.words[3].endUs, pauseEnd = original.words[4].startUs
    expect(groups.some((cue) => cue.startUs < pauseEnd && cue.endUs > pauseStart)).toBe(false)
    // Caption-track binding isn't what this test exercises (`groupCaption` never touches it; commands
    // bind it afterward via `bindUnboundItems`), so the sanity check here uses an empty caption-track
    // list rather than `createProject()`'s default one.
    expect(projectSchema.safeParse({ ...createProject(), captionTracks: [], cues: groups }).success).toBe(true)
    expect(original.words[4].startUs).toBe(22_600_030)
  })

  it('regroups repeatedly with different limits without accumulating drift or changing authority', () => {
    const original = fixture()
    let groups = [original]
    for (let iteration = 0; iteration < 30; iteration += 1) {
      groups = groups.flatMap((cue) => groupCaption(cue, id, { ...DEFAULT_GROUPING, maxWords: iteration % 3 + 1 }))
      expect(timing(groups)).toEqual(timing([original]))
      expect(groups.map((cue) => cue.text).join('')).toBe(original.text)
      expect(groups.every((cue) => cue.textSource === 'user')).toBe(true)
    }
  })

  it('applies word, grapheme, duration and punctuation limits without splitting long tokens', () => {
    for (const options of [
      { ...DEFAULT_GROUPING, maxWords: 1 },
      { ...DEFAULT_GROUPING, maxGraphemes: 3 },
      { ...DEFAULT_GROUPING, maxDurationUs: 400_003 },
    ]) {
      const original = fixture('പഠിക്കുന്നു React മലയാളം')
      const groups = groupCaption(original, id, options)
      expect(groups).toHaveLength(3)
      expect(groups[0].text.trim()).toBe('പഠിക്കുന്നു')
      const boundaries = graphemeBoundaries(original.text)
      let offset = 0
      for (const group of groups) { expect(boundaries.has(offset)).toBe(true); offset += group.text.length }
    }
    expect(groupCaption(fixture('Hello. World!'), id)).toHaveLength(2)
  })

  it('keeps incomplete timing ungrouped until explicit estimation and rejects uncontained words', () => {
    const original = fixture()
    expect(() => groupCaption({ ...original, words: original.words.slice(1) }, id)).toThrow('no timing')
    expect(() => groupCaption({ ...original, words: original.words.map((word) => ({ ...word, startUs: 0 })) }, id)).toThrow('contained')
    expect(() => groupCaption(original, id, { ...DEFAULT_GROUPING, maxWords: 0 })).toThrow('positive')
  })

  it('leaves imported SRT exact until the explicit estimate/group command, with one undo step', () => {
    const srt = '1\n00:00:01,001 --> 00:00:05,999\nഇത് React ആണ്. ഇത് ഒരു tutorial ആണ്!\n'
    const parsed = parseSrt(srt)
    const original = { ...createProject(), cues: parsed.cues }
    const before = serializeSrt(original.cues)
    expect(original.cues[0].words).toEqual([])
    expect(groupCaption(original.cues[0], id)).toEqual(original.cues)
    const result = applyCaptionCommand(original, { type: 'regroup', cueId: original.cues[0].id, idPrefix: 'explicit', estimateMissing: true })
    if (!result.ok) throw new Error(JSON.stringify(result.errors))
    expect(result.project.cues.flatMap((cue) => cue.words).every((word) => word.timingSource === 'estimated' && word.needsReview)).toBe(true)
    expect(result.project.cues.every((cue) => cue.timingSource === 'estimated' && cue.textSource === 'user')).toBe(true)
    expect(result.project.cues.map((cue) => cue.text).join('')).toBe(original.cues[0].text)
    const history = commitHistory(createHistory(original), result.project)
    expect(serializeSrt(undoHistory(history).present.cues)).toBe(before)
    expect(redoHistory(undoHistory(history)).present).toEqual(result.project)
  })
})

it('can merge and regroup repeatedly without text or word timing drift', () => {
  const original = fixture()
  let project = { ...createProject(), cues: groupCaption(original, id) }
  for (let round = 0; round < 5; round += 1) {
    while (project.cues.length > 1) {
      const merged = applyCaptionCommand(project, { type: 'merge-next', cueId: project.cues[0].id })
      if (!merged.ok) throw new Error(JSON.stringify(merged.errors))
      project = merged.project
    }
    expect(project.cues[0].text).toBe(original.text)
    const grouped = applyCaptionCommand(project, { type: 'regroup', cueId: project.cues[0].id, idPrefix: `round${round}`, estimateMissing: false })
    if (!grouped.ok) throw new Error(JSON.stringify(grouped.errors))
    project = grouped.project
    expect(timing(project.cues)).toEqual(timing([original]))
  }
})
