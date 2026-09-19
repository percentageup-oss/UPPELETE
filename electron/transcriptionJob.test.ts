import { describe, expect, it } from 'vitest'
import { createProject } from '../src/core/model'
import { JobFailure, type JobProgress } from '../src/core/jobs'
import type {
  AlignedTranscript, RawAlignmentOutput, RawTranscriptionOutput, SourceTimedTranscript, TranscriptionCapabilities, TranscriptionOptions,
} from '../src/core/transcription'
import type { AudioRelativeAlignmentSegment, TranscriptionAdapter, TranscriptionInput } from '../workers/transcription/contract'
import { JobScheduler } from './jobScheduler'
import { enqueueAlignment, enqueueTranscription } from './transcriptionJob'

/** Deterministic test double, used only in this test file — never a real backend. */
type TranscribeImpl = (input: TranscriptionInput, options: TranscriptionOptions, progress: (value: JobProgress) => void, signal: AbortSignal) => Promise<unknown>
type AlignImpl = (input: TranscriptionInput, segments: readonly AudioRelativeAlignmentSegment[], progress: (value: JobProgress) => void, signal: AbortSignal) => Promise<unknown>

function makeAdapter(config: { caps: unknown; transcribe?: TranscribeImpl; align?: AlignImpl }) {
  const adapter = {
    async capabilities() { return config.caps as TranscriptionCapabilities },
    async transcribe(input: TranscriptionInput, options: TranscriptionOptions, progress: (value: JobProgress) => void, signal: AbortSignal) {
      if (!config.transcribe) throw new Error('transcribe not configured for this test')
      return config.transcribe(input, options, progress, signal) as Promise<RawTranscriptionOutput>
    },
  } as TranscriptionAdapter
  if (config.align) {
    adapter.align = async (input, segments, progress, signal) => config.align!(input, segments, progress, signal) as Promise<RawAlignmentOutput>
  }
  return adapter
}

const capabilities: TranscriptionCapabilities = {
  contractVersion: 1,
  engine: { id: 'whisper-cpp', version: '1.7.0' },
  model: { id: 'ggml-medium-q5' },
  transcription: {
    languages: ['ml', 'en'], autoDetectLanguage: false, devices: ['cpu'], inputSampleRates: [16000],
    wordTiming: 'none', confidence: { segment: false, word: false },
  },
  alignment: { languages: ['en'], granularity: 'word' },
}
const options: TranscriptionOptions = { language: 'ml', device: 'cpu', wordTimestamps: false }
const input: TranscriptionInput = {
  audio: { path: '/tmp/audio.wav', sourceStartUs: 2_000_000, durationUs: 3_000_000, sampleRate: 16000, channels: 1, sampleCount: 48000 },
}

function goodOutput(): RawTranscriptionOutput {
  return { engine: capabilities.engine.id, model: capabilities.model.id, language: 'ml', segments: [{ startUs: 0, endUs: 1_000_000, text: 'namaskaram' }] }
}

describe('enqueueTranscription', () => {
  it('commits exactly once, with the transcript mapped to source time', async () => {
    const scheduler = new JobScheduler()
    const adapter = makeAdapter({ caps: capabilities, transcribe: async () => goodOutput() })
    let committed: SourceTimedTranscript | null = null
    let commitCalls = 0
    const handle = enqueueTranscription(scheduler, {
      adapter, input, options, label: 'Transcribe clip',
      commit: (transcript) => { commitCalls += 1; committed = transcript },
    })
    expect(await handle.outcome).toEqual({ state: 'succeeded', value: undefined })
    expect(commitCalls).toBe(1)
    expect(committed).not.toBeNull()
    expect(committed!.segments[0].startUs).toBe(input.audio.sourceStartUs)
  })

  it('fails without committing when the backend returns malformed output', async () => {
    const scheduler = new JobScheduler()
    const adapter = makeAdapter({ caps: capabilities, transcribe: async () => ({ ...goodOutput(), segments: [{ startUs: 10, endUs: 5, text: 'x' }] }) })
    let commitCalls = 0
    const handle = enqueueTranscription(scheduler, { adapter, input, options, label: 'Transcribe clip', commit: () => { commitCalls += 1 } })
    expect(await handle.outcome).toMatchObject({ state: 'failed', error: { code: 'MALFORMED_OUTPUT' } })
    expect(commitCalls).toBe(0)
  })

  it('fails without committing when the backend throws', async () => {
    const scheduler = new JobScheduler()
    const adapter = makeAdapter({ caps: capabilities, transcribe: async () => { throw new Error('native crash') } })
    let commitCalls = 0
    const handle = enqueueTranscription(scheduler, { adapter, input, options, label: 'Transcribe clip', commit: () => { commitCalls += 1 } })
    expect(await handle.outcome).toMatchObject({ state: 'failed', error: { code: 'BACKEND_FAILED' } })
    expect(commitCalls).toBe(0)
  })

  it('cancels a job that is still queued behind another heavy job, never calling transcribe or commit', async () => {
    const scheduler = new JobScheduler()
    const blocker = new Promise<never>(() => {}) // never resolves within this test
    scheduler.enqueue({ kind: 'export', label: 'Blocking export', run: async () => blocker })
    let transcribeCalled = false
    let commitCalls = 0
    const adapter = makeAdapter({ caps: capabilities, transcribe: async () => { transcribeCalled = true; return goodOutput() } })
    const handle = enqueueTranscription(scheduler, { adapter, input, options, label: 'Transcribe clip', commit: () => { commitCalls += 1 } })
    handle.cancel()
    expect(await handle.outcome).toEqual({ state: 'cancelled' })
    expect(transcribeCalled).toBe(false)
    expect(commitCalls).toBe(0)
  })

  it('cancels a running job before the adapter settles, never committing', async () => {
    const scheduler = new JobScheduler()
    let sawAbort = false
    let notifyStarted!: () => void
    const started = new Promise<void>((resolve) => { notifyStarted = resolve })
    const adapter = makeAdapter({
      caps: capabilities,
      transcribe: (_input, _options, _progress, signal) => new Promise((resolve) => {
        notifyStarted()
        signal.addEventListener('abort', () => { sawAbort = true; resolve(goodOutput()) })
      }),
    })
    let commitCalls = 0
    const handle = enqueueTranscription(scheduler, { adapter, input, options, label: 'Transcribe clip', commit: () => { commitCalls += 1 } })
    await started
    handle.cancel()
    expect(await handle.outcome).toEqual({ state: 'cancelled' })
    expect(sawAbort).toBe(true)
    expect(commitCalls).toBe(0)
  })

  it('cancelling after the adapter resolves but before commit leaves the project completely untouched', async () => {
    const scheduler = new JobScheduler()
    const project = createProject()
    const baseline = structuredClone(project)
    let resolveTranscribe!: (value: RawTranscriptionOutput) => void
    let notifyCalled!: () => void
    const called = new Promise<void>((resolve) => { notifyCalled = resolve })
    const adapter = makeAdapter({
      caps: capabilities,
      transcribe: () => { notifyCalled(); return new Promise<RawTranscriptionOutput>((resolve) => { resolveTranscribe = resolve }) },
    })
    let commitCalls = 0
    const handle = enqueueTranscription(scheduler, {
      adapter, input, options, label: 'Transcribe clip',
      commit: () => { commitCalls += 1; project.title = 'mutated' },
    })
    await called
    handle.cancel()
    resolveTranscribe(goodOutput())
    expect(await handle.outcome).toEqual({ state: 'cancelled' })
    expect(commitCalls).toBe(0)
    expect(project).toEqual(baseline)
  })

  it('cancelling after commit has already started is a no-op: the successful outcome stands', async () => {
    const scheduler = new JobScheduler()
    const adapter = makeAdapter({ caps: capabilities, transcribe: async () => goodOutput() })
    let commitCalls = 0
    let notifyCommitting!: () => void
    const committing = new Promise<void>((resolve) => { notifyCommitting = resolve })
    let releaseCommit!: () => void
    const handle = enqueueTranscription(scheduler, {
      adapter, input, options, label: 'Transcribe clip',
      commit: () => { commitCalls += 1; notifyCommitting(); return new Promise<void>((resolve) => { releaseCommit = resolve }) },
    })
    await committing
    handle.cancel()
    releaseCommit()
    expect(await handle.outcome).toEqual({ state: 'succeeded', value: undefined })
    expect(commitCalls).toBe(1)
  })

  it('wraps a thrown commit error as COMMIT_FAILED', async () => {
    const scheduler = new JobScheduler()
    const adapter = makeAdapter({ caps: capabilities, transcribe: async () => goodOutput() })
    const handle = enqueueTranscription(scheduler, { adapter, input, options, label: 'Transcribe clip', commit: () => { throw new Error('disk full') } })
    expect(await handle.outcome).toMatchObject({ state: 'failed', error: { code: 'COMMIT_FAILED' } })
  })

  it('passes a JobFailure thrown by commit through unchanged', async () => {
    const scheduler = new JobScheduler()
    const adapter = makeAdapter({ caps: capabilities, transcribe: async () => goodOutput() })
    const handle = enqueueTranscription(scheduler, {
      adapter, input, options, label: 'Transcribe clip',
      commit: () => { throw new JobFailure({ code: 'INTERNAL_ERROR', message: 'project schema invalid', retryable: false }) },
    })
    expect(await handle.outcome).toMatchObject({ state: 'failed', error: { code: 'INTERNAL_ERROR', message: 'project schema invalid' } })
  })
})

describe('enqueueAlignment', () => {
  const segments = [{ id: 'cue-1', startUs: input.audio.sourceStartUs, endUs: input.audio.sourceStartUs + 1_000_000, text: 'namaskaram friend' }]

  it('commits exactly once with source-mapped aligned words', async () => {
    const scheduler = new JobScheduler()
    const adapter = makeAdapter({
      caps: capabilities,
      align: async (_input, relativeSegments) => ({
        engine: capabilities.engine.id, model: capabilities.model.id, language: 'en',
        segments: relativeSegments.map((segment) => ({ id: segment.id, words: [{ startUs: segment.startUs, endUs: segment.startUs + 500_000, text: 'namaskaram' }] })),
      }),
    })
    let committed: AlignedTranscript | null = null
    let commitCalls = 0
    const handle = enqueueAlignment(scheduler, {
      adapter, input, language: 'en', segments, label: 'Align clip',
      commit: (result) => { commitCalls += 1; committed = result },
    })
    expect(await handle.outcome).toEqual({ state: 'succeeded', value: undefined })
    expect(commitCalls).toBe(1)
    expect(committed!.segments[0].words[0].startUs).toBe(input.audio.sourceStartUs)
  })

  it('fails without committing when the language is not declared for alignment', async () => {
    const scheduler = new JobScheduler()
    const adapter = makeAdapter({ caps: capabilities, align: async () => ({ engine: capabilities.engine.id, model: capabilities.model.id, language: 'ml', segments: [] }) })
    let commitCalls = 0
    const handle = enqueueAlignment(scheduler, { adapter, input, language: 'ml', segments, label: 'Align clip', commit: () => { commitCalls += 1 } })
    expect(await handle.outcome).toMatchObject({ state: 'failed', error: { code: 'UNSUPPORTED_LANGUAGE' } })
    expect(commitCalls).toBe(0)
  })
})
