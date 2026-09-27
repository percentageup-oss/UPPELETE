import { readFile, rm, stat } from 'node:fs/promises'
import { classifyMedia } from '../../src/core/assetKind'
import {
  resolveExportOtioResultSchema, resolveOtioDocumentSchema, resolveTimelineEditSchema, resolveTimelineInfoSchema,
  type ResolveEditSkip, type ResolveFps, type ResolveImportEditProgress, type ResolveImportEditResult,
  type ResolveInspectedVideo, type ResolveTimelineEdit,
} from '../../src/core/resolveIpc'
import { unpackCompounds, skipUnreadableCompounds } from '../../src/resolve/compoundUnpack'
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
/** Generously above anything a short-form editor's timeline should produce; guards against reading an
 * unbounded file into memory if Resolve ever writes something unexpectedly large. */
const MAX_OTIO_FILE_BYTES = 50 * 1024 * 1024

async function isFile(filePath: string): Promise<boolean> {
  try { return (await stat(filePath)).isFile() } catch { return false }
}

/**
 * Unpacks any compound clips in `edit` (docs/plans/resolve-textplus/14-unpack-compound.md, ADR 0010): the
 * scripting API can't open a compound directly, so its inner edit is read from the timeline's own OTIO
 * export. If the export, read or validation fails, every compound is left as it is but reported with this
 * brief's own reason rather than the generic "Compound clip or nested timeline" — the compound wasn't
 * necessarily unreadable, just its contents this time.
 */
async function unpackCompoundsIfAny(
  deps: ImportTimelineEditDeps, edit: ResolveTimelineEdit, timelineId: string, fps: ResolveFps,
): Promise<{ edit: ResolveTimelineEdit; skipped: ResolveEditSkip[] }> {
  if (!edit.items.some((item) => item.kind === 'compound')) return { edit, skipped: [] }
  let path: string | undefined
  try {
    const exported = await deps.bridge.request('exportTimelineOtio', { timelineId }, resolveExportOtioResultSchema)
    path = exported.path
    const stats = await stat(path)
    if (stats.size > MAX_OTIO_FILE_BYTES) throw new Error('The exported OTIO file is too large')
    const raw = JSON.parse(await readFile(path, 'utf8'))
    const otio = resolveOtioDocumentSchema.parse(raw)
    return unpackCompounds(edit, otio, fps)
  } catch {
    return skipUnreadableCompounds(edit, fps)
  } finally {
    if (path) await rm(path, { force: true })
  }
}

/**
 * Import the Resolve timeline's edit from its original files (docs/plans/resolve-textplus/11-import-edit.md).
 * Every path comes from Resolve through the bridge, never from the renderer, and files are only read.
 */
export async function importTimelineEdit(deps: ImportTimelineEditDeps, onProgress: (progress: ResolveImportEditProgress) => void): Promise<ResolveImportEditResult> {
  const info = await deps.bridge.request('timelineInfo', {}, resolveTimelineInfoSchema)
  const rawEdit = await deps.bridge.request('readTimelineEdit', { timelineId: info.timelineId }, resolveTimelineEditSchema, READ_TIMEOUT_MS)
  const fps = parseResolveFps(rawEdit.timeline.frameRate)
  const { edit, skipped: compoundSkipped } = await unpackCompoundsIfAny(deps, rawEdit, info.timelineId, fps)

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

  return {
    timeline: { ...edit.timeline, fps }, assets, clips,
    unsupported: [...compoundSkipped, ...plan.unsupported], notImported: plan.notImported, truncated: edit.truncated,
  }
}
