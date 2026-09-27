import { stat } from 'node:fs/promises'
import { classifyMedia } from '../../src/core/assetKind'
import {
  resolveTimelineEditSchema, resolveTimelineInfoSchema,
  type ResolveImportEditProgress, type ResolveImportEditResult, type ResolveInspectedVideo,
} from '../../src/core/resolveIpc'
import { planEditImport, type InspectedForEdit } from '../../src/resolve/editToProject'
import { parseResolveFps } from '../../src/resolve/frames'
import type { MediaCandidate } from '../projectMedia'
import type { ResolveBridge } from './bridge'

export type ImportTimelineEditDeps = {
  bridge: ResolveBridge
  /** main.ts's `inspectMedia`: probes and registers the file in `inspectedMedia` (as `dialog:open-video` does). */
  inspect(filePath: string): Promise<MediaCandidate>
}

const READ_TIMEOUT_MS = 30_000
const UNREADABLE = 'Unreadable format (e.g. BRAW/R3D)'

async function isFile(filePath: string): Promise<boolean> {
  try { return (await stat(filePath)).isFile() } catch { return false }
}

/**
 * Import the Resolve timeline's edit from its original files (docs/plans/resolve-textplus/11-import-edit.md).
 * Every path comes from Resolve through the bridge, never from the renderer, and files are only read.
 */
export async function importTimelineEdit(deps: ImportTimelineEditDeps, onProgress: (progress: ResolveImportEditProgress) => void): Promise<ResolveImportEditResult> {
  const info = await deps.bridge.request('timelineInfo', {}, resolveTimelineInfoSchema)
  const edit = await deps.bridge.request('readTimelineEdit', { timelineId: info.timelineId }, resolveTimelineEditSchema, READ_TIMEOUT_MS)
  const fps = parseResolveFps(edit.timeline.frameRate)

  const paths = [...new Set(edit.items.flatMap((item) => item.kind === 'file' && item.filePath ? [item.filePath] : []))]
  const inspectedByPath = new Map<string, InspectedForEdit>()
  const candidates = new Map<string, MediaCandidate>()
  onProgress({ done: 0, total: paths.length })
  for (const [index, filePath] of paths.entries()) {
    if (!await isFile(filePath)) inspectedByPath.set(filePath, { ok: false, message: 'File missing' })
    else {
      try {
        const candidate = await deps.inspect(filePath)
        const metadata = candidate.media.metadata
        const kind = metadata ? classifyMedia(metadata) : null
        if (!metadata || !kind) inspectedByPath.set(filePath, { ok: false, message: UNREADABLE })
        else {
          const rate = metadata.nominalFrameRate ?? metadata.frameRate
          inspectedByPath.set(filePath, { ok: true, kind, durationUs: metadata.durationUs, frameRate: rate ? { num: rate.numerator, den: rate.denominator } : null })
          if (kind === 'video') candidates.set(filePath, candidate)
        }
      } catch { inspectedByPath.set(filePath, { ok: false, message: UNREADABLE }) }
    }
    onProgress({ done: index + 1, total: paths.length })
  }

  const plan = planEditImport(edit, fps, inspectedByPath)
  const assets: ResolveInspectedVideo[] = []
  const assetIndexByPath = new Map<string, number>()
  const clips = plan.clips.map(({ filePath, ...clip }) => {
    let assetIndex = assetIndexByPath.get(filePath)
    if (assetIndex === undefined) {
      const candidate = candidates.get(filePath)!
      assetIndex = assets.length
      assetIndexByPath.set(filePath, assetIndex)
      assets.push({ ok: true, kind: 'video', media: candidate.media, url: candidate.url })
    }
    return { assetIndex, ...clip }
  })

  return { timeline: { ...edit.timeline, fps }, assets, clips, unsupported: plan.unsupported, notImported: plan.notImported, truncated: edit.truncated }
}
