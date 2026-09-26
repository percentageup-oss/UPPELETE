import { z } from 'zod'
import { jobFailure } from './jobs'
import { locateWordSpans } from './captionText'
import { checkTranscriptScript } from './scriptCheck'

/**
 * Typed transcription/alignment contracts. Any backend (whisper.cpp in T3, faster-whisper
 * later) implements `TranscriptionAdapter` in `workers/transcription/contract.ts` against
 * these schemas. Adapters report timestamps relative to the audio file they were given;
 * this module performs the single, explicit mapping back to source-media microseconds and
 * rejects everything a backend cannot be trusted to have gotten right. Nothing here invents
 * text for silence, upgrades estimated timing to aligned timing, or lets a "corrected" word
 * list rewrite the original recognized/imported text.
 */

export const TRANSCRIPTION_CONTRACT_VERSION = 1

const microseconds = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const confidenceSchema = z.number().min(0).max(1)

/**
 * An explicit timing normalization an adapter applied to backend output (for example an end clamped to the
 * audio actually given to the engine). Such a segment is surfaced for review and never presented as the
 * backend's unmodified timing.
 */
export const segmentTimingAdjustmentSchema = z.enum(['end-clamped-to-chunk', 'zero-duration-extended', 'start-moved-after-overlap'])
export type SegmentTimingAdjustment = z.infer<typeof segmentTimingAdjustmentSchema>

// ISO 639-1/639-2 style codes only ('ml', 'en', 'mal'); never a locale tag or a wildcard.
export const languageCodeSchema = z.string().regex(/^[a-z]{2,3}$/, 'Expected a lowercase ISO 639 language code')
export type LanguageCode = z.infer<typeof languageCodeSchema>

/**
 * A stored or requested translation target: a spoken-language code, or one of two romanized (Latin-script)
 * transliteration targets. Recognition-side fields keep `languageCodeSchema`.
 */
export const translationTargetSchema = languageCodeSchema.or(z.enum(['hi-latn', 'ml-latn']))
export type TranslationTarget = z.infer<typeof translationTargetSchema>

function uniqueArray<T>(items: T[]): boolean {
  return new Set(items).size === items.length
}

export const transcriptionCapabilitiesSchema = z.strictObject({
  contractVersion: z.literal(TRANSCRIPTION_CONTRACT_VERSION),
  engine: z.strictObject({ id: z.string().min(1).max(128), version: z.string().min(1).max(128) }),
  model: z.strictObject({ id: z.string().min(1).max(256) }),
  transcription: z.strictObject({
    languages: z.array(languageCodeSchema).min(1).max(256).refine(uniqueArray, 'Declared languages must be unique'),
    autoDetectLanguage: z.boolean(),
    devices: z.array(z.enum(['cpu', 'metal', 'cuda', 'vulkan'])).min(1).max(8)
      .refine(uniqueArray, 'Declared devices must be unique')
      .refine((devices) => devices.includes('cpu'), 'CPU fallback must always be declared'),
    inputSampleRates: z.array(z.union([z.literal(16000), z.literal(48000)])).min(1).max(2).refine(uniqueArray, 'Declared sample rates must be unique'),
    wordTiming: z.enum(['none', 'model']),
    confidence: z.strictObject({ segment: z.boolean(), word: z.boolean() }),
  }),
  // Explicit and independent of transcription.languages: never assume an aligner supports
  // a language just because the recognizer does.
  alignment: z.strictObject({
    languages: z.array(languageCodeSchema).min(1).max(256).refine(uniqueArray, 'Declared alignment languages must be unique'),
    granularity: z.literal('word'),
  }).nullable(),
})
export type TranscriptionCapabilities = z.infer<typeof transcriptionCapabilitiesSchema>

export const transcriptionOptionsSchema = z.strictObject({
  language: z.union([languageCodeSchema, z.literal('auto')]),
  device: z.enum(['cpu', 'metal', 'cuda', 'vulkan']),
  wordTimestamps: z.boolean(),
})
export type TranscriptionOptions = z.infer<typeof transcriptionOptionsSchema>

/** Throws a structured JobFailure before any adapter call is made. */
export function checkTranscriptionOptions(capabilities: TranscriptionCapabilities, options: TranscriptionOptions): void {
  if (options.language === 'auto') {
    if (!capabilities.transcription.autoDetectLanguage) {
      throw jobFailure('UNSUPPORTED_OPTION', 'This model does not support automatic language detection.')
    }
  } else if (!capabilities.transcription.languages.includes(options.language)) {
    throw jobFailure('UNSUPPORTED_LANGUAGE', `Language "${options.language}" is not supported by this model.`)
  }
  if (!capabilities.transcription.devices.includes(options.device)) {
    throw jobFailure('UNSUPPORTED_OPTION', `Device "${options.device}" is not supported by this model.`)
  }
  if (options.wordTimestamps && capabilities.transcription.wordTiming === 'none') {
    throw jobFailure('UNSUPPORTED_OPTION', 'This model does not report word timestamps.')
  }
}

/** Throws a structured JobFailure before any adapter call is made. */
export function checkAudioSampleRate(capabilities: TranscriptionCapabilities, sampleRate: number): void {
  if (!capabilities.transcription.inputSampleRates.includes(sampleRate as 16000 | 48000)) {
    throw jobFailure('INVALID_INPUT', `Audio sample rate ${sampleRate} Hz is not accepted by this model.`)
  }
}

const rawWordSchema = z.strictObject({
  startUs: microseconds,
  endUs: microseconds,
  text: z.string().max(1000),
  confidence: confidenceSchema.optional(),
}).refine((word) => word.endUs > word.startUs, 'Word end must follow its start')

const rawSegmentSchema = z.strictObject({
  startUs: microseconds,
  endUs: microseconds,
  text: z.string().max(10000),
  confidence: confidenceSchema.optional(),
  words: z.array(rawWordSchema).max(10000).optional(),
  timingAdjustment: segmentTimingAdjustmentSchema.optional(),
}).refine((segment) => segment.endUs > segment.startUs, 'Segment end must follow its start')

/** What an adapter returns: timestamps relative to the start of the audio it was given. */
export const rawTranscriptionOutputSchema = z.strictObject({
  engine: z.string().min(1).max(128),
  model: z.string().min(1).max(256),
  // Null only when auto-detection was requested and no speech reached the recognizer at all.
  language: languageCodeSchema.nullable(),
  segments: z.array(rawSegmentSchema).max(100000),
})
export type RawTranscriptionOutput = z.infer<typeof rawTranscriptionOutputSchema>

const timedWordResultSchema = z.strictObject({
  startUs: microseconds,
  endUs: microseconds,
  text: z.string().max(1000),
  confidence: confidenceSchema.nullable(),
  timingSource: z.literal('model'),
}).refine((word) => word.endUs > word.startUs, 'Word end must follow its start')

const timedSegmentResultSchema = z.strictObject({
  startUs: microseconds,
  endUs: microseconds,
  text: z.string().max(10000),
  confidence: confidenceSchema.nullable(),
  words: z.array(timedWordResultSchema).max(10000),
  timingAdjustment: segmentTimingAdjustmentSchema.nullable(),
}).refine((segment) => segment.endUs > segment.startUs, 'Segment end must follow its start')

/** The validated, source-time-mapped result T3/T4 consume. */
export const sourceTimedTranscriptSchema = z.strictObject({
  contractVersion: z.literal(TRANSCRIPTION_CONTRACT_VERSION),
  engine: z.string().min(1).max(128),
  model: z.string().min(1).max(256),
  language: languageCodeSchema.nullable(),
  sourceRange: z.strictObject({ startUs: microseconds, endUs: microseconds }).refine((r) => r.endUs > r.startUs, 'Range end must follow its start'),
  segments: z.array(timedSegmentResultSchema).max(100000),
}).superRefine((transcript, context) => {
  if (!isOrderedNonOverlapping(transcript.segments)) context.addIssue({ code: 'custom', message: 'Recognition segments must be ordered and non-overlapping.' })
  for (const segment of transcript.segments) {
    if (segment.startUs < transcript.sourceRange.startUs || segment.endUs > transcript.sourceRange.endUs
      || !hasCleanText(segment.text) || !isOrderedNonOverlapping(segment.words)
      || !locateWordSpans(segment.text, segment.words)
      || segment.words.some((word) => word.startUs < segment.startUs || word.endUs > segment.endUs || !hasCleanText(word.text))) {
      context.addIssue({ code: 'custom', message: 'Recognition words and segments must match text and source-time bounds.' })
    }
  }
})
export type SourceTimedTranscript = z.infer<typeof sourceTimedTranscriptSchema>

// --- Translation -------------------------------------------------------------------------

/**
 * Gemini's translation of a validated source-timed transcript's segment texts, index-aligned
 * with `SourceTimedTranscript.segments` (same length, same order). Carries no timing of its
 * own: translated captions take the source segment's timing but never its word timestamps,
 * because a translated word does not correspond to the audio at the source word's position.
 */
export const translatedTranscriptSchema = z.strictObject({
  contractVersion: z.literal(TRANSCRIPTION_CONTRACT_VERSION),
  provider: z.literal('gemini'),
  model: z.string().min(1).max(256),
  targetLanguage: translationTargetSchema,
  segments: z.array(z.strictObject({ text: z.string().min(1).max(10000) })).max(100000),
})
export type TranslatedTranscript = z.infer<typeof translatedTranscriptSchema>

// C0 controls other than tab/newline/carriage-return, plus DEL. A literal newline is kept
// because multiline cues are legitimate; other control characters indicate corrupted output.
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

function hasCleanText(text: string): boolean {
  return text.trim().length > 0 && !CONTROL_CHARS.test(text) && !LONE_SURROGATE.test(text)
}

function isOrderedNonOverlapping(items: readonly { startUs: number; endUs: number }[]): boolean {
  for (let index = 1; index < items.length; index += 1) {
    if (items[index].startUs < items[index - 1].endUs) return false
  }
  return true
}

/**
 * Validates a translator's raw output against the source-language transcript it was given:
 * schema-valid, exactly one clean, non-empty text per source segment, in the same order. A
 * count mismatch is rejected outright rather than guessed at — that would silently misalign
 * translated text against the wrong source timing.
 */
export function validateTranslationOutput(
  source: SourceTimedTranscript,
  target: TranslationTarget,
  model: string,
  raw: unknown,
): TranslatedTranscript {
  const parsed = z.strictObject({ segments: z.array(z.strictObject({ text: z.string().max(10000) })).max(100000) }).safeParse(raw)
  if (!parsed.success) throw jobFailure('MALFORMED_OUTPUT', 'Translation output does not match the required schema.', { diagnostic: parsed.error.message.slice(0, 8192) })
  if (parsed.data.segments.length !== source.segments.length) {
    throw jobFailure('MALFORMED_OUTPUT', `Translation returned ${parsed.data.segments.length} segment(s) but the transcript has ${source.segments.length}.`)
  }
  const segments = parsed.data.segments.map((segment, index) => {
    if (!hasCleanText(segment.text)) throw jobFailure('MALFORMED_OUTPUT', `Translated segment ${index} has empty or invalid text.`)
    return { text: segment.text }
  })
  return translatedTranscriptSchema.parse({ contractVersion: TRANSCRIPTION_CONTRACT_VERSION, provider: 'gemini' as const, model, targetLanguage: target, segments })
}

export type AudioWindow = { sourceStartUs: number; durationUs: number }

/**
 * Validates raw adapter output against declared capabilities/options and maps every
 * timestamp to source-media time exactly once (`sourceStartUs + relativeUs`). Throws
 * `MALFORMED_OUTPUT` (or `INVALID_CAPABILITIES`) rather than ever returning a project-
 * mutation-ready value built on backend output that cannot be trusted.
 */
export function validateTranscriptionOutput(
  window: AudioWindow,
  capabilities: TranscriptionCapabilities,
  options: TranscriptionOptions,
  raw: unknown,
): SourceTimedTranscript {
  const capabilitiesCheck = transcriptionCapabilitiesSchema.safeParse(capabilities)
  if (!capabilitiesCheck.success) throw jobFailure('INVALID_CAPABILITIES', 'Transcription capabilities failed validation.', { diagnostic: capabilitiesCheck.error.message.slice(0, 8192) })

  const parsed = rawTranscriptionOutputSchema.safeParse(raw)
  if (!parsed.success) throw jobFailure('MALFORMED_OUTPUT', 'Transcription output does not match the required schema.', { diagnostic: parsed.error.message.slice(0, 8192) })
  const output = parsed.data

  if (output.engine !== capabilities.engine.id) throw jobFailure('MALFORMED_OUTPUT', `Output reports engine "${output.engine}" but capabilities declared "${capabilities.engine.id}".`)
  if (output.model !== capabilities.model.id) throw jobFailure('MALFORMED_OUTPUT', `Output reports model "${output.model}" but capabilities declared "${capabilities.model.id}".`)
  if (output.language === null) {
    if (options.language !== 'auto' || output.segments.length > 0) {
      throw jobFailure('MALFORMED_OUTPUT', 'Output must report a language whenever one was requested or text was recognized.')
    }
  } else if (options.language === 'auto') {
    if (!capabilities.transcription.languages.includes(output.language)) {
      throw jobFailure('MALFORMED_OUTPUT', `Detected language "${output.language}" is not among the declared supported languages.`)
    }
  } else if (output.language !== options.language) {
    throw jobFailure('MALFORMED_OUTPUT', `Output reports language "${output.language}" but "${options.language}" was requested.`)
  }

  if (!isOrderedNonOverlapping(output.segments)) throw jobFailure('MALFORMED_OUTPUT', 'Segments must be ordered and non-overlapping.')

  // Whisper's `-l` only sets a language token; models of any size can still write fluent wrong-script
  // text (observed: Malayalam speech transcribed as Tamil script on small models, and as Gurmukhi
  // script on large-v3). Catch that before any project mutation.
  if (output.language) {
    const scriptCheck = checkTranscriptScript(output.language, output.segments.map((segment) => segment.text))
    if (!scriptCheck.ok) {
      const advice = capabilities.engine.id === 'gemini-api'
        ? 'Check that the spoken language is set correctly (use Malayalam + English for mixed speech), or expect to correct this section by hand.'
        : capabilities.model.id === 'whisper-large-v3'
        ? 'This happened even with the largest Whisper model, so a bigger model will not fix it — check that the spoken language is set correctly, or expect to correct this section by hand.'
        : 'Smaller Whisper models are unreliable for this language — try a larger model (Whisper large-v3) and transcribe again.'
      throw jobFailure('UNEXPECTED_SCRIPT',
        `Language "${output.language}" was selected, but the recognized text is mostly ${scriptCheck.dominantScript} script, not ${scriptCheck.expectedScript}. ${advice}`,
        { diagnostic: `Expected ${scriptCheck.expectedScript}, got ${scriptCheck.dominantScript} (${Math.round(scriptCheck.dominantShare * 100)}%): ${scriptCheck.sample}`.slice(0, 8192), retryable: false })
    }
  }

  const segments = output.segments.map((segment, segmentIndex) => {
    if (segment.startUs > window.durationUs || segment.endUs > window.durationUs) {
      throw jobFailure('MALFORMED_OUTPUT', `Segment ${segmentIndex} extends past the audio duration.`)
    }
    if (!hasCleanText(segment.text)) throw jobFailure('MALFORMED_OUTPUT', `Segment ${segmentIndex} has empty or invalid text.`)
    if (segment.confidence !== undefined && !capabilities.transcription.confidence.segment) {
      throw jobFailure('MALFORMED_OUTPUT', `Segment ${segmentIndex} reports confidence that was not declared as available.`)
    }
    if (segment.words && segment.words.length > 0) {
      if (capabilities.transcription.wordTiming !== 'model') throw jobFailure('MALFORMED_OUTPUT', 'This recognizer does not declare word timing.')
      if (!locateWordSpans(segment.text, segment.words)) throw jobFailure('MALFORMED_OUTPUT', 'Recognized words must match whole words and grapheme clusters in the original text.')
      if (!options.wordTimestamps) throw jobFailure('MALFORMED_OUTPUT', `Segment ${segmentIndex} reports words that were not requested.`)
      if (!isOrderedNonOverlapping(segment.words)) throw jobFailure('MALFORMED_OUTPUT', `Segment ${segmentIndex} has out-of-order or overlapping words.`)
      for (const [wordIndex, word] of segment.words.entries()) {
        if (word.startUs < segment.startUs || word.endUs > segment.endUs) {
          throw jobFailure('MALFORMED_OUTPUT', `Segment ${segmentIndex} word ${wordIndex} is not contained within its segment.`)
        }
        if (!hasCleanText(word.text)) throw jobFailure('MALFORMED_OUTPUT', `Segment ${segmentIndex} word ${wordIndex} has empty or invalid text.`)
        if (word.confidence !== undefined && !capabilities.transcription.confidence.word) {
          throw jobFailure('MALFORMED_OUTPUT', `Segment ${segmentIndex} word ${wordIndex} reports confidence that was not declared as available.`)
        }
      }
    }

    const mapUs = (relativeUs: number): number => {
      const absolute = window.sourceStartUs + relativeUs
      if (!Number.isSafeInteger(absolute)) throw jobFailure('MALFORMED_OUTPUT', `Segment ${segmentIndex} timestamp overflowed safe integer range after source-offset mapping.`)
      return absolute
    }

    return {
      startUs: mapUs(segment.startUs),
      endUs: mapUs(segment.endUs),
      text: segment.text,
      confidence: segment.confidence ?? null,
      words: (segment.words ?? []).map((word) => ({
        startUs: mapUs(word.startUs),
        endUs: mapUs(word.endUs),
        text: word.text,
        confidence: word.confidence ?? null,
        timingSource: 'model' as const,
      })),
      timingAdjustment: segment.timingAdjustment ?? null,
    }
  })

  return sourceTimedTranscriptSchema.parse({
    contractVersion: TRANSCRIPTION_CONTRACT_VERSION,
    engine: output.engine,
    model: output.model,
    language: output.language,
    sourceRange: { startUs: window.sourceStartUs, endUs: window.sourceStartUs + window.durationUs },
    segments,
  })
}

// --- Alignment -------------------------------------------------------------------------

export const alignmentRequestSegmentSchema = z.strictObject({
  id: z.string().min(1).max(128),
  startUs: microseconds,
  endUs: microseconds,
  text: z.string().min(1).max(10000),
}).refine((segment) => segment.endUs > segment.startUs, 'Segment end must follow its start')
export type AlignmentRequestSegment = z.infer<typeof alignmentRequestSegmentSchema>

export type AudioRelativeAlignmentSegment = { id: string; startUs: number; endUs: number; text: string }

/**
 * Converts caller-supplied cue segments (in source-media time) into the audio-relative
 * time an aligner expects. Rejects any segment that falls outside the extracted audio
 * window rather than silently clamping it.
 */
export function toAudioRelativeSegments(window: AudioWindow, segments: readonly AlignmentRequestSegment[]): AudioRelativeAlignmentSegment[] {
  const windowEndUs = window.sourceStartUs + window.durationUs
  return segments.map((segment) => {
    if (segment.startUs < window.sourceStartUs || segment.endUs > windowEndUs) {
      throw jobFailure('INVALID_INPUT', `Segment "${segment.id}" falls outside the extracted audio window.`)
    }
    return { id: segment.id, startUs: segment.startUs - window.sourceStartUs, endUs: segment.endUs - window.sourceStartUs, text: segment.text }
  })
}

const rawAlignedWordSchema = z.strictObject({
  startUs: microseconds,
  endUs: microseconds,
  text: z.string().max(1000),
}).refine((word) => word.endUs > word.startUs, 'Word end must follow its start')

const rawAlignedSegmentSchema = z.strictObject({
  id: z.string().min(1).max(128),
  words: z.array(rawAlignedWordSchema).max(10000),
})

export const rawAlignmentOutputSchema = z.strictObject({
  engine: z.string().min(1).max(128),
  model: z.string().min(1).max(256),
  language: languageCodeSchema,
  segments: z.array(rawAlignedSegmentSchema).max(100000),
})
export type RawAlignmentOutput = z.infer<typeof rawAlignmentOutputSchema>

const alignedWordResultSchema = z.strictObject({
  startUs: microseconds,
  endUs: microseconds,
  text: z.string().max(1000),
  timingSource: z.literal('aligned'),
}).refine((word) => word.endUs > word.startUs, 'Word end must follow its start')

export const alignedTranscriptSchema = z.strictObject({
  contractVersion: z.literal(TRANSCRIPTION_CONTRACT_VERSION),
  engine: z.string().min(1).max(128),
  model: z.string().min(1).max(256),
  language: languageCodeSchema,
  segments: z.array(z.strictObject({ id: z.string().min(1).max(128), words: z.array(alignedWordResultSchema).max(10000) })).max(100000),
})
export type AlignedTranscript = z.infer<typeof alignedTranscriptSchema>

/**
 * Validates raw alignment output: every requested segment id must be answered exactly
 * once, words must be ordered/contained within their (audio-relative) segment, and every
 * word's text must appear, in order, inside the segment's *original* text — an aligner can
 * time words but can never rewrite the caption text it was given.
 */
export function validateAlignmentOutput(
  window: AudioWindow,
  capabilities: TranscriptionCapabilities,
  requestSegments: readonly AlignmentRequestSegment[],
  relativeSegments: readonly AudioRelativeAlignmentSegment[],
  raw: unknown,
): AlignedTranscript {
  const capabilitiesCheck = transcriptionCapabilitiesSchema.safeParse(capabilities)
  if (!capabilitiesCheck.success) throw jobFailure('INVALID_CAPABILITIES', 'Transcription capabilities failed validation.', { diagnostic: capabilitiesCheck.error.message.slice(0, 8192) })
  if (!capabilities.alignment) throw jobFailure('UNSUPPORTED_OPTION', 'This engine does not support alignment.')

  const parsed = rawAlignmentOutputSchema.safeParse(raw)
  if (!parsed.success) throw jobFailure('MALFORMED_OUTPUT', 'Alignment output does not match the required schema.', { diagnostic: parsed.error.message.slice(0, 8192) })
  const output = parsed.data

  if (output.engine !== capabilities.engine.id) throw jobFailure('MALFORMED_OUTPUT', `Output reports engine "${output.engine}" but capabilities declared "${capabilities.engine.id}".`)
  if (output.model !== capabilities.model.id) throw jobFailure('MALFORMED_OUTPUT', `Output reports model "${output.model}" but capabilities declared "${capabilities.model.id}".`)
  if (!capabilities.alignment.languages.includes(output.language)) throw jobFailure('MALFORMED_OUTPUT', `Output reports language "${output.language}" which is not a declared alignment language.`)

  const requestById = new Map(requestSegments.map((segment) => [segment.id, segment]))
  const relativeById = new Map(relativeSegments.map((segment) => [segment.id, segment]))
  const seen = new Set<string>()
  for (const segment of output.segments) {
    if (!requestById.has(segment.id)) throw jobFailure('MALFORMED_OUTPUT', `Alignment output references unknown segment "${segment.id}".`)
    if (seen.has(segment.id)) throw jobFailure('MALFORMED_OUTPUT', `Alignment output answers segment "${segment.id}" more than once.`)
    seen.add(segment.id)
  }
  for (const segment of requestSegments) {
    if (!seen.has(segment.id)) throw jobFailure('MALFORMED_OUTPUT', `Alignment output is missing segment "${segment.id}".`)
  }

  const segments = output.segments.map((segment) => {
    const relative = relativeById.get(segment.id)!
    const originalText = requestById.get(segment.id)!.text
    if (!isOrderedNonOverlapping(segment.words)) throw jobFailure('MALFORMED_OUTPUT', `Segment "${segment.id}" has out-of-order or overlapping words.`)
    if (!locateWordSpans(originalText, segment.words)) throw jobFailure('MALFORMED_OUTPUT', 'Aligned words must match whole words and grapheme clusters in the original text.')
    let searchFrom = 0
    const words = segment.words.map((word) => {
      if (word.startUs < relative.startUs || word.endUs > relative.endUs) {
        throw jobFailure('MALFORMED_OUTPUT', `Segment "${segment.id}" word is not contained within its segment.`)
      }
      if (!hasCleanText(word.text)) throw jobFailure('MALFORMED_OUTPUT', `Segment "${segment.id}" has an empty or invalid aligned word.`)
      const foundAt = originalText.indexOf(word.text, searchFrom)
      if (foundAt < 0) throw jobFailure('MALFORMED_OUTPUT', `Segment "${segment.id}" aligned word "${word.text}" does not appear, in order, in the original text.`)
      searchFrom = foundAt + word.text.length
      const startUs = window.sourceStartUs + word.startUs
      const endUs = window.sourceStartUs + word.endUs
      if (!Number.isSafeInteger(startUs) || !Number.isSafeInteger(endUs)) throw jobFailure('MALFORMED_OUTPUT', `Segment "${segment.id}" timestamp overflowed safe integer range after source-offset mapping.`)
      return { startUs, endUs, text: word.text, timingSource: 'aligned' as const }
    })
    return { id: segment.id, words }
  })

  return alignedTranscriptSchema.parse({
    contractVersion: TRANSCRIPTION_CONTRACT_VERSION,
    engine: output.engine,
    model: output.model,
    language: output.language,
    segments,
  })
}
