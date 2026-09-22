import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { clientMessageSchema, resultSchema, serverMessageSchema, MAX_MESSAGE_BYTES, filePath, type MediaTask } from './protocol'
import { MessageDecoder, encodeMessage } from './wire'

const range = { startUs: 1200001, endUs: 3123456 }
const inputPath = 'C:\\Media folder\\മലയാളം & $(not-a-command).mp4'
const tasks: MediaTask[] = [
  { operation: 'probe', inputPath },
  { operation: 'waveform', inputPath, range, maxPeaks: 4096 },
  { operation: 'thumbnails', inputPath, timestampsUs: [range.startUs], width: 160, outputDirectory: 'C:\\Cache' },
  { operation: 'extractAudio', inputPath, range, outputPath: 'C:\\Cache\\speech.wav', sampleRate: 16000, channels: 1 },
  { operation: 'detectSilence', inputPath, range, thresholdDbfs: -40, minSilenceMs: 500 },
  { operation: 'proxy', inputPath, outputPath: 'C:\\Cache\\proxy.webm', durationUs: 3123456 },
  { operation: 'inspectWhisper', modelPath: 'C:\\Users\\മലയാളം\\Models\\ggml-base.bin' },
  { operation: 'whisperTranscribe', audioPath: 'C:\\Cache\\speech.wav', modelPath: '/Models/ggml-base.bin', language: 'ml', useGpu: false, durationUs: 3123456 },
  { operation: 'export', inputPaths: [inputPath], range, outputPath: 'C:\\Exports\\captioned.mp4', renderManifestPath: 'C:\\Cache\\frames.json',
    frameRate: { numerator: 30000, denominator: 1001 }, width: 1080, height: 1920, profile: 'mp4-caption-renderer-v1' },
]
const request = (task: unknown) => ({ version: 1, type: 'request', id: randomUUID(), task })
const fingerprint = { algorithm: 'sha256-sampled-v1', value: 'a'.repeat(64), sizeBytes: 1024, sampledBytes: 1024 }
const metadata = { durationUs: null, width: null, height: null, rotationDegrees: null, frameRate: null, nominalFrameRate: null, streams: [] }

describe('media protocol', () => {
  it.each(tasks)('round-trips the $operation contract without altering source timestamps or portable path text', (task) => {
    const value = request(task)
    expect(clientMessageSchema.parse(JSON.parse(JSON.stringify(value)))).toEqual(value)
  })
  it('rejects extra keys, unknown versions, unsafe/fractional times, invalid ranges, paths and arbitrary flags', () => {
    const valid = request(tasks[1])
    const invalid = [
      { ...valid, version: 2 }, { ...valid, extra: 'hidden' }, { ...valid, id: 'bad' },
      request({ ...tasks[0], args: ['-y'] }), request({ ...tasks[0], inputPath: '\0' }),
      request({ ...tasks[1], range: { startUs: 0.1, endUs: 10 } }),
      request({ ...tasks[1], range: { startUs: 2, endUs: 1 } }),
      request({ ...tasks[1], range: { startUs: 0, endUs: Number.MAX_SAFE_INTEGER + 1 } }),
      request({ ...tasks[2], timestampsUs: [NaN] }),
      request({ ...tasks[8], frameRate: { numerator: 30, denominator: 0 } }),
      request({ ...tasks[7], language: 'en-US' }),
      request({ ...tasks[7], executable: '/bin/sh' }),
      request({ ...tasks[6], modelPath: 'models/ggml-base.bin' }),
      request({ ...tasks[4], thresholdDbfs: 1 }),
    ]
    for (const value of invalid) expect(clientMessageSchema.safeParse(value).success).toBe(false)
  })
  it('accepts native absolute path syntaxes but rejects URLs and relative paths', () => {
    for (const value of ['/Volumes/Media/മലയാളം.mp4', 'C:\\Media folder\\clip.mp4', 'C:/Media/clip.mp4', '\\\\server\\share\\clip.mp4']) {
      expect(filePath.parse(value)).toBe(value)
    }
    for (const value of ['https://example.com/video.mp4', 'file:///tmp/video.mp4', '../video.mp4', 'C:relative.mp4']) {
      expect(filePath.safeParse(value).success).toBe(false)
    }
  })
  it('validates results for all reserved operations', () => {
    const results = [
      { operation: 'probe', metadata, fingerprint },
      { operation: 'waveform', range, peaks: [0, 0.5, 1] },
      { operation: 'thumbnails', images: [{ requestedUs: 1200001, actualUs: 1200020, path: '/cache/ക.png', width: 160, height: 90 }] },
      { operation: 'extractAudio', path: '/cache/a.wav', sourceStartUs: 1200001, durationUs: 1000000, sampleRate: 16000, channels: 1, sampleCount: 16000 },
      { operation: 'detectSilence', range, silences: [{ startUs: 1_500_000, endUs: 2_000_000 }], speechGating: 'pcm16-rms20ms-below-45dbfs-min2000ms-pad300ms-v1' },
      { operation: 'proxy', path: '/cache/proxy.webm', durationUs: 3123456 },
      { operation: 'inspectWhisper', version: '1.9.4', gpuBackend: 'MTL0', cpuFallbackVerified: true, systemInfo: null },
      { operation: 'whisperTranscribe', language: 'ml', languageSource: 'requested', backends: ['CPU'], threads: 8, speechGating: 'gating-v1',
        silences: [{ startUs: 1_000_000, endUs: 6_000_000 }], chunks: [{ startUs: 0, endUs: 1_300_000 }],
        segments: [{ startUs: 0, endUs: 1_000_000, text: 'ആദ്യ', timingAdjustment: 'end-clamped-to-chunk' }], dropped: { empty: 0, outsideChunk: 0, zeroDuration: 0 } },
      { operation: 'export', path: '/export/a.mp4', durationUs: 1000000, frameCount: 30, frameRate: { numerator: 30, denominator: 1 } },
    ]
    for (const result of results) expect(resultSchema.parse(result)).toEqual(result)
    expect(resultSchema.safeParse({ ...results[1], peaks: [1.1] }).success).toBe(false)
    expect(resultSchema.safeParse({ operation: 'probe', metadata: { ...metadata, durationUs: -1 }, fingerprint }).success).toBe(false)
  })
  it('validates progress, errors and cancellation messages', () => {
    const base = { version: 1, id: randomUUID(), operation: 'export' }
    expect(serverMessageSchema.parse({ ...base, type: 'cancelled' }).type).toBe('cancelled')
    expect(clientMessageSchema.parse({ version: 1, id: base.id, type: 'cancel' }).type).toBe('cancel')
    expect(serverMessageSchema.safeParse({ ...base, type: 'error', error: { code: 'MADE_UP', message: 'x', retryable: true } }).success).toBe(false)
    expect(serverMessageSchema.safeParse({ ...base, type: 'progress', progress: { kind: 'measured', phase: 'export', completed: 20, total: 10, unit: 'frames' } }).success).toBe(false)
  })
  it('frames fragmented UTF-8 and multiple messages without changing text', () => {
    const values = [request(tasks[0]), request(tasks[2])]
    const bytes = Buffer.from(values.map(encodeMessage).join(''))
    const received: unknown[] = []
    const decoder = new MessageDecoder()
    for (const byte of bytes) decoder.push(Buffer.from([byte]), (value) => received.push(value))
    decoder.finish()
    expect(received).toEqual(values)
  })
  it('rejects oversized, malformed and truncated frames', () => {
    expect(() => encodeMessage('x'.repeat(MAX_MESSAGE_BYTES))).toThrow('size limit')
    expect(() => new MessageDecoder().push(Buffer.alloc(MAX_MESSAGE_BYTES + 1), () => {})).toThrow('size limit')
    expect(() => new MessageDecoder().push(Buffer.from('not JSON\n'), () => {})).toThrow('not JSON')
    expect(() => new MessageDecoder().push(Buffer.from([34, 255, 34, 10]), () => {})).toThrow('not JSON')
    const decoder = new MessageDecoder()
    decoder.push(Buffer.from('{'), () => {})
    expect(() => decoder.finish()).toThrow('Truncated')
  })
})
