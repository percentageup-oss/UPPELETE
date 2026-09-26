import { mkdtemp, open, readFile, rm, writeFile, type FileHandle } from 'node:fs/promises'
import { availableParallelism, tmpdir } from 'node:os'
import path from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { LongSilenceDetector, planSpeechChunks, samplesToUs, SPEECH_GATING_VERSION, type SampleSpan } from '../../src/core/speechGating'
import { languageCodeSchema } from '../../src/core/transcription'
import {
  createLineReader, normalizeChunkSegments, parseWhisperBackend, parseWhisperJson, parseWhisperProgressLine, parseWhisperVersion,
  WHISPER_SAMPLE_RATE, WhisperOutputError, type ChunkSegment,
} from '../../src/core/whisperCpp'
import { runExecutableCapture, type ExecutableOutput } from './process'
import { failure, MediaWorkerError, type MediaResult, type MediaTask, type ProgressMessage } from './protocol'
import { pcm16MonoWavHeader, readWavInfo, WavFormatError, type WavPcmInfo } from './wav'

type Progress = (value: ProgressMessage['progress']) => void
export type WhisperDependencies = { runTool?: typeof runExecutableCapture; temporaryRoot?: string; threads?: number }
type InspectTask = Extract<MediaTask, { operation: 'inspectWhisper' }>
type TranscribeTask = Extract<MediaTask, { operation: 'whisperTranscribe' }>
type SpeechChunksTask = Extract<MediaTask, { operation: 'speechChunks' }>

// whisper.cpp logs backend initialization and prints recognized text on stdout; bound what one run may retain.
const MAX_WHISPER_OUTPUT_BYTES = 16 * 1024 * 1024
const COPY_BYTES = 256 * 1024

export function whisperThreadCount(parallelism = availableParallelism()): number {
  return Math.max(1, Math.min(8, parallelism - 2))
}

/**
 * Fixed argument array. Model, audio and output paths are absolute, so none can be parsed as a flag.
 *
 * `-mc 0` disables whisper.cpp's default of carrying the previous 30-second window's decoded text
 * forward as context for the next window. Observed on real English-code-switched Malayalam speech
 * (a single ~70s chunk, so entirely internal to one whisper-cli run): with context carried, one
 * window drifting into a wrong script or a repeated phrase dragged every later window down the same
 * path, producing the pathological repeated-text loops docs/TRANSCRIPTION.md's "Why silence gating
 * uses separate chunk files" section describes, and, separately, whole-transcript wrong-script
 * output. `-mc 0` stops that drift from compounding across windows inside one chunk.
 */
export function whisperArguments(options: { modelPath: string; audioPath: string; language: string; useGpu: boolean; threads: number; outputBase?: string }): string[] {
  return [
    '-m', options.modelPath, '-f', options.audioPath, '-l', options.language, '-t', String(options.threads),
    '-pp', '-sns', '-mc', '0',
    ...(options.outputBase ? ['-oj', '-of', options.outputBase] : []),
    ...(options.useGpu ? [] : ['-ng']),
  ]
}

function whisperFailure(error: unknown, activity: string): never {
  if (error instanceof MediaWorkerError && error.detail.code === 'TOOL_FAILED') {
    const diagnostic = error.detail.diagnostic ?? ''
    const message = /failed to initialize whisper context|failed to load model/i.test(diagnostic)
      ? 'whisper.cpp could not load the selected model. Recheck or download it again in Models.'
      : /failed to read audio/i.test(diagnostic) ? 'whisper.cpp could not read the extracted audio.'
        : /unknown language/i.test(diagnostic) ? 'whisper.cpp does not recognize the selected language.'
          : `whisper.cpp failed while ${activity}.`
    throw failure('TOOL_FAILED', message, { exitCode: error.detail.exitCode, signal: error.detail.signal, diagnostic })
  }
  if (error instanceof MediaWorkerError && error.detail.code === 'SPAWN_FAILED') {
    throw failure('SPAWN_FAILED', 'Could not start the configured whisper-cli executable; check CAPTION_STUDIO_WHISPER_CLI_PATH.', { diagnostic: error.detail.diagnostic })
  }
  throw error
}

/**
 * Real capability detection: `--version`, then the actual model loaded with GPU allowed and with `-ng`, on a
 * generated one-second silent WAV. Only whisper.cpp's backend-initialization lines are read; recognized text
 * from the generated silence is ignored and never kept.
 */
export async function inspectWhisper(whisperPath: string, task: InspectTask, signal: AbortSignal, progress: Progress,
  dependencies: WhisperDependencies = {}): Promise<Extract<MediaResult, { operation: 'inspectWhisper' }>> {
  const runTool = dependencies.runTool ?? runExecutableCapture
  progress({ kind: 'indeterminate', phase: 'inspecting-whisper' })
  let versionOutput: ExecutableOutput
  try { versionOutput = await runTool(whisperPath, ['--version'], signal, 65536) }
  catch (error) { whisperFailure(error, 'reporting its version') }
  const version = parseWhisperVersion(`${versionOutput.stdout}\n${versionOutput.stderr}`)
  if (!version) throw failure('TOOL_FAILED', 'The configured executable did not report a whisper.cpp version; configure whisper-cli built from whisper.cpp 1.9.4.')
  const directory = await mkdtemp(path.join(dependencies.temporaryRoot ?? tmpdir(), 'caption-studio-whisper-inspect-'))
  try {
    const probePath = path.join(directory, 'generated-silence.wav')
    await writeFile(probePath, Buffer.concat([pcm16MonoWavHeader(WHISPER_SAMPLE_RATE, WHISPER_SAMPLE_RATE), Buffer.alloc(WHISPER_SAMPLE_RATE * 2)]), { flag: 'wx', mode: 0o600 })
    const threads = dependencies.threads ?? whisperThreadCount()
    const probe = async (useGpu: boolean): Promise<ExecutableOutput> => {
      try { return await runTool(whisperPath, whisperArguments({ modelPath: task.modelPath, audioPath: probePath, language: 'en', useGpu, threads }), signal, MAX_WHISPER_OUTPUT_BYTES) }
      catch (error) { whisperFailure(error, 'loading the model') }
    }
    const gpu = await probe(true)
    const gpuReport = parseWhisperBackend(gpu.stderr)
    if (gpuReport.kind === 'unreported') {
      throw failure('TOOL_FAILED', 'whisper.cpp did not report which compute backend it initialized; this whisper-cli build is not supported.', { diagnostic: gpu.stderr.slice(-8192) })
    }
    const cpu = await probe(false)
    if (parseWhisperBackend(cpu.stderr).kind !== 'cpu') {
      throw failure('TOOL_FAILED', 'whisper.cpp did not confirm CPU execution with the GPU disabled.', { diagnostic: cpu.stderr.slice(-8192) })
    }
    const systemInfo = /^system_info: (.+)$/m.exec(gpu.stderr)?.[1]?.trim().slice(0, 2048) || null
    return { operation: 'inspectWhisper', version, gpuBackend: gpuReport.kind === 'gpu' ? gpuReport.name : null, cpuFallbackVerified: true, systemInfo }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

/** Exported so `silence.ts` streams the same mono 16-bit PCM through `LongSilenceDetector` without duplicating this read loop. */
export async function forEachSampleBlock(handle: FileHandle, info: WavPcmInfo, signal: AbortSignal, visit: (samples: Int16Array) => void) {
  const buffer = Buffer.alloc(COPY_BYTES)
  let position = info.dataOffset
  const end = info.dataOffset + info.dataBytes
  while (position < end) {
    if (signal.aborted) throw failure('CANCELLED', 'Operation cancelled')
    const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, end - position), position)
    if (bytesRead === 0 || bytesRead % 2 !== 0) throw failure('TOOL_FAILED', 'Transcription audio changed or was truncated while it was read')
    const samples = new Int16Array(bytesRead / 2)
    for (let index = 0; index < samples.length; index += 1) samples[index] = buffer.readInt16LE(index * 2)
    visit(samples)
    position += bytesRead
  }
}

async function writeAll(handle: FileHandle, bytes: Buffer, position: number) {
  let written = 0
  while (written < bytes.length) {
    const { bytesWritten } = await handle.write(bytes, written, bytes.length - written, position + written)
    if (!bytesWritten) throw failure('INTERNAL_ERROR', 'Disk write made no progress')
    written += bytesWritten
  }
}

/** Copies exactly the chunk's samples into a new job-owned WAV, so whisper.cpp never sees audio outside it. */
async function writeChunk(source: FileHandle, info: WavPcmInfo, chunk: SampleSpan, outputPath: string, signal: AbortSignal) {
  const output = await open(outputPath, 'wx', 0o600)
  try {
    const header = pcm16MonoWavHeader(chunk.endSample - chunk.startSample, info.sampleRate)
    await writeAll(output, header, 0)
    const buffer = Buffer.alloc(COPY_BYTES)
    let sourcePosition = info.dataOffset + chunk.startSample * 2
    const sourceEnd = info.dataOffset + chunk.endSample * 2
    let outputPosition = header.length
    while (sourcePosition < sourceEnd) {
      if (signal.aborted) throw failure('CANCELLED', 'Operation cancelled')
      const { bytesRead } = await source.read(buffer, 0, Math.min(buffer.length, sourceEnd - sourcePosition), sourcePosition)
      if (bytesRead === 0) throw failure('TOOL_FAILED', 'Transcription audio was truncated while a speech chunk was written')
      await writeAll(output, buffer.subarray(0, bytesRead), outputPosition)
      sourcePosition += bytesRead
      outputPosition += bytesRead
    }
  } finally {
    await output.close()
  }
}

/**
 * Detects long silences in the extracted audio, writes each padded speech region to its own WAV and runs
 * whisper-cli on each one. Real whisper.cpp 1.9.4 was observed inventing text for a silent span and reading
 * past `-ot/-d` windows, so silence is never sent and chunks are separate files. Segments are returned in
 * microseconds relative to the extracted audio (chunk start + whisper offset). Progress is measured over
 * detected speech audio from whisper.cpp's own `-pp` percentages.
 */
export async function transcribeWithWhisper(whisperPath: string, task: TranscribeTask, signal: AbortSignal, progress: Progress,
  dependencies: WhisperDependencies = {}): Promise<Extract<MediaResult, { operation: 'whisperTranscribe' }>> {
  const runTool = dependencies.runTool ?? runExecutableCapture
  let info: WavPcmInfo
  try { info = await readWavInfo(task.audioPath) }
  catch (error) { throw failure('TOOL_FAILED', error instanceof WavFormatError ? `Transcription audio is not usable: ${error.message}` : 'Transcription audio could not be read') }
  if (info.sampleRate !== WHISPER_SAMPLE_RATE || info.channels !== 1) throw failure('INVALID_MESSAGE', 'whisper.cpp transcription requires 16 kHz mono 16-bit PCM audio')
  const sampleRate = info.sampleRate
  progress({ kind: 'indeterminate', phase: 'detecting-speech' })
  const source = await open(task.audioPath, 'r')
  let directory: string | undefined
  try {
    const detector = new LongSilenceDetector({ sampleRate })
    await forEachSampleBlock(source, info, signal, (samples) => detector.push(samples))
    const { totalSamples, silences } = detector.finish()
    // FFmpeg keeps a final sample that starts inside the requested range but can end up to one sample past it
    // (observed: 20 µs). Bounding every time by the audio window keeps captions inside the source media.
    const toUs = (span: SampleSpan) => ({
      startUs: Math.min(samplesToUs(span.startSample, sampleRate), task.durationUs),
      endUs: Math.min(samplesToUs(span.endSample, sampleRate), task.durationUs),
    })
    const chunks = planSpeechChunks(totalSamples, silences, { sampleRate }).filter((span) => { const range = toUs(span); return range.endUs > range.startUs })
    const chunkRanges = chunks.map(toUs)
    const totalSpeechUs = chunkRanges.reduce((sum, range) => sum + range.endUs - range.startUs, 0)
    const threads = dependencies.threads ?? whisperThreadCount()

    // With auto-detection the longest chunk is recognized first; its detected language is then fixed for the rest.
    const order = chunks.map((_chunk, index) => index)
    if (task.language === 'auto' && chunks.length > 1) {
      const length = (index: number) => chunks[index].endSample - chunks[index].startSample
      const longest = order.reduce((best, index) => (length(index) > length(best) ? index : best), 0)
      order.splice(order.indexOf(longest), 1)
      order.unshift(longest)
    }

    let language: string | null = task.language === 'auto' ? null : task.language
    const backends = new Set<string>()
    const recognized: ChunkSegment[][] = chunks.map(() => [])
    const dropped = { empty: 0, outsideChunk: 0, zeroDuration: 0 }
    let completedUs = 0
    let reportedUs = -1
    const report = (value: number) => {
      const bounded = Math.min(value, totalSpeechUs)
      if (totalSpeechUs <= 0 || bounded <= reportedUs) return
      reportedUs = bounded
      progress({ kind: 'measured', phase: 'recognizing', completed: bounded, total: totalSpeechUs, unit: 'sourceUs' })
    }
    if (chunks.length > 0) {
      directory = await mkdtemp(path.join(dependencies.temporaryRoot ?? tmpdir(), 'caption-studio-whisper-'))
      report(0)
    }

    for (const index of order) {
      if (signal.aborted) throw failure('CANCELLED', 'Operation cancelled')
      const range = chunkRanges[index]
      const chunkUs = range.endUs - range.startUs
      const chunkPath = path.join(directory!, `chunk-${index}.wav`)
      const outputBase = path.join(directory!, `chunk-${index}`)
      await writeChunk(source, info, chunks[index], chunkPath, signal)
      const lines = createLineReader((line) => {
        const percent = parseWhisperProgressLine(line)
        if (percent !== null) report(completedUs + Math.floor(chunkUs * percent / 100))
      })
      const decoder = new StringDecoder('utf8')
      let output: ExecutableOutput
      try {
        output = await runTool(whisperPath, whisperArguments({ modelPath: task.modelPath, audioPath: chunkPath, language: language ?? 'auto', useGpu: task.useGpu, threads, outputBase }),
          signal, MAX_WHISPER_OUTPUT_BYTES, { onStderr: (chunk) => lines.push(decoder.write(chunk)) })
      } catch (error) { whisperFailure(error, 'recognizing speech') }
      lines.push(decoder.end())
      lines.finish()
      if (signal.aborted) throw failure('CANCELLED', 'Operation cancelled')

      const backend = parseWhisperBackend(output.stderr)
      if (backend.kind === 'unreported') {
        throw failure('TOOL_FAILED', 'whisper.cpp did not report which compute backend it used; this whisper-cli build is not supported.', { diagnostic: output.stderr.slice(-8192) })
      }
      backends.add(backend.kind === 'gpu' ? backend.name : 'CPU')

      let parsed: ReturnType<typeof parseWhisperJson>
      try { parsed = parseWhisperJson(await readFile(`${outputBase}.json`)) }
      catch (error) { throw failure('TOOL_FAILED', error instanceof WhisperOutputError ? error.message : 'whisper.cpp did not write its JSON transcript', { diagnostic: output.stderr.slice(-8192) }) }
      if (!languageCodeSchema.safeParse(parsed.language).success) throw failure('TOOL_FAILED', `whisper.cpp reported an unrecognized language code "${parsed.language.slice(0, 16)}"`)
      if (language === null) language = parsed.language
      else if (parsed.language !== language) throw failure('TOOL_FAILED', `whisper.cpp reported language "${parsed.language}" instead of the requested "${language}"`)

      const normalized = normalizeChunkSegments(range, parsed.segments)
      recognized[index] = normalized.segments
      dropped.empty += normalized.dropped.empty
      dropped.outsideChunk += normalized.dropped.outsideChunk
      dropped.zeroDuration += normalized.dropped.zeroDuration
      completedUs += chunkUs
      report(completedUs)
      await rm(chunkPath, { force: true })
      await rm(`${outputBase}.json`, { force: true })
    }

    return {
      operation: 'whisperTranscribe', language, languageSource: task.language !== 'auto' ? 'requested' : language ? 'detected' : 'none',
      backends: [...backends], threads, speechGating: SPEECH_GATING_VERSION, silences: silences.map(toUs).filter((range) => range.endUs > range.startUs), chunks: chunkRanges,
      segments: recognized.flat(), dropped,
    }
  } finally {
    await source.close()
    if (directory) await rm(directory, { recursive: true, force: true })
  }
}

/** Shorter pauses than the 2 s gating silence, used only as preferred split points inside over-long speech. */
const SPLIT_PAUSE_MS = 250

/**
 * Splits a speech span into parts of at most `maxSamples`. Each cut goes to the middle of the pause nearest the limit
 * within the last half of the part, so it lands between words; with no such pause it falls back to a fixed cut.
 */
export function splitAtPauses(span: SampleSpan, maxSamples: number, pauses: readonly SampleSpan[]): SampleSpan[] {
  const parts: SampleSpan[] = []
  let start = span.startSample
  while (span.endSample - start > maxSamples) {
    const limit = start + maxSamples
    const floor = start + Math.floor(maxSamples / 2)
    let cut = limit
    for (const pause of pauses) {
      const middle = Math.floor((pause.startSample + pause.endSample) / 2)
      if (middle > floor && middle <= limit && (cut === limit || middle > cut)) cut = middle
    }
    parts.push({ startSample: start, endSample: cut })
    start = cut
  }
  parts.push({ startSample: start, endSample: span.endSample })
  return parts
}

/**
 * The same long-silence gating whisper.cpp uses, for engines that take whole files (cloud transcription): each padded
 * speech region, further split at `maxChunkUs`, is written to its own WAV in `outputDirectory`. Splits prefer a short
 * pause near the limit and only fall inside a word for speech with no such pause. Times are relative to the
 * extracted audio and bounded by its window.
 */
export async function writeSpeechChunks(task: SpeechChunksTask, signal: AbortSignal, progress: Progress): Promise<Extract<MediaResult, { operation: 'speechChunks' }>> {
  let info: WavPcmInfo
  try { info = await readWavInfo(task.audioPath) }
  catch (error) { throw failure('TOOL_FAILED', error instanceof WavFormatError ? `Transcription audio is not usable: ${error.message}` : 'Transcription audio could not be read') }
  if (info.channels !== 1) throw failure('INVALID_MESSAGE', 'Speech chunking requires mono 16-bit PCM audio')
  const { sampleRate } = info
  progress({ kind: 'indeterminate', phase: 'detecting-speech' })
  const source = await open(task.audioPath, 'r')
  try {
    const detector = new LongSilenceDetector({ sampleRate })
    const pauseDetector = new LongSilenceDetector({ sampleRate, minSilenceMs: SPLIT_PAUSE_MS })
    await forEachSampleBlock(source, info, signal, (samples) => { detector.push(samples); pauseDetector.push(samples) })
    const { totalSamples, silences } = detector.finish()
    const pauses = pauseDetector.finish().silences
    const toUs = (span: SampleSpan) => ({
      startUs: Math.min(samplesToUs(span.startSample, sampleRate), task.durationUs),
      endUs: Math.min(samplesToUs(span.endSample, sampleRate), task.durationUs),
    })
    const maxSamples = Math.max(1, Math.floor(task.maxChunkUs * sampleRate / 1_000_000))
    const spans = planSpeechChunks(totalSamples, silences, { sampleRate }).flatMap((span) => splitAtPauses(span, maxSamples, pauses))
      .filter((span) => { const range = toUs(span); return range.endUs > range.startUs })
    const chunks = []
    for (const [index, span] of spans.entries()) {
      const chunkPath = path.join(task.outputDirectory, `speech-${String(index).padStart(5, '0')}.wav`)
      await writeChunk(source, info, span, chunkPath, signal)
      chunks.push({ path: chunkPath, ...toUs(span) })
    }
    return { operation: 'speechChunks', speechGating: SPEECH_GATING_VERSION, silences: silences.map(toUs).filter((range) => range.endUs > range.startUs), chunks }
  } finally {
    await source.close()
  }
}
