import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { exportManifestSchema, exportPlanSchema, exportFrameCountFor, exportOutputDurationUs, frameRequestAt, normalizeManifest } from '../../src/export/plan'
import { createLayerPlan } from '../../src/core/layerPlan'
import { exportSupportFromConfiguration, type ExportSupport } from '../../src/core/exportSupport'
import { failure, type MediaTask, type MediaResult, type ProgressMessage, type Toolchain } from './protocol'
import { runExecutable } from './process'
import { probeMedia } from './probe'
import { exportArguments, exportFilterGraph } from './exportArguments'
import { ownedProcess, PngReader, writeBounded } from './exportProcesses'

/** The Windows argv limit `docs/EDITING.md` calls out — past this the graph moves to a script file. */
const FILTER_COMPLEX_ARGV_LIMIT_BYTES = 8 * 1024

type ExportTask = Extract<MediaTask, { operation: 'export' }>
type ProcessSpawner = typeof ownedProcess
type ToolRunner = typeof runExecutable
type MediaProber = typeof probeMedia
/** Test-only seams. Production code never overrides these; they exist so `export.test.ts` can
 * exercise the real orchestration logic — cancellation, progress parsing, gap-frame reuse,
 * cleanup and output validation — against fake processes instead of a real FFmpeg/export host,
 * mirroring the `{ runTool, temporaryRoot }` injection already used by `waveform.ts`/`thumbnails.ts`. */
export type ExportDependencies = { spawn?: ProcessSpawner; probe?: MediaProber; runTool?: ToolRunner; temporaryRoot?: string }

export async function exportSupport(tools: Toolchain | undefined, signal: AbortSignal,
  dependencies: Pick<ExportDependencies, 'runTool'> = {}): Promise<ExportSupport> {
  if (!tools?.exportHost) return { supported: false, reason: 'The GPU export host is not configured for this build.' }
  const runTool = dependencies.runTool ?? runExecutable
  const support = exportSupportFromConfiguration(await runTool(tools.ffmpegPath, ['-version'], signal), process.platform)
  if (!support.supported) return support
  const probeSupport = exportSupportFromConfiguration(await runTool(tools.ffprobePath, ['-version'], signal), process.platform)
  if (!probeSupport.supported) return probeSupport
  try {
    await stat(tools.exportHost.executable)
    await stat(tools.exportHost.scriptPath)
  } catch {
    return { supported: false, reason: 'The built GPU export host is missing; run the export build step.' }
  }
  return { supported: true, reason: null }
}

export async function renderVideo(task: ExportTask, tools: Toolchain, signal: AbortSignal,
  report: (value: ProgressMessage['progress']) => void, dependencies: ExportDependencies = {}): Promise<Extract<MediaResult, { operation: 'export' }>> {
  const spawn = dependencies.spawn ?? ownedProcess
  const probe = dependencies.probe ?? probeMedia
  const support = await exportSupport(tools, signal, dependencies)
  if (!support.supported) throw failure('UNSUPPORTED_OPERATION', support.reason!)
  if (!path.isAbsolute(task.outputPath) || path.resolve(task.inputPath) === path.resolve(task.outputPath)) throw failure('INVALID_MESSAGE', 'Export must use a new explicit destination')
  const manifestStat = await stat(task.renderManifestPath)
  if (manifestStat.size > 64 * 1024 * 1024) throw failure('OUTPUT_LIMIT', 'Export manifest exceeds 64 MiB')
  const manifest = exportManifestSchema.parse(JSON.parse(await readFile(task.renderManifestPath, 'utf8')))
  const edits = normalizeManifest(manifest)
  const plan = exportPlanSchema.parse({ width: task.width, height: task.height, range: task.range, frameRate: task.frameRate })
  // One plan for which source timestamp each output frame shows and which frames repeat.
  const layer = createLayerPlan({
    cues: manifest.cues, style: manifest.style, display: manifest.display, segments: edits.segments,
    rangeStartUs: plan.range.startUs, mediaDurationUs: task.range.endUs, frameRate: plan.frameRate, overlays: edits.overlays,
    output: { width: plan.width, height: plan.height },
  })
  const inputProbe = await probe(tools.ffprobePath, task.inputPath, signal)
  if (!inputProbe.metadata.durationUs || task.range.endUs > inputProbe.metadata.durationUs || !inputProbe.metadata.streams.some((s) => s.kind === 'video')) throw failure('INVALID_MESSAGE', 'Export range needs a known video duration and must stay within it')
  const hasAudio = inputProbe.metadata.streams.some((s) => s.kind === 'audio')
  const controller = new AbortController()
  const cancel = () => controller.abort()
  signal.addEventListener('abort', cancel, { once: true })
  if (signal.aborted) cancel()
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS; delete env.NODE_PATH
  // A dedicated Electron profile directory per job — never the editor's own userData — so
  // concurrent or crashed export hosts never collide on Local State/GPU cache.
  const hostProfileDirectory = await mkdtemp(path.join(dependencies.temporaryRoot ?? tmpdir(), 'caption-studio-export-host-'))
  let host: ReturnType<ProcessSpawner> | undefined, encoder: ReturnType<ProcessSpawner> | undefined
  try {
    // Cuts can chain hundreds of trim/concat filters; past the Windows argv limit the graph moves
    // to a file passed with `-filter_complex_script` instead of being inlined (docs/EDITING.md).
    const graph = exportFilterGraph(plan, hasAudio, manifest)
    let filterComplexScriptPath: string | undefined
    if (Buffer.byteLength(graph.filterComplex, 'utf8') > FILTER_COMPLEX_ARGV_LIMIT_BYTES) {
      filterComplexScriptPath = path.join(hostProfileDirectory, 'filtergraph.txt')
      await writeFile(filterComplexScriptPath, graph.filterComplex, 'utf8')
    }
    // Sound-effect clip paths reach FFmpeg directly as `-i` arguments (never a shell string), but
    // unlike the source/overlay paths they are not looked up in main's fingerprint registry inside
    // this worker — confirm each one is a real, readable file before spawning anything, so a stale
    // or unrelinked path fails with an actionable message instead of an opaque FFmpeg error.
    for (const clip of edits.audioClips) {
      try { await stat(clip.path) }
      catch { throw failure('INVALID_MESSAGE', `Sound effect "${clip.id}" could not be read at its resolved path.`) }
    }
    // The host allow-lists exactly these URLs (scripts/export-host.mjs) — never an arbitrary
    // renderer- or project-supplied path — so an overlay asset this job did not resolve can never load.
    const assetArgs = [...new Set(edits.overlays.map((overlay) => overlay.assetUrl))].flatMap((url) => ['--asset', url])
    host = spawn(tools.exportHost!.executable, [tools.exportHost!.scriptPath, '--user-data', hostProfileDirectory, ...assetArgs], controller.signal, env)
    encoder = spawn(tools.ffmpegPath, exportArguments(task.inputPath, task.outputPath, plan, hasAudio, manifest, filterComplexScriptPath), controller.signal)
    // Either process failure interrupts a blocked frame read/write in its peer.
    host.closed.catch(cancel); encoder.closed.catch(cancel)
    const total = exportFrameCountFor(exportOutputDurationUs(plan, edits), plan.frameRate)
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
    const reader = new PngReader(host.child.stdout)
    // One request, one PNG, one completed pipe write. No sequence on disk or unbounded queue.
    //
    // `layerPlan` gives every output frame its source timestamp and a signature covering everything
    // that can change the layer's pixels. Consecutive frames with the same signature are identical,
    // so the previously rendered PNG is re-sent instead of repainting it — the same frame count
    // still goes down the pipe. Frames with no active cue are additionally cached for the whole
    // export (they are one fully transparent image), preserving X2's gap-frame reuse across gaps
    // that are not adjacent. Only these two buffers are retained, so memory stays bounded.
    type RenderedFrame = { signature: string; png: Buffer }
    let previous: RenderedFrame | null = null
    let gap: RenderedFrame | null = null
    const reuse = (candidate: RenderedFrame | null, signature: string) => candidate && candidate.signature === signature ? candidate.png : null
    for (let index = 0; index < total; index++) {
      if (controller.signal.aborted) throw failure('CANCELLED', 'Export interrupted')
      const frame = layer.frameAt(index)
      const cached: Buffer | null = reuse(previous, frame.signature) ?? reuse(gap, frame.signature)
      if (cached) {
        previous = { signature: frame.signature, png: cached }
        await writeBounded(encoder.child.stdin, cached)
        continue
      }
      const { request } = frameRequestAt(manifest, plan, index, frame.sourceUs)
      await writeBounded(host.child.stdin, JSON.stringify(request) + '\n')
      const png = await reader.frame()
      previous = { signature: frame.signature, png }
      if (frame.activeCueId === null) gap ??= { signature: frame.signature, png }
      await writeBounded(encoder.child.stdin, png)
    }
    host.child.stdin.end(); encoder.child.stdin.end()
    await encoder.closed; await host.closed
    if (signal.aborted) throw failure('CANCELLED', 'Export cancelled')
    // Independent output validation precedes finalization by main's commit gate.
    const output = await probe(tools.ffprobePath, task.outputPath, signal)
    const video = output.metadata.streams.find((s) => s.kind === 'video')
    if (video?.codec.name !== 'h264' || video.width !== plan.width || video.height !== plan.height
      || !output.metadata.durationUs || (graph.hasAudioOut && !output.metadata.streams.some((s) => s.kind === 'audio' && s.codec.name === 'aac'))) throw failure('TOOL_FAILED', 'Encoded MP4 failed stream validation')
    return { operation: 'export', path: task.outputPath, durationUs: output.metadata.durationUs, frameCount: total, frameRate: plan.frameRate }
  } catch (error) {
    // Recover the actual encoder/host failure before translating external cancellation.
    cancel()
    const outcomes = await Promise.allSettled([encoder?.closed, host?.closed])
    if (signal.aborted) throw failure('CANCELLED', 'Export cancelled')
    const failed = outcomes.find((outcome) => outcome.status === 'rejected')
    if (failed?.status === 'rejected') throw failed.reason
    throw error
  } finally {
    signal.removeEventListener('abort', cancel)
    host?.stop(); encoder?.stop()
    await Promise.allSettled([host?.closed, encoder?.closed])
    await rm(hostProfileDirectory, { recursive: true, force: true })
  }
}
