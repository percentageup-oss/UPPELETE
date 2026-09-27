import type { MediaFingerprint, ProjectMedia } from '../../src/core/media'
import {
  resolveAppendVideoClipsResultSchema, resolveCreateTimelineResultSchema, resolveImportMediaResultSchema,
  type ResolvePushProgress, type ResolvePushTimelineRequest, type ResolvePushTimelineResult,
} from '../../src/core/resolveIpc'
import { formatResolveFps } from '../../src/resolve/frames'
import type { ResolveBridge } from './bridge'

export type PushTimelineDeps = {
  bridge: ResolveBridge
  /** main.ts's fingerprint registry, the same one `registerExportIpc` resolves assets from. */
  lookupMedia(fingerprint: MediaFingerprint): { path: string; media: ProjectMedia } | undefined
}

const COMMAND_TIMEOUT_MS = 30_000
/** ADR 0009 measured Text+ clip placement at this batch size (~1.3 s for 100); plain video clip placement is
 * unmeasured but assumed no slower, since it skips the per-clip styling `insertClips` also does. */
const APPEND_BATCH = 50
const IMPORT_BATCH = 25

const chunks = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = []
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size))
  return out
}

/**
 * Creates a new timeline in Resolve's currently open project (docs/plans/resolve-textplus/12-push-to-resolve.md):
 * every asset's file path is resolved here, from the same fingerprint registry export and sync use — never from
 * the renderer — so a missing or unrelinked asset stops the push before Resolve creates anything. Captions are
 * placed separately, by `applySync` against the timeline this returns.
 */
export async function pushTimeline(deps: PushTimelineDeps, request: ResolvePushTimelineRequest, onProgress: (progress: ResolvePushProgress) => void): Promise<ResolvePushTimelineResult> {
  const pathByAsset = new Map<string, string>()
  for (const { assetId, fingerprint } of request.assets) {
    const found = deps.lookupMedia(fingerprint)
    if (!found) throw new Error('A video is offline — relink it before creating a DaVinci timeline.')
    pathByAsset.set(assetId, found.path)
  }

  const uniquePaths = [...new Set(request.clips.map((clip) => pathByAsset.get(clip.assetId)!))]
  const total = 1 + Math.ceil(uniquePaths.length / IMPORT_BATCH) + Math.ceil(request.clips.length / APPEND_BATCH)
  let done = 0
  const progress = (phase: ResolvePushProgress['phase']) => { done += 1; onProgress({ done, total, phase }) }

  const created = await deps.bridge.request('createTimeline', {
    name: request.name, fps: formatResolveFps(request.fps), width: request.width, height: request.height,
  }, resolveCreateTimelineResultSchema, COMMAND_TIMEOUT_MS)
  progress('timeline')

  try {
    for (const batch of chunks(uniquePaths, IMPORT_BATCH)) {
      await deps.bridge.request('importMedia', { paths: batch }, resolveImportMediaResultSchema, COMMAND_TIMEOUT_MS)
      progress('media')
    }

    const errors: string[] = []
    for (const batch of chunks(request.clips, APPEND_BATCH)) {
      const { clips } = await deps.bridge.request('appendVideoClips', {
        timelineId: created.timelineId,
        clips: batch.map((clip) => ({
          filePath: pathByAsset.get(clip.assetId)!, trackIndex: clip.trackIndex,
          recordFrame: created.startFrame + clip.recordOffsetFrames,
          startFrame: clip.sourceStartFrame, endFrame: clip.sourceEndFrame,
        })),
      }, resolveAppendVideoClipsResultSchema, COMMAND_TIMEOUT_MS)
      for (const placed of clips) if (!placed.ok) errors.push(placed.error ?? 'A clip could not be placed.')
      progress('clips')
    }

    return {
      timelineId: created.timelineId, timelineName: created.name, projectName: created.projectName,
      startFrame: created.startFrame, fps: request.fps, width: request.width, height: request.height,
      note: created.note, errors,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Adding clips failed.'
    throw new Error(`A DaVinci timeline “${created.name}” was created, but ${message}`)
  }
}
