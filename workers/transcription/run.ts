import { z } from 'zod'
import { jobFailure, JobFailure, jobProgressSchema, isProgressRegression, type JobProgress } from '../../src/core/jobs'
import {
  languageCodeSchema,
  transcriptionCapabilitiesSchema,
  checkTranscriptionOptions,
  checkAudioSampleRate,
  validateTranscriptionOutput,
  toAudioRelativeSegments,
  validateAlignmentOutput,
  alignmentRequestSegmentSchema,
  type TranscriptionOptions,
  type SourceTimedTranscript,
  type AlignmentRequestSegment,
  type AlignedTranscript,
  type AudioWindow,
} from '../../src/core/transcription'
import { transcriptionInputSchema, type TranscriptionAdapter, type TranscriptionInput } from './contract'

export type RunOptions = { signal?: AbortSignal; onProgress?: (value: JobProgress) => void }

function wrapAdapterError(error: unknown): JobFailure {
  if (error instanceof JobFailure) return error
  const message = error instanceof Error ? error.message : String(error)
  return jobFailure('BACKEND_FAILED', 'The transcription backend failed.', { diagnostic: message.slice(0, 8192), retryable: false })
}

/**
 * Wraps an adapter's progress callback so that only schema-valid, monotonically-advancing
 * progress ever reaches the caller. Anything else aborts the adapter's own signal and
 * records a terminal `INVALID_PROGRESS` failure — a backend cannot make a UI progress bar
 * visibly rewind or report a value this contract cannot make sense of.
 */
function guardedProgress(internal: AbortController, onProgress: ((value: JobProgress) => void) | undefined) {
  let last: JobProgress | null = null
  let failure: JobFailure | null = null
  let settled = false
  const report = (value: unknown) => {
    if (settled || failure) return
    const parsed = jobProgressSchema.safeParse(value)
    if (!parsed.success) {
      failure = jobFailure('INVALID_PROGRESS', 'Transcription backend reported malformed progress.', { diagnostic: parsed.error.message.slice(0, 8192) })
      internal.abort()
      return
    }
    if (isProgressRegression(last, parsed.data)) {
      failure = jobFailure('INVALID_PROGRESS', 'Transcription backend progress moved backward.')
      internal.abort()
      return
    }
    last = parsed.data
    onProgress?.(parsed.data)
  }
  const finish = () => { settled = true }
  return { report, finish, get failure() { return failure } }
}

function linkAbort(internal: AbortController, external: AbortSignal | undefined): () => void {
  if (!external) return () => {}
  if (external.aborted) { internal.abort(); return () => {} }
  const onAbort = () => internal.abort()
  external.addEventListener('abort', onAbort, { once: true })
  return () => external.removeEventListener('abort', onAbort)
}

/** Fetches and schema-validates capabilities before any option check or adapter call that trusts them. */
async function getValidatedCapabilities(adapter: TranscriptionAdapter) {
  let capabilities: unknown
  try { capabilities = await adapter.capabilities() } catch (error) { throw wrapAdapterError(error) }
  const parsed = transcriptionCapabilitiesSchema.safeParse(capabilities)
  if (!parsed.success) throw jobFailure('INVALID_CAPABILITIES', 'Transcription capabilities failed validation.', { diagnostic: parsed.error.message.slice(0, 8192) })
  return parsed.data
}

/**
 * Validates input/options against declared capabilities, invokes the adapter with a
 * guarded progress callback and a linked cancellation signal, then validates and maps its
 * output to source-media time. Never returns (or lets a caller commit) output produced
 * after cancellation was requested, and never calls the adapter at all for input the
 * adapter itself declared it cannot handle.
 */
export async function runTranscription(
  adapter: TranscriptionAdapter,
  input: TranscriptionInput,
  options: TranscriptionOptions,
  { signal, onProgress }: RunOptions = {},
): Promise<SourceTimedTranscript> {
  const parsedInput = transcriptionInputSchema.safeParse(input)
  if (!parsedInput.success) throw jobFailure('INVALID_INPUT', 'Transcription input failed validation.', { diagnostic: parsedInput.error.message.slice(0, 8192) })

  const capabilities = await getValidatedCapabilities(adapter)
  checkTranscriptionOptions(capabilities, options)
  checkAudioSampleRate(capabilities, parsedInput.data.audio.sampleRate)

  const internal = new AbortController()
  const unlink = linkAbort(internal, signal)
  const progress = guardedProgress(internal, onProgress)
  let raw
  try {
    raw = await adapter.transcribe(parsedInput.data, options, progress.report, internal.signal)
  } catch (error) {
    progress.finish()
    unlink()
    if (progress.failure) throw progress.failure
    if (signal?.aborted) throw jobFailure('CANCELLED', 'Transcription was cancelled.')
    throw wrapAdapterError(error)
  }
  progress.finish()
  unlink()
  if (progress.failure) throw progress.failure
  if (signal?.aborted) throw jobFailure('CANCELLED', 'Transcription was cancelled.')

  const window: AudioWindow = { sourceStartUs: parsedInput.data.audio.sourceStartUs, durationUs: parsedInput.data.audio.durationUs }
  return validateTranscriptionOutput(window, capabilities, options, raw)
}

export async function runAlignment(
  adapter: TranscriptionAdapter,
  input: TranscriptionInput,
  language: string,
  segments: readonly AlignmentRequestSegment[],
  { signal, onProgress }: RunOptions = {},
): Promise<AlignedTranscript> {
  const parsedInput = transcriptionInputSchema.safeParse(input)
  if (!parsedInput.success) throw jobFailure('INVALID_INPUT', 'Transcription input failed validation.', { diagnostic: parsedInput.error.message.slice(0, 8192) })
  const parsedLanguage = languageCodeSchema.safeParse(language)
  if (!parsedLanguage.success) throw jobFailure('INVALID_INPUT', 'Alignment language failed validation.')
  const parsedSegments = z.array(alignmentRequestSegmentSchema).max(100000).safeParse(segments)
  if (!parsedSegments.success) throw jobFailure('INVALID_INPUT', 'Alignment segments failed validation.', { diagnostic: parsedSegments.error.message.slice(0, 8192) })

  const capabilities = await getValidatedCapabilities(adapter)
  const align = adapter.align
  if (!capabilities.alignment || !align) throw jobFailure('UNSUPPORTED_OPTION', 'This engine does not support alignment.')
  if (!capabilities.alignment.languages.includes(parsedLanguage.data)) {
    throw jobFailure('UNSUPPORTED_LANGUAGE', `Language "${language}" is not supported for alignment by this model.`)
  }
  checkAudioSampleRate(capabilities, parsedInput.data.audio.sampleRate)

  const window: AudioWindow = { sourceStartUs: parsedInput.data.audio.sourceStartUs, durationUs: parsedInput.data.audio.durationUs }
  const relativeSegments = toAudioRelativeSegments(window, parsedSegments.data)

  const internal = new AbortController()
  const unlink = linkAbort(internal, signal)
  const progress = guardedProgress(internal, onProgress)
  let raw
  try {
    raw = await align(parsedInput.data, relativeSegments, progress.report, internal.signal)
  } catch (error) {
    progress.finish()
    unlink()
    if (progress.failure) throw progress.failure
    if (signal?.aborted) throw jobFailure('CANCELLED', 'Alignment was cancelled.')
    throw wrapAdapterError(error)
  }
  progress.finish()
  unlink()
  if (progress.failure) throw progress.failure
  if (signal?.aborted) throw jobFailure('CANCELLED', 'Alignment was cancelled.')

  return validateAlignmentOutput(window, capabilities, parsedSegments.data, relativeSegments, raw)
}
