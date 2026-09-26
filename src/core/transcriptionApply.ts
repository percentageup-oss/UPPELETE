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
 * Captions entirely outside the transcribed range are always kept, and for a partial range (`options.partial`)
 * so are captions crossing its edge, whatever the choice. The result is one project value, so the caller
 * commits it as a single undoable history step.
 */

/** A translation plus the Gemini token usage of the call that produced it (kept for `translationRuns`). */
export type TranslationWithUsage = TranslatedTranscript & { usage?: { inputTokens?: number; outputTokens?: number } }

export type TranscriptionApplyChoice = 'keep-authored' | 'replace-all'
export type TranscriptionApplySummary = { added: number; removed: number; kept: number; skippedOverlapping: number; boundaryKept: number }

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

/**
 * A cue belongs to the transcribed video when it names it — or names no video at all (captions
 * imported before any video was placed). Source time is per file, so a cue of *another* video that
 * merely overlaps numerically is never offered for replacement (docs/EDITING.md "Per-video
 * transcription"). `assetId` undefined keeps the single-timeline behaviour for callers with no video.
 */
const sameLanguage = (a: Cue, b: Cue) => a.translationLanguage === b.translationLanguage
const sameVideo = (cue: Cue, assetId: string | undefined) => assetId === undefined || cue.mediaAssetId === undefined || cue.mediaAssetId === assetId

export function captionsOverlappingRange(cues: readonly Cue[], range: { startUs: number; endUs: number }, assetId?: string): Cue[] {
  return cues.filter((cue) => sameVideo(cue, assetId) && overlaps(cue, range))
}

/** For a partial-range run, a cue that overlaps the range but extends past either edge is never replaced. */
export function straddlesRange(cue: Cue, range: { startUs: number; endUs: number }): boolean {
  return overlaps(cue, range) && (cue.startUs < range.startUs || cue.endUs > range.endUs)
}

/** The captions a run over `range` may replace: those overlapping it, minus (for a partial range) the ones crossing its edge. */
export function replaceableCaptionsInRange(cues: readonly Cue[], range: { startUs: number; endUs: number }, assetId: string | undefined, partial: boolean): Cue[] {
  const overlapping = captionsOverlappingRange(cues, range, assetId)
  return partial ? overlapping.filter((cue) => !straddlesRange(cue, range)) : overlapping
}

/**
 * Recognition, word timing and readable grouping are independently testable stages. The recognized text is always
 * kept as the original layer; each translation adds its own layer of cues tagged with its target language.
 * Segment timing is still the recognizer's, and translated captions always need review because their word
 * timing is estimated, never audio-aligned.
 */
export function transcriptToCues(transcript: SourceTimedTranscript, runId: string, newId: () => string, translations: readonly TranslatedTranscript[] = []): Cue[] {
  const grouped = (cues: Cue[]) => cues.flatMap((cue) => untimedTokenCount(cue) ? [cue] : groupCaption(cue, newId))
  return [
    ...grouped(recognitionToCaptions(transcript, runId, newId)),
    ...translations.flatMap((translation) => grouped(translatedRecognitionToCaptions(transcript, translation, runId, newId))
      .map((cue) => ({ ...cue, translationLanguage: translation.targetLanguage }))),
  ]
}

/** The run whose saved recognition can rebuild a video's original captions: only when that video has none. */
export function rebuildableRun(project: Pick<CaptionProject, 'cues' | 'transcriptionRuns'>, assetId: string): TranscriptionRun | null {
  if (project.cues.some((cue) => !cue.translationLanguage && (cue.mediaAssetId === assetId || !cue.mediaAssetId))) return null
  return [...(project.transcriptionRuns ?? [])].reverse().find((run) => run.mediaAssetId === assetId && run.recognition) ?? null
}

/** Rebuilds the original-language captions from a run's saved recognition, without any API call or touching existing cues. */
export function rebuildOriginalCues(project: CaptionProject, assetId: string, newId: () => string): CaptionProject | null {
  const run = rebuildableRun(project, assetId)
  if (!run?.recognition) return null
  const defaultCaptionTrackId = project.captionTracks[0]?.id
  const rebuilt = transcriptToCues(run.recognition, run.id, newId)
    .map((cue) => ({ ...cue, mediaAssetId: assetId, ...(defaultCaptionTrackId ? { captionTrackId: defaultCaptionTrackId } : {}) }))
  if (!rebuilt.length) return null
  return { ...project, cues: [...project.cues, ...rebuilt].sort((a, b) => a.startUs - b.startUs || a.endUs - b.endUs) }
}

export function applyTranscription(
  project: CaptionProject,
  transcript: SourceTimedTranscript,
  run: TranscriptionRun,
  choice: TranscriptionApplyChoice | null,
  newId: () => string,
  translations: readonly TranslationWithUsage[] = [],
  /** The video that was transcribed: new cues are bound to it and only its captions can be replaced. */
  assetId?: string,
  /** `partial`: the transcript covers only part of the video, so captions crossing the range edge are kept. */
  options?: { partial?: boolean },
): { project: CaptionProject; summary: TranscriptionApplySummary } {
  const range = transcript.sourceRange
  const partial = options?.partial ?? false
  const replaceable = new Set(replaceableCaptionsInRange(project.cues, range, assetId, partial))
  if (choice === null && replaceable.size > 0) throw new TranscriptionChoiceRequired()
  const kept = project.cues.filter((cue) => !replaceable.has(cue) || (choice === 'keep-authored' && !isUntouchedModelCue(cue)))
  const boundaryKept = partial ? captionsOverlappingRange(project.cues, range, assetId).filter((cue) => straddlesRange(cue, range)).length : 0
  // New cues are stamped directly, the same as `mediaAssetId` just above — this bypasses the normal
  // command path (`applyTranscript` in App.tsx commits the result straight to history), so nothing
  // downstream calls `bindUnboundItems` to backfill it.
  const defaultCaptionTrackId = project.captionTracks[0]?.id
  const incoming = transcriptToCues(transcript, run.id, newId, translations)
    .map((cue) => ({ ...cue, ...(assetId ? { mediaAssetId: assetId } : {}), ...(defaultCaptionTrackId ? { captionTrackId: defaultCaptionTrackId } : {}) }))
  // Only a kept caption of the same language can displace a new one: a translation always overlaps its original.
  const added = incoming.filter((cue) => !kept.some((existing) => sameVideo(existing, assetId) && sameLanguage(existing, cue) && overlaps(existing, cue)))
  const cues = [...kept, ...added].sort((a, b) => a.startUs - b.startUs || a.endUs - b.endUs)
  // Translation provenance moves to `translationRuns`; the legacy `translation` field on the run is no longer written.
  const { translation: _legacyTranslation, ...runRecord } = run
  const translationRuns = translations.filter((translation) => added.some((cue) => cue.translationLanguage === translation.targetLanguage)).map((translation) => ({
    id: newId(), createdAt: run.createdAt, provider: 'gemini' as const, model: translation.model, sourceLanguage: run.language, targetLanguage: translation.targetLanguage,
    ...(assetId ? { mediaAssetId: assetId } : {}), transcriptionRunId: run.id, segmentCount: translation.segments.length,
    ...(translation.usage?.inputTokens ? { inputTokens: translation.usage.inputTokens } : {}),
    ...(translation.usage?.outputTokens ? { outputTokens: translation.usage.outputTokens } : {}),
  }))
  // Show the first translation, as "Transcribe and translate" always has; with none, whatever was shown stays.
  const shownTranslation = translationRuns[0]?.targetLanguage ?? project.shownTranslation
  return {
    project: {
      ...project, cues,
      ...(shownTranslation ? { shownTranslation } : {}),
      ...(translationRuns.length ? { translationRuns: [...(project.translationRuns ?? []), ...translationRuns] } : {}),
      transcriptionRuns: [...(project.transcriptionRuns ?? []), { ...runRecord, ...(assetId ? { mediaAssetId: assetId } : {}), recognition: structuredClone(transcript) }],
    },
    summary: { added: added.length, removed: project.cues.length - kept.length, kept: kept.length, skippedOverlapping: incoming.length - added.length, boundaryKept },
  }
}
