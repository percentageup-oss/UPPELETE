import { describe, expect, it } from 'vitest'
import { createProject, projectSchema, type CaptionProject, type Cue, type TranscriptionRun } from './model'
import type { SourceTimedTranscript, TranslatedTranscript } from './transcription'
import { applyTranscription, describeExistingCaptions, TranscriptionChoiceRequired } from './transcriptionApply'

const segment = (startUs: number, endUs: number, text: string, timingAdjustment: SourceTimedTranscript['segments'][number]['timingAdjustment'] = null) =>
  ({ startUs, endUs, text, confidence: null, words: [], timingAdjustment })

const transcript: SourceTimedTranscript = {
  contractVersion: 1, engine: 'whisper.cpp', model: 'whisper-base', language: 'ml',
  sourceRange: { startUs: 0, endUs: 60_000_000 },
  segments: [
    segment(1_000_000, 3_000_000, 'ആദ്യ വാചകം'),
    segment(25_000_000, 27_000_000, 'After a long pause', 'end-clamped-to-chunk'),
  ],
}

const run: TranscriptionRun = {
  id: 'run-2', createdAt: '2026-09-15T00:00:00.000Z', engine: { id: 'whisper.cpp', version: '1.9.4' },
  model: { id: 'whisper-base', fileName: 'ggml-base.bin', sha256: '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe' },
  requestedLanguage: 'auto', language: 'ml', requestedDevice: 'metal', backends: ['MTL0'], sourceRange: { startUs: 0, endUs: 60_000_000 },
  audioExtraction: 'ffmpeg-v1', speechGating: 'gating-v1', chunkCount: 2, silenceCount: 1, segmentCount: 2, adjustedSegmentCount: 1,
  droppedSegments: { empty: 0, outsideChunk: 0, zeroDuration: 0 },
}

let nextId = 0
const newId = () => `new-${++nextId}`
const cue = (id: string, startUs: number, endUs: number, text: string, overrides: Partial<Cue> = {}): Cue =>
  ({ id, startUs, endUs, text, timingSource: 'model', needsReview: false, textSource: 'model', words: [], transcriptionRunId: 'run-1', ...overrides })
const withCues = (cues: Cue[]): CaptionProject => ({ ...createProject(), cues })

describe('applyTranscription', () => {
  it('creates model captions with provenance and keeps the silence gap empty', () => {
    const { project, summary } = applyTranscription(createProject(), transcript, run, null, newId)
    expect(project.cues.map(({ startUs, endUs, text, textSource, timingSource, needsReview, transcriptionRunId }) => ({ startUs, endUs, text, textSource, timingSource, needsReview, transcriptionRunId }))).toEqual([
      { startUs: 1_000_000, endUs: 3_000_000, text: 'ആദ്യ വാചകം', textSource: 'model', timingSource: 'model', needsReview: true, transcriptionRunId: 'run-2' },
      { startUs: 25_000_000, endUs: 27_000_000, text: 'After a long pause', textSource: 'model', timingSource: 'model', needsReview: true, transcriptionRunId: 'run-2' },
    ])
    expect(project.cues.some((item) => item.startUs < 25_000_000 && item.endUs > 3_000_000)).toBe(false)
    expect(project.transcriptionRuns).toEqual([{ ...run, recognition: transcript }])
    expect(project.cues.flatMap((cue) => cue.words).every((word) => word.timingSource === 'estimated' && word.needsReview)).toBe(true)
    expect(summary).toEqual({ added: 2, removed: 0, kept: 0, skippedOverlapping: 0 })
    expect(projectSchema.parse(project)).toEqual(project)
  })

  it('requires an explicit choice before touching overlapping captions', () => {
    const existing = withCues([cue('imported', 20_000_000, 22_000_000, 'Imported SRT line', { textSource: 'imported', timingSource: 'imported' })])
    const before = structuredClone(existing)
    expect(() => applyTranscription(existing, transcript, run, null, newId)).toThrow(TranscriptionChoiceRequired)
    expect(existing).toEqual(before)
  })

  it('keeps imported, corrected and retimed captions and skips new segments that overlap them', () => {
    const corrected = cue('corrected', 900_000, 3_100_000, 'ആദ്യ വാക്യം (corrected)', { textSource: 'user', needsReview: true })
    const retimed = cue('retimed', 40_000_000, 41_000_000, 'retimed model text', { timingSource: 'manual' })
    const untouched = cue('untouched', 25_000_000, 26_500_000, 'old model text')
    const { project, summary } = applyTranscription(withCues([corrected, untouched, retimed]), transcript, run, 'keep-authored', newId)
    expect(project.cues.map((item) => item.id)).toEqual(['corrected', expect.stringMatching(/^new-/), 'retimed'])
    expect(project.cues[0]).toEqual(corrected)
    expect(project.cues[1]).toMatchObject({ text: 'After a long pause', transcriptionRunId: 'run-2' })
    expect(summary).toEqual({ added: 1, removed: 1, kept: 2, skippedOverlapping: 1 })
  })

  it('replaces every caption in range only when explicitly asked, keeping captions outside the range', () => {
    const shortRange = { ...transcript, sourceRange: { startUs: 0, endUs: 30_000_000 } }
    const inRange = cue('corrected', 900_000, 3_100_000, 'corrected', { textSource: 'user' })
    const outside = cue('outside', 45_000_000, 46_000_000, 'outside the transcribed range', { textSource: 'user' })
    const { project, summary } = applyTranscription(withCues([inRange, outside]), shortRange, run, 'replace-all', newId)
    expect(project.cues.map((item) => item.text)).toEqual(['ആദ്യ വാചകം', 'After a long pause', 'outside the transcribed range'])
    expect(summary).toEqual({ added: 2, removed: 1, kept: 1, skippedOverlapping: 0 })
  })

  it('counts authored versus untouched model captions for the choice dialog', () => {
    expect(describeExistingCaptions([
      cue('a', 0, 1, 'model'),
      cue('b', 1, 2, 'edited', { textSource: 'user' }),
      cue('c', 2, 3, 'imported', { textSource: 'imported', timingSource: 'imported' }),
    ])).toEqual({ total: 3, untouchedModel: 1, authored: 2 })
  })
})

describe('applyTranscription with a translation', () => {
  const translation: TranslatedTranscript = {
    contractVersion: 1, provider: 'gemini', model: 'gemini-3.8-flash', targetLanguage: 'en',
    segments: [{ text: 'First sentence' }, { text: 'After a long pause (translated)' }],
  }

  it('creates captions from the translated text, keeps the source-language recognition, and always needs review', () => {
    const { project, summary } = applyTranscription(createProject(), transcript, run, null, newId, [translation])
    expect(project.cues.map(({ startUs, endUs, text, textSource, timingSource, needsReview, transcriptionRunId }) => ({ startUs, endUs, text, textSource, timingSource, needsReview, transcriptionRunId }))).toEqual([
      { startUs: 1_000_000, endUs: 3_000_000, text: 'First sentence', textSource: 'model', timingSource: 'model', needsReview: true, transcriptionRunId: 'run-2' },
      { startUs: 25_000_000, endUs: 27_000_000, text: 'After a long pause (translated)', textSource: 'model', timingSource: 'model', needsReview: true, transcriptionRunId: 'run-2' },
    ])
    // Original, spoken-language recognition is retained as evidence even though captions carry translated text.
    expect(project.transcriptionRuns).toEqual([{ ...run, recognition: transcript }])
    expect(project.cues.flatMap((cue) => cue.words).every((word) => word.timingSource === 'estimated' && word.needsReview)).toBe(true)
    expect(summary).toEqual({ added: 2, removed: 0, kept: 0, skippedOverlapping: 0 })
    expect(projectSchema.parse(project)).toEqual(project)
  })

  it('throws when the translation segment count does not match the transcript, never silently misaligning timing to the wrong text', () => {
    const mismatched: TranslatedTranscript = { ...translation, segments: translation.segments.slice(0, 1) }
    expect(() => applyTranscription(createProject(), transcript, run, null, newId, [mismatched])).toThrow()
  })

  it('keeps authored captions and still translates the replaced segments when combined with keep-authored', () => {
    const untouched = cue('untouched', 25_000_000, 26_500_000, 'old model text')
    const { project } = applyTranscription(withCues([untouched]), transcript, run, 'keep-authored', newId, [translation])
    expect(project.cues.map((item) => item.text)).toEqual(['First sentence', 'After a long pause (translated)'])
  })
})

describe('applyTranscription of one video among several', () => {
  it('never offers another video’s captions for replacement, and binds the new captions and the run to the transcribed video', () => {
    const otherVideo = withCues([cue('a-line', 1_000_000, 3_000_000, 'Video A caption', { mediaAssetId: 'video-a', textSource: 'imported', timingSource: 'imported' })])
    // Numerically overlapping source time, but a different file: no choice is needed and nothing of A is touched.
    const { project, summary } = applyTranscription(otherVideo, transcript, run, null, newId, [], 'video-b')
    expect(project.cues.find((entry) => entry.id === 'a-line')).toEqual(otherVideo.cues[0])
    expect(project.cues.filter((entry) => entry.id !== 'a-line').every((entry) => entry.mediaAssetId === 'video-b')).toBe(true)
    expect(project.transcriptionRuns?.at(-1)?.mediaAssetId).toBe('video-b')
    expect(summary).toMatchObject({ added: 2, removed: 0, kept: 1 })
  })

  it('still asks before replacing the transcribed video’s own captions', () => {
    const same = withCues([cue('b-line', 1_000_000, 3_000_000, 'Video B caption', { mediaAssetId: 'video-b', textSource: 'imported', timingSource: 'imported' })])
    expect(() => applyTranscription(same, transcript, run, null, newId, [], 'video-b')).toThrow(TranscriptionChoiceRequired)
  })
})
