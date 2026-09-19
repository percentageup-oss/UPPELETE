import { z } from 'zod'
import { filePath, microseconds } from '../media/protocol'
import {
  transcriptionCapabilitiesSchema,
  transcriptionOptionsSchema,
  rawTranscriptionOutputSchema,
  alignmentRequestSegmentSchema,
  rawAlignmentOutputSchema,
  type TranscriptionCapabilities,
  type TranscriptionOptions,
  type RawTranscriptionOutput,
  type AudioRelativeAlignmentSegment,
  type RawAlignmentOutput,
} from '../../src/core/transcription'

export type { AudioRelativeAlignmentSegment }
import type { JobProgress } from '../../src/core/jobs'

/**
 * Shape of the mono extracted-audio input a transcription adapter consumes, matching the
 * media worker's `extractAudio` result (implemented in T3). `sourceStartUs` is where this
 * audio window begins in the *source media*, in canonical integer microseconds — the value
 * every adapter timestamp is ultimately offset against.
 */
export const transcriptionInputSchema = z.strictObject({
  audio: z.strictObject({
    path: filePath,
    sourceStartUs: microseconds,
    durationUs: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    sampleRate: z.union([z.literal(16000), z.literal(48000)]),
    channels: z.literal(1),
    sampleCount: microseconds,
  }),
}).refine((input) => Number.isSafeInteger(input.audio.sourceStartUs + input.audio.durationUs), 'Audio window end overflows safe integer range')
export type TranscriptionInput = z.infer<typeof transcriptionInputSchema>

/**
 * Contract every transcription backend implements: whisper.cpp first (T3), faster-whisper
 * as an optional NVIDIA/Windows adapter later. Timestamps an adapter reports are always
 * relative to the start of the audio file it was given (`input.audio.path`), never source-
 * media time — offset mapping happens once, centrally, in `src/core/transcription.ts`.
 *
 * Implementations must:
 *  - reap any child process before their returned promise settles or rejects;
 *  - only call `progress` with values they can actually measure (no fabricated percentage);
 *  - stop and reject promptly once `cancellation` aborts, rather than finishing silent work;
 *  - never invent text for silence or gaps — silence simply produces no segment.
 */
export interface TranscriptionAdapter {
  capabilities(): Promise<TranscriptionCapabilities>
  transcribe(
    input: TranscriptionInput,
    options: TranscriptionOptions,
    progress: (value: JobProgress) => void,
    cancellation: AbortSignal,
  ): Promise<RawTranscriptionOutput>
  /**
   * Present only when `capabilities().alignment` is non-null. `segments` are already
   * converted to audio-relative time (matching `input.audio.path`'s own timeline) by the
   * caller in `run.ts` — an adapter never sees source-media time.
   */
  align?(
    input: TranscriptionInput,
    segments: readonly AudioRelativeAlignmentSegment[],
    progress: (value: JobProgress) => void,
    cancellation: AbortSignal,
  ): Promise<RawAlignmentOutput>
}

// Re-exported so callers only need this module plus the adapter they picked.
export { transcriptionCapabilitiesSchema, transcriptionOptionsSchema, rawTranscriptionOutputSchema, alignmentRequestSegmentSchema, rawAlignmentOutputSchema }
