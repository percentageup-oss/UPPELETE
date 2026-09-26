import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { AUDIO_EXTRACTION_VERSION } from '../src/core/audioExtraction'
import { jobFailure, type JobSnapshot } from '../src/core/jobs'
import type { TranscriptionRun } from '../src/core/model'
import { MODEL_CATALOG, type ManagedModelId } from '../src/core/modelCatalog'
import type { LanguageCode, SourceTimedTranscript, TranslatedTranscript } from '../src/core/transcription'
import type { TranscriptionAvailability, TranscriptionDevice } from '../src/core/transcriptionIpc'
import type { MediaWorkerClient } from '../workers/media/client'
import { runTranscription } from '../workers/transcription/run'
import type { JobContext, JobHandle, JobScheduler } from './jobScheduler'
import { WhisperCppAdapter, whisperCapabilities, type WhisperInspection } from './whisperAdapter'
import { CloudTranscriptionAdapter, type CloudAdapterConfig, type CloudRecognizer } from './cloudTranscription'
import { GEMINI_ENGINE_ID, GEMINI_ENGINE_VERSION, GEMINI_MAX_CHUNK_US, geminiCloudRecognizer } from './geminiTranscription'
import { geminiRecognizer, type GeminiRecognizer } from './geminiRecognition'
import { OPENAI_ENGINE_ID, OPENAI_ENGINE_VERSION, OPENAI_MAX_CHUNK_US, openaiRecognizer } from './openaiRecognition'
import { ELEVENLABS_ENGINE_ID, ELEVENLABS_ENGINE_VERSION, ELEVENLABS_MAX_CHUNK_US, elevenlabsRecognizer } from './elevenlabsRecognition'
import { cloudProvider, type CloudLanguageChoice, type CloudProviderId } from '../src/core/transcriptionProviders'
import { geminiTranslator, translateTranscript, type GeminiTranslator } from './geminiTranslation'

export const WHISPER_NOT_CONFIGURED_MESSAGE = 'No local speech engine is configured. Run ./dev.sh to build whisper-cli (whisper.cpp 1.9.4) automatically, or set whisperCliPath in caption-studio.local.json (CAPTION_STUDIO_WHISPER_CLI_PATH overrides it) together with the FFmpeg/ffprobe pair.'

export type TranscriptionServiceOptions = {
  worker: Pick<MediaWorkerClient, 'start'>
  scheduler: JobScheduler
  /** Must re-verify the managed model's checksum on every call (ModelManager.installedPath). */
  installedModelPath(id: ManagedModelId): Promise<string>
  whisperConfigured: boolean
  temporaryRoot: string
  now?: () => Date
  /** Test seam; defaults to the real Gemini client for the given key. */
  geminiRecognizer?: (apiKey: string) => GeminiRecognizer
  /** Test seam replacing the recognizer of any cloud provider. */
  cloudRecognizer?: (provider: CloudProviderId, apiKey: string, model: string) => CloudRecognizer
  /** Test seam; defaults to the real Gemini client for the given key. */
  geminiTranslator?: (apiKey: string) => GeminiTranslator
}

export type TranscriptionRequest = {
  mediaPath: string
  sourceRange: { startUs: number; endUs: number }
  modelId: ManagedModelId
  language: string
  device: TranscriptionDevice
  translateTo: LanguageCode | null
  /** Required only when `translateTo` is set; whisper.cpp itself never sees or needs a key. */
  apiKey?: string
}

/** Optional cloud transcription with the user's own key; no model file or device choice applies. */
export type CloudTranscriptionRequest = {
  engine: CloudProviderId
  mediaPath: string
  sourceRange: { startUs: number; endUs: number }
  /** Absent means the provider's catalog default. */
  model?: string
  language: CloudLanguageChoice
  translateTo: LanguageCode | null
  /** The key of `engine`. */
  apiKey: string
  /** Translation always uses Gemini; needed only when `translateTo` is set and `engine` is not Gemini. */
  translationApiKey?: string
}

const CLOUD_ENGINES: Record<CloudProviderId, Omit<CloudAdapterConfig, 'model'>> = {
  gemini: { engineId: GEMINI_ENGINE_ID, engineVersion: GEMINI_ENGINE_VERSION, maxChunkUs: GEMINI_MAX_CHUNK_US },
  openai: { engineId: OPENAI_ENGINE_ID, engineVersion: OPENAI_ENGINE_VERSION, maxChunkUs: OPENAI_MAX_CHUNK_US },
  elevenlabs: { engineId: ELEVENLABS_ENGINE_ID, engineVersion: ELEVENLABS_ENGINE_VERSION, maxChunkUs: ELEVENLABS_MAX_CHUNK_US },
}

export type TranscriptionJobValue = { transcript: SourceTimedTranscript; run: TranscriptionRun; translation: TranslatedTranscript | null }

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Main-owned, Electron-free orchestration of one real local transcription job: re-verify the model, inspect
 * the engine (cached per model path for the session; failures are not cached), extract audio into a job-owned
 * directory, run the whisper.cpp adapter through `runTranscription` (single source-time mapping and validation),
 * then deliver the transcript only through the scheduler's commit gate. The job directory is removed whether
 * the job succeeds, fails or is cancelled. Applying captions to a project is a separate, explicit renderer step.
 */
export class TranscriptionService {
  private readonly inspections = new Map<string, Promise<WhisperInspection>>()

  constructor(private readonly options: TranscriptionServiceOptions) {}

  private model(id: ManagedModelId) {
    const model = MODEL_CATALOG.find((entry) => entry.id === id)
    if (!model) throw jobFailure('MODEL_UNAVAILABLE', 'The selected model is not in the managed catalog.')
    return model
  }

  private inspect(modelPath: string): Promise<WhisperInspection> {
    const cached = this.inspections.get(modelPath)
    if (cached) return cached
    const pending = this.options.worker.start({ operation: 'inspectWhisper', modelPath }, { timeoutMs: 180_000 }).result
    this.inspections.set(modelPath, pending)
    pending.catch(() => { if (this.inspections.get(modelPath) === pending) this.inspections.delete(modelPath) })
    return pending
  }

  async availability(modelId: ManagedModelId): Promise<TranscriptionAvailability> {
    if (!this.options.whisperConfigured) return { available: false, reason: WHISPER_NOT_CONFIGURED_MESSAGE }
    const model = this.model(modelId)
    let modelPath: string
    try { modelPath = await this.options.installedModelPath(modelId) }
    catch (error) { return { available: false, reason: `${model.name} is not installed and verified (${messageOf(error)}). Download it in Models first.` } }
    try {
      const inspection = await this.inspect(modelPath)
      const capabilities = whisperCapabilities(model, inspection)
      return {
        available: true, engine: capabilities.engine, modelId,
        languages: capabilities.transcription.languages, autoDetectLanguage: capabilities.transcription.autoDetectLanguage,
        devices: capabilities.transcription.devices, gpuBackend: inspection.gpuBackend, systemInfo: inspection.systemInfo,
      }
    } catch (error) {
      return { available: false, reason: `The speech engine could not be used with ${model.name}: ${messageOf(error)}` }
    }
  }

  start(request: TranscriptionRequest | CloudTranscriptionRequest, onUpdate: (snapshot: JobSnapshot) => void): JobHandle<TranscriptionJobValue> {
    const run = 'engine' in request
      ? (ctx: JobContext) => this.runCloud(request, ctx)
      : (() => { const model = this.model(request.modelId); return (ctx: JobContext) => this.run(request, model, ctx) })()
    let jobId: string | null = null
    const unsubscribe = this.options.scheduler.subscribe((snapshot) => { if (snapshot.id === jobId) onUpdate(snapshot) })
    const handle = this.options.scheduler.enqueue<TranscriptionJobValue>({
      kind: 'transcription',
      label: `Transcribe ${path.basename(request.mediaPath)}`.slice(0, 256),
      run,
    })
    jobId = handle.id
    const current = this.options.scheduler.get(handle.id)
    if (current) onUpdate(current)
    void handle.outcome.finally(unsubscribe)
    return handle
  }

  private async run(request: TranscriptionRequest, model: ReturnType<TranscriptionService['model']>, ctx: JobContext): Promise<TranscriptionJobValue> {
    if (!this.options.whisperConfigured) throw jobFailure('BACKEND_FAILED', WHISPER_NOT_CONFIGURED_MESSAGE)
    ctx.reportProgress({ kind: 'indeterminate', phase: 'loading-model' })
    let modelPath: string
    try { modelPath = await this.options.installedModelPath(request.modelId) }
    catch (error) {
      throw jobFailure('MODEL_UNAVAILABLE', `${model.name} is not installed and verified. Download or recheck it in Models, then try again.`, { diagnostic: messageOf(error).slice(0, 8192) })
    }
    const inspection = await this.inspect(modelPath)
    if (ctx.signal.aborted) throw jobFailure('CANCELLED', 'Transcription was cancelled.')

    const directory = await mkdtemp(path.join(this.options.temporaryRoot, 'caption-studio-transcription-'))
    try {
      const durationUs = request.sourceRange.endUs - request.sourceRange.startUs
      ctx.reportProgress({ kind: 'indeterminate', phase: 'extracting-audio' })
      const audio = await this.options.worker.start({
        operation: 'extractAudio', inputPath: request.mediaPath, range: request.sourceRange,
        outputPath: path.join(directory, 'audio.wav'), sampleRate: 16000, channels: 1,
      }, {
        signal: ctx.signal,
        timeoutMs: Math.min(86_400_000, 300_000 + Math.ceil(durationUs / 1000) * 2),
        onProgress: (message) => {
          const value = message.progress
          if (value.kind === 'measured' && value.phase === 'audio') {
            ctx.reportProgress({ kind: 'measured', phase: 'extracting-audio', completed: value.completed, total: value.total, unit: 'sourceUs' })
          }
        },
      }).result

      const adapter = new WhisperCppAdapter(this.options.worker, model, modelPath, inspection)
      const transcript = await runTranscription(adapter, {
        audio: { path: audio.path, sourceStartUs: audio.sourceStartUs, durationUs: audio.durationUs, sampleRate: audio.sampleRate as 16000, channels: 1, sampleCount: audio.sampleCount },
      }, { language: request.language as 'auto', device: request.device, wordTimestamps: false }, { signal: ctx.signal, onProgress: ctx.reportProgress })
      const report = adapter.lastRun
      if (!report) throw jobFailure('INTERNAL_ERROR', 'The whisper.cpp run report is missing.')

      const translated = request.translateTo ? await this.translate(request.translateTo, request.apiKey!, transcript, ctx) : null

      if (!ctx.enterCommit()) throw jobFailure('CANCELLED', 'Transcription was cancelled before its captions were delivered.')
      return {
        transcript,
        translation: translated?.translation ?? null,
        run: {
          id: randomUUID(),
          createdAt: (this.options.now?.() ?? new Date()).toISOString(),
          engine: { id: transcript.engine, version: inspection.version },
          model: { id: model.id, fileName: model.fileName, sha256: model.sha256 },
          requestedLanguage: request.language,
          language: transcript.language,
          requestedDevice: request.device,
          backends: report.backends,
          sourceRange: transcript.sourceRange,
          audioExtraction: AUDIO_EXTRACTION_VERSION,
          speechGating: report.speechGating,
          chunkCount: report.chunks.length,
          silenceCount: report.silences.length,
          segmentCount: transcript.segments.length,
          adjustedSegmentCount: transcript.segments.filter((segment) => segment.timingAdjustment !== null).length,
          droppedSegments: report.dropped,
          ...(translated ? { translation: this.translationProvenance(translated) } : {}),
        },
      }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }

  /** Shared by both engines: translate the recognized text with Gemini, reporting a dedicated progress phase. */
  private async translate(target: LanguageCode, apiKey: string, transcript: SourceTimedTranscript, ctx: JobContext) {
    const translator = (this.options.geminiTranslator ?? geminiTranslator)(apiKey)
    const result = await translateTranscript(translator, transcript, target, ctx.signal, ctx.reportProgress)
    return { target, ...result }
  }

  private translationProvenance({ target, translation, usage }: { target: LanguageCode; translation: TranslatedTranscript; usage: { inputTokens?: number; outputTokens?: number } }) {
    return {
      provider: 'gemini' as const,
      model: translation.model,
      targetLanguage: target,
      segmentCount: translation.segments.length,
      ...(usage.inputTokens ? { inputTokens: usage.inputTokens } : {}),
      ...(usage.outputTokens ? { outputTokens: usage.outputTokens } : {}),
    }
  }

  private recognizerFor(request: CloudTranscriptionRequest, model: string): CloudRecognizer {
    if (this.options.cloudRecognizer) return this.options.cloudRecognizer(request.engine, request.apiKey, model)
    if (request.engine === 'gemini') {
      return geminiCloudRecognizer((this.options.geminiRecognizer ?? ((key: string) => geminiRecognizer(key, 'transcribe', model)))(request.apiKey))
    }
    return request.engine === 'openai' ? openaiRecognizer(request.apiKey, model) : elevenlabsRecognizer(request.apiKey, model)
  }

  private async runCloud(request: CloudTranscriptionRequest, ctx: JobContext): Promise<TranscriptionJobValue> {
    const model = request.model ?? cloudProvider(request.engine).defaultModel
    const translationKey = request.engine === 'gemini' ? request.apiKey : request.translationApiKey
    if (request.translateTo && !translationKey) throw jobFailure('INVALID_INPUT', 'Add a Gemini API key in Settings before translating captions.')
    const directory = await mkdtemp(path.join(this.options.temporaryRoot, 'caption-studio-transcription-'))
    try {
      const durationUs = request.sourceRange.endUs - request.sourceRange.startUs
      ctx.reportProgress({ kind: 'indeterminate', phase: 'extracting-audio' })
      const audio = await this.options.worker.start({
        operation: 'extractAudio', inputPath: request.mediaPath, range: request.sourceRange,
        outputPath: path.join(directory, 'audio.wav'), sampleRate: 16000, channels: 1,
      }, {
        signal: ctx.signal,
        timeoutMs: Math.min(86_400_000, 300_000 + Math.ceil(durationUs / 1000) * 2),
        onProgress: (message) => {
          const value = message.progress
          if (value.kind === 'measured' && value.phase === 'audio') {
            ctx.reportProgress({ kind: 'measured', phase: 'extracting-audio', completed: value.completed, total: value.total, unit: 'sourceUs' })
          }
        },
      }).result

      const chunkDirectory = path.join(directory, 'speech')
      await mkdir(chunkDirectory)
      const adapter = new CloudTranscriptionAdapter(this.options.worker, this.recognizerFor(request, model), chunkDirectory, { ...CLOUD_ENGINES[request.engine], model })
      const transcript = await runTranscription(adapter, {
        audio: { path: audio.path, sourceStartUs: audio.sourceStartUs, durationUs: audio.durationUs, sampleRate: audio.sampleRate as 16000, channels: 1, sampleCount: audio.sampleCount },
      }, { language: request.language, device: 'cpu', wordTimestamps: true }, { signal: ctx.signal, onProgress: ctx.reportProgress })
      const report = adapter.lastRun
      if (!report) throw jobFailure('INTERNAL_ERROR', 'The cloud transcription run report is missing.')

      const translated = request.translateTo ? await this.translate(request.translateTo, translationKey!, transcript, ctx) : null

      if (!ctx.enterCommit()) throw jobFailure('CANCELLED', 'Transcription was cancelled before its captions were delivered.')
      return {
        transcript,
        translation: translated?.translation ?? null,
        run: {
          id: randomUUID(),
          createdAt: (this.options.now?.() ?? new Date()).toISOString(),
          provider: request.engine,
          engine: { id: transcript.engine, version: (await adapter.capabilities()).engine.version },
          model: { id: transcript.model },
          requestedLanguage: request.language,
          language: transcript.language,
          sourceRange: transcript.sourceRange,
          audioExtraction: AUDIO_EXTRACTION_VERSION,
          speechGating: report.speechGating,
          chunkCount: report.chunks.length,
          silenceCount: report.silences.length,
          segmentCount: transcript.segments.length,
          adjustedSegmentCount: transcript.segments.filter((segment) => segment.timingAdjustment !== null).length,
          wordCount: transcript.segments.reduce((sum, segment) => sum + segment.words.length, 0),
          droppedWordCount: report.droppedWords,
          droppedAnnotationCount: report.droppedAnnotations,
          ...(report.inputTokens ? { inputTokens: report.inputTokens } : {}),
          ...(report.outputTokens ? { outputTokens: report.outputTokens } : {}),
          ...(translated ? { translation: this.translationProvenance(translated) } : {}),
        },
      }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }
}
