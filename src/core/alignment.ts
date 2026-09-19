import { captionTokens, locateWordSpans } from './captionText'
import { projectSchema, type AlignmentRun, type CaptionProject, type CaptionWord } from './model'
import type { AlignedTranscript, AudioRelativeAlignmentSegment, RawAlignmentOutput } from './transcription'
import { estimateMissingWordTimings } from './wordTiming'

export type RecognizedWord = { text: string; startUs: number; endUs: number }

/** Comparison-only normalization. Returned words always retain the exact imported SRT token. */
export function alignmentKey(value: string): string {
  return value.normalize('NFC').toLocaleLowerCase().replace(/[\p{P}\p{S}]/gu, '')
}

/**
 * Exact monotonic token matching. This deliberately has no fuzzy path: uncertain provider text is
 * omitted and will remain an explicitly estimated fallback in project state.
 */
export function matchRecognizedWords(
  segments: readonly AudioRelativeAlignmentSegment[],
  recognized: readonly RecognizedWord[],
  engine = 'gemini',
  model = 'gemini-3.5-transcribe',
): RawAlignmentOutput {
  let recognitionCursor = 0
  const output = segments.map((segment) => {
    const tokens = captionTokens(segment.text)
    const candidates = recognized
      .map((word, index) => ({ word, index }))
      .filter(({ word, index }) => index >= recognitionCursor && word.startUs >= segment.startUs && word.endUs <= segment.endUs)
    const rows = tokens.length + 1, cols = candidates.length + 1
    const score = Array.from({ length: rows }, () => new Uint32Array(cols))
    for (let i = tokens.length - 1; i >= 0; i--) for (let j = candidates.length - 1; j >= 0; j--) {
      score[i][j] = alignmentKey(tokens[i].text) !== '' && alignmentKey(tokens[i].text) === alignmentKey(candidates[j].word.text)
        ? score[i + 1][j + 1] + 1
        : Math.max(score[i + 1][j], score[i][j + 1])
    }
    const words: RecognizedWord[] = []
    let i = 0, j = 0
    while (i < tokens.length && j < candidates.length) {
      const token = tokens[i], candidate = candidates[j]
      if (alignmentKey(token.text) !== '' && alignmentKey(token.text) === alignmentKey(candidate.word.text)
        && score[i][j] === score[i + 1][j + 1] + 1) {
        words.push({ text: token.text, startUs: candidate.word.startUs, endUs: candidate.word.endUs })
        recognitionCursor = candidate.index + 1
        i++; j++
      } else if (score[i + 1][j] >= score[i][j + 1]) i++
      else j++
    }
    return { id: segment.id, words }
  })
  return { engine, model, language: 'ml', segments: output }
}

function overlaps(a: CaptionWord, b: CaptionWord) {
  return a.startUs < b.endUs && b.startUs < a.endUs
}

/** Applies a validated partial result as one immutable project mutation. Manual timing always wins. */
export function applyAlignment(
  project: CaptionProject,
  transcript: AlignedTranscript,
  runBase: Omit<AlignmentRun, 'alignedWordCount' | 'estimatedWordCount'>,
  newId: () => string,
): CaptionProject {
  const byId = new Map(transcript.segments.map((segment) => [segment.id, segment]))
  let alignedWordCount = 0, estimatedWordCount = 0
  const cues = project.cues.map((cue) => {
    const segment = byId.get(cue.id)
    if (!segment) return cue
    const spans = locateWordSpans(cue.text, segment.words)
    if (!spans) return cue
    const aligned: CaptionWord[] = segment.words.map((word, index) => ({
      ...word, ...spans[index], id: newId(), timingSource: 'aligned', needsReview: false, alignmentRunId: runBase.id,
    }))
    const manual = cue.words.filter((word) => word.timingSource === 'manual')
    const fixed = [...manual, ...aligned.filter((word) => !manual.some((kept) => overlaps(kept, word)))]
      .sort((a, b) => (a.textStart ?? 0) - (b.textStart ?? 0))
      .filter((word, index, all) => index === 0 || (word.startUs >= all[index - 1].endUs && (word.textStart ?? 0) >= (all[index - 1].textEnd ?? 0)))
    let words: CaptionWord[]
    try { words = estimateMissingWordTimings({ ...cue, words: fixed }, newId) }
    catch { words = cue.words }
    alignedWordCount += words.filter((word) => word.alignmentRunId === runBase.id).length
    estimatedWordCount += words.filter((word) => word.timingSource === 'estimated').length
    return { ...cue, words, needsReview: words.some((word) => word.needsReview) }
  })
  const run: AlignmentRun = { ...runBase, alignedWordCount, estimatedWordCount }
  return projectSchema.parse({ ...project, cues, alignmentRuns: [...(project.alignmentRuns ?? []), run], updatedAt: run.createdAt })
}
