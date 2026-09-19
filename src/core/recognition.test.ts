import { expect, it } from 'vitest'
import { recognitionToCaptions } from './recognition'
import { transcriptToCues, applyTranscription, TranscriptionChoiceRequired } from './transcriptionApply'
import { applyCaptionCommand } from './captionCommands'
import { createProject, projectSchema, type Cue, type TranscriptionRun } from './model'
import type { SourceTimedTranscript } from './transcription'

const transcript: SourceTimedTranscript = {
  contractVersion: 1, engine: 'test-only', model: 'fixture', language: 'ml', sourceRange: { startUs: 0, endUs: 60_000_000 },
  segments: [{ startUs: 123_457, endUs: 40_000_019, text: 'React മലയാളം', confidence: null, timingAdjustment: null,
    words: [{ text: 'React', startUs: 123_457, endUs: 234_569, confidence: 0.9, timingSource: 'model' },
      { text: 'മലയാളം', startUs: 39_000_007, endUs: 40_000_019, confidence: null, timingSource: 'model' }] }],
}
const run: TranscriptionRun = { id: 'r', createdAt: '2026-09-15', engine: { id: 'test-only', version: '1' }, model: { id: 'fixture', fileName: 'fixture.bin', sha256: 'a'.repeat(64) }, requestedLanguage: 'ml', language: 'ml', requestedDevice: 'cpu', backends: ['CPU'], sourceRange: transcript.sourceRange, audioExtraction: 'test', speechGating: 'test', chunkCount: 1, silenceCount: 0, segmentCount: 1, adjustedSegmentCount: 0, droppedSegments: { empty: 0, outsideChunk: 0, zeroDuration: 0 } }
let serial = 0
const id = () => `new-${++serial}`

it('keeps recognition separate from word identities and readable grouping, preserving model timing/confidence', () => {
  const snapshot = structuredClone(transcript)
  const cues = recognitionToCaptions(transcript, 'r', id)
  expect(cues).toHaveLength(1)
  expect(cues[0].words.map(({ startUs, endUs, timingSource }) => ({ startUs, endUs, timingSource }))).toEqual(transcript.segments[0].words.map(({ startUs, endUs, timingSource }) => ({ startUs, endUs, timingSource })))
  expect(cues[0].words[0].confidence).toBe(0.9)
  const grouped = transcriptToCues(transcript, 'r', id)
  expect(grouped).toHaveLength(2)
  expect(grouped[0].endUs).toBe(234_569)
  expect(grouped[1].startUs).toBe(39_000_007)
  expect(transcript).toEqual(snapshot)
})

it('retains original recognition through edits, JSON reopen and correction-preserving retranscription', () => {
  const applied = applyTranscription(createProject(), transcript, run, null, id).project
  const originalId = applied.cues[0].id
  const edited = applyCaptionCommand(applied, { type: 'update-text', cueId: originalId, text: 'Corrected React!' })
  if (!edited.ok) throw new Error('Edit failed')
  const reopened = projectSchema.parse(JSON.parse(JSON.stringify(edited.project)))
  expect(reopened.transcriptionRuns![0].recognition).toEqual(transcript)
  expect(() => applyTranscription(reopened, transcript, run, null, id)).toThrow(TranscriptionChoiceRequired)
  const kept = applyTranscription(reopened, transcript, { ...run, id: 'r2' }, 'keep-authored', id).project
  expect(kept.cues.find((cue) => cue.id === originalId)).toEqual(reopened.cues[0])
  expect(kept.transcriptionRuns![0].recognition).toEqual(transcript)
  const replaced = applyTranscription(reopened, transcript, run, 'replace-all', id).project
  expect(replaced.cues.some((cue) => cue.text.includes('Corrected'))).toBe(false)
})

it('protects manual word corrections even when cue-level provenance still says model', () => {
  const cue: Cue = { ...recognitionToCaptions(transcript, 'r', id)[0] }
  cue.words = cue.words.map((word) => ({ ...word, timingSource: 'manual' }))
  const result = applyTranscription({ ...createProject(), cues: [cue] }, transcript, run, 'keep-authored', id)
  expect(result.project.cues).toEqual([cue])
})

it('rejects source-range violations and partial grapheme recognition at the conversion boundary', () => {
  expect(() => recognitionToCaptions({ ...transcript, sourceRange: { startUs: 0, endUs: 10 } }, 'r', id)).toThrow()
  expect(() => recognitionToCaptions({ ...transcript, segments: [{ ...transcript.segments[0], text: 'കി', words: [{ ...transcript.segments[0].words[0], text: 'ക' }] }] }, 'r', id)).toThrow()
})

it('keeps an impossibly short segment visible and untimed instead of fabricating zero-duration words', () => {
  const short = { ...transcript, segments: [{ ...transcript.segments[0], startUs: 0, endUs: 1, words: [] }] }
  const cue = recognitionToCaptions(short, 'r', id)[0]
  expect(cue).toMatchObject({ text: 'React മലയാളം', startUs: 0, endUs: 1, words: [], needsReview: true })
})
