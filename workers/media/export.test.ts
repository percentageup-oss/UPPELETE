import { readFileSync } from 'node:fs'
import { PassThrough } from 'node:stream'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { failure, type Toolchain } from './protocol'
import { FrameReader, PngReader } from './exportProcesses'
import { selectFrameTransport } from './exportTransport'
import { exportHostCount, exportSupport, mostInformativeFailure, resetExportSupportCacheForTests, renderVideo, type ExportDependencies } from './export'
import { DEFAULT_CAPTION_STYLE } from '../../src/captions/style'
import { exportManifestV3Schema, frameSourceUs, type ExportManifest } from '../../src/export/plan'
import { encodeCubeData, parseCube } from '../../src/color/cube'
import { defaultShape } from '../../src/core/shapeCommands'

const PINNED_VERSION = 'ffmpeg version 9.0.1\nconfiguration: --disable-gpl --disable-version3 --disable-nonfree --disable-autodetect --disable-network --enable-zlib --enable-videotoolbox\n'
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

function pngFrame(marker: number): Buffer {
  return Buffer.concat([SIGNATURE, Buffer.from([marker & 0xff])])
}
function framed(png: Buffer): Buffer {
  const header = Buffer.alloc(4)
  header.writeUInt32BE(png.length)
  return Buffer.concat([header, png])
}

/** A process double: a real Duplex pair so `writeBounded`/`PngReader`/`.on('data')` all behave like
 * the genuine child-process streams they replace, with `closed` settled the same way `ownedProcess`
 * settles it — resolved once its stdin finishes normally, rejected on external abort or an injected
 * failure — so the loop's cancellation/failure propagation is exercised for real, not asserted by hand. */
function fakeProcess(signal: AbortSignal) {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  let settled = false
  let resolveClosed!: () => void, rejectClosed!: (error: unknown) => void
  const closed = new Promise<void>((resolve, reject) => { resolveClosed = resolve; rejectClosed = reject })
  closed.catch(() => {})
  const stop = vi.fn(() => {
    if (settled) return
    settled = true
    stdout.end()
    if (!stdin.destroyed) stdin.destroy()
    rejectClosed(failure('CANCELLED', 'Export cancelled'))
  })
  signal.addEventListener('abort', stop, { once: true })
  stdin.on('finish', () => {
    if (settled) return
    settled = true
    signal.removeEventListener('abort', stop)
    resolveClosed()
  })
  return {
    child: { stdin, stdout } as unknown as { stdin: NodeJS.WritableStream; stdout: NodeJS.ReadableStream },
    closed, stop,
    fail(error: unknown) { if (settled) return; settled = true; stdout.end(); rejectClosed(error) },
  }
}

function fakeHost(signal: AbortSignal, respond: (request: any) => Buffer | null) {
  const process = fakeProcess(signal)
  let requestCount = 0
  let buffered = ''
  ;(process.child.stdin as PassThrough).on('data', (chunk: Buffer) => {
    buffered += chunk.toString('utf8')
    let newline
    while ((newline = buffered.indexOf('\n')) >= 0) {
      const line = buffered.slice(0, newline); buffered = buffered.slice(newline + 1)
      requestCount++
      const png = respond(JSON.parse(line))
      if (png) (process.child.stdout as PassThrough).write(framed(png))
    }
  })
  return { ...process, requestCount: () => requestCount }
}

function fakeEncoder(signal: AbortSignal) {
  const process = fakeProcess(signal)
  const received: Buffer[] = []
  ;(process.child.stdin as PassThrough).on('data', (chunk: Buffer) => received.push(chunk))
  return { ...process, received }
}

const tools: Toolchain = { ffmpegPath: '/tools/ffmpeg', ffprobePath: '/tools/ffprobe',
  exportHost: { executable: process.execPath, scriptPath: __filename } }

function outputProbe(width: number, height: number, durationUs: number, hasAudio: boolean) {
  return {
    operation: 'probe' as const,
    metadata: {
      durationUs, width, height, rotationDegrees: 0,
      frameRate: { numerator: 30, denominator: 1 }, nominalFrameRate: { numerator: 30, denominator: 1 },
      streams: [
        { index: 0, kind: 'video' as const, codec: { name: 'h264', longName: null, profile: null, level: null, tag: null },
          timeBase: null, startUs: 0, durationUs, width, height, averageFrameRate: null, nominalFrameRate: null, rotationDegrees: 0, sampleRate: null, channels: null },
        ...(hasAudio ? [{ index: 1, kind: 'audio' as const, codec: { name: 'aac', longName: null, profile: null, level: null, tag: null },
          timeBase: null, startUs: 0, durationUs, width: null, height: null, averageFrameRate: null, nominalFrameRate: null, rotationDegrees: null, sampleRate: 48000, channels: 2 }] : []),
      ],
    },
    fingerprint: { algorithm: 'sha256-sampled-v1' as const, value: 'a'.repeat(64), sizeBytes: 1, sampledBytes: 1 },
  }
}
function inputProbe(durationUs: number, hasAudio: boolean) { return outputProbe(1080, 1920, durationUs, hasAudio) }

const directories: string[] = []
// The fake hosts below emit PNGs; the worker's default transport is raw.
beforeEach(() => { vi.stubEnv('CAPTION_STUDIO_EXPORT_TRANSPORT', 'png'); vi.stubEnv('CAPTION_STUDIO_EXPORT_HOSTS', '1') })
afterEach(async () => { vi.unstubAllEnvs(); resetExportSupportCacheForTests(); await Promise.all(directories.splice(0).map((d) => rm(d, { recursive: true, force: true }))) })

/**
 * One distinct cue per output frame, so every frame has its own layer signature and therefore its
 * own host round trip. Tests that count host requests or need to act on a specific frame use this;
 * a single long static cue now legitimately renders once and repeats (see the reuse tests).
 */
function perFrameCues(count: number, rate: { numerator: number; denominator: number }): ExportManifest['cues'] {
  return Array.from({ length: count }, (_, index) => ({
    id: `f${index}`, startUs: frameSourceUs(index, 0, rate), endUs: frameSourceUs(index + 1, 0, rate),
    text: `frame ${index}`, timingSource: 'manual' as const, needsReview: false, textSource: 'user' as const, words: [],
  }))
}

async function jobFixture(overrides: { cues?: ExportManifest['cues']; segments?: { startUs: number; endUs: number }[] } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'export-test-'))
  directories.push(root)
  const cues = overrides.cues ?? [
    { id: 'c1', startUs: 0, endUs: 1_000_000, text: 'hi', timingSource: 'manual' as const, needsReview: false, textSource: 'user' as const, words: [] },
  ]
  const manifest: ExportManifest = overrides.segments
    ? { version: 2, style: DEFAULT_CAPTION_STYLE, cues, overlays: [], blurRegions: [], audioClips: [], segments: overrides.segments }
    : { version: 1, style: DEFAULT_CAPTION_STYLE, cues }
  const renderManifestPath = path.join(root, 'frames.json')
  await writeFile(renderManifestPath, JSON.stringify(manifest))
  return { root, renderManifestPath }
}

describe('PngReader', () => {
  it('reassembles one framed PNG delivered across several small chunks', async () => {
    const png = pngFrame(7)
    const bytes = framed(png)
    async function* chunks() { for (let i = 0; i < bytes.length; i += 3) yield bytes.subarray(i, i + 3) }
    const reader = new PngReader(chunks())
    expect(await reader.frame()).toEqual(png)
  })
  it('reads a sequence of independent frames from one stream in order', async () => {
    const a = pngFrame(1), b = pngFrame(2)
    async function* chunks() { yield framed(a); yield framed(b) }
    const reader = new PngReader(chunks())
    expect(await reader.frame()).toEqual(a)
    expect(await reader.frame()).toEqual(b)
  })
  it('drops the stray CRLF Electron.exe prints on Windows before the first frame, even split across chunks', async () => {
    const a = pngFrame(1), b = pngFrame(2)
    async function* chunks() { yield Buffer.from('\r'); yield Buffer.concat([Buffer.from('\n'), framed(a)]); yield framed(b) }
    const reader = new PngReader(chunks())
    expect(await reader.frame()).toEqual(a)
    expect(await reader.frame()).toEqual(b)
  })
  it('rejects a length header over the size limit', async () => {
    async function* chunks() { const header = Buffer.alloc(4); header.writeUInt32BE(65 * 1024 * 1024); yield header }
    await expect(new PngReader(chunks()).frame()).rejects.toMatchObject({ detail: { code: 'OUTPUT_LIMIT' } })
  })
  it('rejects bytes that are not a valid PNG signature', async () => {
    async function* chunks() { yield framed(Buffer.from('not a png at all')) }
    await expect(new PngReader(chunks()).frame()).rejects.toMatchObject({ detail: { code: 'TOOL_FAILED' } })
  })
  it('fails closed instead of hanging when the stream ends mid-frame', async () => {
    async function* chunks() { yield Buffer.from([0, 0, 0, 20]); yield Buffer.from([1, 2, 3]) }
    await expect(new PngReader(chunks()).frame()).rejects.toMatchObject({ detail: { code: 'TOOL_FAILED' } })
  })
})

describe('FrameReader raw frames', () => {
  const bitmap = (bytes: number) => Buffer.alloc(bytes, 7)
  it('round-trips a frame of exactly the expected size, across small chunks', async () => {
    const frame = bitmap(4 * 3 * 4), bytes = framed(frame)
    async function* chunks() { for (let i = 0; i < bytes.length; i += 5) yield bytes.subarray(i, i + 5) }
    expect(await new FrameReader(chunks()).frame({ rawBytes: frame.length })).toEqual(frame)
  })
  it('rejects a frame of any other size', async () => {
    async function* chunks() { yield framed(bitmap(47)) }
    await expect(new FrameReader(chunks()).frame({ rawBytes: 48 })).rejects.toMatchObject({ detail: { code: 'TOOL_FAILED' } })
  })
  it('rejects a corrupt header before allocating for it', async () => {
    async function* chunks() { const header = Buffer.alloc(4); header.writeUInt32BE(0xffffff00); yield header }
    await expect(new FrameReader(chunks()).frame({ rawBytes: 48 })).rejects.toMatchObject({ detail: { code: 'TOOL_FAILED' } })
  })
  it('refuses an expected size above the frame limit', async () => {
    async function* chunks() { yield Buffer.alloc(4) }
    await expect(new FrameReader(chunks()).frame({ rawBytes: 65 * 1024 * 1024 })).rejects.toMatchObject({ detail: { code: 'OUTPUT_LIMIT' } })
  })
  it('still drops the Windows CRLF before the first raw frame', async () => {
    const frame = bitmap(16)
    async function* chunks() { yield Buffer.from([0x0d, 0x0a]); yield framed(frame) }
    expect(await new FrameReader(chunks()).frame({ rawBytes: 16 })).toEqual(frame)
  })
})

describe('exportSupport', () => {
  it('is unsupported without a configured export host', async () => {
    const { supported, reason } = await exportSupport({ ffmpegPath: '/a', ffprobePath: '/b' }, new AbortController().signal)
    expect(supported).toBe(false)
    expect(reason).toBeTruthy()
  })
  it('is supported for the pinned profile with an existing host script', async () => {
    const runTool = vi.fn().mockResolvedValue(PINNED_VERSION)
    const result = await exportSupport(tools, new AbortController().signal, { runTool })
    expect(result).toEqual({ supported: true, reason: null })
    expect(runTool).toHaveBeenCalledTimes(2)
  })
  it('caches a supported result so a second check does not rerun the -version probes', async () => {
    const runTool = vi.fn().mockResolvedValue(PINNED_VERSION)
    await exportSupport(tools, new AbortController().signal, { runTool })
    const calls = runTool.mock.calls.length
    expect(await exportSupport(tools, new AbortController().signal, { runTool })).toEqual({ supported: true, reason: null })
    expect(runTool).toHaveBeenCalledTimes(calls)
  })
  it('does not cache an unsupported result', async () => {
    const runTool = vi.fn().mockResolvedValue('ffmpeg version 7.0.0\nconfiguration: --enable-gpl\n')
    await exportSupport(tools, new AbortController().signal, { runTool })
    const calls = runTool.mock.calls.length
    await exportSupport(tools, new AbortController().signal, { runTool })
    expect(runTool.mock.calls.length).toBeGreaterThan(calls)
  })
  it('reports the exact reason for an unsupported FFmpeg configuration without touching the filesystem', async () => {
    const runTool = vi.fn().mockResolvedValue('ffmpeg version 7.0.0\nconfiguration: --enable-gpl\n')
    const result = await exportSupport(tools, new AbortController().signal, { runTool })
    expect(result.supported).toBe(false)
    expect(result.reason).toMatch(/pinned FFmpeg/)
  })
})

describe('renderVideo', () => {
  it('renders every requested frame through the host, feeds them to the encoder in order and validates the finished MP4', async () => {
    const { root, renderManifestPath } = await jobFixture()
    const signal = new AbortController().signal
    let hostHandle!: ReturnType<typeof fakeHost>, encoderHandle!: ReturnType<typeof fakeEncoder>
    const spawn: ExportDependencies['spawn'] = ((executable, _args, s) => {
      if (executable === tools.exportHost!.executable) return hostHandle = fakeHost(s, (request) => pngFrame(request.timestampUs % 256)) as any
      return encoderHandle = fakeEncoder(s) as any
    }) as ExportDependencies['spawn']
    const probe = vi.fn(async (_ffprobe: string, inputPath: string) => inputPath.endsWith('out.mp4') ? outputProbe(1080, 1920, 1_000_000, true) : inputProbe(1_000_000, true))
    const runTool = vi.fn().mockResolvedValue(PINNED_VERSION)
    const progress: unknown[] = []
    const result = await renderVideo({
      operation: 'export', inputPaths: ['/media/in.mp4'], outputPath: '/media/out.mp4', renderManifestPath,
      range: { startUs: 0, endUs: 1_000_000 }, frameRate: { numerator: 30, denominator: 1 }, width: 1080, height: 1920, profile: 'mp4-caption-renderer-v1',
    }, tools, signal, (value) => progress.push(value), { spawn, probe, runTool, temporaryRoot: root })
    const { timings, ...rest } = result
    expect(rest).toEqual({ operation: 'export', path: '/media/out.mp4', durationUs: 1_000_000, frameCount: 30, frameRate: { numerator: 30, denominator: 1 } })
    expect(timings).toBeDefined()
    expect(timings!.paintedFrames + timings!.reusedFrames).toBe(result.frameCount)
    expect(timings!.paintedFrames).toBeGreaterThan(0)
    expect(timings!.totalMs).toBeGreaterThanOrEqual(timings!.startupMs)
    expect(encoderHandle.received.length).toBe(30) // one PNG write per frame, in order
    // Both processes are always reaped in `finally`, even on success — killing an already-exited
    // process is a harmless no-op, and this is the same safety net a hung process needs.
    expect(hostHandle.stop).toHaveBeenCalled()
    expect(encoderHandle.stop).toHaveBeenCalled()
    // The job-owned export-host profile directory is removed once the job finishes.
    expect(await readdir(root)).toEqual(['frames.json'])
  })

  it('reuses one rendered gap frame for every timestamp with no active cue instead of asking the host again', async () => {
    // A single 1-frame-long cue at the very start (exactly one 30fps frame interval) leaves
    // every later frame a gap: frame 0 (t=0) is active, frame 1 (t=33,333) is already past the
    // half-open cue end.
    const { root, renderManifestPath } = await jobFixture({ cues: [
      { id: 'c1', startUs: 0, endUs: 33_333, text: 'hi', timingSource: 'manual', needsReview: false, textSource: 'user', words: [] },
    ] })
    const signal = new AbortController().signal
    let hostHandle!: ReturnType<typeof fakeHost>
    const spawn: ExportDependencies['spawn'] = ((executable, _args, s) => {
      if (executable === tools.exportHost!.executable) return hostHandle = fakeHost(s, () => pngFrame(1)) as any
      return fakeEncoder(s) as any
    }) as ExportDependencies['spawn']
    const probe = vi.fn(async (_ffprobe: string, inputPath: string) => inputPath.endsWith('out.mp4') ? outputProbe(1080, 1920, 1_000_000, false) : inputProbe(1_000_000, false))
    await renderVideo({
      operation: 'export', inputPaths: ['/media/in.mp4'], outputPath: '/media/out.mp4', renderManifestPath,
      range: { startUs: 0, endUs: 1_000_000 }, frameRate: { numerator: 30, denominator: 1 }, width: 1080, height: 1920, profile: 'mp4-caption-renderer-v1',
    }, tools, signal, () => {}, { spawn, probe, runTool: vi.fn().mockResolvedValue(PINNED_VERSION), temporaryRoot: root })
    // 30 total frames; only frame 0 is active (real cue), one more real host round trip renders the
    // reused gap frame once, and every remaining gap frame is served from that cached PNG.
    expect(hostHandle.requestCount()).toBe(2)
  })

  it('paints a static caption once and repeats it for every frame it is unchanged on', async () => {
    // The default fixture is one static cue covering the whole export: every frame is visually
    // identical, so the layer plan gives them one signature and the host renders exactly once.
    const { root, renderManifestPath } = await jobFixture()
    let hostHandle!: ReturnType<typeof fakeHost>
    const encoded: Buffer[] = []
    const spawn: ExportDependencies['spawn'] = ((executable, _args, s2) => {
      if (executable === tools.exportHost!.executable) return hostHandle = fakeHost(s2, () => pngFrame(1)) as any
      const encoder = fakeEncoder(s2) as any
      encoder.child.stdin.on('data', (chunk: Buffer) => encoded.push(chunk))
      return encoder
    }) as ExportDependencies['spawn']
    const probe = vi.fn(async (_ffprobe: string, inputPath: string) => inputPath.endsWith('out.mp4') ? outputProbe(1080, 1920, 1_000_000, false) : inputProbe(1_000_000, false))
    const result = await renderVideo({
      operation: 'export', inputPaths: ['/media/in.mp4'], outputPath: '/media/out.mp4', renderManifestPath,
      range: { startUs: 0, endUs: 1_000_000 }, frameRate: { numerator: 30, denominator: 1 }, width: 1080, height: 1920, profile: 'mp4-caption-renderer-v1',
    }, tools, new AbortController().signal, () => {}, { spawn, probe, runTool: vi.fn().mockResolvedValue(PINNED_VERSION), temporaryRoot: root })
    expect(hostHandle.requestCount()).toBe(1)
    // The saving is in painting, never in what reaches the encoder: all 30 frames are still written.
    expect(result.frameCount).toBe(30)
    expect(Buffer.concat(encoded).length).toBe(pngFrame(1).length * 30)
  })

  it('sends frames to the encoder in index order with gap and repeat reuse when the next paint is prefetched', async () => {
    // Frames: 0 cue A, 1-2 gap, 3 cue B, 4-5 gap again. Painted: 0, 1, 3 (the gap cache serves 4-5).
    const { root, renderManifestPath } = await jobFixture({ cues: [
      { id: 'a', startUs: 0, endUs: 33_333, text: 'a', timingSource: 'manual', needsReview: false, textSource: 'user', words: [] },
      { id: 'b', startUs: 100_000, endUs: 133_333, text: 'b', timingSource: 'manual', needsReview: false, textSource: 'user', words: [] },
    ] })
    let painted = 0
    let hostHandle!: ReturnType<typeof fakeHost>, encoderHandle!: ReturnType<typeof fakeEncoder>
    const spawn: ExportDependencies['spawn'] = ((executable, _args, s) => {
      if (executable === tools.exportHost!.executable) return hostHandle = fakeHost(s, () => pngFrame(++painted)) as any
      return encoderHandle = fakeEncoder(s) as any
    }) as ExportDependencies['spawn']
    const probe = vi.fn(async (_ffprobe: string, inputPath: string) => inputPath.endsWith('out.mp4') ? outputProbe(1080, 1920, 200_000, false) : inputProbe(1_000_000, false))
    const result = await renderVideo({
      operation: 'export', inputPaths: ['/media/in.mp4'], outputPath: '/media/out.mp4', renderManifestPath,
      range: { startUs: 0, endUs: 200_000 }, frameRate: { numerator: 30, denominator: 1 }, width: 1080, height: 1920, profile: 'mp4-caption-renderer-v1',
    }, tools, new AbortController().signal, () => {}, { spawn, probe, runTool: vi.fn().mockResolvedValue(PINNED_VERSION), temporaryRoot: root })
    expect(result.frameCount).toBe(6)
    expect(hostHandle.requestCount()).toBe(3)
    expect(encoderHandle.received.map((chunk) => chunk[chunk.length - 1])).toEqual([1, 2, 2, 3, 2, 2])
  })

  it('asks the host for the next frame while the encoder is still ingesting the current one, and cancels cleanly with a prefetch pending', async () => {
    const { root, renderManifestPath } = await jobFixture({ cues: perFrameCues(30, { numerator: 30, denominator: 1 }) })
    const controller = new AbortController()
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => unhandled.push(reason)
    process.on('unhandledRejection', onUnhandled)
    let hostHandle!: ReturnType<typeof fakeHost>, blockedStdin!: { destroy: () => void }
    const spawn: ExportDependencies['spawn'] = ((executable, _args, s) => {
      // Answers only the first request: the second (the prefetch) stays pending on the host.
      if (executable === tools.exportHost!.executable) return hostHandle = fakeHost(s, (request) => request.timestampUs === 0 ? pngFrame(1) : null) as any
      const encoder = fakeEncoder(s) as any
      // An encoder that never accepts the first frame; destroying it fails the write, as a dead pipe would.
      let stuck: ((error?: Error | null) => void) | undefined
      blockedStdin = { destroy: () => stuck?.(new Error('pipe closed')) }
      encoder.child.stdin = { write: (_bytes: Buffer, done: (error?: Error | null) => void) => { stuck = done; return false }, end() {} }
      return encoder
    }) as ExportDependencies['spawn']
    const outcome = renderVideo({
      operation: 'export', inputPaths: ['/media/in.mp4'], outputPath: '/media/out.mp4', renderManifestPath,
      range: { startUs: 0, endUs: 1_000_000 }, frameRate: { numerator: 30, denominator: 1 }, width: 1080, height: 1920, profile: 'mp4-caption-renderer-v1',
    }, tools, controller.signal, () => {}, { spawn, probe: vi.fn(async () => inputProbe(1_000_000, true)), runTool: vi.fn().mockResolvedValue(PINNED_VERSION), temporaryRoot: root })
    outcome.catch(() => {})
    await vi.waitFor(() => expect(hostHandle.requestCount()).toBe(2))
    controller.abort(); blockedStdin.destroy()
    await expect(outcome).rejects.toMatchObject({ detail: { code: 'CANCELLED' } })
    await new Promise((resolve) => setTimeout(resolve, 20))
    process.off('unhandledRejection', onUnhandled)
    expect(unhandled).toEqual([])
  })

  it('cancels mid-export, stops both processes and cleans its job-owned temp directory without touching the encoder output', async () => {
    const { root, renderManifestPath } = await jobFixture({ cues: perFrameCues(30, { numerator: 30, denominator: 1 }) })
    const controller = new AbortController()
    let hostHandle!: ReturnType<typeof fakeHost>, encoderHandle!: ReturnType<typeof fakeEncoder>
    const spawn: ExportDependencies['spawn'] = ((executable, _args, s) => {
      if (executable === tools.exportHost!.executable) {
        return hostHandle = fakeHost(s, (request) => {
          if (request.timestampUs > 0) queueMicrotask(() => controller.abort()) // cancel after the first frame
          return pngFrame(1)
        }) as any
      }
      return encoderHandle = fakeEncoder(s) as any
    }) as ExportDependencies['spawn']
    const probe = vi.fn(async () => inputProbe(1_000_000, true))
    const outcome = renderVideo({
      operation: 'export', inputPaths: ['/media/in.mp4'], outputPath: '/media/out.mp4', renderManifestPath,
      range: { startUs: 0, endUs: 1_000_000 }, frameRate: { numerator: 30, denominator: 1 }, width: 1080, height: 1920, profile: 'mp4-caption-renderer-v1',
    }, tools, controller.signal, () => {}, { spawn, probe, runTool: vi.fn().mockResolvedValue(PINNED_VERSION), temporaryRoot: root })
    await expect(outcome).rejects.toMatchObject({ detail: { code: 'CANCELLED' } })
    expect(hostHandle.stop).toHaveBeenCalled()
    expect(encoderHandle.stop).toHaveBeenCalled()
    expect(probe).toHaveBeenCalledTimes(1) // only the input probe; a cancelled job never validates output
    expect(await readdir(root)).toEqual(['frames.json']) // the export-host profile dir was removed
  })

  it('surfaces the encoder failure with its diagnostic instead of a generic cancellation', async () => {
    const { root, renderManifestPath } = await jobFixture()
    const signal = new AbortController().signal
    let encoderHandle!: ReturnType<typeof fakeEncoder>
    const spawn: ExportDependencies['spawn'] = ((executable, _args, s) => {
      if (executable === tools.exportHost!.executable) return fakeHost(s, (request) => { queueMicrotask(() => encoderHandle.fail(failure('TOOL_FAILED', 'Export process failed', { exitCode: 1, diagnostic: 'videotoolbox session invalidated' }))); return pngFrame(1) }) as any
      return encoderHandle = fakeEncoder(s) as any
    }) as ExportDependencies['spawn']
    const probe = vi.fn(async () => inputProbe(1_000_000, true))
    const outcome = renderVideo({
      operation: 'export', inputPaths: ['/media/in.mp4'], outputPath: '/media/out.mp4', renderManifestPath,
      range: { startUs: 0, endUs: 1_000_000 }, frameRate: { numerator: 30, denominator: 1 }, width: 1080, height: 1920, profile: 'mp4-caption-renderer-v1',
    }, tools, signal, () => {}, { spawn, probe, runTool: vi.fn().mockResolvedValue(PINNED_VERSION), temporaryRoot: root })
    await expect(outcome).rejects.toMatchObject({ detail: { code: 'TOOL_FAILED', diagnostic: 'videotoolbox session invalidated' } })
  })

  it('fails a frame the caption renderer never returns as a named stall instead of hanging', async () => {
    const { root, renderManifestPath } = await jobFixture({ cues: perFrameCues(30, { numerator: 30, denominator: 1 }) })
    let hostHandle!: ReturnType<typeof fakeHost>, encoderHandle!: ReturnType<typeof fakeEncoder>
    const spawn: ExportDependencies['spawn'] = ((executable, _args, s) => {
      // Answers the first 13 frames, then stays alive but silent — a hung renderer.
      if (executable === tools.exportHost!.executable) return hostHandle = fakeHost(s, (request) => request.timestampUs < frameSourceUs(13, 0, { numerator: 30, denominator: 1 }) ? pngFrame(1) : null) as any
      return encoderHandle = fakeEncoder(s) as any
    }) as ExportDependencies['spawn']
    const outcome = renderVideo({
      operation: 'export', inputPaths: ['/media/in.mp4'], outputPath: '/media/out.mp4', renderManifestPath,
      range: { startUs: 0, endUs: 1_000_000 }, frameRate: { numerator: 30, denominator: 1 }, width: 1080, height: 1920, profile: 'mp4-caption-renderer-v1',
    }, tools, new AbortController().signal, () => {}, { spawn, probe: vi.fn(async () => inputProbe(1_000_000, true)), runTool: vi.fn().mockResolvedValue(PINNED_VERSION), temporaryRoot: root, stallMs: 50 })
    await expect(outcome).rejects.toMatchObject({ detail: { code: 'TOOL_FAILED', message: expect.stringMatching(/stalled at frame 14 of 30: the caption renderer/) } })
    expect(hostHandle.stop).toHaveBeenCalled()
    expect(encoderHandle.stop).toHaveBeenCalled()
    expect(await readdir(root)).toEqual(['frames.json'])
  }, 10_000)

  it('fails an encoder that stops accepting frames as a named stall with its stderr', async () => {
    const { root, renderManifestPath } = await jobFixture()
    let encoderHandle!: ReturnType<typeof fakeEncoder>
    const spawn: ExportDependencies['spawn'] = ((executable, _args, s) => {
      if (executable === tools.exportHost!.executable) return fakeHost(s, () => pngFrame(1)) as any
      encoderHandle = fakeEncoder(s)
      // A wedged encoder: alive, but its stdin never completes a write after the fifth frame.
      const stdin = encoderHandle.child.stdin as PassThrough
      const write = stdin.write.bind(stdin)
      let writes = 0
      stdin.write = ((chunk: any, callback?: any) => ++writes > 5 ? true : write(chunk, callback)) as any
      return { ...encoderHandle, diagnostic: () => 'mf: MFT async event wait' } as any
    }) as ExportDependencies['spawn']
    const outcome = renderVideo({
      operation: 'export', inputPaths: ['/media/in.mp4'], outputPath: '/media/out.mp4', renderManifestPath,
      range: { startUs: 0, endUs: 1_000_000 }, frameRate: { numerator: 30, denominator: 1 }, width: 1080, height: 1920, profile: 'mp4-caption-renderer-v1',
    }, tools, new AbortController().signal, () => {}, { spawn, probe: vi.fn(async () => inputProbe(1_000_000, true)), runTool: vi.fn().mockResolvedValue(PINNED_VERSION), temporaryRoot: root, stallMs: 50 })
    await expect(outcome).rejects.toMatchObject({ detail: { code: 'TOOL_FAILED', message: expect.stringMatching(/stalled at frame 6 of 30: the \S+ encoder accepted no frame/), diagnostic: 'mf: MFT async event wait' } })
  }, 10_000)

  it('does not let a host that ignores stdin EOF hold a finished export open', async () => {
    const { root, renderManifestPath } = await jobFixture()
    const spawn: ExportDependencies['spawn'] = ((executable, _args, s) => {
      if (executable === tools.exportHost!.executable) {
        // Stays running after its stdin ends; only being stopped (killed) closes it.
        const host = fakeHost(s, () => pngFrame(1))
        let kill!: () => void
        const closed = new Promise<void>((_resolve, reject) => { kill = () => reject(failure('TOOL_FAILED', 'Export process failed')) })
        closed.catch(() => {})
        return { ...host, closed, stop: vi.fn(() => kill()) } as any
      }
      return fakeEncoder(s) as any
    }) as ExportDependencies['spawn']
    const probe = vi.fn(async (_ffprobe: string, inputPath: string) => inputPath.endsWith('out.mp4') ? outputProbe(1080, 1920, 1_000_000, false) : inputProbe(1_000_000, false))
    const result = await renderVideo({
      operation: 'export', inputPaths: ['/media/in.mp4'], outputPath: '/media/out.mp4', renderManifestPath,
      range: { startUs: 0, endUs: 1_000_000 }, frameRate: { numerator: 30, denominator: 1 }, width: 1080, height: 1920, profile: 'mp4-caption-renderer-v1',
    }, tools, new AbortController().signal, () => {}, { spawn, probe, runTool: vi.fn().mockResolvedValue(PINNED_VERSION), temporaryRoot: root })
    expect(result.frameCount).toBe(30)
  }, 10_000)

  it('surfaces the export host failure with its diagnostic instead of the encoder\'s teardown cancellation', async () => {
    // The mirror of the encoder case above, and the reported bug: the host dies on its own, the
    // encoder is then stopped by the job and rejects `CANCELLED`, and the encoder used to be read first.
    const { root, renderManifestPath } = await jobFixture()
    const signal = new AbortController().signal
    let hostHandle!: ReturnType<typeof fakeHost>
    const spawn: ExportDependencies['spawn'] = ((executable, _args, s) => {
      if (executable === tools.exportHost!.executable) {
        return hostHandle = fakeHost(s, () => { queueMicrotask(() => hostHandle.fail(failure('TOOL_FAILED', 'Export process failed', { exitCode: 1, diagnostic: 'export host: frame 1 failed: Offscreen committed paint timeout' }))); return null }) as any
      }
      return fakeEncoder(s) as any
    }) as ExportDependencies['spawn']
    const outcome = renderVideo({
      operation: 'export', inputPaths: ['/media/in.mp4'], outputPath: '/media/out.mp4', renderManifestPath,
      range: { startUs: 0, endUs: 1_000_000 }, frameRate: { numerator: 30, denominator: 1 }, width: 1080, height: 1920, profile: 'mp4-caption-renderer-v1',
    }, tools, signal, () => {}, { spawn, probe: vi.fn(async () => inputProbe(1_000_000, true)), runTool: vi.fn().mockResolvedValue(PINNED_VERSION), temporaryRoot: root })
    await expect(outcome).rejects.toMatchObject({ detail: { code: 'TOOL_FAILED', exitCode: 1, diagnostic: expect.stringContaining('Offscreen committed paint timeout') } })
  })

  it('still reports the host\'s reason when its stdout closes before its exit status arrives', async () => {
    // A child's stdout ends before its `close` event. The frame loop sees the closed pipe first and
    // starts teardown; the host's own exit status must not be overwritten by that teardown.
    const { root, renderManifestPath } = await jobFixture()
    const signal = new AbortController().signal
    let hostHandle!: ReturnType<typeof fakeHost>
    const spawn: ExportDependencies['spawn'] = ((executable, _args, s) => {
      if (executable === tools.exportHost!.executable) {
        return hostHandle = fakeHost(s, () => {
          queueMicrotask(() => (hostHandle.child.stdout as PassThrough).end())
          setTimeout(() => hostHandle.fail(failure('TOOL_FAILED', 'Export process failed', { exitCode: 1, diagnostic: 'export host: window not created: GPU process crashed' })), 20)
          return null
        }) as any
      }
      return fakeEncoder(s) as any
    }) as ExportDependencies['spawn']
    const outcome = renderVideo({
      operation: 'export', inputPaths: ['/media/in.mp4'], outputPath: '/media/out.mp4', renderManifestPath,
      range: { startUs: 0, endUs: 1_000_000 }, frameRate: { numerator: 30, denominator: 1 }, width: 1080, height: 1920, profile: 'mp4-caption-renderer-v1',
    }, tools, signal, () => {}, { spawn, probe: vi.fn(async () => inputProbe(1_000_000, true)), runTool: vi.fn().mockResolvedValue(PINNED_VERSION), temporaryRoot: root })
    await expect(outcome).rejects.toMatchObject({ detail: { code: 'TOOL_FAILED', diagnostic: expect.stringContaining('GPU process crashed') } })
  })

  it('parses real "frame=" progress lines from the encoder as measured, monotonic frame progress', async () => {
    const { root, renderManifestPath } = await jobFixture({ cues: perFrameCues(30, { numerator: 30, denominator: 1 }) })
    const signal = new AbortController().signal
    let encoderHandle!: ReturnType<typeof fakeEncoder>
    const spawn: ExportDependencies['spawn'] = ((executable, _args, s) => {
      if (executable === tools.exportHost!.executable) {
        return fakeHost(s, (request) => {
          const frame = Math.round(request.timestampUs / 33_367) + 1
          ;(encoderHandle.child.stdout as PassThrough).write(Buffer.from(`frame=${frame}\n`))
          return pngFrame(1)
        }) as any
      }
      return encoderHandle = fakeEncoder(s) as any
    }) as ExportDependencies['spawn']
    const probe = vi.fn(async (_ffprobe: string, inputPath: string) => inputPath.endsWith('out.mp4') ? outputProbe(1080, 1920, 1_000_000, true) : inputProbe(1_000_000, true))
    const progress: { completed: number; total: number }[] = []
    await renderVideo({
      operation: 'export', inputPaths: ['/media/in.mp4'], outputPath: '/media/out.mp4', renderManifestPath,
      range: { startUs: 0, endUs: 1_000_000 }, frameRate: { numerator: 30, denominator: 1 }, width: 1080, height: 1920, profile: 'mp4-caption-renderer-v1',
    }, tools, signal, (value) => { if (value.kind === 'measured') progress.push({ completed: value.completed, total: value.total }) }, { spawn, probe, runTool: vi.fn().mockResolvedValue(PINNED_VERSION), temporaryRoot: root })
    expect(progress.length).toBe(30)
    expect(progress[0]).toEqual({ completed: 1, total: 30 })
    expect(progress.at(-1)).toEqual({ completed: 30, total: 30 })
    for (let i = 1; i < progress.length; i++) expect(progress[i].completed).toBeGreaterThanOrEqual(progress[i - 1].completed)
  })

  it('rejects an output path equal to the input path even when the tools are otherwise supported', async () => {
    const { renderManifestPath } = await jobFixture()
    const outcome = renderVideo({
      operation: 'export', inputPaths: ['/media/same.mp4'], outputPath: '/media/same.mp4', renderManifestPath,
      range: { startUs: 0, endUs: 1_000_000 }, frameRate: { numerator: 30, denominator: 1 }, width: 1080, height: 1920, profile: 'mp4-caption-renderer-v1',
    }, tools, new AbortController().signal, () => {}, { runTool: vi.fn().mockResolvedValue(PINNED_VERSION) })
    await expect(outcome).rejects.toMatchObject({ detail: { code: 'INVALID_MESSAGE' } })
  })

  it('computes the frame count from the kept (sequence) duration when the manifest has cuts, not the full planned range', async () => {
    // Keeps 0-300ms and 700ms-1s of the 1s planned range: 600ms kept, exactly 18 frames at 30fps.
    const { root, renderManifestPath } = await jobFixture({ segments: [{ startUs: 0, endUs: 300_000 }, { startUs: 700_000, endUs: 1_000_000 }] })
    const signal = new AbortController().signal
    let encoderHandle!: ReturnType<typeof fakeEncoder>
    const spawn: ExportDependencies['spawn'] = ((executable, _args, s) => {
      if (executable === tools.exportHost!.executable) return fakeHost(s, () => pngFrame(1)) as any
      return encoderHandle = fakeEncoder(s) as any
    }) as ExportDependencies['spawn']
    const probe = vi.fn(async (_ffprobe: string, inputPath: string) => inputPath.endsWith('out.mp4') ? outputProbe(1080, 1920, 600_000, true) : inputProbe(1_000_000, true))
    const result = await renderVideo({
      operation: 'export', inputPaths: ['/media/in.mp4'], outputPath: '/media/out.mp4', renderManifestPath,
      range: { startUs: 0, endUs: 1_000_000 }, frameRate: { numerator: 30, denominator: 1 }, width: 1080, height: 1920, profile: 'mp4-caption-renderer-v1',
    }, tools, signal, () => {}, { spawn, probe, runTool: vi.fn().mockResolvedValue(PINNED_VERSION), temporaryRoot: root })
    expect(result.frameCount).toBe(18)
    expect(encoderHandle.received.length).toBe(18)
  })

  it('writes an oversized filtergraph to a script file in the job directory and passes -/filter_complex <file>', async () => {
    // 200 kept segments produce a trim/concat graph well past the 8 KiB argv-safe inline limit.
    const segments = Array.from({ length: 200 }, (_, index) => ({ startUs: index * 10_000, endUs: index * 10_000 + 5_000 }))
    const { root, renderManifestPath } = await jobFixture({ segments })
    const signal = new AbortController().signal
    let encoderArgs: string[] = []
    let scriptContentAtSpawnTime = ''
    const spawn: ExportDependencies['spawn'] = ((executable, args, s) => {
      if (executable === tools.exportHost!.executable) return fakeHost(s, () => pngFrame(1)) as any
      encoderArgs = args as string[]
      // The job directory (and this script file) is removed once the job finishes, so it has to be
      // read synchronously here, right after export.ts writes it and before it spawns this process.
      const scriptIndex = encoderArgs.indexOf('-/filter_complex')
      if (scriptIndex >= 0) scriptContentAtSpawnTime = readFileSync(encoderArgs[scriptIndex + 1], 'utf8')
      return fakeEncoder(s) as any
    }) as ExportDependencies['spawn']
    const keptUs = segments.reduce((total, segment) => total + (segment.endUs - segment.startUs), 0)
    const probe = vi.fn(async (_ffprobe: string, inputPath: string) => inputPath.endsWith('out.mp4') ? outputProbe(1080, 1920, keptUs, true) : inputProbe(2_000_000, true))
    await renderVideo({
      operation: 'export', inputPaths: ['/media/in.mp4'], outputPath: '/media/out.mp4', renderManifestPath,
      range: { startUs: 0, endUs: 2_000_000 }, frameRate: { numerator: 30, denominator: 1 }, width: 1080, height: 1920, profile: 'mp4-caption-renderer-v1',
    }, tools, signal, () => {}, { spawn, probe, runTool: vi.fn().mockResolvedValue(PINNED_VERSION), temporaryRoot: root })
    const scriptIndex = encoderArgs.indexOf('-/filter_complex')
    expect(scriptIndex).toBeGreaterThan(-1)
    expect(encoderArgs).not.toContain('-filter_complex')
    expect(encoderArgs[scriptIndex + 1].startsWith(root)).toBe(true)
    expect(scriptContentAtSpawnTime).toContain('concat=n=200:v=1:a=0[vcat]')
  })

  it('writes a manifest v3 baked LUT to its own .cube file before spawning the encoder, and the graph names it', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'export-test-'))
    directories.push(root)
    const identity = new Float32Array(2 ** 3 * 3)
    for (let b = 0; b < 2; b++) for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) {
      const i = ((b * 2 + g) * 2 + r) * 3
      identity[i] = r; identity[i + 1] = g; identity[i + 2] = b
    }
    const manifest = exportManifestV3Schema.parse({
      version: 3, cues: [], style: DEFAULT_CAPTION_STYLE, format: { width: 1080, height: 1920, frameRate: { numerator: 30, denominator: 1 } },
      sequenceDurationUs: 1_000_000, inputs: [{ path: '/media/in.mp4', kind: 'video' }],
      clips: [{ id: 'a', inputIndex: 0, assetId: 'v', kind: 'video', trackIndex: 0, timelineStartUs: 0, sourceStartUs: 0, sourceEndUs: 1_000_000, opacity: 1, fit: 'contain', gain: 1, lutId: 'lut-1' }],
      overlays: [], blurRegions: [], luts: [{ id: 'lut-1', size: 2, data: encodeCubeData(identity) }],
    })
    const renderManifestPath = path.join(root, 'frames.json')
    await writeFile(renderManifestPath, JSON.stringify(manifest))
    const signal = new AbortController().signal
    let cubeFileContentAtSpawnTime = ''
    const spawn: ExportDependencies['spawn'] = ((executable, args, s) => {
      if (executable === tools.exportHost!.executable) return fakeHost(s, () => pngFrame(1)) as any
      const encoderArgs = args as string[]
      const graph = encoderArgs.includes('-/filter_complex') ? readFileSync(encoderArgs[encoderArgs.indexOf('-/filter_complex') + 1], 'utf8') : encoderArgs[encoderArgs.indexOf('-filter_complex') + 1]
      const match = /lut3d=file='([^']+)'/.exec(graph)
      if (!match) console.error('GRAPH:', graph)
      expect(match).not.toBeNull()
      // Read now, synchronously, before the job's `finally` removes its temp directory.
      cubeFileContentAtSpawnTime = readFileSync(match![1], 'utf8')
      return fakeEncoder(s) as any
    }) as ExportDependencies['spawn']
    const probe = vi.fn(async (_ffprobe: string, inputPath: string) => inputPath.endsWith('out.mp4') ? outputProbe(1080, 1920, 1_000_000, false) : inputProbe(1_000_000, false))
    await renderVideo({
      operation: 'export', inputPaths: ['/media/in.mp4'], outputPath: '/media/out.mp4', renderManifestPath,
      range: { startUs: 0, endUs: 1_000_000 }, frameRate: { numerator: 30, denominator: 1 }, width: 1080, height: 1920, profile: 'mp4-caption-renderer-v1',
    }, tools, signal, () => {}, { spawn, probe, runTool: vi.fn().mockResolvedValue(PINNED_VERSION), temporaryRoot: root })
    const parsed = parseCube(cubeFileContentAtSpawnTime)
    expect(parsed.size).toBe(2)
    expect(Array.from(parsed.data)).toEqual(Array.from(identity))
  })
})

describe('renderVideo shape-blend export passes (docs/plans/shape-blend/02-export-passes.md)', () => {
  it('writes K sub-frames per output frame in pass order, reuses an unchanged band, and skips the host for an empty one', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'export-test-'))
    directories.push(root)
    // One blend shape, active only during frame 0 (endUs lands exactly on frame 1's timestamp, so
    // the half-open range excludes it there): K = 3 bands. Band 0 always has a pinned vignette (so
    // it never counts as empty); band 2 (the last band) never gets anything, so it is always empty.
    const manifest = exportManifestV3Schema.parse({
      version: 3, cues: [], style: DEFAULT_CAPTION_STYLE, format: { width: 64, height: 64, frameRate: { numerator: 10, denominator: 1 } },
      sequenceDurationUs: 200_000, inputs: [], overlays: [], blurRegions: [], clips: [],
      effects: [{ id: 'e1', kind: 'vignette', startUs: 0, endUs: 10_000_000, enabled: true, amount: .5, softness: .5 }],
      shapes: [{ ...defaultShape('box', 'blend-1', 0, 100_000), layerOrder: 1, blendMode: 'multiply' }],
    })
    const renderManifestPath = path.join(root, 'frames.json')
    await writeFile(renderManifestPath, JSON.stringify(manifest))
    let hostHandle!: ReturnType<typeof fakeHost>, encoderHandle!: ReturnType<typeof fakeEncoder>
    // PINNED = band 0 (the pinned vignette), BLEND = band 1 (the blend shape, only requested while
    // active), BLANK = the one shared blank request the worker renders once for every empty pass.
    const PINNED = 1, BLEND = 2, BLANK = 3
    const spawn: ExportDependencies['spawn'] = ((executable, _args, s) => {
      if (executable === tools.exportHost!.executable) {
        return hostHandle = fakeHost(s, (request) => pngFrame(request.shapeActors?.length ? BLEND : request.frameEffects?.vignette ? PINNED : BLANK)) as any
      }
      return encoderHandle = fakeEncoder(s) as any
    }) as ExportDependencies['spawn']
    const probe = vi.fn(async (_ffprobe: string, inputPath: string) => inputPath.endsWith('out.mp4') ? outputProbe(64, 64, 200_000, false) : inputProbe(1_000_000, false))
    const result = await renderVideo({
      operation: 'export', inputPaths: [], outputPath: '/media/out.mp4', renderManifestPath,
      range: { startUs: 0, endUs: 200_000 }, frameRate: { numerator: 10, denominator: 1 }, width: 64, height: 64, profile: 'mp4-caption-renderer-v1',
    }, tools, new AbortController().signal, () => {}, { spawn, probe, runTool: vi.fn().mockResolvedValue(PINNED_VERSION), temporaryRoot: root })
    // Frame count stays in output frames (2), never K x 2 — the pass split is invisible here.
    expect(result.frameCount).toBe(2)
    // 2 output frames x 3 passes = 6 writes to the encoder, in pass order each time.
    const markers = encoderHandle.received.map((chunk) => chunk[8])
    expect(markers).toEqual([PINNED, BLEND, BLANK, PINNED, BLANK, BLANK])
    // Band 0 rendered once and was reused for frame 1 (same signature both frames); band 1 rendered
    // once while the shape was active; the shared blank buffer was rendered once for every other slot.
    expect(hostHandle.requestCount()).toBe(3)
  })
})

describe('mostInformativeFailure', () => {
  const cancelled = () => failure('CANCELLED', 'Export cancelled')
  const toolFailed = (diagnostic: string) => failure('TOOL_FAILED', 'Export process failed', { exitCode: 1, diagnostic })

  it('prefers a process\'s own failure over its peer\'s teardown cancellation, whichever order they are listed in', () => {
    const host = toolFailed('host stderr')
    expect(mostInformativeFailure(cancelled(), [cancelled(), host])).toBe(host)
    expect(mostInformativeFailure(cancelled(), [host, cancelled()])).toBe(host)
  })
  it('prefers the frame loop\'s own error over a bare cancellation', () => {
    const loop = failure('TOOL_FAILED', 'Caption renderer closed before completing a frame')
    expect(mostInformativeFailure(loop, [cancelled(), cancelled()])).toBe(loop)
  })
  it('falls back to a cancellation only when nothing more informative exists', () => {
    const first = cancelled()
    expect(mostInformativeFailure(cancelled(), [first])).toBe(first)
    const loop = new Error('unexpected')
    expect(mostInformativeFailure(loop, [])).toBe(loop)
  })
})

describe('renderVideo raw transport', () => {
  const task = (renderManifestPath: string) => ({
    operation: 'export' as const, inputPaths: ['/media/in.mp4'], outputPath: '/media/out.mp4', renderManifestPath,
    range: { startUs: 0, endUs: 1_000_000 }, frameRate: { numerator: 30, denominator: 1 }, width: 1080, height: 1920, profile: 'mp4-caption-renderer-v1' as const,
  })
  const run = async (respond: () => Buffer, env: string | undefined) => {
    vi.stubEnv('CAPTION_STUDIO_EXPORT_TRANSPORT', env ?? '')
    const { root, renderManifestPath } = await jobFixture()
    const argv: Record<string, string[]> = {}
    let encoderHandle!: ReturnType<typeof fakeEncoder>
    const spawn: ExportDependencies['spawn'] = ((executable, args, s) => {
      if (executable === tools.exportHost!.executable) { argv.host = args; return fakeHost(s, respond) as any }
      argv.encoder = args
      return encoderHandle = fakeEncoder(s) as any
    }) as ExportDependencies['spawn']
    const probe = vi.fn(async (_ffprobe: string, inputPath: string) => inputPath.endsWith('out.mp4') ? outputProbe(1080, 1920, 1_000_000, false) : inputProbe(1_000_000, false))
    const outcome = renderVideo(task(renderManifestPath), tools, new AbortController().signal, () => {}, { spawn, probe, runTool: vi.fn().mockResolvedValue(PINNED_VERSION), temporaryRoot: root })
    return { outcome, argv, encoder: () => encoderHandle }
  }
  it('when raw: the host gets --transport raw, FFmpeg reads bgra, and each frame is one full bitmap write', async () => {
    const { outcome, argv, encoder } = await run(() => Buffer.alloc(1080 * 1920 * 4, 3), 'raw')
    expect((await outcome).frameCount).toBe(30)
    expect(argv.host[argv.host.indexOf('--transport') + 1]).toBe('raw')
    expect(argv.encoder.slice(argv.encoder.indexOf('-f'), argv.encoder.indexOf('pipe:0') + 1)).toContain('bgra')
    expect(encoder().received.length).toBe(30)
  })
  it('defaults to PNG', async () => {
    const { outcome, argv } = await run(() => pngFrame(1), undefined)
    await outcome
    expect(argv.host[argv.host.indexOf('--transport') + 1]).toBe('png')
  })
  it('selectFrameTransport: raw only when explicitly requested', () => {
    expect(selectFrameTransport({})).toBe('png')
    expect(selectFrameTransport({ CAPTION_STUDIO_EXPORT_TRANSPORT: 'raw' })).toBe('raw')
    expect(selectFrameTransport({ CAPTION_STUDIO_EXPORT_TRANSPORT: 'bogus' })).toBe('png')
  })
  it('CAPTION_STUDIO_EXPORT_TRANSPORT=png keeps the PNG path', async () => {
    const { outcome, argv } = await run(() => pngFrame(1), 'png')
    await outcome
    expect(argv.host[argv.host.indexOf('--transport') + 1]).toBe('png')
    expect(argv.encoder).toContain('image2pipe')
  })
  it('fails a raw frame of the wrong size instead of feeding FFmpeg a misaligned stream', async () => {
    const { outcome } = await run(() => Buffer.alloc(1080 * 1920 * 4 - 4), 'raw')
    await expect(outcome).rejects.toMatchObject({ detail: { code: 'TOOL_FAILED' } })
  })
})

describe('renderVideo host pool', () => {
  const frameOf = (request: { timestampUs: number }) => Math.round(request.timestampUs * 30 / 1_000_000)
  const task = (renderManifestPath: string, endUs = 1_000_000) => ({
    operation: 'export' as const, inputPaths: ['/media/in.mp4'], outputPath: '/media/out.mp4', renderManifestPath,
    range: { startUs: 0, endUs }, frameRate: { numerator: 30, denominator: 1 }, width: 1080, height: 1920, profile: 'mp4-caption-renderer-v1' as const,
  })
  const probeFor = (outputDurationUs: number) => vi.fn(async (_ffprobe: string, inputPath: string) => inputPath.endsWith('out.mp4') ? outputProbe(1080, 1920, outputDurationUs, false) : inputProbe(1_000_000, false))
  const runTool = () => vi.fn().mockResolvedValue(PINNED_VERSION)
  const lastByte = (chunks: Buffer[]) => chunks.map((chunk) => chunk[chunk.length - 1])

  /** Hosts that answer after a random delay, tracking concurrency per host and across the pool. */
  function delayedHosts(seed = 7) {
    let state = seed
    const random = () => (state = (state * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
    const hosts: ReturnType<typeof fakeHost>[] = []
    const stats = { requested: 0, maxInFlightPerHost: 0, encoderFrames: 0, maxAhead: 0 }
    let encoderHandle!: ReturnType<typeof fakeEncoder>
    const spawn: ExportDependencies['spawn'] = ((executable, _args, s) => {
      if (executable !== tools.exportHost!.executable) {
        encoderHandle = fakeEncoder(s)
        ;(encoderHandle.child.stdin as PassThrough).on('data', () => { stats.encoderFrames++ })
        return encoderHandle as any
      }
      let inFlight = 0
      const host: ReturnType<typeof fakeHost> = fakeHost(s, (request) => {
        stats.requested++; inFlight++
        stats.maxInFlightPerHost = Math.max(stats.maxInFlightPerHost, inFlight)
        stats.maxAhead = Math.max(stats.maxAhead, stats.requested - stats.encoderFrames)
        setTimeout(() => { inFlight--; (host.child.stdout as PassThrough).write(framed(pngFrame(frameOf(request)))) }, random() * 15)
        return null
      })
      hosts.push(host)
      return host as any
    }) as ExportDependencies['spawn']
    return { spawn, hosts, stats, encoder: () => encoderHandle }
  }

  it('sends frames to the encoder in index order when hosts answer out of order, using every host and never running ahead more than 2N', async () => {
    const { root, renderManifestPath } = await jobFixture({ cues: perFrameCues(30, { numerator: 30, denominator: 1 }) })
    const pool = delayedHosts()
    const result = await renderVideo(task(renderManifestPath), tools, new AbortController().signal, () => {}, { spawn: pool.spawn, probe: probeFor(1_000_000), runTool: runTool(), temporaryRoot: root, hosts: 3 })
    expect(result.timings!.hosts).toBe(3)
    expect(pool.hosts).toHaveLength(3)
    expect(lastByte(pool.encoder().received)).toEqual(Array.from({ length: 30 }, (_, index) => index))
    expect(pool.hosts.every((host) => host.requestCount() > 0)).toBe(true)
    expect(pool.stats.maxInFlightPerHost).toBe(1)
    // 2N renders outstanding, plus the frame currently being handed to the encoder.
    expect(pool.stats.maxAhead).toBeLessThanOrEqual(2 * 3 + 1)
    pool.hosts.forEach((host) => expect(host.stop).toHaveBeenCalled())
    expect(await readdir(root)).toEqual(['frames.json'])
  })

  it('keeps the gap and repeat reuse pattern unchanged with several hosts', async () => {
    const { root, renderManifestPath } = await jobFixture({ cues: [
      { id: 'a', startUs: 0, endUs: 33_333, text: 'a', timingSource: 'manual', needsReview: false, textSource: 'user', words: [] },
      { id: 'b', startUs: 100_000, endUs: 133_333, text: 'b', timingSource: 'manual', needsReview: false, textSource: 'user', words: [] },
    ] })
    let painted = 0
    const hosts: ReturnType<typeof fakeHost>[] = []
    let encoder!: ReturnType<typeof fakeEncoder>
    const spawn: ExportDependencies['spawn'] = ((executable, _args, s) => {
      if (executable === tools.exportHost!.executable) { const host = fakeHost(s, () => pngFrame(++painted)); hosts.push(host); return host as any }
      return encoder = fakeEncoder(s) as any
    }) as ExportDependencies['spawn']
    const result = await renderVideo(task(renderManifestPath, 200_000), tools, new AbortController().signal, () => {}, { spawn, probe: probeFor(200_000), runTool: runTool(), temporaryRoot: root, hosts: 3 })
    expect(result.frameCount).toBe(6)
    expect(hosts.reduce((sum, host) => sum + host.requestCount(), 0)).toBe(3)
    expect(lastByte(encoder.received)).toEqual([1, 2, 2, 3, 2, 2])
  })

  it("fails the export with the dying host's diagnostic and reaps every host and the encoder", async () => {
    const { root, renderManifestPath } = await jobFixture({ cues: perFrameCues(30, { numerator: 30, denominator: 1 }) })
    const pool = delayedHosts()
    const outcome = renderVideo(task(renderManifestPath), tools, new AbortController().signal, () => {}, { spawn: pool.spawn, probe: probeFor(1_000_000), runTool: runTool(), temporaryRoot: root, hosts: 3 })
    outcome.catch(() => {})
    await vi.waitFor(() => expect(pool.stats.requested).toBeGreaterThan(4))
    pool.hosts[1].fail(failure('TOOL_FAILED', 'Export process failed', { exitCode: 1, diagnostic: 'gpu process crashed' }))
    await expect(outcome).rejects.toMatchObject({ detail: { code: 'TOOL_FAILED', diagnostic: 'gpu process crashed' } })
    pool.hosts.forEach((host) => expect(host.stop).toHaveBeenCalled())
    expect(pool.encoder().stop).toHaveBeenCalled()
    expect(await readdir(root)).toEqual(['frames.json'])
  })

  it('reaps every host on cancellation', async () => {
    const { root, renderManifestPath } = await jobFixture({ cues: perFrameCues(30, { numerator: 30, denominator: 1 }) })
    const pool = delayedHosts()
    const controller = new AbortController()
    const outcome = renderVideo(task(renderManifestPath), tools, controller.signal, () => {}, { spawn: pool.spawn, probe: probeFor(1_000_000), runTool: runTool(), temporaryRoot: root, hosts: 3 })
    outcome.catch(() => {})
    await vi.waitFor(() => expect(pool.stats.requested).toBeGreaterThan(4))
    controller.abort()
    await expect(outcome).rejects.toMatchObject({ detail: { code: 'CANCELLED' } })
    pool.hosts.forEach((host) => expect(host.stop).toHaveBeenCalled())
    expect(await readdir(root)).toEqual(['frames.json'])
  })

  it('never starts more hosts than frames', async () => {
    const { root, renderManifestPath } = await jobFixture()
    const pool = delayedHosts()
    const result = await renderVideo(task(renderManifestPath, 33_333), tools, new AbortController().signal, () => {}, { spawn: pool.spawn, probe: probeFor(33_333), runTool: runTool(), temporaryRoot: root, hosts: 3 })
    expect(result.frameCount).toBe(1)
    expect(pool.hosts).toHaveLength(1)
  })
})

describe('exportHostCount', () => {
  it('is a quarter of the cores, clamped to 1-3', () => {
    expect(exportHostCount({}, 2)).toBe(1)
    expect(exportHostCount({}, 8)).toBe(2)
    expect(exportHostCount({}, 12)).toBe(3)
    expect(exportHostCount({}, 64)).toBe(3)
  })
  it('honours CAPTION_STUDIO_EXPORT_HOSTS within the clamp and ignores junk', () => {
    expect(exportHostCount({ CAPTION_STUDIO_EXPORT_HOSTS: '1' }, 64)).toBe(1)
    expect(exportHostCount({ CAPTION_STUDIO_EXPORT_HOSTS: '2' }, 4)).toBe(2)
    expect(exportHostCount({ CAPTION_STUDIO_EXPORT_HOSTS: '9' }, 4)).toBe(3)
    expect(exportHostCount({ CAPTION_STUDIO_EXPORT_HOSTS: 'many' }, 8)).toBe(2)
    expect(exportHostCount({ CAPTION_STUDIO_EXPORT_HOSTS: '0' }, 8)).toBe(2)
  })
})
