import type { JobProgress } from '../src/core/jobs'
import type { ModelArtifact } from '../src/core/modelCatalog'
import { TRANSCRIPTION_CONTRACT_VERSION, type RawTranscriptionOutput, type TranscriptionCapabilities, type TranscriptionOptions } from '../src/core/transcription'
import { deviceForBackendName, WHISPER_CPP_ENGINE_ID, WHISPER_LANGUAGES } from '../src/core/whisperCpp'
import type { MediaWorkerClient } from '../workers/media/client'
import type { MediaResult } from '../workers/media/protocol'
import type { TranscriptionAdapter, TranscriptionInput } from '../workers/transcription/contract'

export type WhisperInspection = Extract<MediaResult, { operation: 'inspectWhisper' }>
export type WhisperRunReport = Extract<MediaResult, { operation: 'whisperTranscribe' }>

/**
 * Capabilities come from real inspection of the configured executable and model: the version whisper-cli
 * reports, a GPU device only when whisper.cpp actually initialized one, and CPU, which inspection verified
 * with `-ng`. Segment-level timing only: whisper-cli token timestamps are not exposed as word timing (T4), and
 * no aligner is declared.
 */
export function whisperCapabilities(model: ModelArtifact, inspection: WhisperInspection): TranscriptionCapabilities {
  const gpuDevice = inspection.gpuBackend ? deviceForBackendName(inspection.gpuBackend) : null
  return {
    contractVersion: TRANSCRIPTION_CONTRACT_VERSION,
    engine: { id: WHISPER_CPP_ENGINE_ID, version: inspection.version },
    model: { id: model.id },
    transcription: {
      languages: model.multilingual ? [...WHISPER_LANGUAGES] : ['en'],
      autoDetectLanguage: model.multilingual,
      devices: gpuDevice ? ['cpu', gpuDevice] : ['cpu'],
      inputSampleRates: [16000],
      wordTiming: 'none',
      confidence: { segment: false, word: false },
    },
    alignment: null,
  }
}

/** Generous per-job deadline (CPU recognition can be much slower than real time), capped at the client's 24 h limit. */
export function recognitionTimeoutMs(durationUs: number): number {
  return Math.min(86_400_000, 600_000 + Math.ceil(durationUs / 1000) * 10)
}

export class WhisperCppAdapter implements TranscriptionAdapter {
  /** Chunking, backend and dropped-segment details of the most recent successful run, for provenance. */
  lastRun: WhisperRunReport | null = null

  constructor(
    private readonly worker: Pick<MediaWorkerClient, 'start'>,
    private readonly model: ModelArtifact,
    private readonly modelPath: string,
    private readonly inspection: WhisperInspection,
  ) {}

  async capabilities(): Promise<TranscriptionCapabilities> {
    return whisperCapabilities(this.model, this.inspection)
  }

  async transcribe(input: TranscriptionInput, options: TranscriptionOptions, progress: (value: JobProgress) => void, cancellation: AbortSignal): Promise<RawTranscriptionOutput> {
    progress({ kind: 'indeterminate', phase: 'recognizing' })
    const result = await this.worker.start({
      operation: 'whisperTranscribe', audioPath: input.audio.path, modelPath: this.modelPath, language: options.language, useGpu: options.device !== 'cpu',
      durationUs: input.audio.durationUs,
    }, {
      signal: cancellation,
      timeoutMs: recognitionTimeoutMs(input.audio.durationUs),
      onProgress: (message) => {
        const value = message.progress
        if (value.kind === 'measured' && value.phase === 'recognizing') {
          progress({ kind: 'measured', phase: 'recognizing', completed: value.completed, total: value.total, unit: 'sourceUs' })
        }
      },
    }).result
    this.lastRun = result
    return {
      engine: WHISPER_CPP_ENGINE_ID,
      model: this.model.id,
      language: result.language,
      segments: result.segments.map((segment) => ({
        startUs: segment.startUs, endUs: segment.endUs, text: segment.text,
        ...(segment.timingAdjustment ? { timingAdjustment: segment.timingAdjustment } : {}),
      })),
    }
  }
}
