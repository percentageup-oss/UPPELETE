import { app } from 'electron'
import { mkdir, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import {
  resolveEmptyResultSchema, resolveRenderStartResultSchema, resolveRenderStatusResultSchema, resolveTimelineInfoSchema,
  type ResolveInspectedVideo, type ResolveTimelineInfo,
} from '../../src/core/resolveIpc'
import { parseResolveFps } from '../../src/resolve/frames'
import type { MediaCandidate } from '../projectMedia'
import type { ResolveBridge } from './bridge'

/** README: "a small H.264 proxy (720p, with audio)" — the long side of the scaled render. */
const MAX_LONG_SIDE = 1280
const RENDER_POLL_INTERVAL_MS = 500

export type RenderTimelineProxyDeps = {
  bridge: ResolveBridge
  /** The same probe main.ts uses for `dialog:open-video` (`inspectMedia`), so the proxy's
   * fingerprint lands in `inspectedMedia` and transcription can resolve its path afterwards. */
  inspect(filePath: string): Promise<MediaCandidate>
}

export type RenderTimelineProxyResult = {
  inspected: ResolveInspectedVideo
  timeline: ResolveTimelineInfo & { fps: { num: number; den: number } }
}

/** Always KathaCut's own cache, never Resolve's media — the proxy never touches Resolve's project. */
function resolveProxyCacheDir(): string {
  return path.join(app.getPath('userData'), 'Cache', 'resolve-proxies')
}

function sanitizeTimelineName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]+/g, '_').trim()
  return cleaned.length ? cleaned.slice(0, 80) : 'timeline'
}

/** The render is expected at `<name>.mp4`; if Resolve named it differently, the newest file sharing
 * the same unique prefix is used instead. Errors if neither is found. */
async function findRenderedFile(dir: string, name: string): Promise<string> {
  const exact = path.join(dir, `${name}.mp4`)
  try {
    await stat(exact)
    return exact
  } catch { /* fall through to the prefix search below */ }
  const entries = await readdir(dir, { withFileTypes: true })
  const matches = entries.filter((entry) => entry.isFile() && entry.name.startsWith(name))
  if (!matches.length) throw new Error('DaVinci Resolve finished rendering, but the proxy file could not be found.')
  const withMtime = await Promise.all(matches.map(async (entry) => {
    const filePath = path.join(dir, entry.name)
    return { filePath, mtimeMs: (await stat(filePath)).mtimeMs }
  }))
  withMtime.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return withMtime[0].filePath
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Renders the current DaVinci Resolve timeline to a small H.264 proxy in KathaCut's own cache
 * (docs/plans/resolve-textplus/04-project-from-timeline.md), polling until it finishes, then
 * inspects and registers the result exactly like an opened video file.
 */
export async function renderTimelineProxy(deps: RenderTimelineProxyDeps, onProgress: (percent: number) => void, signal: AbortSignal): Promise<RenderTimelineProxyResult> {
  const timeline = await deps.bridge.request('timelineInfo', {}, resolveTimelineInfoSchema)
  const fps = parseResolveFps(timeline.frameRate)
  const targetDir = resolveProxyCacheDir()
  await mkdir(targetDir, { recursive: true })
  const name = `${sanitizeTimelineName(timeline.timelineName)}-${timeline.timelineId.slice(0, 8)}-${Date.now()}`

  const started = await deps.bridge.request('renderProxyStart', { targetDir, name, maxLongSide: MAX_LONG_SIDE }, resolveRenderStartResultSchema)

  const cancelRender = () => deps.bridge.request('renderCancel', { jobId: started.jobId }, resolveEmptyResultSchema).catch(() => undefined)
  const cancelledError = () => new Error('The DaVinci Resolve render was cancelled.')

  if (signal.aborted) { await cancelRender(); throw cancelledError() }
  for (;;) {
    await sleep(RENDER_POLL_INTERVAL_MS)
    if (signal.aborted) { await cancelRender(); throw cancelledError() }
    const status = await deps.bridge.request('renderStatus', { jobId: started.jobId }, resolveRenderStatusResultSchema)
    onProgress(Math.max(0, Math.min(100, Math.round(status.percent ?? 0))))
    if (status.status === 'Complete') break
    if (status.status === 'Cancelled') throw cancelledError()
    if (status.status === 'Failed') throw new Error(status.error || 'DaVinci Resolve reported that the render failed.')
  }

  const outputPath = await findRenderedFile(targetDir, name)
  const candidate = await deps.inspect(outputPath)
  return {
    inspected: { ok: true, kind: 'video', media: candidate.media, url: candidate.url },
    timeline: { ...timeline, fps },
  }
}
