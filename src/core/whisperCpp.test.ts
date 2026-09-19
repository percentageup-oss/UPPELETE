import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { languageCodeSchema } from './transcription'
import {
  createLineReader, deviceForBackendName, escapeRawControlCharacters, normalizeChunkSegments, parseWhisperBackend, parseWhisperJson,
  parseWhisperProgressLine, parseWhisperVersion, WHISPER_LANGUAGES, WhisperOutputError,
} from './whisperCpp'

// Lines captured verbatim from real whisper-cli 1.9.4 runs (ggml-base.bin) on macOS arm64, with Metal and with -ng.
const metalStderr = [
  'whisper_init_with_params_no_state: devices    = 3',
  'whisper_backend_init_gpu: device 0: MTL0 (type: 1)',
  'whisper_backend_init_gpu: found GPU device 0: MTL0 (type: 1, cnt: 0)',
  'whisper_backend_init_gpu: using MTL0 backend',
  'ggml_metal_init: found device: Apple M4 Pro',
  'whisper_backend_init: using BLAS backend',
  'system_info: n_threads = 8 / 12 | WHISPER : VITISAI = 0 | COREML = 0 | OPENVINO = 0 | MTL : EMBED_LIBRARY = 1 | CPU : NEON = 1 | ARM_FMA = 1 | FP16_VA = 1 | DOTPROD = 1 | ACCELERATE = 1 | REPACK = 1 | ',
  'whisper_print_progress_callback: progress =  81%',
  'whisper_print_progress_callback: progress = 100%',
].join('\n')
const cpuStderr = [
  'whisper_backend_init_gpu: no GPU found',
  'whisper_backend_init: using BLAS backend',
  'whisper_full_with_state: auto-detected language: en (p = 0.967344)',
].join('\n')
const utf8 = (text: string) => new TextEncoder().encode(text)

describe('whisper-cli JSON transcript', () => {
  it('parses a real whisper-cli 1.9.4 -oj transcript (model path redacted) with its integer millisecond offsets', () => {
    const parsed = parseWhisperJson(readFileSync('tests/fixtures/whisper-cli-1.9.4-base-transcript.json'))
    expect(parsed).toEqual({
      language: 'en',
      segments: [
        { fromMs: 0, toMs: 4000, text: ' Welcome to the Caption Studio Test.' },
        { fromMs: 4000, toMs: 8000, text: ' This sentence comes before a long pause.' },
        { fromMs: 26000, toMs: 34000, text: ' After 20 seconds of silence, the speaker returns and finishes the recording.' },
      ],
    })
  })

  it('preserves Malayalam/English text and combining marks byte-exactly', () => {
    const text = ' ഇത് ഒരു test ആണ്, ശരിയല്ലേ?'
    const json = JSON.stringify({ result: { language: 'ml' }, transcription: [{ timestamps: {}, offsets: { from: 120, to: 2380 }, text }] })
    expect(parseWhisperJson(utf8(json)).segments[0].text).toBe(text)
  })

  it('re-escapes only raw control characters that whisper-cli 1.9.4 leaves unescaped inside strings', () => {
    const raw = '{"result":{"language":"en"},"transcription":[{"offsets":{"from":0,"to":10},"text":"a\tb\nq\\"u\\\\ote"}]}'
    expect(escapeRawControlCharacters(raw)).toBe('{"result":{"language":"en"},"transcription":[{"offsets":{"from":0,"to":10},"text":"a\\u0009b\\u000aq\\"u\\\\ote"}]}')
    expect(parseWhisperJson(utf8(raw)).segments[0].text).toBe('a\tb\nq"u\\ote')
    expect(() => escapeRawControlCharacters('{"text":"open')).toThrow(WhisperOutputError)
  })

  it('fails closed on invalid UTF-8, invalid JSON and unexpected shapes', () => {
    expect(() => parseWhisperJson(new Uint8Array([0x7b, 0xff, 0x7d]))).toThrow('not valid UTF-8')
    expect(() => parseWhisperJson(utf8('{"result":'))).toThrow(WhisperOutputError)
    expect(() => parseWhisperJson(utf8('{"result":{"language":"en"},"transcription":[{"offsets":{"from":-1,"to":10},"text":"a"}]}'))).toThrow('unexpected shape')
    expect(() => parseWhisperJson(utf8('{"transcription":[]}'))).toThrow('unexpected shape')
  })
})

describe('whisper-cli log parsing', () => {
  it('reads the initialized backend from real stderr rather than inferring a device', () => {
    expect(parseWhisperBackend(metalStderr)).toEqual({ kind: 'gpu', name: 'MTL0' })
    expect(parseWhisperBackend(cpuStderr)).toEqual({ kind: 'cpu' })
    expect(parseWhisperBackend('whisper_backend_init_gpu: using MTL0 backend\nwhisper_backend_init_gpu: failed to initialize MTL0 backend\n')).toEqual({ kind: 'cpu' })
    expect(parseWhisperBackend('whisper_backend_init: using BLAS backend')).toEqual({ kind: 'unreported' })
    expect(deviceForBackendName('MTL0')).toBe('metal')
    expect(deviceForBackendName('CUDA1')).toBe('cuda')
    expect(deviceForBackendName('Vulkan0')).toBe('vulkan')
    expect(deviceForBackendName('BLAS')).toBeNull()
  })

  it('reads real -pp progress lines, including lines split across stream chunks', () => {
    const values: number[] = []
    const reader = createLineReader((line) => { const value = parseWhisperProgressLine(line); if (value !== null) values.push(value) })
    reader.push(metalStderr.slice(0, 500))
    reader.push(metalStderr.slice(500))
    reader.finish()
    expect(values).toEqual([81, 100])
    expect(parseWhisperProgressLine('whisper_print_progress_callback: progress = 101%')).toBeNull()
    expect(parseWhisperProgressLine('main: processing progress = 50%')).toBeNull()
  })

  it('reads the version reported by --version', () => {
    expect(parseWhisperVersion('whisper.cpp version: 1.9.4\n')).toBe('1.9.4')
    expect(parseWhisperVersion('whisper.cpp version: 1.9.4-dev\n')).toBe('1.9.4-dev')
    expect(parseWhisperVersion('usage: something else')).toBeNull()
  })

  it('declares the 100 language codes of whisper.cpp 1.9.4, including Malayalam and English', () => {
    expect(WHISPER_LANGUAGES).toHaveLength(100)
    expect(new Set(WHISPER_LANGUAGES).size).toBe(100)
    expect(WHISPER_LANGUAGES).toContain('ml')
    expect(WHISPER_LANGUAGES).toContain('en')
    for (const code of WHISPER_LANGUAGES) expect(languageCodeSchema.safeParse(code).success).toBe(true)
  })
})

describe('normalizeChunkSegments', () => {
  it('maps chunk-relative milliseconds to audio microseconds exactly, trimming only surrounding whitespace', () => {
    const result = normalizeChunkSegments({ startUs: 1_197_000, endUs: 7_020_000 }, [
      { fromMs: 0, toMs: 2800, text: ' Welcome to the Caption Studio Test.' },
      { fromMs: 2800, toMs: 5800, text: ' ഇത് ഒരു test ആണ് ' },
    ])
    expect(result).toEqual({
      segments: [
        { startUs: 1_197_000, endUs: 3_997_000, text: 'Welcome to the Caption Studio Test.' },
        { startUs: 3_997_000, endUs: 6_997_000, text: 'ഇത് ഒരു test ആണ്' },
      ],
      dropped: { empty: 0, outsideChunk: 0, zeroDuration: 0 },
    })
  })

  it('clamps an end past the audio given to whisper (observed in real output) and marks it', () => {
    const result = normalizeChunkSegments({ startUs: 26_860_000, endUs: 32_000_000 }, [{ fromMs: 0, toMs: 5320, text: ' After 20 seconds of silence.' }])
    expect(result.segments).toEqual([{ startUs: 26_860_000, endUs: 32_000_000, text: 'After 20 seconds of silence.', timingAdjustment: 'end-clamped-to-chunk' }])
  })

  it('extends zero-length segments to the next segment, moves overlapping starts and drops text with no audio', () => {
    const result = normalizeChunkSegments({ startUs: 10_000_000, endUs: 13_000_000 }, [
      { fromMs: 0, toMs: 0, text: 'zero' },
      { fromMs: 500, toMs: 1500, text: 'next' },
      { fromMs: 1400, toMs: 2000, text: 'overlap' },
      { fromMs: 2000, toMs: 2200, text: '   ' },
      { fromMs: 3000, toMs: 3000, text: 'at end' },
      { fromMs: 3500, toMs: 4000, text: 'beyond' },
    ])
    expect(result.segments).toEqual([
      { startUs: 10_000_000, endUs: 10_500_000, text: 'zero', timingAdjustment: 'zero-duration-extended' },
      { startUs: 10_500_000, endUs: 11_500_000, text: 'next' },
      { startUs: 11_500_000, endUs: 12_000_000, text: 'overlap', timingAdjustment: 'start-moved-after-overlap' },
    ])
    expect(result.dropped).toEqual({ empty: 1, outsideChunk: 2, zeroDuration: 0 })
  })
})
