import { randomUUID } from 'node:crypto'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { JobSnapshot } from '../src/core/jobs'
import { MODEL_CATALOG } from '../src/core/modelCatalog'
import type { MediaWorkerClient } from '../workers/media/client'
import { failure, type MediaTask, type ProgressMessage } from '../workers/media/protocol'
import { JobScheduler } from './jobScheduler'
import { TranscriptionService, type TranscriptionRequest } from './transcriptionService'

/**
 * Test-only worker double returning protocol-shaped results, so the service's ordering, re-verification,
 * source-time mapping, provenance, commit gating and cleanup can be checked. It does not simulate recognition.
 */
type StartOptions = { signal?: AbortSignal; onProgress?: (message: ProgressMessage) => void; timeoutMs?: number }
type Handler = (task: any, options: StartOptions) => Promise<unknown>
function workerDouble(handlers: Record<string, Handler>) {
  const tasks: MediaTask[] = []
  const worker = {
    start(task: MediaTask, options: StartOptions = {}) {
      tasks.push(task)
      const handler = handlers[task.operation]
      return { id: randomUUID(), cancel() {}, result: handler ? handler(task, options) : Promise.reject(new Error(`unexpected ${task.operation}`)) }
    },
  }
  return { tasks, worker: worker as unknown as Pick<MediaWorkerClient, 'start'> }
}

let temporaryRoot: string
beforeEach(async () => { temporaryRoot = await mkdtemp(path.join(tmpdir(), 'caption-transcription-service-')) })
afterEach(async () => { await rm(temporaryRoot, { recursive: true, force: true }) })
const leftovers = async () => (await readdir(temporaryRoot)).filter((name) => name.startsWith('caption-studio-transcription-'))

const inspection = { operation: 'inspectWhisper', version: '1.9.4', gpuBackend: 'MTL0', cpuFallbackVerified: true, systemInfo: 'MTL : EMBED_LIBRARY = 1' }
const progressMessage = (operation: string, progress: ProgressMessage['progress']) => ({ version: 1, type: 'progress', id: randomUUID(), operation, progress }) as ProgressMessage

function handlers(overrides: Record<string, Handler> = {}): Record<string, Handler> {
  return {
    inspectWhisper: async () => inspection,
    extractAudio: async (task) => {
      expect(path.dirname(task.outputPath).startsWith(path.join(temporaryRoot, 'caption-studio-transcription-'))).toBe(true)
      return { operation: 'extractAudio', path: task.outputPath, sourceStartUs: task.range.startUs, durationUs: 10_000_000, sampleRate: 16000, channels: 1, sampleCount: 160_000 }
    },
    whisperTranscribe: async (task, options) => {
      options.onProgress?.(progressMessage('whisperTranscribe', { kind: 'measured', phase: 'recognizing', completed: 1_000_000, total: 2_000_000, unit: 'sourceUs' }))
      return {
        operation: 'whisperTranscribe', language: 'ml', languageSource: 'detected', backends: [task.useGpu ? 'MTL0' : 'CPU'], threads: 8, speechGating: 'gating-v1',
        silences: [{ startUs: 3_000_000, endUs: 9_000_000 }], chunks: [{ startUs: 0, endUs: 3_300_000 }, { startUs: 8_700_000, endUs: 10_000_000 }],
        segments: [{ startUs: 1_000_000, endUs: 2_000_000, text: 'ആദ്യ വാചകം' }, { startUs: 9_000_000, endUs: 10_000_000, text: 'after the pause', timingAdjustment: 'end-clamped-to-chunk' }],
        dropped: { empty: 0, outsideChunk: 1, zeroDuration: 0 },
      }
    },
    ...overrides,
  }
}

const request = (overrides: Partial<TranscriptionRequest> = {}): TranscriptionRequest => ({
  mediaPath: '/Media/വീഡിയോ.mp4', sourceRange: { startUs: 5_000_000, endUs: 15_000_000 }, modelId: 'whisper-base', language: 'auto', device: 'metal', translateTo: null, ...overrides,
})

describe('TranscriptionService', () => {
  it('re-verifies the model, extracts and recognizes, maps to source time with provenance, then removes job files', async () => {
    const { tasks, worker } = workerDouble(handlers())
    const verified: string[] = []
    const service = new TranscriptionService({
      worker, scheduler: new JobScheduler(), whisperConfigured: true, temporaryRoot, now: () => new Date('2026-09-15T00:00:00.000Z'),
      installedModelPath: async (id) => { verified.push(id); return '/Models/ggml-base.bin' },
    })
    const snapshots: JobSnapshot[] = []
    const outcome = await service.start(request(), (snapshot) => snapshots.push(snapshot)).outcome
    if (outcome.state !== 'succeeded') throw new Error(JSON.stringify(outcome))
    expect(verified).toEqual(['whisper-base'])
    expect(tasks.map((task) => task.operation)).toEqual(['inspectWhisper', 'extractAudio', 'whisperTranscribe'])
    expect(tasks[1]).toMatchObject({ inputPath: '/Media/വീഡിയോ.mp4', range: { startUs: 5_000_000, endUs: 15_000_000 }, sampleRate: 16000, channels: 1 })
    expect(tasks[2]).toMatchObject({ modelPath: '/Models/ggml-base.bin', language: 'auto', useGpu: true, durationUs: 10_000_000 })
    expect(outcome.value.transcript.segments).toEqual([
      { startUs: 6_000_000, endUs: 7_000_000, text: 'ആദ്യ വാചകം', confidence: null, words: [], timingAdjustment: null },
      { startUs: 14_000_000, endUs: 15_000_000, text: 'after the pause', confidence: null, words: [], timingAdjustment: 'end-clamped-to-chunk' },
    ])
    expect(outcome.value.run).toMatchObject({
      createdAt: '2026-09-15T00:00:00.000Z', engine: { id: 'whisper.cpp', version: '1.9.4' },
      model: { id: 'whisper-base', fileName: 'ggml-base.bin', sha256: MODEL_CATALOG[0].sha256 },
      requestedLanguage: 'auto', language: 'ml', requestedDevice: 'metal', backends: ['MTL0'], sourceRange: { startUs: 5_000_000, endUs: 15_000_000 },
      audioExtraction: 'ffmpeg-aresample-async1-firstpts0-s16le-mono-wav-v1', speechGating: 'gating-v1',
      chunkCount: 2, silenceCount: 1, segmentCount: 2, adjustedSegmentCount: 1, droppedSegments: { empty: 0, outsideChunk: 1, zeroDuration: 0 },
    })
    expect(snapshots.map((snapshot) => snapshot.progress?.phase)).toEqual(expect.arrayContaining(['loading-model', 'extracting-audio', 'recognizing']))
    expect(snapshots.at(-1)?.state).toBe('succeeded')
    expect(await leftovers()).toEqual([])
  })

  it('re-verifies the model for every job but inspects the engine once per model path, with CPU mapped to useGpu false', async () => {
    const { tasks, worker } = workerDouble(handlers())
    let verifications = 0
    const service = new TranscriptionService({ worker, scheduler: new JobScheduler(), whisperConfigured: true, temporaryRoot, installedModelPath: async () => { verifications += 1; return '/Models/ggml-base.bin' } })
    expect((await service.start(request(), () => {}).outcome).state).toBe('succeeded')
    const second = await service.start(request({ device: 'cpu', language: 'ml' }), () => {}).outcome
    expect(second.state).toBe('succeeded')
    expect(verifications).toBe(2)
    expect(tasks.filter((task) => task.operation === 'inspectWhisper')).toHaveLength(1)
    expect(tasks.filter((task) => task.operation === 'whisperTranscribe').at(-1)).toMatchObject({ useGpu: false, language: 'ml' })
  })

  it('fails with an actionable model error without starting any worker when the model is not verified', async () => {
    const { tasks, worker } = workerDouble(handlers())
    const service = new TranscriptionService({ worker, scheduler: new JobScheduler(), whisperConfigured: true, temporaryRoot, installedModelPath: async () => { throw new Error('Installed file does not match the trusted SHA-256/size') } })
    const outcome = await service.start(request(), () => {}).outcome
    expect(outcome).toMatchObject({ state: 'failed', error: { code: 'MODEL_UNAVAILABLE', message: expect.stringContaining('Download or recheck it in Models') } })
    expect(tasks).toEqual([])
  })

  it('cancels a running recognition, never delivers output and removes the job directory', async () => {
    let cancelJob = () => {}
    const { worker } = workerDouble(handlers({
      whisperTranscribe: (_task, options) => new Promise((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => reject(failure('CANCELLED', 'Operation cancelled')), { once: true })
        queueMicrotask(() => cancelJob())
      }),
    }))
    const service = new TranscriptionService({ worker, scheduler: new JobScheduler(), whisperConfigured: true, temporaryRoot, installedModelPath: async () => '/Models/ggml-base.bin' })
    const handle = service.start(request(), () => {})
    cancelJob = handle.cancel
    expect(await handle.outcome).toEqual({ state: 'cancelled' })
    expect(await leftovers()).toEqual([])
  })

  it('surfaces a real worker failure as a structured backend error and still cleans up', async () => {
    const { worker } = workerDouble(handlers({ extractAudio: async () => { throw failure('TOOL_FAILED', 'This media has no audio stream to transcribe') } }))
    const service = new TranscriptionService({ worker, scheduler: new JobScheduler(), whisperConfigured: true, temporaryRoot, installedModelPath: async () => '/Models/ggml-base.bin' })
    expect(await service.start(request(), () => {}).outcome).toMatchObject({ state: 'failed', error: { code: 'BACKEND_FAILED', message: 'This media has no audio stream to transcribe' } })
    expect(await leftovers()).toEqual([])
  })

  it('translates the recognized text with Gemini after local recognition, keeps the source-language recognition, and records provenance', async () => {
    const { tasks, worker } = workerDouble(handlers())
    const translateCalls: { texts: string[]; target: string; sourceLanguage: string | null }[] = []
    const service = new TranscriptionService({
      worker, scheduler: new JobScheduler(), whisperConfigured: true, temporaryRoot, now: () => new Date('2026-09-18T00:00:00.000Z'),
      installedModelPath: async () => '/Models/ggml-base.bin',
      geminiTranslator: (apiKey) => async (texts, target, sourceLanguage) => {
        translateCalls.push({ texts: [...texts], target, sourceLanguage })
        expect(apiKey).toBe('test-key')
        return {
          texts: texts.map((text) => text === 'ആദ്യ വാചകം' ? 'First sentence' : 'After the pause'),
          usage: { inputTokens: 20, outputTokens: 10 },
        }
      },
    })
    const snapshots: JobSnapshot[] = []
    const outcome = await service.start(request({ translateTo: 'en', apiKey: 'test-key' }), (snapshot) => snapshots.push(snapshot)).outcome
    if (outcome.state !== 'succeeded') throw new Error(JSON.stringify(outcome))
    expect(tasks.map((task) => task.operation)).toEqual(['inspectWhisper', 'extractAudio', 'whisperTranscribe'])
    expect(translateCalls).toEqual([{ texts: ['ആദ്യ വാചകം', 'after the pause'], target: 'en', sourceLanguage: 'ml' }])
    expect(outcome.value.transcript.segments.map((segment) => segment.text)).toEqual(['ആദ്യ വാചകം', 'after the pause'])
    expect(outcome.value.translation?.segments.map((segment) => segment.text)).toEqual(['First sentence', 'After the pause'])
    expect(outcome.value.run.translation).toEqual({ provider: 'gemini', model: 'gemini-3.8-flash', targetLanguage: 'en', segmentCount: 2, inputTokens: 20, outputTokens: 10 })
    expect(snapshots.map((snapshot) => snapshot.progress?.phase)).toEqual(expect.arrayContaining(['recognizing', 'translating']))
    expect(await leftovers()).toEqual([])
  })

  it('skips translation entirely when translateTo is null', async () => {
    const { worker } = workerDouble(handlers())
    const service = new TranscriptionService({ worker, scheduler: new JobScheduler(), whisperConfigured: true, temporaryRoot, installedModelPath: async () => '/Models/ggml-base.bin' })
    const outcome = await service.start(request(), () => {}).outcome
    if (outcome.state !== 'succeeded') throw new Error(JSON.stringify(outcome))
    expect(outcome.value.translation).toBeNull()
    expect(outcome.value.run.translation).toBeUndefined()
  })

  it('cancels during translation, never delivers a translated transcript and removes job files', async () => {
    let cancelJob = () => {}
    const { worker } = workerDouble(handlers())
    const service = new TranscriptionService({
      worker, scheduler: new JobScheduler(), whisperConfigured: true, temporaryRoot, installedModelPath: async () => '/Models/ggml-base.bin',
      geminiTranslator: () => (_texts, _target, _sourceLanguage, signal) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(failure('CANCELLED', 'Operation cancelled')), { once: true })
        queueMicrotask(() => cancelJob())
      }),
    })
    const handle = service.start(request({ translateTo: 'en', apiKey: 'test-key' }), () => {})
    cancelJob = handle.cancel
    expect(await handle.outcome).toEqual({ state: 'cancelled' })
    expect(await leftovers()).toEqual([])
  })

  it('reports availability from configuration, model verification and real inspection', async () => {
    const { worker } = workerDouble(handlers())
    const unconfigured = new TranscriptionService({ worker, scheduler: new JobScheduler(), whisperConfigured: false, temporaryRoot, installedModelPath: async () => '/Models/ggml-base.bin' })
    expect(await unconfigured.availability('whisper-base')).toMatchObject({ available: false, reason: expect.stringContaining('CAPTION_STUDIO_WHISPER_CLI_PATH') })
    const missing = new TranscriptionService({ worker, scheduler: new JobScheduler(), whisperConfigured: true, temporaryRoot, installedModelPath: async () => { throw new Error('Model is not installed') } })
    expect(await missing.availability('whisper-base')).toMatchObject({ available: false, reason: expect.stringContaining('Download it in Models first') })
    const service = new TranscriptionService({ worker, scheduler: new JobScheduler(), whisperConfigured: true, temporaryRoot, installedModelPath: async (id) => `/Models/${id}.bin` })
    const multilingual = await service.availability('whisper-base')
    expect(multilingual).toMatchObject({ available: true, engine: { id: 'whisper.cpp', version: '1.9.4' }, autoDetectLanguage: true, devices: ['cpu', 'metal'], gpuBackend: 'MTL0' })
    if (multilingual.available) expect(multilingual.languages).toEqual(expect.arrayContaining(['ml', 'en']))
    expect(await service.availability('whisper-base-en')).toMatchObject({ available: true, languages: ['en'], autoDetectLanguage: false })
  })
})

describe('TranscriptionService with Gemini', () => {
  const geminiHandlers = (overrides: Record<string, Handler> = {}) => handlers({
    speechChunks: async (task) => {
      expect(task.outputDirectory.startsWith(path.join(temporaryRoot, 'caption-studio-transcription-'))).toBe(true)
      return { operation: 'speechChunks', speechGating: 'gating-v1', silences: [{ startUs: 3_000_000, endUs: 9_000_000 }], chunks: [{ path: path.join(task.outputDirectory, 'speech-00000.wav'), startUs: 0, endUs: 3_300_000 }] }
    },
    ...overrides,
  })

  it('never verifies a local model, records cloud provenance with word timing, and removes job files', async () => {
    const { tasks, worker } = workerDouble(geminiHandlers())
    const keys: string[] = []
    const service = new TranscriptionService({
      worker, scheduler: new JobScheduler(), whisperConfigured: false, temporaryRoot, now: () => new Date('2026-09-17T00:00:00.000Z'),
      installedModelPath: async () => { throw new Error('must not be called') },
      geminiRecognizer: (apiKey) => { keys.push(apiKey); return async () => ({ words: [{ text: 'ആദ്യ', startUs: 1_000_000, endUs: 1_400_000 }, { text: 'വാചകം', startUs: 1_450_000, endUs: 2_000_000 }], usage: { inputTokens: 12, outputTokens: 5 } }) },
    })
    const outcome = await service.start({ engine: 'gemini', mediaPath: '/Media/clip.mp4', sourceRange: { startUs: 5_000_000, endUs: 15_000_000 }, language: 'auto', translateTo: null, apiKey: 'test-key-123' }, () => {}).outcome
    if (outcome.state !== 'succeeded') throw new Error(JSON.stringify(outcome))
    expect(keys).toEqual(['test-key-123'])
    expect(tasks.map((task) => task.operation)).toEqual(['extractAudio', 'speechChunks'])
    expect(outcome.value.transcript.segments[0]).toMatchObject({ startUs: 6_000_000, endUs: 7_000_000, text: 'ആദ്യ വാചകം' })
    expect(outcome.value.transcript.segments[0].words).toHaveLength(2)
    expect(outcome.value.run).toMatchObject({
      provider: 'gemini', engine: { id: 'gemini-api' }, model: { id: 'gemini-3.5-transcribe' }, requestedLanguage: 'auto', language: 'ml',
      chunkCount: 1, silenceCount: 1, segmentCount: 1, wordCount: 2, droppedWordCount: 0, inputTokens: 12, outputTokens: 5,
    })
    expect(JSON.stringify(outcome.value.run)).not.toContain('test-key-123')
    expect(await leftovers()).toEqual([])
  })

  it('cancels during an upload, never delivers captions and removes job files', async () => {
    const { worker } = workerDouble(geminiHandlers())
    let cancelJob = () => {}
    const service = new TranscriptionService({
      worker, scheduler: new JobScheduler(), whisperConfigured: false, temporaryRoot, installedModelPath: async () => '/unused',
      geminiRecognizer: () => (_path, _locales, signal) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(failure('CANCELLED', 'Operation cancelled')), { once: true })
        queueMicrotask(() => cancelJob())
      }),
    })
    const handle = service.start({ engine: 'gemini', mediaPath: '/Media/clip.mp4', sourceRange: { startUs: 0, endUs: 10_000_000 }, language: 'ml', translateTo: null, apiKey: 'k' }, () => {})
    cancelJob = handle.cancel
    expect(await handle.outcome).toEqual({ state: 'cancelled' })
    expect(await leftovers()).toEqual([])
  })

  it('translates Gemini-recognized captions with the same key and records translation provenance alongside recognition provenance', async () => {
    const { worker } = workerDouble(geminiHandlers())
    const keys: string[] = []
    const service = new TranscriptionService({
      worker, scheduler: new JobScheduler(), whisperConfigured: false, temporaryRoot,
      installedModelPath: async () => { throw new Error('must not be called') },
      geminiRecognizer: (apiKey) => { keys.push(apiKey); return async () => ({ words: [{ text: 'ആദ്യ', startUs: 1_000_000, endUs: 1_400_000 }, { text: 'വാചകം', startUs: 1_450_000, endUs: 2_000_000 }], usage: { inputTokens: 12, outputTokens: 5 } }) },
      geminiTranslator: (apiKey) => { keys.push(apiKey); return async (texts) => ({ texts: texts.map(() => 'First sentence'), usage: { inputTokens: 8, outputTokens: 4 } }) },
    })
    const outcome = await service.start({ engine: 'gemini', mediaPath: '/Media/clip.mp4', sourceRange: { startUs: 5_000_000, endUs: 15_000_000 }, language: 'auto', translateTo: 'en', apiKey: 'test-key-123' }, () => {}).outcome
    if (outcome.state !== 'succeeded') throw new Error(JSON.stringify(outcome))
    expect(keys).toEqual(['test-key-123', 'test-key-123'])
    expect(outcome.value.transcript.segments[0].text).toBe('ആദ്യ വാചകം')
    expect(outcome.value.translation?.segments.map((segment) => segment.text)).toEqual(['First sentence'])
    expect(outcome.value.run).toMatchObject({ translation: { provider: 'gemini', targetLanguage: 'en', segmentCount: 1, inputTokens: 8, outputTokens: 4 } })
    expect(await leftovers()).toEqual([])
  })
})
