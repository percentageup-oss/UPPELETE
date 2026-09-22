import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { build } from 'esbuild'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { MediaWorkerClient } from './client'
import { runExecutable } from './process'
import { type ProgressMessage, serverMessageSchema } from './protocol'

let directory: string
let workerPath: string
beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'caption-worker മലയാളം & space-'))
  workerPath = path.join(directory, 'server.cjs')
  await build({ entryPoints: ['workers/media/server.ts'], outfile: workerPath, bundle: true, platform: 'node', format: 'cjs' })
})
afterAll(async () => { await rm(directory, { recursive: true, force: true }) })

async function rawWorker(input: string): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [workerPath], { shell: false, stdio: ['pipe', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (chunk) => { output += chunk })
    child.on('error', reject)
    child.on('close', () => {
      try { resolve(output.trim().split('\n').filter(Boolean).map((line) => serverMessageSchema.parse(JSON.parse(line)))) } catch (error) { reject(error) }
    })
    child.stdin.on('error', () => {})
    child.stdin.end(input)
  })
}

describe('real worker process', () => {
  it('reports actual child identity through the bundled server at a Unicode path', async () => {
    const client = new MediaWorkerClient({ workerPath })
    const progress: ProgressMessage[] = []
    try {
      const result = await client.start({ operation: 'runtime' }, { onProgress: (value) => progress.push(value) }).result
      expect(result.pid).not.toBe(process.pid)
      expect(result.platform).toBe(process.platform)
      expect(result.architecture).toBe(process.arch)
      expect(result.nodeVersion).toBe(process.versions.node)
      expect(progress.map((p) => p.progress)).toEqual([{ kind: 'indeterminate', phase: 'running' }])
      // Promise settlement waits for the worker to be reaped.
      expect(() => process.kill(result.pid, 0)).toThrow()
    } finally { await client.close() }
  })
  it('reports missing tool configuration and absent executables, without searching PATH', async () => {
    const client = new MediaWorkerClient({ workerPath })
    const missing = new MediaWorkerClient({ workerPath, tools: { ffmpegPath: path.join(directory, 'absent'), ffprobePath: path.join(directory, 'absent-probe') } })
    const absentWhisper = new MediaWorkerClient({ workerPath, tools: { ffmpegPath: path.join(directory, 'absent'), ffprobePath: path.join(directory, 'absent-probe'), whisperCliPath: path.join(directory, 'absent-whisper-cli') } })
    try {
      await expect(client.start({ operation: 'inspectToolchain' }).result).rejects.toMatchObject({ detail: { code: 'TOOL_NOT_CONFIGURED' } })
      await expect(client.start({ operation: 'probe', inputPath: path.join(directory, 'media.mp4') }).result).rejects.toMatchObject({ detail: { code: 'TOOL_NOT_CONFIGURED' } })
      await expect(client.start({ operation: 'waveform', inputPath: path.join(directory, 'media.mp4'), range: { startUs: 0, endUs: 1_000_000 }, maxPeaks: 10 }).result)
        .rejects.toMatchObject({ detail: { code: 'TOOL_NOT_CONFIGURED' } })
      await expect(client.start({ operation: 'thumbnails', inputPath: path.join(directory, 'media.mp4'), timestampsUs: [0], width: 160, outputDirectory: directory }).result)
        .rejects.toMatchObject({ detail: { code: 'TOOL_NOT_CONFIGURED' } })
      await expect(client.start({ operation: 'proxy', inputPath: path.join(directory, 'media.mp4'), outputPath: path.join(directory, 'proxy.webm'), durationUs: 1_000_000 }).result)
        .rejects.toMatchObject({ detail: { code: 'TOOL_NOT_CONFIGURED' } })
      await expect(client.start({ operation: 'extractAudio', inputPath: path.join(directory, 'media.mp4'), range: { startUs: 0, endUs: 1_000_000 }, outputPath: path.join(directory, 'audio.wav'), sampleRate: 16000, channels: 1 }).result)
        .rejects.toMatchObject({ detail: { code: 'TOOL_NOT_CONFIGURED' } })
      await expect(client.start({ operation: 'export', inputPaths: [path.join(directory, 'input.mp4')], renderManifestPath: path.join(directory, 'frames.json'), outputPath: path.join(directory, 'out.mp4'), range: { startUs: 0, endUs: 1_000_000 }, frameRate: { numerator: 30, denominator: 1 }, width: 1080, height: 1920, profile: 'mp4-caption-renderer-v1' }).result)
        .rejects.toMatchObject({ detail: { code: 'TOOL_NOT_CONFIGURED' } })
      await expect(missing.start({ operation: 'inspectToolchain' }).result).rejects.toMatchObject({ detail: { code: 'SPAWN_FAILED' } })
      // An FFmpeg pair alone never enables transcription; whisper-cli must be configured explicitly.
      await expect(missing.start({ operation: 'inspectWhisper', modelPath: path.join(directory, 'ggml-base.bin') }).result)
        .rejects.toMatchObject({ detail: { code: 'TOOL_NOT_CONFIGURED' } })
      await expect(missing.start({ operation: 'whisperTranscribe', audioPath: path.join(directory, 'audio.wav'), modelPath: path.join(directory, 'ggml-base.bin'), language: 'ml', useGpu: false, durationUs: 1_000_000 }).result)
        .rejects.toMatchObject({ detail: { code: 'TOOL_NOT_CONFIGURED' } })
      await expect(absentWhisper.start({ operation: 'inspectWhisper', modelPath: path.join(directory, 'ggml-base.bin') }).result)
        .rejects.toMatchObject({ detail: { code: 'SPAWN_FAILED', message: expect.stringContaining('CAPTION_STUDIO_WHISPER_CLI_PATH') } })
    } finally { await client.close(); await missing.close(); await absentWhisper.close() }
  })
  it('validates requests in the server, including duplicate requests and incorrect cancellation IDs', async () => {
    const request = { version: 1, type: 'request', id: randomUUID(), task: { operation: 'runtime' } }
    for (const messages of [
      [{ ...request, version: 99 }],
      [{ ...request, task: { operation: 'runtime', hidden: true } }],
      [request, request],
      [request, { version: 1, type: 'cancel', id: randomUUID() }],
    ]) {
      const output = await rawWorker(messages.map((m) => JSON.stringify(m) + '\n').join(''))
      expect(output).toContainEqual(expect.objectContaining({ type: 'fatal', error: expect.objectContaining({ code: 'INVALID_MESSAGE' }) }))
    }
    expect(await rawWorker('oops\n')).toContainEqual(expect.objectContaining({ type: 'fatal' }))
  })
  it('acknowledges cancellation on the wire and pre-cancelled client requests', async () => {
    const id = randomUUID()
    const output = await rawWorker(JSON.stringify({ version: 1, type: 'request', id, task: { operation: 'runtime' } }) + '\n' + JSON.stringify({ version: 1, type: 'cancel', id }) + '\n')
    expect(output).toContainEqual({ version: 1, type: 'cancelled', id, operation: 'runtime' })
    expect(output.filter((m) => (m as {type: string}).type === 'result')).toHaveLength(0)
    const client = new MediaWorkerClient({ workerPath })
    await expect(client.start({ operation: 'runtime' }, { signal: AbortSignal.abort() }).result).rejects.toMatchObject({ detail: { code: 'CANCELLED' } })
    await client.close()
    expect(() => client.start({ operation: 'runtime' })).toThrow('closed')
  })
  it('cancels an in-flight worker and closes owned jobs', async () => {
    const client = new MediaWorkerClient({ workerPath })
    const job = client.start({ operation: 'runtime' })
    const rejection = expect(job.result).rejects.toMatchObject({ detail: { code: 'CANCELLED' } })
    await client.close()
    await rejection
  })
  it('reports abnormal startup and timeout without hanging', async () => {
    const missing = new MediaWorkerClient({ workerPath: path.join(directory, 'no-worker.cjs') })
    const timeout = new MediaWorkerClient({ workerPath, timeoutMs: 1 })
    try {
      await expect(missing.start({ operation: 'runtime' }).result).rejects.toMatchObject({ detail: { code: 'WORKER_EXITED' } })
      await expect(timeout.start({ operation: 'runtime' }).result).rejects.toMatchObject({ detail: { code: 'TIMEOUT' } })
      const perJob = new MediaWorkerClient({ workerPath })
      try {
        await expect(perJob.start({ operation: 'runtime' }, { timeoutMs: 1 }).result).rejects.toMatchObject({ detail: { code: 'TIMEOUT' } })
        expect(() => perJob.start({ operation: 'runtime' }, { timeoutMs: 0 })).toThrow('between 1 ms and 24 hours')
      } finally { await perJob.close() }
    } finally { await missing.close(); await timeout.close() }
  })
  it.each(['wrong-id', 'wrong-operation', 'extra-key', 'duplicate', 'malformed'])('rejects a test-only hostile transport response: %s', async (variant) => {
    // This is a malformed protocol peer, not a media tool or simulated FFmpeg output.
    const peer = path.join(directory, `peer-${variant}.cjs`)
    await writeFile(peer, `process.stdin.once('data', chunk => {
      const request = JSON.parse(chunk.toString().split('\\n')[0]);
      let message = { version: 1, type: 'result', id: request.id, result: { operation: 'runtime', pid: process.pid, platform: process.platform, architecture: process.arch, nodeVersion: process.versions.node } };
      if (${JSON.stringify(variant)} === 'wrong-id') message.id = require('node:crypto').randomUUID();
      if (${JSON.stringify(variant)} === 'wrong-operation') message.result = { operation: 'probe', metadata: { durationUs: null, width: null, height: null, rotationDegrees: null, frameRate: null, nominalFrameRate: null, streams: [] }, fingerprint: { algorithm: 'sha256-sampled-v1', value: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', sizeBytes: 1, sampledBytes: 1 } };
      if (${JSON.stringify(variant)} === 'extra-key') message.result.extra = true;
      const line = ${JSON.stringify(variant)} === 'malformed' ? 'oops\\n' : JSON.stringify(message) + '\\n';
      process.stdout.write(line + (${JSON.stringify(variant)} === 'duplicate' ? line : ''), () => process.exit(0));
    });`)
    const client = new MediaWorkerClient({ workerPath: peer })
    try { await expect(client.start({ operation: 'runtime' }).result).rejects.toMatchObject({ detail: { code: 'INVALID_MESSAGE' } }) }
    finally { await client.close() }
  })
})

describe('direct executable runner (real Node child programs, no FFmpeg mocks)', () => {
  it('passes spaces, Unicode and shell metacharacters literally in argument arrays', async () => {
    const text = 'മലയാളം with spaces & $(echo unsafe); `echo unsafe`'
    const output = await runExecutable(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', text], new AbortController().signal)
    expect(output).toBe(text)
  })
  it('reports exit status and bounds tool output', async () => {
    await expect(runExecutable(process.execPath, ['-e', 'process.stderr.write("diagnostic"); process.exit(7)'], new AbortController().signal))
      .rejects.toMatchObject({ detail: { code: 'TOOL_FAILED', exitCode: 7, diagnostic: 'diagnostic' } })
    await expect(runExecutable(process.execPath, ['-e', 'process.stdout.write("x".repeat(100000))'], new AbortController().signal, 1000))
      .rejects.toMatchObject({ detail: { code: 'OUTPUT_LIMIT' } })
  })
  it('terminates and reaps a real active tool on cancellation', async () => {
    const pidPath = path.join(directory, 'active-child.pid')
    const controller = new AbortController()
    const result = runExecutable(process.execPath, ['-e', 'require("node:fs").writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000)', pidPath], controller.signal)
    const rejection = expect(result).rejects.toMatchObject({ detail: { code: 'CANCELLED' } })
    const { readFile } = await import('node:fs/promises')
    let pid = 0
    await expect.poll(async () => { try { pid = Number(await readFile(pidPath, 'utf8')); return pid > 0 } catch { return false } }).toBe(true)
    controller.abort()
    await rejection
    expect(() => process.kill(pid, 0)).toThrow()
  })
})
