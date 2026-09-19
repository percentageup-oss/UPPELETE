/**
 * Pure, deterministic accuracy metrics for comparing a candidate ASR model's transcript against a
 * hand-corrected reference, used only by `scripts/transcription-bench.ts` (never by the shipped
 * app). Whisper's own English-oriented text normalizer is known to distort Malayalam (see
 * `sujithatz/ggml-whisper-medium-ml`'s model card: 38.6% WER without normalization vs. 11.5% with
 * it — the normalizer is doing most of the "improvement" by mangling both sides identically); this
 * module normalizes only punctuation/whitespace/case and never rewrites script or spelling.
 *
 * Word error rate is measured on whitespace-separated tokens, which is a genuine limitation for
 * Malayalam: it is agglutinative and often under-spaced compared to English, so WER here is a
 * coarser, stricter signal than for English. Character error rate is measured over Unicode
 * grapheme clusters (`Intl.Segmenter`), so a Malayalam vowel sign is never split from its base
 * consonant and counted as a separate edit — the same rule `captionText.ts` and `scriptCheck.ts`
 * already apply to this text.
 */

export type EditCounts = { substitutions: number; deletions: number; insertions: number; matches: number }
export type ErrorRateResult = { rate: number | null; referenceLength: number } & EditCounts

const PUNCTUATION = /[\p{P}\p{S}]/gu
const WHITESPACE = /\s+/g

/** NFC-normalizes, strips punctuation/symbols, lowercases and collapses whitespace. Never touches script. */
export function normalizeForComparison(text: string): string {
  return text.normalize('NFC').replace(PUNCTUATION, ' ').toLowerCase().replace(WHITESPACE, ' ').trim()
}

function tokenizeWords(text: string): string[] {
  const normalized = normalizeForComparison(text)
  return normalized.length === 0 ? [] : normalized.split(' ')
}

function graphemes(text: string): string[] {
  const normalized = normalizeForComparison(text).replace(/ /g, '')
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  return [...segmenter.segment(normalized)].map((entry) => entry.segment)
}

/**
 * Classic Levenshtein alignment (substitution/deletion/insertion all cost 1) with a backtrace, so
 * the result reports which edit types occurred rather than only their total. `reference` is the
 * hand-corrected text; `hypothesis` is the candidate model's output.
 */
function editCounts<T>(reference: readonly T[], hypothesis: readonly T[]): EditCounts {
  const rows = reference.length + 1
  const cols = hypothesis.length + 1
  const cost = new Uint32Array(rows * cols)
  const at = (row: number, col: number) => row * cols + col
  for (let row = 0; row < rows; row += 1) cost[at(row, 0)] = row
  for (let col = 0; col < cols; col += 1) cost[at(0, col)] = col
  for (let row = 1; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      if (reference[row - 1] === hypothesis[col - 1]) { cost[at(row, col)] = cost[at(row - 1, col - 1)]; continue }
      cost[at(row, col)] = 1 + Math.min(cost[at(row - 1, col - 1)], cost[at(row - 1, col)], cost[at(row, col - 1)])
    }
  }
  const counts: EditCounts = { substitutions: 0, deletions: 0, insertions: 0, matches: 0 }
  let row = reference.length
  let col = hypothesis.length
  while (row > 0 || col > 0) {
    if (row > 0 && col > 0 && reference[row - 1] === hypothesis[col - 1]) { counts.matches += 1; row -= 1; col -= 1; continue }
    const diagonal = row > 0 && col > 0 ? cost[at(row - 1, col - 1)] : Infinity
    const up = row > 0 ? cost[at(row - 1, col)] : Infinity
    const left = col > 0 ? cost[at(row, col - 1)] : Infinity
    const best = Math.min(diagonal, up, left)
    if (diagonal <= best) { counts.substitutions += 1; row -= 1; col -= 1 }
    else if (up <= best) { counts.deletions += 1; row -= 1 }
    else { counts.insertions += 1; col -= 1 }
  }
  return counts
}

function errorRate(counts: EditCounts, referenceLength: number): ErrorRateResult {
  return { ...counts, referenceLength, rate: referenceLength === 0 ? null : (counts.substitutions + counts.deletions + counts.insertions) / referenceLength }
}

/** Word error rate on whitespace-separated, normalized tokens. `null` rate when the reference is empty. */
export function wordErrorRate(reference: string, hypothesis: string): ErrorRateResult {
  const referenceWords = tokenizeWords(reference)
  return errorRate(editCounts(referenceWords, tokenizeWords(hypothesis)), referenceWords.length)
}

/** Character error rate on Unicode grapheme clusters (spaces excluded). `null` rate when the reference is empty. */
export function characterErrorRate(reference: string, hypothesis: string): ErrorRateResult {
  const referenceGraphemes = graphemes(reference)
  return errorRate(editCounts(referenceGraphemes, graphemes(hypothesis)), referenceGraphemes.length)
}

export type LatinRecallResult = { recall: number | null; matched: number; total: number }

/**
 * How many distinct Latin-script tokens (English technical terms, product names, acronyms) in the
 * reference also appear somewhere in the hypothesis. Mixed Malayalam/English speech is the
 * project's primary content (`docs/PRODUCT.md`), and WER alone can hide a model that reproduces
 * Malayalam passably but drops or mistranscribes every English term. `null` when the reference has
 * no Latin-script tokens to check.
 */
export function latinTokenRecall(reference: string, hypothesis: string): LatinRecallResult {
  const isLatinToken = (token: string) => /\p{Script=Latin}/u.test(token) && !/[^\p{Script=Latin}\p{N}]/u.test(token)
  const referenceTokens = new Set(tokenizeWords(reference).filter(isLatinToken))
  if (referenceTokens.size === 0) return { recall: null, matched: 0, total: 0 }
  const hypothesisTokens = new Set(tokenizeWords(hypothesis).filter(isLatinToken))
  const matched = [...referenceTokens].filter((token) => hypothesisTokens.has(token)).length
  return { recall: matched / referenceTokens.size, matched, total: referenceTokens.size }
}

export type RepetitionResult = { repeated: boolean; example: string | null }

/** Minimum consecutive repeats of one word, or of one whole segment, before it is flagged as a loop. */
const REPEAT_WORD_THRESHOLD = 4
const REPEAT_SEGMENT_THRESHOLD = 2

/**
 * Flags the runaway repetition/looping failure mode independently reported for LLM-based speech
 * recognition (Gemma 4 audio: "repeated phrases, invented content ... incomplete processing"),
 * which word/character error rate alone does not distinguish from ordinary substitution errors.
 */
export function detectRepetition(segments: readonly string[]): RepetitionResult {
  for (const segment of segments) {
    const words = tokenizeWords(segment)
    let run = 1
    for (let index = 1; index < words.length; index += 1) {
      run = words[index] === words[index - 1] ? run + 1 : 1
      if (run >= REPEAT_WORD_THRESHOLD) return { repeated: true, example: words[index] }
    }
  }
  let run = 1
  for (let index = 1; index < segments.length; index += 1) {
    const previous = normalizeForComparison(segments[index - 1])
    run = previous.length > 0 && normalizeForComparison(segments[index]) === previous ? run + 1 : 1
    if (run >= REPEAT_SEGMENT_THRESHOLD) return { repeated: true, example: segments[index] }
  }
  return { repeated: false, example: null }
}

export type CueDurationStats = { count: number; medianSeconds: number | null; maxSeconds: number | null; overThresholdCount: number }

/**
 * Cue-length sanity check: a fine-tune that lost segment-timestamp prediction (for example one
 * tuned for short dictation, like the FUTO "ACFT" pass) tends to produce a few very long cues
 * instead of many short ones, which is unusable for subtitles even with perfect text.
 */
export function cueDurationStats(segments: readonly { startUs: number; endUs: number }[], thresholdSeconds = 7): CueDurationStats {
  const durationsSeconds = segments.map((segment) => (segment.endUs - segment.startUs) / 1_000_000).sort((a, b) => a - b)
  if (durationsSeconds.length === 0) return { count: 0, medianSeconds: null, maxSeconds: null, overThresholdCount: 0 }
  const mid = Math.floor(durationsSeconds.length / 2)
  const median = durationsSeconds.length % 2 === 0 ? (durationsSeconds[mid - 1] + durationsSeconds[mid]) / 2 : durationsSeconds[mid]
  return {
    count: durationsSeconds.length,
    medianSeconds: median,
    maxSeconds: durationsSeconds[durationsSeconds.length - 1],
    overThresholdCount: durationsSeconds.filter((seconds) => seconds > thresholdSeconds).length,
  }
}

export type AsrBenchmarkResult = {
  wer: ErrorRateResult
  cer: ErrorRateResult
  latinRecall: LatinRecallResult
  repetition: RepetitionResult
  cueDurations: CueDurationStats
}

/** Combines every metric above over one transcript's segments against one hand-corrected reference. */
export function benchmarkTranscript(reference: string, segments: readonly { startUs: number; endUs: number; text: string }[]): AsrBenchmarkResult {
  const hypothesis = segments.map((segment) => segment.text).join(' ')
  return {
    wer: wordErrorRate(reference, hypothesis),
    cer: characterErrorRate(reference, hypothesis),
    latinRecall: latinTokenRecall(reference, hypothesis),
    repetition: detectRepetition(segments.map((segment) => segment.text)),
    cueDurations: cueDurationStats(segments),
  }
}
