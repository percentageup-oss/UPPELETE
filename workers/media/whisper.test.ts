import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { runExecutableCapture } from './process'
import { failure, type MediaTask, type ProgressMessage } from './protocol'
import { pcm16MonoWavHeader, readWavInfo } from './wav'
import { inspectWhisper, transcribeWithWhisper, whisperArguments, writeSpeechChunks } from './whisper'

/**
 * The tool runner below is a test double: it records the real argument arrays and chunk files the worker
 * produces and writes JSON in whisper-cli's -oj shape. It checks orchestration, offsets and cleanup only; it
 * does not simulate recognition quality or timing. Real whisper.cpp runs are in scripts/transcription-smoke.ts.
 */

let directory: string
beforeEach(async () => { directory = await mkdtemp(path.join(tmpdir(), 'caption-whisper-test മലയാളം ')) })
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

const tone = (count: number) => Int16Array.from({ length: count }, (_value, index) => (index % 40 < 20 ? 8000 : -8000))
const zeros = (count: number) => new Int16Array(count)
async function writeAudio(name: string, parts: Int16Array[], sampleRate = 16000) {
  const count = parts.reduce((sum, part) => sum + part.length, 0)
  const data = Buffer.alloc(count * 2)
  let offset = 0
  for (const part of parts) for (const value of part) { data.writeInt16LE(value, offset); offset += 2 }
  const file = path.join(directory, name)
  await writeFile(file, Buffer.concat([pcm16MonoWavHeader(count, sampleRate), data]))
  return file
}
const leftovers = async () => (await readdir(directory)).filter((name) => name.startsWith('caption-studio-whisper'))

type Call = { args: string[]; chunkSamples: number }
type Response = { language: string; segments: { from: number; to: number; text: string }[] } | Error
function whisperDouble(respond: (call: { language: string; chunkSamples: number; index: number }) => Response, calls: Call[]) {
  return (async (_executable, args, _signal, _maxBytes, observer) => {
    const list = [...args]
    const value = (flag: string) => list[list.indexOf(flag) + 1]
    const info = await readWavInfo(value('-f'))
    calls.push({ args: list, chunkSamples: info.sampleCount })
    const response = respond({ language: value('-l'), chunkSamples: info.sampleCount, index: calls.length - 1 })
    if (response instanceof Error) throw response
    const backendLine = list.includes('-ng') ? 'whisper_backend_init_gpu: no GPU found' : 'whisper_backend_init_gpu: using MTL0 backend'
    const stderr = `${backendLine}\nwhisper_print_progress_callback: progress =  50%\nwhisper_print_progress_callback: progress = 100%\n`
    observer?.onStderr?.(Buffer.from(stderr))
    await writeFile(`${value('-of')}.json`, JSON.stringify({ result: { language: response.language }, transcription: response.segments.map((segment) => ({ offsets: { from: segment.from, to: segment.to }, text: segment.text })) }))
    return { stdout: '', stderr }
  }) as typeof runExecutableCapture
}
const transcribeTask = (audioPath: string, language: string, useGpu = true, durationUs = 3_600_000_000): Extract<MediaTask, { operation: 'whisperTranscribe' }> =>
  ({ operation: 'whisperTranscribe', audioPath, modelPath: '/Models/ggml-base.bin', language, useGpu, durationUs })

describe('whisper.cpp worker operation', () => {
  it('builds fixed argument arrays with CPU fallback as -ng and no cross-window text context', () => {
    expect(whisperArguments({ modelPath: '/m/ggml-base.bin', audioPath: '/j/chunk-0.wav', language: 'ml', useGpu: false, threads: 8, outputBase: '/j/chunk-0' }))
      .toEqual(['-m', '/m/ggml-base.bin', '-f', '/j/chunk-0.wav', '-l', 'ml', '-t', '8', '-pp', '-sns', '-mc', '0', '-oj', '-of', '/j/chunk-0', '-ng'])
  })

  it('never sends a long silence, maps each chunk offset exactly and reports honest monotonic progress', async () => {
    const audioPath = await writeAudio('audio ശബ്ദം.wav', [tone(16000), zeros(80000), tone(32000)])
    const calls: Call[] = []
    const runTool = whisperDouble(({ language }) => language === 'auto'
      ? { language: 'ml', segments: [{ from: 0, to: 2400, text: ' ദീർഘമായ ഇടവേളയ്ക്ക് ശേഷം' }] }
      : { language: 'ml', segments: [{ from: 0, to: 1000, text: ' ആദ്യ വാചകം test' }] }, calls)
    const progress: ProgressMessage['progress'][] = []
    const result = await transcribeWithWhisper('/tools/whisper-cli', transcribeTask(audioPath, 'auto'), new AbortController().signal, (value) => progress.push(value), { runTool, temporaryRoot: directory, threads: 8 })

    // Longest speech chunk first with auto-detection, then the detected language for the rest; 80,000 silent samples never sent.
    expect(calls.map((call) => ({ samples: call.chunkSamples, language: call.args[call.args.indexOf('-l') + 1], gpu: !call.args.includes('-ng') })))
      .toEqual([{ samples: 36800, language: 'auto', gpu: true }, { samples: 20800, language: 'ml', gpu: true }])
    expect(result).toEqual({
      operation: 'whisperTranscribe', language: 'ml', languageSource: 'detected', backends: ['MTL0'], threads: 8,
      speechGating: 'pcm16-rms20ms-below-45dbfs-min2000ms-pad300ms-v1',
      silences: [{ startUs: 1_000_000, endUs: 6_000_000 }],
      chunks: [{ startUs: 0, endUs: 1_300_000 }, { startUs: 5_700_000, endUs: 8_000_000 }],
      segments: [
        { startUs: 0, endUs: 1_000_000, text: 'ആദ്യ വാചകം test' },
        { startUs: 5_700_000, endUs: 8_000_000, text: 'ദീർഘമായ ഇടവേളയ്ക്ക് ശേഷം', timingAdjustment: 'end-clamped-to-chunk' },
      ],
      dropped: { empty: 0, outsideChunk: 0, zeroDuration: 0 },
    })
    expect(progress).toEqual([
      { kind: 'indeterminate', phase: 'detecting-speech' },
      ...[0, 1_150_000, 2_300_000, 2_950_000, 3_600_000].map((completed) => ({ kind: 'measured', phase: 'recognizing', completed, total: 3_600_000, unit: 'sourceUs' })),
    ])
    expect(await leftovers()).toEqual([])
  })

  it('does not run whisper at all for all-silent audio', async () => {
    const audioPath = await writeAudio('silence.wav', [zeros(48000)])
    const calls: Call[] = []
    const runTool = whisperDouble(() => new Error('must not run'), calls)
    const auto = await transcribeWithWhisper('/tools/whisper-cli', transcribeTask(audioPath, 'auto'), new AbortController().signal, () => {}, { runTool, temporaryRoot: directory })
    expect(auto).toMatchObject({ language: null, languageSource: 'none', segments: [], chunks: [], backends: [], silences: [{ startUs: 0, endUs: 3_000_000 }] })
    const requested = await transcribeWithWhisper('/tools/whisper-cli', transcribeTask(audioPath, 'en'), new AbortController().signal, () => {}, { runTool, temporaryRoot: directory })
    expect(requested).toMatchObject({ language: 'en', languageSource: 'requested', segments: [] })
    expect(calls).toEqual([])
  })

  it('runs CPU-only with -ng and reports the CPU backend whisper.cpp initialized', async () => {
    const audioPath = await writeAudio('speech.wav', [tone(8000)])
    const calls: Call[] = []
    const result = await transcribeWithWhisper('/tools/whisper-cli', transcribeTask(audioPath, 'en', false), new AbortController().signal, () => {}, { runTool: whisperDouble(() => ({ language: 'en', segments: [] }), calls), temporaryRoot: directory })
    expect(calls[0].args).toContain('-ng')
    expect(result).toMatchObject({ backends: ['CPU'], language: 'en', segments: [] })
  })

  it('bounds chunk and segment ends by the audio window when the last sample ends past it (observed in real extraction)', async () => {
    // 16,001 samples end at 1,000,062 µs, but the extracted window is exactly 1,000,000 µs.
    const audioPath = await writeAudio('overshoot.wav', [tone(16001)])
    const result = await transcribeWithWhisper('/tools/whisper-cli', transcribeTask(audioPath, 'en', true, 1_000_000), new AbortController().signal, () => {},
      { runTool: whisperDouble(() => ({ language: 'en', segments: [{ from: 0, to: 1100, text: 'whole clip' }] }), []), temporaryRoot: directory })
    expect(result.chunks).toEqual([{ startUs: 0, endUs: 1_000_000 }])
    expect(result.segments).toEqual([{ startUs: 0, endUs: 1_000_000, text: 'whole clip', timingAdjustment: 'end-clamped-to-chunk' }])
  })

  it('maps a model load failure to an actionable error and removes job files', async () => {
    const audioPath = await writeAudio('speech.wav', [tone(8000)])
    const runTool = whisperDouble(() => failure('TOOL_FAILED', 'Local media tool failed', { exitCode: 3, diagnostic: 'whisper_init_from_file_with_params_no_state: loading model\nerror: failed to initialize whisper context\n' }), [])
    await expect(transcribeWithWhisper('/tools/whisper-cli', transcribeTask(audioPath, 'ml'), new AbortController().signal, () => {}, { runTool, temporaryRoot: directory }))
      .rejects.toMatchObject({ detail: { code: 'TOOL_FAILED', message: expect.stringContaining('could not load the selected model'), exitCode: 3 } })
    expect(await leftovers()).toEqual([])
  })

  it('fails closed when whisper reports a language other than the one requested', async () => {
    const audioPath = await writeAudio('speech.wav', [tone(8000)])
    await expect(transcribeWithWhisper('/tools/whisper-cli', transcribeTask(audioPath, 'ml'), new AbortController().signal, () => {}, { runTool: whisperDouble(() => ({ language: 'en', segments: [] }), []), temporaryRoot: directory }))
      .rejects.toMatchObject({ detail: { code: 'TOOL_FAILED' } })
  })

  it('stops before the next chunk once cancelled and cleans up', async () => {
    const audioPath = await writeAudio('speech.wav', [tone(16000), zeros(80000), tone(16000)])
    const controller = new AbortController()
    const calls: Call[] = []
    const runTool = whisperDouble(() => { controller.abort(); return { language: 'en', segments: [{ from: 0, to: 500, text: 'one' }] } }, calls)
    await expect(transcribeWithWhisper('/tools/whisper-cli', transcribeTask(audioPath, 'en'), controller.signal, () => {}, { runTool, temporaryRoot: directory }))
      .rejects.toMatchObject({ detail: { code: 'CANCELLED' } })
    expect(calls).toHaveLength(1)
    expect(await leftovers()).toEqual([])
  })

  it('rejects audio that is not 16 kHz mono PCM', async () => {
    const audioPath = await writeAudio('wrong-rate.wav', [tone(4800)], 48000)
    await expect(transcribeWithWhisper('/tools/whisper-cli', transcribeTask(audioPath, 'en'), new AbortController().signal, () => {}, { runTool: whisperDouble(() => new Error('must not run'), []), temporaryRoot: directory }))
      .rejects.toMatchObject({ detail: { code: 'INVALID_MESSAGE' } })
  })
})

describe('whisper.cpp inspection', () => {
  const gpuStderr = 'whisper_backend_init_gpu: using MTL0 backend\nwhisper_backend_init: using BLAS backend\nsystem_info: n_threads = 8 / 12 | MTL : EMBED_LIBRARY = 1 | CPU : NEON = 1 | \n'
  const cpuStderr = 'whisper_backend_init_gpu: no GPU found\nwhisper_backend_init: using BLAS backend\n'
  function inspectionDouble(stderr: { gpu: string; cpu: string }, version = 'whisper.cpp version: 1.9.4\n', probes: { samples: number; cpu: boolean; model: string }[] = []) {
    return (async (_executable, args) => {
      const list = [...args]
      if (list[0] === '--version') return { stdout: version, stderr: '' }
      const info = await readWavInfo(list[list.indexOf('-f') + 1])
      probes.push({ samples: info.sampleCount, cpu: list.includes('-ng'), model: list[list.indexOf('-m') + 1] })
      return { stdout: '[BLANK_AUDIO]', stderr: list.includes('-ng') ? stderr.cpu : stderr.gpu }
    }) as typeof runExecutableCapture
  }

  it('reports the version, the GPU backend whisper.cpp initialized and a verified CPU fallback', async () => {
    const probes: { samples: number; cpu: boolean; model: string }[] = []
    const result = await inspectWhisper('/tools/whisper-cli', { operation: 'inspectWhisper', modelPath: '/Models/ggml-base.bin' }, new AbortController().signal, () => {},
      { runTool: inspectionDouble({ gpu: gpuStderr, cpu: cpuStderr }, undefined, probes), temporaryRoot: directory })
    expect(result).toEqual({ operation: 'inspectWhisper', version: '1.9.4', gpuBackend: 'MTL0', cpuFallbackVerified: true, systemInfo: 'n_threads = 8 / 12 | MTL : EMBED_LIBRARY = 1 | CPU : NEON = 1 |' })
    expect(probes).toEqual([{ samples: 16000, cpu: false, model: '/Models/ggml-base.bin' }, { samples: 16000, cpu: true, model: '/Models/ggml-base.bin' }])
    expect(await leftovers()).toEqual([])
  })

  it('reports no GPU when whisper.cpp initialized none, and rejects unknown executables or silent builds', async () => {
    const signal = new AbortController().signal
    const task = { operation: 'inspectWhisper' as const, modelPath: '/Models/ggml-base.bin' }
    expect(await inspectWhisper('/tools/whisper-cli', task, signal, () => {}, { runTool: inspectionDouble({ gpu: cpuStderr, cpu: cpuStderr }), temporaryRoot: directory }))
      .toMatchObject({ gpuBackend: null, cpuFallbackVerified: true })
    await expect(inspectWhisper('/tools/whisper-cli', task, signal, () => {}, { runTool: inspectionDouble({ gpu: '', cpu: cpuStderr }), temporaryRoot: directory }))
      .rejects.toMatchObject({ detail: { code: 'TOOL_FAILED' } })
    await expect(inspectWhisper('/tools/whisper-cli', task, signal, () => {}, { runTool: inspectionDouble({ gpu: gpuStderr, cpu: gpuStderr }), temporaryRoot: directory }))
      .rejects.toMatchObject({ detail: { code: 'TOOL_FAILED' } })
    await expect(inspectWhisper('/tools/whisper-cli', task, signal, () => {}, { runTool: inspectionDouble({ gpu: gpuStderr, cpu: cpuStderr }, 'ffmpeg version 9.0.1'), temporaryRoot: directory }))
      .rejects.toMatchObject({ detail: { code: 'TOOL_FAILED', message: expect.stringContaining('did not report a whisper.cpp version') } })
    expect(await leftovers()).toEqual([])
  })
})

describe('speech chunk files for cloud transcription', () => {
  it('writes only speech between long silences, splits over-long speech, and reports exact audio-relative ranges', async () => {
    const audio = await writeAudio('speech.wav', [tone(32_000), zeros(64_000), tone(48_000)])
    const outputDirectory = path.join(directory, 'chunks')
    await import('node:fs/promises').then((fs) => fs.mkdir(outputDirectory))
    const result = await writeSpeechChunks({ operation: 'speechChunks', audioPath: audio, outputDirectory, durationUs: 9_000_000, maxChunkUs: 2_000_000 }, new AbortController().signal, () => {})
    expect(result.silences).toEqual([{ startUs: 2_000_000, endUs: 6_000_000 }])
    expect(result.chunks.map(({ startUs, endUs }) => ({ startUs, endUs }))).toEqual([
      { startUs: 0, endUs: 2_000_000 }, { startUs: 2_000_000, endUs: 2_300_000 },
      { startUs: 5_700_000, endUs: 7_700_000 }, { startUs: 7_700_000, endUs: 9_000_000 },
    ])
    for (const chunk of result.chunks) {
      expect(path.dirname(chunk.path)).toBe(outputDirectory)
      expect((await readWavInfo(chunk.path)).sampleCount).toBe((chunk.endUs - chunk.startUs) * 16 / 1000)
    }
  })

  it('writes nothing for all-silent audio', async () => {
    const audio = await writeAudio('silent.wav', [zeros(80_000)])
    const outputDirectory = path.join(directory, 'none')
    await import('node:fs/promises').then((fs) => fs.mkdir(outputDirectory))
    const result = await writeSpeechChunks({ operation: 'speechChunks', audioPath: audio, outputDirectory, durationUs: 5_000_000, maxChunkUs: 60_000_000 }, new AbortController().signal, () => {})
    expect(result.chunks).toEqual([])
    expect(await readdir(outputDirectory)).toEqual([])
  })
})
