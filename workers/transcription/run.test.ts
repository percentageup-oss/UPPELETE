import { describe, expect, it } from 'vitest'
import { JobFailure, type JobProgress, type JobStructuredError } from '../../src/core/jobs'
import type {
  AudioRelativeAlignmentSegment, RawAlignmentOutput, RawTranscriptionOutput, TranscriptionCapabilities, TranscriptionOptions,
} from '../../src/core/transcription'
import type { TranscriptionAdapter, TranscriptionInput } from './contract'
import { runAlignment, runTranscription } from './run'

/**
 * A deterministic test double only — never imported outside this test file. It exists to
 * verify the lifecycle/guard rules in `run.ts`, not to simulate any real transcription
 * backend's behavior, output quality or timing.
 */
type TranscribeImpl = (input: TranscriptionInput, options: TranscriptionOptions, progress: (value: JobProgress) => void, signal: AbortSignal) => Promise<unknown>
type AlignImpl = (input: TranscriptionInput, segments: readonly AudioRelativeAlignmentSegment[], progress: (value: JobProgress) => void, signal: AbortSignal) => Promise<unknown>

function makeAdapter(config: { caps: unknown; transcribe?: TranscribeImpl; align?: AlignImpl }) {
  const adapter = {
    transcribeCalls: 0,
    alignCalls: 0,
    async capabilities() { return config.caps as TranscriptionCapabilities },
    async transcribe(input: TranscriptionInput, options: TranscriptionOptions, progress: (value: JobProgress) => void, signal: AbortSignal) {
      adapter.transcribeCalls += 1
      if (!config.transcribe) throw new Error('transcribe not configured for this test')
      return config.transcribe(input, options, progress, signal) as Promise<RawTranscriptionOutput>
    },
  } as TranscriptionAdapter & { transcribeCalls: number; alignCalls: number }
  if (config.align) {
    adapter.align = async (input, segments, progress, signal) => {
      adapter.alignCalls += 1
      return config.align!(input, segments, progress, signal) as Promise<RawAlignmentOutput>
    }
  }
  return adapter
}

const capabilities: TranscriptionCapabilities = {
  contractVersion: 1,
  engine: { id: 'whisper-cpp', version: '1.7.0' },
  model: { id: 'ggml-medium-q5' },
  transcription: {
    languages: ['ml', 'en'], autoDetectLanguage: false, devices: ['cpu'], inputSampleRates: [16000],
    wordTiming: 'model', confidence: { segment: false, word: false },
  },
  alignment: { languages: ['en'], granularity: 'word' },
}

const options: TranscriptionOptions = { language: 'ml', device: 'cpu', wordTimestamps: false }
const input: TranscriptionInput = {
  audio: { path: '/tmp/audio.wav', sourceStartUs: 1_000_000, durationUs: 5_000_000, sampleRate: 16000, channels: 1, sampleCount: 80000 },
}

function goodOutput(): RawTranscriptionOutput {
  return { engine: capabilities.engine.id, model: capabilities.model.id, language: 'ml', segments: [{ startUs: 0, endUs: 1000, text: 'hello' }] }
}

function expectCode(promise: Promise<unknown>, code: JobStructuredError['code']) {
  return expect(promise).rejects.toMatchObject({ detail: { code } })
}

describe('runTranscription: input/option gating (adapter never called)', () => {
  it('rejects an unsupported language without calling the adapter', async () => {
    const adapter = makeAdapter({ caps: capabilities, transcribe: async () => goodOutput() })
    await expectCode(runTranscription(adapter, input, { ...options, language: 'fr' }), 'UNSUPPORTED_LANGUAGE')
    expect(adapter.transcribeCalls).toBe(0)
  })
  it('rejects an unsupported device without calling the adapter', async () => {
    const adapter = makeAdapter({ caps: capabilities, transcribe: async () => goodOutput() })
    await expectCode(runTranscription(adapter, input, { ...options, device: 'cuda' }), 'UNSUPPORTED_OPTION')
    expect(adapter.transcribeCalls).toBe(0)
  })
  it('rejects requested word timestamps the model does not report, without calling the adapter', async () => {
    const noWordTiming = { ...capabilities, transcription: { ...capabilities.transcription, wordTiming: 'none' as const } }
    const adapter = makeAdapter({ caps: noWordTiming, transcribe: async () => goodOutput() })
    await expectCode(runTranscription(adapter, input, { ...options, wordTimestamps: true }), 'UNSUPPORTED_OPTION')
    expect(adapter.transcribeCalls).toBe(0)
  })
  it('rejects an unsupported sample rate without calling the adapter', async () => {
    const adapter = makeAdapter({ caps: capabilities, transcribe: async () => goodOutput() })
    await expectCode(runTranscription(adapter, { audio: { ...input.audio, sampleRate: 48000 } }, options), 'INVALID_INPUT')
    expect(adapter.transcribeCalls).toBe(0)
  })
  it('rejects invalid capabilities without calling the adapter', async () => {
    const adapter = makeAdapter({ caps: { ...capabilities, contractVersion: 2 }, transcribe: async () => goodOutput() })
    await expectCode(runTranscription(adapter, input, options), 'INVALID_CAPABILITIES')
    expect(adapter.transcribeCalls).toBe(0)
  })
  it('rejects invalid input without calling capabilities or the adapter', async () => {
    const adapter = makeAdapter({ caps: capabilities, transcribe: async () => goodOutput() })
    await expectCode(runTranscription(adapter, { audio: { ...input.audio, durationUs: -1 } } as unknown as TranscriptionInput, options), 'INVALID_INPUT')
    expect(adapter.transcribeCalls).toBe(0)
  })
})

describe('runTranscription: progress guarding', () => {
  it('forwards only valid, monotonically-advancing progress', async () => {
    const seen: JobProgress[] = []
    const adapter = makeAdapter({
      caps: capabilities,
      transcribe: async (_input, _options, progress) => {
        progress({ kind: 'indeterminate', phase: 'loading-model' })
        progress({ kind: 'measured', phase: 'recognizing', completed: 10, total: 100, unit: 'sourceUs' })
        progress({ kind: 'measured', phase: 'recognizing', completed: 50, total: 100, unit: 'sourceUs' })
        return goodOutput()
      },
    })
    await runTranscription(adapter, input, options, { onProgress: (value) => seen.push(value) })
    expect(seen).toHaveLength(3)
  })

  it('fails with INVALID_PROGRESS and aborts the adapter signal on malformed progress', async () => {
    let sawAbort = false
    const adapter = makeAdapter({
      caps: capabilities,
      transcribe: async (_input, _options, progress, signal) => {
        progress({ kind: 'measured', phase: 'recognizing', completed: 5, total: 10 } as unknown as JobProgress)
        await new Promise<void>((resolve) => {
          if (signal.aborted) { sawAbort = true; resolve(); return }
          signal.addEventListener('abort', () => { sawAbort = true; resolve() }, { once: true })
        })
        return goodOutput()
      },
    })
    await expectCode(runTranscription(adapter, input, options), 'INVALID_PROGRESS')
    expect(sawAbort).toBe(true)
  })

  it('fails with INVALID_PROGRESS when progress regresses, discarding the resolved output', async () => {
    const adapter = makeAdapter({
      caps: capabilities,
      transcribe: async (_input, _options, progress) => {
        progress({ kind: 'measured', phase: 'recognizing', completed: 50, total: 100, unit: 'sourceUs' })
        progress({ kind: 'measured', phase: 'recognizing', completed: 10, total: 100, unit: 'sourceUs' })
        return goodOutput()
      },
    })
    await expectCode(runTranscription(adapter, input, options), 'INVALID_PROGRESS')
  })
})

describe('runTranscription: output validation and failure mapping', () => {
  it('rejects malformed output as MALFORMED_OUTPUT', async () => {
    const adapter = makeAdapter({ caps: capabilities, transcribe: async () => ({ engine: capabilities.engine.id, model: capabilities.model.id, language: 'ml', segments: [{ startUs: 10, endUs: 5, text: 'x' }] }) })
    await expectCode(runTranscription(adapter, input, options), 'MALFORMED_OUTPUT')
  })

  it('waits for the adapter to settle on cancellation and discards output returned after abort', async () => {
    const controller = new AbortController()
    let resolveTranscribe!: (value: RawTranscriptionOutput) => void
    let notifyCalled!: () => void
    const called = new Promise<void>((resolve) => { notifyCalled = resolve })
    const adapter = makeAdapter({
      caps: capabilities,
      transcribe: () => { notifyCalled(); return new Promise<RawTranscriptionOutput>((resolve) => { resolveTranscribe = resolve }) },
    })
    const resultPromise = runTranscription(adapter, input, options, { signal: controller.signal })
    // Cancel only once the adapter is actually mid-flight, then let it resolve with
    // otherwise-valid output afterward; run() must still reject rather than resolve with it.
    await called
    controller.abort()
    resolveTranscribe(goodOutput())
    await expectCode(resultPromise, 'CANCELLED')
  })

  it('wraps a thrown non-contract error as BACKEND_FAILED', async () => {
    const adapter = makeAdapter({ caps: capabilities, transcribe: async () => { throw new Error('native crash') } })
    await expectCode(runTranscription(adapter, input, options), 'BACKEND_FAILED')
  })

  it('passes a thrown JobFailure through unchanged', async () => {
    const adapter = makeAdapter({ caps: capabilities, transcribe: async () => { throw new JobFailure({ code: 'MODEL_UNAVAILABLE', message: 'model missing', retryable: false }) } })
    await expectCode(runTranscription(adapter, input, options), 'MODEL_UNAVAILABLE')
  })
})

describe('runAlignment', () => {
  const segments = [{ id: 'cue-1', startUs: input.audio.sourceStartUs, endUs: input.audio.sourceStartUs + 1_000_000, text: 'hello there' }]

  it('rejects alignment when the adapter has no align method, without calling capabilities-declared alignment', async () => {
    const adapter = makeAdapter({ caps: capabilities })
    await expectCode(runAlignment(adapter, input, 'en', segments), 'UNSUPPORTED_OPTION')
    expect(adapter.alignCalls).toBe(0)
  })

  it('rejects alignment when capabilities declare none, even if the adapter has an align method', async () => {
    const adapter = makeAdapter({ caps: { ...capabilities, alignment: null }, align: async () => ({ engine: capabilities.engine.id, model: capabilities.model.id, language: 'en', segments: [] }) })
    await expectCode(runAlignment(adapter, input, 'en', segments), 'UNSUPPORTED_OPTION')
    expect(adapter.alignCalls).toBe(0)
  })

  it('rejects a language not in the declared alignment set without calling align', async () => {
    const adapter = makeAdapter({ caps: capabilities, align: async () => ({ engine: capabilities.engine.id, model: capabilities.model.id, language: 'ml', segments: [] }) })
    await expectCode(runAlignment(adapter, input, 'ml', segments), 'UNSUPPORTED_LANGUAGE')
    expect(adapter.alignCalls).toBe(0)
  })

  it('succeeds and maps aligned words to source time', async () => {
    const adapter = makeAdapter({
      caps: capabilities,
      align: async (_input, relativeSegments) => ({
        engine: capabilities.engine.id, model: capabilities.model.id, language: 'en',
        segments: relativeSegments.map((segment) => ({ id: segment.id, words: [{ startUs: segment.startUs, endUs: segment.startUs + 100, text: 'hello' }] })),
      }),
    })
    const result = await runAlignment(adapter, input, 'en', segments)
    expect(result.segments[0].words[0].startUs).toBe(input.audio.sourceStartUs)
  })
})
