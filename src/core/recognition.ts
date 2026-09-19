import type { Cue } from './model'
import { sourceTimedTranscriptSchema, translatedTranscriptSchema, type SourceTimedTranscript, type TranslatedTranscript } from './transcription'
import { captionTokens, locateWordSpans } from './captionText'
import { estimateWordTimings, untimedTokenCount } from './wordTiming'

/** Recognition is immutable evidence. Create editable identities independently of grouping. */
export function recognitionToCaptions(transcript: SourceTimedTranscript, runId: string, newId: () => string): Cue[] {
  const checked = sourceTimedTranscriptSchema.parse(transcript)
  return checked.segments.map((segment) => {
    const spans = locateWordSpans(segment.text, segment.words)
    if (!spans) throw new Error('Recognized words must match whole words/graphemes in the recognized text.')
    const cue: Cue = {
      id: newId(), startUs: segment.startUs, endUs: segment.endUs, text: segment.text,
      timingSource: 'model', textSource: 'model', needsReview: segment.timingAdjustment !== null,
      transcriptionRunId: runId,
      words: segment.words.map((word, index) => ({
        ...word, ...spans[index], id: newId(), needsReview: segment.timingAdjustment !== null,
      })),
    }
    if (!segment.words.length && captionTokens(cue.text).length <= cue.endUs - cue.startUs) cue.words = estimateWordTimings(cue, newId)
    cue.needsReview ||= cue.words.some((word) => word.needsReview) || untimedTokenCount(cue) > 0
    return cue
  })
}

/**
 * Builds captions from a Gemini translation of the recognized text instead of the recognized
 * text itself. Segment timing (source-media time) is exactly the recognizer's — a translated
 * caption still displays for the same window the original speech occupied — but a translated
 * word never inherits the source word's timing, since it does not correspond to that audio
 * position. Word timing is instead estimated across the segment and always flagged for review.
 */
export function translatedRecognitionToCaptions(
  transcript: SourceTimedTranscript,
  translation: TranslatedTranscript,
  runId: string,
  newId: () => string,
): Cue[] {
  const checkedTranscript = sourceTimedTranscriptSchema.parse(transcript)
  const checkedTranslation = translatedTranscriptSchema.parse(translation)
  if (checkedTranslation.segments.length !== checkedTranscript.segments.length) {
    throw new Error('Translation segment count must match the recognized transcript segment count.')
  }
  return checkedTranscript.segments.map((segment, index) => {
    const cue: Cue = {
      id: newId(), startUs: segment.startUs, endUs: segment.endUs, text: checkedTranslation.segments[index].text,
      timingSource: 'model', textSource: 'model', needsReview: true,
      transcriptionRunId: runId,
      words: [],
    }
    if (captionTokens(cue.text).length <= cue.endUs - cue.startUs) cue.words = estimateWordTimings(cue, newId)
    return cue
  })
}
