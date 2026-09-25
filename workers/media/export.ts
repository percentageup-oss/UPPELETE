import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { availableParallelism, tmpdir } from 'node:os'
import path from 'node:path'
import {
  blankFrameRequest, exportManifestSchema, exportPlanSchema, exportFrameCountFor, exportOutputDurationUs, frameRequestAt, frameRequestAtSequence, manifestTimeline, maskFrameRequest, normalizeManifest,
  type ExportManifestV3, type PlannedFrame,
} from '../../src/export/plan'
import { createLayerPlan } from '../../src/core/layerPlan'
import { glassShapes, graphicsPasses } from '../../src/core/graphicsPasses'
import { exportSupportFromConfiguration, type ExportSupport } from '../../src/core/exportSupport'
import type { VideoEncoderId } from '../../src/core/exportEncoder'
import { selectVideoEncoder } from './exportEncoderSelect'
import { failure, MediaWorkerError, type MediaTask, type MediaResult, type ProgressMessage, type Toolchain } from './protocol'
import { runExecutable } from './process'
import { probeMedia } from './probe'
import { exportArguments, exportArgumentsV3, exportFilterGraph, exportFilterGraphV3, maskTargets, type MaskTarget } from './exportArguments'
import { ownedProcess, RenderHost, writeBounded } from './exportProcesses'
import { selectFrameTransport, type FrameTransport } from './exportTransport'
import { decodeCubeData, writeCube } from '../../src/color/cube'

/** The Windows argv limit `docs/EDITING.md` calls out — past this the graph moves to a script file. */
const FILTER_COMPLEX_ARGV_LIMIT_BYTES = 8 * 1024

/** How long a failing export waits for its peer process to say why it died before tearing it down. */
const PEER_SETTLE_MS = 2000

/**
 * The longest a single frame step may wait on a live peer — the host returning a PNG, or FFmpeg
 * accepting one — before the export fails as stalled. The host bounds its own render at 15 s and
 * exits on failure, so this only fires when a process is alive but no longer making progress
 * (a wedged hardware encoder, a hung renderer). Without it the pipe waits forever and the progress
 * bar freezes with no message.
 */
const FRAME_STALL_MS = 60_000

/** Rejects with a stall failure naming the step if `work` has not settled within `ms`. */
async function withinStallDeadline<T>(work: Promise<T>, ms: number, describe: () => { message: string; diagnostic: string }): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([work, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        const { message, diagnostic } = describe()
        reject(failure('TOOL_FAILED', message, { diagnostic: diagnostic.slice(-8192) }))
      }, ms)
    })])
  } finally { clearTimeout(timer) }
}

/** Resolves once every promise settles or the deadline passes, whichever is first; never rejects. */
async function settledWithin(promises: (Promise<unknown> | undefined)[], ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([
    Promise.allSettled(promises),
    new Promise<void>((resolve) => { timer = setTimeout(resolve, ms) }),
  ])
  clearTimeout(timer)
}

const isCancellation = (error: unknown) => error instanceof MediaWorkerError && error.detail.code === 'CANCELLED'

/**
 * The failure to report for an export that stopped on its own. Either process dying makes
 * `export.ts` abort the other, so a real failure always arrives alongside the `CANCELLED`
 * rejection of its peer — a rejection that is only ever our own teardown. Prefer, in order: a
 * process's own non-cancellation failure (the encoder's or host's exit status and stderr), the
 * error the frame loop itself hit, and only then a bare cancellation.
 */
export function mostInformativeFailure(loopError: unknown, processFailures: unknown[]): unknown {
  return processFailures.find((reason) => !isCancellation(reason))
    ?? (isCancellation(loopError) ? undefined : loopError)
    ?? processFailures[0]
    ?? loopError
}

type ExportTask = Extract<MediaTask, { operation: 'export' }>
type ProcessSpawner = typeof ownedProcess
type ToolRunner = typeof runExecutable
type MediaProber = typeof probeMedia
/** Test-only seams. Production code never overrides these; they exist so `export.test.ts` can
 * exercise the real orchestration logic — cancellation, progress parsing, gap-frame reuse,
 * cleanup and output validation — against fake processes instead of a real FFmpeg/export host,
 * mirroring the `{ runTool, temporaryRoot }` injection already used by `waveform.ts`/`thumbnails.ts`. */
export type ExportDependencies = { spawn?: ProcessSpawner; probe?: MediaProber; runTool?: ToolRunner; temporaryRoot?: string; stallMs?: number; transport?: FrameTransport; hosts?: number }

/** Each host is ~300 MB and a raw 1080p frame 8 MB, so the pool stays small. */
const MAX_EXPORT_HOSTS = 3
/** Export hosts to run: a quarter of the cores, 1-3, unless `CAPTION_STUDIO_EXPORT_HOSTS` sets it. */
export function exportHostCount(env: NodeJS.ProcessEnv = process.env, parallelism = availableParallelism()): number {
  const requested = Number(env.CAPTION_STUDIO_EXPORT_HOSTS)
  const count = Number.isInteger(requested) && requested >= 1 ? requested : Math.floor(parallelism / 4)
  return Math.min(MAX_EXPORT_HOSTS, Math.max(1, count))
}

/** Successful support checks for the session, so each export job skips the `-version` runs. Only
 * `supported: true` is cached: a fixed install is re-checked on the next job. */
const supportedTools = new Set<string>()
export function resetExportSupportCacheForTests() { supportedTools.clear() }

export async function exportSupport(tools: Toolchain | undefined, signal: AbortSignal,
  dependencies: Pick<ExportDependencies, 'runTool'> = {}): Promise<ExportSupport> {
  if (!tools?.exportHost) return { supported: false, reason: 'The GPU export host is not configured for this build.' }
  const cacheKey = `${tools.ffmpegPath}|${tools.ffprobePath}|${tools.exportHost.executable}`
  if (supportedTools.has(cacheKey)) return { supported: true, reason: null }
  const support = await checkExportSupport(tools, tools.exportHost, signal, dependencies)
  if (support.supported) supportedTools.add(cacheKey)
  return support
}

async function checkExportSupport(tools: Toolchain, exportHost: NonNullable<Toolchain['exportHost']>, signal: AbortSignal,
  dependencies: Pick<ExportDependencies, 'runTool'>): Promise<ExportSupport> {
  const runTool = dependencies.runTool ?? runExecutable
  let encodersOutput: string | undefined
  if (process.platform !== 'darwin') {
    const selection = await selectVideoEncoder(tools.ffmpegPath, signal, runTool)
    if ('reason' in selection) return { supported: false, reason: selection.reason }
    encodersOutput = selection.encodersOutput
  }
  const support = exportSupportFromConfiguration(await runTool(tools.ffmpegPath, ['-version'], signal), process.platform, encodersOutput)
  if (!support.supported) return support
  const probeSupport = exportSupportFromConfiguration(await runTool(tools.ffprobePath, ['-version'], signal), process.platform, encodersOutput)
  if (!probeSupport.supported) return probeSupport
  try {
    await stat(exportHost.executable)
    await stat(exportHost.scriptPath)
  } catch {
    return { supported: false, reason: 'The built GPU export host is missing; run the export build step.' }
  }
  return { supported: true, reason: null }
}

export async function renderVideo(task: ExportTask, tools: Toolchain, signal: AbortSignal,
  report: (value: ProgressMessage['progress']) => void, dependencies: ExportDependencies = {}): Promise<Extract<MediaResult, { operation: 'export' }>> {
  const startedAt = performance.now()
  const spawn = dependencies.spawn ?? ownedProcess
  const probe = dependencies.probe ?? probeMedia
  const support = await exportSupport(tools, signal, dependencies)
  if (!support.supported) throw failure('UNSUPPORTED_OPERATION', support.reason!)
  const selection = await selectVideoEncoder(tools.ffmpegPath, signal, dependencies.runTool ?? runExecutable)
  if ('reason' in selection) throw failure('UNSUPPORTED_OPERATION', selection.reason)
  const videoEncoder = selection.encoder
  if (!path.isAbsolute(task.outputPath) || task.inputPaths.some((input) => path.resolve(input) === path.resolve(task.outputPath))) {
    throw failure('INVALID_MESSAGE', 'Export must use a new explicit destination')
  }
  const manifestStat = await stat(task.renderManifestPath)
  if (manifestStat.size > 64 * 1024 * 1024) throw failure('OUTPUT_LIMIT', 'Export manifest exceeds 64 MiB')
  const manifest = exportManifestSchema.parse(JSON.parse(await readFile(task.renderManifestPath, 'utf8')))
  const plan = exportPlanSchema.parse({ width: task.width, height: task.height, range: task.range, frameRate: task.frameRate })
  const controller = new AbortController()
  const cancel = () => controller.abort()
  signal.addEventListener('abort', cancel, { once: true })
  if (signal.aborted) cancel()
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS; delete env.NODE_PATH
  // A dedicated Electron profile directory per job — never the editor's own userData — so
  // concurrent or crashed export hosts never collide on Local State/GPU cache. Baked LUT files
  // (Color: adjustment layers) also land here, next to `filtergraph.txt`.
  const hostProfileDirectory = await mkdtemp(path.join(dependencies.temporaryRoot ?? tmpdir(), 'caption-studio-export-host-'))
  const extraProfileDirectories: string[] = []
  const hosts: RenderHost[] = []
  let encoder: ReturnType<ProcessSpawner> | undefined
  try {
    // `prepareV3` writes any baked LUT files into `hostProfileDirectory` before building the
    // filtergraph, since the graph embeds their on-disk paths as literal `lut3d=file=…` text.
    const job = manifest.version === 3 ? await prepareV3(manifest, task, tools, signal, probe, hostProfileDirectory, videoEncoder) : await prepareV2(manifest, task, tools, signal, probe, plan, videoEncoder)
    // Fixed for the whole job: it is FFmpeg's input format.
    const transport = job.pngOnly ? 'png' : dependencies.transport ?? selectFrameTransport()
    // Cuts can chain hundreds of trim/concat filters; past the Windows argv limit the graph moves
    // to a file passed with `-/filter_complex <file>` instead of being inlined (docs/EDITING.md).
    const graph = job.graph(transport)
    let filterComplexScriptPath: string | undefined
    if (Buffer.byteLength(graph.filterComplex, 'utf8') > FILTER_COMPLEX_ARGV_LIMIT_BYTES) {
      filterComplexScriptPath = path.join(hostProfileDirectory, 'filtergraph.txt')
      await writeFile(filterComplexScriptPath, graph.filterComplex, 'utf8')
    }
    // The host allow-lists exactly these URLs (scripts/export-host.mjs) — never an arbitrary
    // renderer- or project-supplied path — so an overlay asset this job did not resolve can never load.
    const assetArgs = [...new Set(job.overlayUrls)].flatMap((url) => ['--asset', url])
    const hostArgs = (profileDirectory: string) => [...(tools.exportHost!.args ?? [tools.exportHost!.scriptPath]), '--user-data', profileDirectory, '--transport', transport, ...assetArgs]
    const frameExpectation = transport === 'raw' ? { rawBytes: job.width * job.height * 4 } : 'png' as const
    // Frames are painted by up to N hosts in parallel but still go to the one encoder in index order.
    const hostCount = Math.max(1, Math.min(dependencies.hosts ?? exportHostCount(), job.frameCount))
    for (let n = 0; n < hostCount; n++) {
      // Host 0 shares the job directory (LUT files, filter script); the others get their own profile.
      const profileDirectory = n === 0 ? hostProfileDirectory : await mkdtemp(path.join(dependencies.temporaryRoot ?? tmpdir(), 'caption-studio-export-host-'))
      if (n > 0) extraProfileDirectories.push(profileDirectory)
      hosts.push(new RenderHost(spawn(tools.exportHost!.executable, hostArgs(profileDirectory), controller.signal, env), frameExpectation))
    }
    // Layer masks FFmpeg applies (video clips, blur) are images the host rasterizes from the same SVG
    // the preview masks with. They must exist before the encoder opens them as inputs, so host 0
    // runs first; identical masks share one file.
    const maskFiles: string[] = []
    const rasterized = new Map<string, string>()
    for (const target of job.masks) {
      const key = JSON.stringify(target.mask)
      let file = rasterized.get(key)
      if (!file) {
        file = path.join(hostProfileDirectory, `mask-${rasterized.size}.png`)
        await writeFile(file, await hosts[0].render(maskFrameRequest(target.mask, job.width, job.height), 'png'))
        rasterized.set(key, file)
      }
      maskFiles.push(file)
    }
    encoder = spawn(tools.ffmpegPath, job.args(transport, filterComplexScriptPath, maskFiles), controller.signal)
    // Either process failure interrupts a blocked frame read/write in its peer.
    for (const host of hosts) host.closed.catch(cancel)
    encoder.closed.catch(cancel)
    const total = job.frameCount
    let progressText = '', lastFrame = 0
    encoder.child.stdout.on('data', (chunk: Buffer) => {
      progressText += chunk.toString('utf8')
      if (progressText.length > 8192) { cancel(); return }
      let newline
      while ((newline = progressText.indexOf('\n')) >= 0) {
        const line = progressText.slice(0, newline).trim(); progressText = progressText.slice(newline + 1)
        if (/^frame=\s*\d+$/.test(line)) {
          const frame = Math.min(total, Number(line.slice(6)))
          if (frame >= lastFrame) { lastFrame = frame; report({ kind: 'measured', phase: 'export', completed: frame, total, unit: 'frames' }) }
        }
      }
    })
    // One request, one PNG, one completed pipe write. No sequence on disk or unbounded queue.
    //
    // `layerPlan` gives every output frame its source timestamp and a signature covering everything
    // that can change the layer's pixels. Consecutive frames with the same signature are identical,
    // so the previously rendered PNG is re-sent instead of repainting it — the same frame count
    // still goes down the pipe. Frames with no active cue are additionally cached for the whole
    // export (they are one fully transparent image), preserving X2's gap-frame reuse across gaps
    // that are not adjacent. Only these two buffers are retained, so memory stays bounded.
    type RenderedFrame = { signature: string; png: Buffer }
    const stallMs = dependencies.stallMs ?? FRAME_STALL_MS
    const seconds = Math.round(stallMs / 1000)
    const encoderHandle = encoder
    let hostWaitMs = 0, encoderWaitMs = 0, paintedFrames = 0, reusedFrames = 0
    const toEncoder = async (index: number, png: Buffer) => {
      const waitStart = performance.now()
      try {
        await withinStallDeadline(writeBounded(encoderHandle.child.stdin, png), stallMs, () => ({
          message: `Export stalled at frame ${index + 1} of ${total}: the ${videoEncoder} encoder accepted no frame for ${seconds} s`,
          diagnostic: encoderHandle.diagnostic?.() ?? '',
        }))
      } finally { encoderWaitMs += performance.now() - waitStart }
    }
    const fromHost = (host: RenderHost, index: number, request: unknown) => withinStallDeadline(host.render(request), stallMs, () => ({
      message: `Export stalled at frame ${index + 1} of ${total}: the caption renderer returned no frame for ${seconds} s`,
      diagnostic: host.diagnostic(),
    }))
    const idleHosts = [...hosts]
    const hostWaiters: ((host: RenderHost) => void)[] = []
    const acquireHost = () => new Promise<RenderHost>((resolve, reject) => {
      if (controller.signal.aborted) return reject(failure('CANCELLED', 'Export interrupted'))
      const host = idleHosts.shift()
      if (host) resolve(host); else hostWaiters.push(resolve)
    })
    const releaseHost = (host: RenderHost) => { const waiter = hostWaiters.shift(); if (waiter) waiter(host); else idleHosts.push(host) }
    const loopStartedAt = performance.now()
    const startupMs = loopStartedAt - startedAt
    if (job.passCount === 1) {
      let previous: RenderedFrame | null = null
      let gap: RenderedFrame | null = null
      const reuse = (candidate: RenderedFrame | null, signature: string) => candidate && candidate.signature === signature ? candidate.png : null
      // Render pool: which indices need painting is decided from layer signatures alone (the same rule
      // as the byte-side reuse below), so the scheduler can plan ahead without any bytes. Each painted
      // index goes to the next idle host; results are consumed strictly in index order. At most 2N
      // painted frames are outstanding (in flight or waiting to be consumed), which bounds memory.
      const frames = new Map<number, LayerFrame>()
      let plannedTo = 0, plannedPrevious: string | null = null, plannedGap: string | null = null
      const nextPainted = (): number => {
        for (; plannedTo < total; plannedTo++) {
          const frame = job.layer.frameAt(plannedTo)
          frames.set(plannedTo, frame)
          const reused = frame.signature === plannedPrevious || frame.signature === plannedGap
          plannedPrevious = frame.signature
          if (!reused && frame.activeCueId === null) plannedGap ??= frame.signature
          if (!reused) return plannedTo++
        }
        return total
      }
      const renders = new Map<number, Promise<Buffer>>()
      const dispatch = (index: number, frame: LayerFrame) => {
        const request = job.request(index, frame).request
        const promise = acquireHost().then(async (host) => {
          try { return await fromHost(host, index, request) } finally { releaseHost(host) }
        })
        // Bookkeeping only: the real rejection is observed when the loop awaits this render, and one
        // abandoned by an earlier failure must not surface as an unhandled rejection.
        promise.catch(() => {})
        return promise
      }
      const window = 2 * hosts.length
      const fill = () => {
        while (renders.size < window) {
          const next = nextPainted()
          if (next >= total) return
          renders.set(next, dispatch(next, frames.get(next)!))
        }
      }
      fill()
      for (let index = 0; index < total; index++) {
        if (controller.signal.aborted) throw failure('CANCELLED', 'Export interrupted')
        const frame = frames.get(index) ?? job.layer.frameAt(index)
        frames.delete(index)
        const cached: Buffer | null = reuse(previous, frame.signature) ?? reuse(gap, frame.signature)
        if (cached) {
          previous = { signature: frame.signature, png: cached }
          reusedFrames++
          await toEncoder(index, cached)
          continue
        }
        const render = renders.get(index) ?? dispatch(index, frame)
        const waitStart = performance.now()
        let png: Buffer
        try { png = await render } finally { hostWaitMs += performance.now() - waitStart }
        renders.delete(index)
        paintedFrames++
        previous = { signature: frame.signature, png }
        if (frame.activeCueId === null) gap ??= { signature: frame.signature, png }
        fill()
        await toEncoder(index, png)
      }
    } else {
      // Shape blend export passes (docs/plans/shape-blend/02-export-passes.md): each output frame is
      // K sub-frames now, sent down the same pipe in pass order. Each band keeps its own "previous"
      // reuse cache (the whole-frame cache above only makes sense for one pass), and a pass whose
      // signature says it paints nothing at all writes one cached blank buffer instead of asking a
      // host to render (and this loop to wait on) content that is fully transparent either way.
      const passCount = job.passCount
      const blankBuffer = transport === 'raw'
        ? Buffer.alloc(job.width * job.height * 4)
        : await hosts[0].render(blankFrameRequest(job.width, job.height), 'png')
      const previous: (RenderedFrame | null)[] = new Array(passCount).fill(null)
      for (let index = 0; index < total; index++) {
        if (controller.signal.aborted) throw failure('CANCELLED', 'Export interrupted')
        const frame = job.layer.frameAt(index)
        const passStates = job.layer.passSignatures(index)
        const buffers: Buffer[] = new Array(passCount)
        const toRender: number[] = []
        for (let pass = 0; pass < passCount; pass++) {
          const state = passStates[pass]
          const cached = state.empty ? null : previous[pass]
          if (state.empty) { buffers[pass] = blankBuffer; reusedFrames++ }
          else if (cached && cached.signature === state.signature) { buffers[pass] = cached.png; reusedFrames++ }
          else toRender.push(pass)
        }
        if (toRender.length) {
          const waitStart = performance.now()
          try {
            await Promise.all(toRender.map(async (pass) => {
              const host = await acquireHost()
              try {
                const request = job.request(index, frame, pass).request
                const png = await withinStallDeadline(host.render(request), stallMs, () => ({
                  message: `Export stalled at frame ${index + 1} of ${total} (pass ${pass + 1} of ${passCount}): the caption renderer returned no frame for ${seconds} s`,
                  diagnostic: host.diagnostic(),
                }))
                buffers[pass] = png
                previous[pass] = { signature: passStates[pass].signature, png }
              } finally { releaseHost(host) }
            }))
          } finally { hostWaitMs += performance.now() - waitStart }
          paintedFrames += toRender.length
        }
        for (let pass = 0; pass < passCount; pass++) await toEncoder(index, buffers[pass])
      }
    }
    const loopEndedAt = performance.now()
    for (const host of hosts) host.end()
    encoder.child.stdin.end()
    await encoder.closed
    // Every frame is already encoded; the host is only asked to exit. It is given a moment and then
    // reaped by `finally`, so a host that misses stdin EOF (seen with Electron on Windows) cannot
    // hold a finished export open.
    await settledWithin(hosts.map((host) => host.closed), PEER_SETTLE_MS)
    if (signal.aborted) throw failure('CANCELLED', 'Export cancelled')
    // Independent output validation precedes finalization by main's commit gate.
    const output = await probe(tools.ffprobePath, task.outputPath, signal)
    const video = output.metadata.streams.find((s) => s.kind === 'video')
    if (video?.codec.name !== 'h264' || video.width !== job.width || video.height !== job.height
      || !output.metadata.durationUs || (graph.hasAudioOut && !output.metadata.streams.some((s) => s.kind === 'audio' && s.codec.name === 'aac'))) throw failure('TOOL_FAILED', 'Encoded MP4 failed stream validation')
    const finishedAt = performance.now()
    const loopSeconds = (loopEndedAt - loopStartedAt) / 1000
    const timings = {
      startupMs, hostWaitMs, encoderWaitMs, hosts: hosts.length, paintedFrames, reusedFrames,
      finalizeMs: finishedAt - loopEndedAt, totalMs: finishedAt - startedAt, fps: loopSeconds > 0 ? total / loopSeconds : 0,
    }
    return { operation: 'export', path: task.outputPath, durationUs: output.metadata.durationUs, frameCount: total, frameRate: job.frameRate, timings }
  } catch (error) {
    // Recover the actual encoder/host failure before translating external cancellation. A peer that
    // is already dying on its own (the host writing its error and exiting, say) is given a moment
    // to report why *before* our own teardown: once `cancel()` runs, every process that closes
    // afterwards rejects `CANCELLED`, and the real reason is indistinguishable from our SIGTERM.
    if (!signal.aborted) await settledWithin([encoder?.closed, ...hosts.map((host) => host.closed)], PEER_SETTLE_MS)
    cancel()
    const outcomes = await Promise.allSettled([encoder?.closed, ...hosts.map((host) => host.closed)])
    if (signal.aborted) throw failure('CANCELLED', 'Export cancelled')
    throw mostInformativeFailure(error, outcomes.flatMap((outcome) => outcome.status === 'rejected' ? [outcome.reason] : []))
  } finally {
    signal.removeEventListener('abort', cancel)
    for (const host of hosts) host.stop()
    encoder?.stop()
    await Promise.allSettled([...hosts.map((host) => host.closed), encoder?.closed])
    await Promise.all([hostProfileDirectory, ...extraProfileDirectories].map((directory) => rm(directory, { recursive: true, force: true })))
  }
}

type LayerFrame = ReturnType<ReturnType<typeof createLayerPlan>['frameAt']>
/** Everything the frame loop and encoder need, whichever manifest version drives them. */
type PreparedExport = {
  layer: ReturnType<typeof createLayerPlan>
  /** `pass` selects one band of the shape-blend pass model (`graphicsPasses`) for a v3 manifest;
   * ignored (and never called with more than one value) when `passCount` is 1. */
  request: (index: number, frame: LayerFrame, pass?: number) => PlannedFrame
  graph: (transport: FrameTransport) => { filterComplex: string; hasAudioOut: boolean }
  args: (transport: FrameTransport, filterComplexScriptPath?: string, maskFiles?: readonly string[]) => string[]
  overlayUrls: string[]
  /** FFmpeg-composited layers with a mask; their images are rasterized by the host before encoding starts. */
  masks: MaskTarget[]
  frameCount: number
  width: number
  height: number
  frameRate: ExportManifestV3['format']['frameRate']
  /** K in the shape-blend pass model (docs/plans/shape-blend/02-export-passes.md): 1 for every
   * manifest with no blending shapes (v1/v2 always; v3 unless the project has one), which keeps the
   * frame loop's single-request-per-output-frame path exactly as it was before passes existed. */
  passCount: number
  /** True when a glass shape is present: its map sub-frame must reach FFmpeg exactly, and raw transport has the
   * documented un-premultiply bug, so the job uses PNG whatever was requested (docs/plans/liquid-glass/04-glass-export-pass.md). */
  pngOnly?: boolean
}

/** Manifests v1/v2: one source media, X2's byte-identical encoder arguments. */
async function prepareV2(manifest: Exclude<ReturnType<typeof exportManifestSchema.parse>, ExportManifestV3>, task: ExportTask, tools: Toolchain,
  signal: AbortSignal, probe: MediaProber, plan: ReturnType<typeof exportPlanSchema.parse>, videoEncoder: VideoEncoderId): Promise<PreparedExport> {
  const edits = normalizeManifest(manifest)
  const [inputPath] = task.inputPaths
  // One plan for which source timestamp each output frame shows and which frames repeat.
  const layer = createLayerPlan({
    cues: manifest.cues, style: manifest.style, display: manifest.display, segments: edits.segments,
    rangeStartUs: plan.range.startUs, mediaDurationUs: task.range.endUs, frameRate: plan.frameRate, overlays: edits.overlays,
    output: { width: plan.width, height: plan.height },
  })
  const inputProbe = await probe(tools.ffprobePath, inputPath, signal)
  if (!inputProbe.metadata.durationUs || task.range.endUs > inputProbe.metadata.durationUs || !inputProbe.metadata.streams.some((s) => s.kind === 'video')) throw failure('INVALID_MESSAGE', 'Export range needs a known video duration and must stay within it')
  const hasAudio = inputProbe.metadata.streams.some((s) => s.kind === 'audio')
  // Sound-effect clip paths reach FFmpeg directly as `-i` arguments (never a shell string), but
  // unlike the source/overlay paths they are not looked up in main's fingerprint registry inside
  // this worker — confirm each one is a real, readable file before spawning anything, so a stale
  // or unrelinked path fails with an actionable message instead of an opaque FFmpeg error.
  for (const clip of edits.audioClips) {
    try { await stat(clip.path) }
    catch { throw failure('INVALID_MESSAGE', `Sound effect "${clip.id}" could not be read at its resolved path.`) }
  }
  return {
    layer,
    request: (index, frame) => frameRequestAt(manifest, plan, index, frame.sourceUs),
    graph: (transport) => exportFilterGraph(plan, hasAudio, manifest, transport),
    args: (transport, script) => exportArguments(inputPath, task.outputPath, plan, hasAudio, manifest, script, task.encoding, videoEncoder, transport),
    overlayUrls: edits.overlays.map((overlay) => overlay.assetUrl),
    masks: [],
    frameCount: exportFrameCountFor(exportOutputDurationUs(plan, edits), plan.frameRate),
    width: plan.width, height: plan.height, frameRate: plan.frameRate,
    passCount: 1,
  }
}

/**
 * Manifest v3: every input is probed once — for its audio stream, and so a clip reaching past the
 * end of its file fails here with its name rather than as an opaque FFmpeg error — and every input
 * must be one the task declared.
 */
async function prepareV3(manifest: ExportManifestV3, task: ExportTask, tools: Toolchain, signal: AbortSignal, probe: MediaProber, hostProfileDirectory: string, videoEncoder: VideoEncoderId): Promise<PreparedExport> {
  const declared = new Set(task.inputPaths.map((input) => path.resolve(input)))
  // Each baked LUT (`manifest.luts`, Color: adjustment layers) becomes its own `.cube` file next to
  // `filtergraph.txt`, before the graph is built — the graph embeds the file's own path as literal
  // `lut3d=file=…` text, so the file must exist under that exact name first.
  const lutPaths = new Map<string, string>()
  for (const lut of manifest.luts) {
    const file = path.join(hostProfileDirectory, `lut-${lut.id}.cube`)
    await writeFile(file, writeCube({ size: lut.size, title: '', domainMin: [0, 0, 0], domainMax: [1, 1, 1], data: decodeCubeData(lut.data, lut.size ** 3 * 3) }), 'utf8')
    lutPaths.set(lut.id, file)
  }
  const probes = new Map<string, Awaited<ReturnType<MediaProber>>>()
  const hasAudioByInput: boolean[] = []
  for (const [index, input] of manifest.inputs.entries()) {
    const resolved = path.resolve(input.path)
    if (!declared.has(resolved)) throw failure('INVALID_MESSAGE', 'Export manifest reads a file the task did not declare')
    if (input.kind === 'image') {
      try { await stat(input.path) } catch { throw failure('INVALID_MESSAGE', `Image "${path.basename(input.path)}" could not be read at its resolved path.`) }
      hasAudioByInput[index] = false
      continue
    }
    let probed = probes.get(resolved)
    if (!probed) { probed = await probe(tools.ffprobePath, input.path, signal); probes.set(resolved, probed) }
    const clip = manifest.clips.find((candidate) => candidate.inputIndex === index)
    const durationUs = probed.metadata.durationUs
    if (input.kind === 'video' && !probed.metadata.streams.some((s) => s.kind === 'video')) throw failure('INVALID_MESSAGE', `"${path.basename(input.path)}" has no video stream`)
    // Probed durations can differ from the stored ones by a few microseconds; a millisecond of slack.
    if (clip && durationUs !== null && clip.sourceEndUs > durationUs + 1_000) throw failure('INVALID_MESSAGE', `A clip of "${path.basename(input.path)}" runs past the end of the file; relink or trim it.`)
    hasAudioByInput[index] = probed.metadata.streams.some((s) => s.kind === 'audio')
  }
  const { width, height, frameRate } = manifest.format
  const layer = createLayerPlan({
    cues: manifest.cues, style: manifest.style, display: manifest.display, frameRate, overlays: manifest.overlays, effects: manifest.effects, textOverlays: manifest.textOverlays, shapes: manifest.shapes,
    timeline: manifestTimeline(manifest), output: { width, height },
  })
  // Built per transport, but the LUT files above are written once.
  const graphs = new Map<FrameTransport, ReturnType<typeof exportFilterGraphV3>>()
  const graphFor = (transport: FrameTransport) => graphs.get(transport) ?? (graphs.set(transport, exportFilterGraphV3(manifest, hasAudioByInput, lutPaths, transport)), graphs.get(transport)!)
  return {
    layer,
    request: (index, frame, pass) => frameRequestAtSequence(manifest, index, frame.active, pass),
    graph: graphFor,
    args: (transport, script, maskFiles) => exportArgumentsV3(manifest, task.outputPath, hasAudioByInput, script, task.encoding, maskFiles, graphFor(transport), videoEncoder, transport),
    overlayUrls: manifest.overlays.map((overlay) => overlay.assetUrl),
    masks: maskTargets(manifest),
    frameCount: exportFrameCountFor(manifest.sequenceDurationUs, frameRate),
    width, height, frameRate,
    passCount: graphicsPasses(manifest.shapes).count,
    pngOnly: glassShapes(manifest.shapes).length > 0,
  }
}
