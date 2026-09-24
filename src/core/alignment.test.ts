import { describe, expect, it } from 'vitest'
import { applyAlignment, matchRecognizedWords } from './alignment'
import { createProject } from './model'

describe('exact alignment matching', () => {
  it('preserves imported Malayalam/English tokens and leaves unmatched words out', () => {
    const output = matchRecognizedWords(
      [{ id: 'c1', startUs: 0, endUs: 4_000_000, text: 'ഇത് React ആണ്!' }],
      [
        { text: 'ഇത്', startUs: 100_000, endUs: 400_000 },
        { text: 'wrong', startUs: 500_000, endUs: 700_000 },
        { text: 'react', startUs: 800_000, endUs: 1_200_000 },
        { text: 'ആണ്', startUs: 1_300_000, endUs: 1_600_000 },
      ],
    )
    expect(output.segments[0].words.map((word) => word.text)).toEqual(['ഇത്', 'React', 'ആണ്'])
  })

  it('applies partial timing, estimates only gaps, and preserves manual corrections', () => {
    const project = createProject()
    project.cues = [{
      id: 'c1', startUs: 0, endUs: 4_000_000, text: 'one two three', timingSource: 'imported', textSource: 'imported', needsReview: true,
      captionTrackId: project.captionTracks[0].id,
      words: [{ id: 'manual', text: 'two', textStart: 4, textEnd: 7, startUs: 1_200_000, endUs: 1_800_000, timingSource: 'manual', needsReview: false }],
    }]
    let serial = 0
    const next = applyAlignment(project, {
      contractVersion: 1, engine: 'gemini', model: 'gemini-3.5-transcribe', language: 'ml',
      segments: [{ id: 'c1', words: [
        { text: 'one', startUs: 100_000, endUs: 500_000, timingSource: 'aligned' },
        { text: 'three', startUs: 2_000_000, endUs: 2_400_000, timingSource: 'aligned' },
      ] }],
    }, {
      id: 'run-1', createdAt: '2026-09-17T00:00:00.000Z', provider: 'gemini', model: 'gemini-3.5-transcribe',
      sourceRange: { startUs: 0, endUs: 4_000_000 }, segmentCount: 1,
    }, () => `new-${++serial}`)
    expect(next.cues[0].words.map((word) => [word.text, word.timingSource])).toEqual([
      ['one', 'aligned'], ['two', 'manual'], ['three', 'aligned'],
    ])
    expect(next.alignmentRuns?.[0].alignedWordCount).toBe(2)
  })
})
