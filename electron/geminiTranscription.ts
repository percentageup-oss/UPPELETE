import type { RecognizedWord } from '../src/core/alignment'
import type { JobProgress } from '../src/core/jobs'
import {
  TRANSCRIPTION_CONTRACT_VERSION, type RawTranscriptionOutput, type SegmentTimingAdjustment, type TranscriptionCapabilities, type TranscriptionOptions,
} from '../src/core/transcription'
import type { MediaWorkerClient } from '../workers/media/client'
import type { MediaResult } from '../workers/media/protocol'
import type { TranscriptionAdapter, TranscriptionInput } from '../workers/transcription/contract'
import { GEMINI_TRANSCRIBE_MODEL, type GeminiLocale, type GeminiRecognizer } from './geminiRecognition'

export const GEMINI_ENGINE_ID = 'gemini-api'
export const GEMINI_ENGINE_VERSION = 'v1beta'
/** Upload size bound per request; speech with no 2-second pause for this long is split at a fixed point. */
export const GEMINI_MAX_CHUNK_US = 20 * 60 * 1_000_000
const SEGMENT_PAUSE_US = 800_000
const SEGMENT_MAX_US = 30_000_000
const SENTENCE_END = /[.?!।॥]["'”’)\]]*$/u
const HAS_WORD_CHARACTER = /[\p{L}\p{M}\p{N}]/u

export const geminiCapabilities: TranscriptionCapabilities = {
  contractVersion: TRANSCRIPTION_CONTRACT_VERSION,
  engine: { id: GEMINI_ENGINE_ID, version: GEMINI_ENGINE_VERSION },
  model: { id: GEMINI_TRANSCRIBE_MODEL },
  transcription: {
    languages: ['ml', 'en'], autoDetectLanguage: true, devices: ['cpu'], inputSampleRates: [16000],
    wordTiming: 'model', confidence: { segment: false, word: false },
  },
  alignment: null,
}

/**
 * `auto` returns no locale at all. The transcription docs are explicit that `language_codes`
 * "omitted or empty" is what enables detection *and* code-switching — the model "handles
 * intra-sentence and inter-sentential code-switching without manual configuration", and Google's own
 * word-timestamp sample sends no `language_codes`. Pinning `['ml-IN', 'en-IN']` here was that manual
 * configuration: each speech chunk is its own request, so the model committed to one language per
 * chunk and wrote spoken English phonetically in Malayalam script ("സീ യു" for "See you").
 * `ml`/`en` still pin one locale — those options exist precisely to force one script, and the
 * Transcribe dialog says so.
 */
export function geminiLocales(language: TranscriptionOptions['language']): GeminiLocale[] {
  return language === 'ml' ? ['ml-IN'] : language === 'en' ? ['en-IN'] : []
}

type RawSegment = RawTranscriptionOutput['segments'][number]
type Word = { text: string; startUs: number; endUs: number }

/**
 * Turns Gemini's timed words for one chunk (chunk-relative µs) into readable segments. Segment text is exactly the
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

export type GeminiRunReport = Omit<Extract<MediaResult, { operation: 'speechChunks' }>, 'operation'> & {
  inputTokens: number; outputTokens: number; droppedWords: number
  /** Model output that could not become a timed word (see `GeminiRecognition.droppedAnnotations`) — text
   * Gemini produced that never reached the transcript, surfaced instead of silently vanishing. */
  droppedAnnotations: number
}

/**
 * Cloud adapter behind the same contract as whisper.cpp: the worker gates long silences and writes speech chunk
 * files (silence is never uploaded), each chunk is recognized separately, and chunk-relative word times are offset
 * to the extracted audio. `runTranscription` then performs the single source-time mapping and validation.
 */
export class GeminiTranscriptionAdapter implements TranscriptionAdapter {
  lastRun: GeminiRunReport | null = null

  constructor(
    private readonly worker: Pick<MediaWorkerClient, 'start'>,
    private readonly recognize: GeminiRecognizer,
    private readonly chunkDirectory: string,
  ) {}

  async capabilities(): Promise<TranscriptionCapabilities> { return geminiCapabilities }

  async transcribe(input: TranscriptionInput, options: TranscriptionOptions, progress: (value: JobProgress) => void, cancellation: AbortSignal): Promise<RawTranscriptionOutput> {
    progress({ kind: 'indeterminate', phase: 'recognizing' })
    const plan = await this.worker.start({
      operation: 'speechChunks', audioPath: input.audio.path, outputDirectory: this.chunkDirectory, durationUs: input.audio.durationUs, maxChunkUs: GEMINI_MAX_CHUNK_US,
    }, { signal: cancellation, timeoutMs: Math.min(86_400_000, 300_000 + Math.ceil(input.audio.durationUs / 1000)) }).result
    const locales = geminiLocales(options.language)
    const segments: RawSegment[] = []
    let inputTokens = 0, outputTokens = 0, droppedWords = 0, droppedAnnotations = 0
    for (const [index, chunk] of plan.chunks.entries()) {
      if (plan.chunks.length) progress({ kind: 'measured', phase: 'recognizing', completed: index, total: plan.chunks.length, unit: 'items' })
      const result = await this.recognize(chunk.path, { locales }, cancellation)
      const chunkSegments = segmentsFromWords(result.words, chunk.endUs - chunk.startUs)
      const offset = (value: number) => chunk.startUs + value
      for (const segment of chunkSegments.segments) {
        segments.push({ ...segment, startUs: offset(segment.startUs), endUs: offset(segment.endUs), words: segment.words?.map((word) => ({ ...word, startUs: offset(word.startUs), endUs: offset(word.endUs) })) })
      }
      droppedWords += chunkSegments.droppedWords
      droppedAnnotations += result.droppedAnnotations
      inputTokens += result.usage.inputTokens ?? 0; outputTokens += result.usage.outputTokens ?? 0
    }
    if (plan.chunks.length) progress({ kind: 'measured', phase: 'recognizing', completed: plan.chunks.length, total: plan.chunks.length, unit: 'items' })
    this.lastRun = { speechGating: plan.speechGating, silences: plan.silences, chunks: plan.chunks, inputTokens, outputTokens, droppedWords, droppedAnnotations }
    return {
      engine: GEMINI_ENGINE_ID, model: GEMINI_TRANSCRIBE_MODEL,
      // Gemini reports no language; a mixed request is recorded as Malayalam, as the alignment path does.
      language: options.language === 'auto' ? (segments.length ? 'ml' : null) : options.language,
      segments,
    }
  }
}
