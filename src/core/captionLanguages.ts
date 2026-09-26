import type { CaptionProject, Cue } from './model'
import { isUntouchedModelCue } from './transcriptionApply'
import { captionTokens } from './captionText'
import type { TranslationTarget } from './transcription'
import { estimateWordTimings } from './wordTiming'

/**
 * Language layers: every cue is either an original-language cue (no `translationLanguage`) or belongs to one
 * translation. Anything that decides what is on screen hands its cues through `displayedCues`, so preview, export
 * and SRT can never disagree, and `activeCueAt` keeps seeing one flat list.
 */
export function cuesForLanguage<T extends Pick<Cue, 'translationLanguage'>>(cues: readonly T[], language: TranslationTarget | null): T[] {
  return cues.filter((cue) => (cue.translationLanguage ?? null) === language)
}

/** The cues on screen: the shown translation when it still has cues, otherwise the original layer. */
export function displayedCues<T extends Pick<Cue, 'translationLanguage'>>(cues: readonly T[], shownTranslation: TranslationTarget | undefined | null): T[] {
  if (shownTranslation && cues.some((cue) => cue.translationLanguage === shownTranslation)) return cuesForLanguage(cues, shownTranslation)
  return cuesForLanguage(cues, null)
}

/** The language a caption sequence is currently shown in (`null` = the original), after the fallback `displayedCues` applies. */
export function shownLanguage(cues: readonly Pick<Cue, 'translationLanguage'>[], shownTranslation: TranslationTarget | undefined | null): TranslationTarget | null {
  return shownTranslation && cues.some((cue) => cue.translationLanguage === shownTranslation) ? shownTranslation : null
}

export function projectLanguages(project: Pick<CaptionProject, 'cues' | 'transcriptionRuns'>): { originalLanguage: string | null; translations: TranslationTarget[] } {
  const translations: TranslationTarget[] = []
  for (const cue of project.cues) if (cue.translationLanguage && !translations.includes(cue.translationLanguage)) translations.push(cue.translationLanguage)
  const runs = project.transcriptionRuns ?? []
  return { originalLanguage: runs.length ? runs[runs.length - 1].language : null, translations }
}

/**
 * One translated cue per original cue: same source-media window and video, `model` provenance, always Needs review.
 * Word timing is estimated across the cue, never inherited from the original words (a translated word does not sit
 * at the original word's audio position). A blank translation yields no cue rather than an empty caption.
 */
export function translatedCaptionsFromCues(originals: readonly Cue[], texts: readonly string[], target: TranslationTarget, newId: () => string): Cue[] {
  if (originals.length !== texts.length) throw new Error('Translation line count must match the caption count.')
  return originals.flatMap((original, index) => {
    const text = texts[index].trim()
    if (!text) return []
    const cue: Cue = {
      id: newId(), startUs: original.startUs, endUs: original.endUs, text,
      timingSource: 'model', textSource: 'model', needsReview: true,
      translationLanguage: target, words: [],
      ...(original.mediaAssetId ? { mediaAssetId: original.mediaAssetId } : {}),
      ...(original.captionTrackId ? { captionTrackId: original.captionTrackId } : {}),
      ...(original.transcriptionRunId ? { transcriptionRunId: original.transcriptionRunId } : {}),
    }
    if (captionTokens(text).length <= cue.endUs - cue.startUs) cue.words = estimateWordTimings(cue, newId)
    return [cue]
  })
}

const belongsToVideo = (cue: Pick<Cue, 'mediaAssetId'>, assetId: string) => !cue.mediaAssetId || cue.mediaAssetId === assetId

/** The picked video's original-language cues (user edits included), in time order: the source text for translating. */
export function originalCuesOfVideo(cues: readonly Cue[], assetId: string): Cue[] {
  return cuesForLanguage(cues, null).filter((cue) => belongsToVideo(cue, assetId)).sort((a, b) => a.startUs - b.startUs || a.endUs - b.endUs)
}

/** How many cues a language already has for this video, and how many of them the user edited (those are never replaced). */
export function describeTranslationLayer(cues: readonly Cue[], assetId: string, language: TranslationTarget): { total: number; edited: number } {
  const layer = cuesForLanguage(cues, language).filter((cue) => belongsToVideo(cue, assetId))
  return { total: layer.length, edited: layer.filter((cue) => !isUntouchedModelCue(cue)).length }
}

export type TranslatedLayerResult = { target: TranslationTarget; texts: string[]; model: string; inputTokens?: number; outputTokens?: number }
export type TranslationApplySummary = { target: TranslationTarget; added: number; replaced: number; keptEdited: number }

/**
 * Adds a translated layer per result as one project value (one undo step). An existing layer for the same video keeps
 * the cues the user edited and replaces only untouched model cues; a new cue overlapping a kept one is skipped.
 * Appends a `translationRuns` entry per language and leaves `shownTranslation` alone.
 */
export function applyTranslatedLayers(
  project: CaptionProject, assetId: string, sourceLanguage: string | null, originals: readonly Cue[], results: readonly TranslatedLayerResult[], newId: () => string,
): { project: CaptionProject; summaries: TranslationApplySummary[] } {
  let cues = [...project.cues]
  const summaries: TranslationApplySummary[] = []
  const newRuns = []
  const createdAt = new Date().toISOString()
  for (const result of results) {
    const incoming = translatedCaptionsFromCues(originals, result.texts, result.target, newId)
    const inLayer = (cue: Cue) => cue.translationLanguage === result.target && belongsToVideo(cue, assetId)
    const replaceable = cues.filter((cue) => inLayer(cue) && isUntouchedModelCue(cue))
    const keptEdited = cues.filter((cue) => inLayer(cue) && !isUntouchedModelCue(cue))
    const kept = cues.filter((cue) => !replaceable.includes(cue))
    const added = incoming.filter((cue) => !keptEdited.some((existing) => existing.startUs < cue.endUs && cue.startUs < existing.endUs))
    cues = [...kept, ...added]
    summaries.push({ target: result.target, added: added.length, replaced: replaceable.length, keptEdited: keptEdited.length })
    newRuns.push({
      id: newId(), createdAt, provider: 'gemini' as const, model: result.model, sourceLanguage, targetLanguage: result.target,
      mediaAssetId: assetId, segmentCount: added.length,
      ...(result.inputTokens !== undefined ? { inputTokens: result.inputTokens } : {}), ...(result.outputTokens !== undefined ? { outputTokens: result.outputTokens } : {}),
    })
  }
  cues.sort((a, b) => a.startUs - b.startUs || a.endUs - b.endUs)
  return { project: { ...project, cues, ...(newRuns.length ? { translationRuns: [...(project.translationRuns ?? []), ...newRuns] } : {}) }, summaries }
}
