import type { CaptionProject, Cue, TranscriptionRun } from './model'
import type { SourceTimedTranscript, TranslatedTranscript } from './transcription'
import { recognitionToCaptions, translatedRecognitionToCaptions } from './recognition'
import { groupCaption } from './captionGrouping'
import { untimedTokenCount } from './wordTiming'

/**
 * Turns a validated, source-timed transcript into project captions without ever silently overwriting what a
 * person wrote. When existing captions overlap the transcribed range the caller must pass an explicit choice:
 *  - `keep-authored`: keep every imported, user-edited or manually retimed caption; replace only captions whose
 *    text and timing still come from recognition or its automatic estimates, with no manual/aligned word edits. New segments overlapping a kept caption are skipped,
 *    never merged into its text.
 *  - `replace-all`: remove every caption overlapping the transcribed range, including human corrections.
 * Captions entirely outside the transcribed range are always kept. The result is one project value, so the caller
 * commits it as a single undoable history step.
 */

export type TranscriptionApplyChoice = 'keep-authored' | 'replace-all'
export type TranscriptionApplySummary = { added: number; removed: number; kept: number; skippedOverlapping: number }

export class TranscriptionChoiceRequired extends Error {
  constructor() {
    super('Existing captions overlap the transcribed range. Choose whether to keep your captions or replace them.')
    this.name = 'TranscriptionChoiceRequired'
  }
}

export function isUntouchedModelCue(cue: Cue): boolean {
  return cue.textSource === 'model' && ['model', 'estimated'].includes(cue.timingSource)
    && !cue.words.some((word) => word.timingSource === 'manual' || word.timingSource === 'aligned')
}

export function describeExistingCaptions(cues: readonly Cue[]) {
  const untouchedModel = cues.filter(isUntouchedModelCue).length
  return { total: cues.length, untouchedModel, authored: cues.length - untouchedModel }
}

const overlaps = (a: { startUs: number; endUs: number }, b: { startUs: number; endUs: number }) => a.startUs < b.endUs && b.startUs < a.endUs

export function captionsOverlappingRange(cues: readonly Cue[], range: { startUs: number; endUs: number }): Cue[] {
  return cues.filter((cue) => overlaps(cue, range))
}

/**
 * Recognition, word timing and readable grouping are independently testable stages. When a
 * translation is supplied, captions carry the translated text instead of the recognized text;
 * segment timing is still the recognizer's, and translated captions always need review because
 * their word timing is estimated, never audio-aligned.
 */
export function transcriptToCues(transcript: SourceTimedTranscript, runId: string, newId: () => string, translation?: TranslatedTranscript | null): Cue[] {
  const cues = translation ? translatedRecognitionToCaptions(transcript, translation, runId, newId) : recognitionToCaptions(transcript, runId, newId)
  return cues.flatMap((cue) => untimedTokenCount(cue) ? [cue] : groupCaption(cue, newId))
}

export function applyTranscription(
  project: CaptionProject,
  transcript: SourceTimedTranscript,
  run: TranscriptionRun,
  choice: TranscriptionApplyChoice | null,
  newId: () => string,
  translation?: TranslatedTranscript | null,
): { project: CaptionProject; summary: TranscriptionApplySummary } {
  const range = transcript.sourceRange
  if (choice === null && captionsOverlappingRange(project.cues, range).length > 0) throw new TranscriptionChoiceRequired()
  const kept = project.cues.filter((cue) => !overlaps(cue, range) || (choice === 'keep-authored' && !isUntouchedModelCue(cue)))
  const incoming = transcriptToCues(transcript, run.id, newId, translation)
  const added = incoming.filter((cue) => !kept.some((existing) => overlaps(existing, cue)))
  const cues = [...kept, ...added].sort((a, b) => a.startUs - b.startUs || a.endUs - b.endUs)
  return {
    project: { ...project, cues, transcriptionRuns: [...(project.transcriptionRuns ?? []), { ...run, recognition: structuredClone(transcript) }] },
    summary: { added: added.length, removed: project.cues.length - kept.length, kept: kept.length, skippedOverlapping: incoming.length - added.length },
  }
}
