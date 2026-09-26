import type { RecognizedWord } from '../src/core/alignment'
import type { JobProgress } from '../src/core/jobs'
import {
  TRANSCRIPTION_CONTRACT_VERSION, type RawTranscriptionOutput, type SegmentTimingAdjustment, type TranscriptionCapabilities, type TranscriptionOptions,
} from '../src/core/transcription'
import { CLOUD_LANGUAGE_CODES, type CloudLanguageChoice, type CloudSpokenLanguage } from '../src/core/transcriptionProviders'
import type { MediaWorkerClient } from '../workers/media/client'
import type { MediaResult } from '../workers/media/protocol'
import type { TranscriptionAdapter, TranscriptionInput } from '../workers/transcription/contract'

const SEGMENT_PAUSE_US = 800_000
const SEGMENT_MAX_US = 30_000_000
const SENTENCE_END = /[.?!।॥]["'”’)\]]*$/u
const HAS_WORD_CHARACTER = /[\p{L}\p{M}\p{N}]/u

export type CloudLanguage = CloudLanguageChoice
export type CloudUsage = { inputTokens?: number; outputTokens?: number }
/** `droppedAnnotations` counts provider output that could not become a timed word, so it is visible instead of silently
 * vanishing. `detectedLanguage` is set only when the provider itself reported a language. */
export type CloudRecognition = { words: RecognizedWord[]; usage: CloudUsage; droppedAnnotations: number; detectedLanguage?: CloudSpokenLanguage | null }
export type CloudRecognizer = (audioPath: string, options: { language: CloudLanguage }, signal: AbortSignal) => Promise<CloudRecognition>

type RawSegment = RawTranscriptionOutput['segments'][number]
type Word = { text: string; startUs: number; endUs: number }

/**
 * Turns a provider's timed words for one chunk (chunk-relative µs) into readable segments. Segment text is exactly the
 * word texts joined by single spaces, so every word is locatable in it. Normalizations are explicit, never silent:
 * words are bounded to the chunk (`end-clamped-to-chunk`) and a word overlapping its predecessor starts at the
 * predecessor's end (`start-moved-after-overlap`); a word left with no duration, and punctuation-only tokens, are
 * joined onto the previous word. The segment carries the first adjustment so it is flagged for review.
 */
export function segmentsFromWords(recognized: readonly RecognizedWord[], chunkDurationUs: number): { segments: RawSegment[]; droppedWords: number } {
  const words: (Word & { adjustment?: SegmentTimingAdjustment })[] = []
  let droppedWords = 0
  for (const original of recognized) {
    const text = original.text.replace(/\s+/gu, ' ').trim()
    if (!text || original.startUs >= chunkDurationUs) { droppedWords += 1; continue }
    const previous = words.at(-1)
    let adjustment: SegmentTimingAdjustment | undefined
    let endUs = original.endUs
    if (endUs > chunkDurationUs) { endUs = chunkDurationUs; adjustment = 'end-clamped-to-chunk' }
    let startUs = original.startUs
    if (previous && startUs < previous.endUs) { startUs = previous.endUs; adjustment ??= 'start-moved-after-overlap' }
    if (previous && (!HAS_WORD_CHARACTER.test(text) || endUs <= startUs)) {
      previous.text = HAS_WORD_CHARACTER.test(text) ? `${previous.text} ${text}` : `${previous.text}${text}`
      previous.endUs = Math.max(previous.endUs, Math.min(endUs, chunkDurationUs))
      previous.adjustment ??= adjustment
      continue
    }
    if (endUs <= startUs || !HAS_WORD_CHARACTER.test(text)) { droppedWords += 1; continue }
    words.push({ text, startUs, endUs, ...(adjustment ? { adjustment } : {}) })
  }

  const segments: RawSegment[] = []
  let current: typeof words = []
  const flush = () => {
    if (!current.length) return
    const adjustment = current.find((word) => word.adjustment)?.adjustment
    segments.push({
      startUs: current[0].startUs, endUs: current.at(-1)!.endUs, text: current.map((word) => word.text).join(' '),
      words: current.map(({ text, startUs, endUs }) => ({ text, startUs, endUs })),
      ...(adjustment ? { timingAdjustment: adjustment } : {}),
    })
    current = []
  }
  for (const word of words) {
    const last = current.at(-1)
    if (last && (word.startUs - last.endUs >= SEGMENT_PAUSE_US || SENTENCE_END.test(last.text) || word.endUs - current[0].startUs > SEGMENT_MAX_US)) flush()
    current.push(word)
  }
  flush()
  return { segments, droppedWords }
}

/** A chunk has no pause of 2 s or more, so a stretch this long with no recognized word is probably missing speech. */
export const UNCOVERED_GAP_US = 10_000_000
export type UncoveredRange = { startUs: number; endUs: number }

/** Stretches of at least `minGapUs` inside `[0, chunkDurationUs]` (chunk-relative) that no segment covers. */
export function uncoveredRanges(segments: readonly { startUs: number; endUs: number }[], chunkDurationUs: number, minGapUs = UNCOVERED_GAP_US): UncoveredRange[] {
  const gaps: UncoveredRange[] = []
  let cursor = 0
  for (const segment of [...segments, { startUs: chunkDurationUs, endUs: chunkDurationUs }]) {
    if (segment.startUs - cursor >= minGapUs) gaps.push({ startUs: cursor, endUs: segment.startUs })
    cursor = Math.max(cursor, segment.endUs)
  }
  return gaps
}

export type CloudRunReport = Omit<Extract<MediaResult, { operation: 'speechChunks' }>, 'operation'> & {
  /** Audio-relative stretches inside speech chunks where the provider returned no words. */
  uncovered: UncoveredRange[]
  inputTokens: number; outputTokens: number; droppedWords: number
  /** Provider output that could not become a timed word (see `CloudRecognition.droppedAnnotations`). */
  droppedAnnotations: number
}

export type CloudAdapterConfig = {
  engineId: string
  engineVersion: string
  model: string
  /** Upload size bound per request; speech with no 2-second pause for this long is split at a fixed point. */
  maxChunkUs: number
}

/**
 * Cloud adapter behind the same contract as whisper.cpp: the worker gates long silences and writes speech chunk
 * files (silence is never uploaded), each chunk is recognized separately, and chunk-relative word times are offset
 * to the extracted audio. `runTranscription` then performs the single source-time mapping and validation.
 * One implementation serves every provider; only the injected recognizer and config differ.
 */
export class CloudTranscriptionAdapter implements TranscriptionAdapter {
  lastRun: CloudRunReport | null = null

  constructor(
    private readonly worker: Pick<MediaWorkerClient, 'start'>,
    private readonly recognize: CloudRecognizer,
    private readonly chunkDirectory: string,
    private readonly config: CloudAdapterConfig,
  ) {}

  async capabilities(): Promise<TranscriptionCapabilities> {
    return {
      contractVersion: TRANSCRIPTION_CONTRACT_VERSION,
      engine: { id: this.config.engineId, version: this.config.engineVersion },
      model: { id: this.config.model },
      transcription: {
        languages: [...CLOUD_LANGUAGE_CODES], autoDetectLanguage: true, devices: ['cpu'], inputSampleRates: [16000],
        wordTiming: 'model', confidence: { segment: false, word: false },
      },
      alignment: null,
    }
  }

  async transcribe(input: TranscriptionInput, options: TranscriptionOptions, progress: (value: JobProgress) => void, cancellation: AbortSignal): Promise<RawTranscriptionOutput> {
    progress({ kind: 'indeterminate', phase: 'recognizing' })
    const plan = await this.worker.start({
      operation: 'speechChunks', audioPath: input.audio.path, outputDirectory: this.chunkDirectory, durationUs: input.audio.durationUs, maxChunkUs: this.config.maxChunkUs,
    }, { signal: cancellation, timeoutMs: Math.min(86_400_000, 300_000 + Math.ceil(input.audio.durationUs / 1000)) }).result
    const language = options.language as CloudLanguage
    const segments: RawSegment[] = []
    const uncovered: UncoveredRange[] = []
    let inputTokens = 0, outputTokens = 0, droppedWords = 0, droppedAnnotations = 0
    let detected: CloudSpokenLanguage | null = null
    for (const [index, chunk] of plan.chunks.entries()) {
      if (plan.chunks.length) progress({ kind: 'measured', phase: 'recognizing', completed: index, total: plan.chunks.length, unit: 'items' })
      const result = await this.recognize(chunk.path, { language }, cancellation)
      detected ??= result.detectedLanguage ?? null
      const chunkSegments = segmentsFromWords(result.words, chunk.endUs - chunk.startUs)
      const offset = (value: number) => chunk.startUs + value
      for (const segment of chunkSegments.segments) {
        segments.push({ ...segment, startUs: offset(segment.startUs), endUs: offset(segment.endUs), words: segment.words?.map((word) => ({ ...word, startUs: offset(word.startUs), endUs: offset(word.endUs) })) })
      }
      for (const gap of uncoveredRanges(chunkSegments.segments, chunk.endUs - chunk.startUs)) uncovered.push({ startUs: offset(gap.startUs), endUs: offset(gap.endUs) })
      droppedWords += chunkSegments.droppedWords
      droppedAnnotations += result.droppedAnnotations
      inputTokens += result.usage.inputTokens ?? 0; outputTokens += result.usage.outputTokens ?? 0
    }
    if (plan.chunks.length) progress({ kind: 'measured', phase: 'recognizing', completed: plan.chunks.length, total: plan.chunks.length, unit: 'items' })
    this.lastRun = { speechGating: plan.speechGating, silences: plan.silences, chunks: plan.chunks, uncovered, inputTokens, outputTokens, droppedWords, droppedAnnotations }
    return {
      engine: this.config.engineId, model: this.config.model,
      // A provider-reported language wins; otherwise a mixed request is recorded as Malayalam, as the alignment path does.
      language: language === 'auto' ? (segments.length ? (detected ?? 'ml') : null) : language,
      segments,
    }
  }
}
