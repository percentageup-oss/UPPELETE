import path from 'node:path'
import {
  resolveDeleteClipsResultSchema, resolveFindTrackResultSchema, resolveInsertClipsResultSchema, resolveReadClipsResultSchema,
  resolveTimelineInfoSchema, resolveTrackResultSchema, resolveUpdateClipsResultSchema, resolveEmptyResultSchema,
  type ResolveSyncApplyRequest, type ResolveSyncPreview, type ResolveSyncPreviewRequest, type ResolveSyncProgress,
  type ResolveSyncResult, type ResolveSyncSpec,
} from '../../src/core/resolveIpc'
import { diffSync, planSync, replaceAllPlan, type RemoteClip, type SyncDiff, type SyncedEntry } from '../../src/resolve/syncDiff'
import { parseResolveFps, timelineFrameToTimecode } from '../../src/resolve/frames'
import { z } from 'zod'
import type { ResolveBridge } from './bridge'
import { bridgeResourcesDir } from './install'

/** The Text+ clip inside the `KathaCut` bin of `resources/resolve/kathacut-captions.drb` (exported by the user,
 * 2026-09-27; the bin also holds a `Timeline 1`, which is never used). */
const TEMPLATE_CLIP_NAME = 'Fusion Title'
const templatePath = () => path.join(bridgeResourcesDir(), 'kathacut-captions.drb')

/** ADR 0009: 100 Text+ clips placed + styled in ~1.3 s, so 50 stays well inside the ~2 s per-command target. */
const INSERT_BATCH = 50
const UPDATE_BATCH = 20
const DELETE_BATCH = 50
const COMMAND_TIMEOUT_MS = 30_000

const chunks = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = []
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size))
  return out
}

/** ADR 0011 ("Timing"): a Character Level Styling write costs ~0.5s of Resolve CPU time per clip (the
 * `ExportFusionComp`/`ImportFusionComp` round trip), well over the ~2s per-command budget beyond ~3 clips — so a
 * batch never carries more than `maxStyled` CLS clips, whatever `styled` says, even though plain clips still batch
 * at the full `maxTotal` size the ADR left unchanged. */
function chunkForCls<T>(items: T[], maxTotal: number, styled: (item: T) => boolean, maxStyled = 3): T[][] {
  const out: T[][] = []
  let current: T[] = []
  let styledCount = 0
  for (const item of items) {
    const isStyled = styled(item)
    if (current.length >= maxTotal || (isStyled && styledCount >= maxStyled)) {
      out.push(current); current = []; styledCount = 0
    }
    current.push(item)
    if (isStyled) styledCount++
  }
  if (current.length) out.push(current)
  return out
}

const bridgeSpec = (spec: ResolveSyncSpec) => ({
  key: spec.key, startFrame: spec.startFrame, endFrame: spec.endFrame, text: spec.text, inputs: spec.inputs,
  keyframes: spec.keyframes, styleRanges: spec.styleRanges,
})

async function readRemote(bridge: ResolveBridge, timelineId: string, trackName: string): Promise<{ trackIndex: number | null; clips: RemoteClip[] }> {
  const { trackIndex } = await bridge.request('findTrack', { timelineId, name: trackName }, resolveFindTrackResultSchema)
  if (trackIndex === null) return { trackIndex, clips: [] }
  const { clips } = await bridge.request('readClips', { timelineId, trackIndex }, resolveReadClipsResultSchema, COMMAND_TIMEOUT_MS)
  return { trackIndex, clips }
}

function previewOf(diff: SyncDiff<ResolveSyncSpec>, trackExists: boolean, trackClips: number): ResolveSyncPreview {
  return {
    trackExists, trackClips,
    insert: diff.insert.length, update: diff.update.length, replace: diff.replace.length, remove: diff.remove.length,
    unchanged: diff.unchanged, foreign: diff.foreign,
    conflicts: diff.conflicts.map(({ key, kind, clipId, resolveText, keptText, startFrame }) => ({
      key, kind, keptText,
      ...(clipId !== undefined ? { clipId } : {}),
      ...(resolveText !== undefined ? { resolveText } : {}),
      ...(startFrame !== undefined ? { startFrame } : {}),
    })),
  }
}

export async function previewSync(bridge: ResolveBridge, request: ResolveSyncPreviewRequest): Promise<ResolveSyncPreview> {
  const remote = await readRemote(bridge, request.timelineId, request.trackName)
  return previewOf(diffSync({ specs: request.specs, synced: request.synced, remote: remote.clips }), remote.trackIndex !== null, remote.clips.length)
}

/**
 * Applies a sync: recomputes the diff (or, with `replaceAll`, clears the track) from a fresh `readClips`, then template, track, deletes, inserts and updates
 * in batches. Stops at the first failing batch and returns the synced list for what actually happened, so
 * `resolveLink.synced` never claims a clip that isn't in Resolve.
 */
export async function applySync(bridge: ResolveBridge, request: ResolveSyncApplyRequest, onProgress: (progress: ResolveSyncProgress) => void): Promise<ResolveSyncResult> {
  const { timelineId, trackName } = request
  const remote = await readRemote(bridge, timelineId, trackName)
  const plan = request.replaceAll ? replaceAllPlan(request.specs, request.synced, remote.clips)
    : planSync(diffSync({ specs: request.specs, synced: request.synced, remote: remote.clips }), request.decisions)

  const errors: string[] = []
  const fontNotes = new Set<string>()
  const synced: SyncedEntry[] = [...plan.carried]
  // Entries whose clip is still in Resolve until its delete/update actually happens.
  const pendingUpdate = new Map(plan.update.map((item) => [item.clipId, request.synced.find((entry) => entry.key === item.spec.key)]))
  const pendingDelete = new Map<string, SyncedEntry | undefined>([
    ...plan.remove.map((item) => [item.clipId, item.previous] as const),
    ...plan.replace.map((item) => [item.clipId, item.previous] as const),
  ])
  const inserts = [...plan.insert, ...plan.replace.map((item) => item.spec)]
  const total = 2 + pendingDelete.size + inserts.length + plan.update.length
  let done = 0
  const progress = (phase: ResolveSyncProgress['phase'], step = 1) => { done += step; onProgress({ done, total, phase }) }

  const finish = (): ResolveSyncResult => {
    for (const previous of pendingDelete.values()) if (previous) synced.push(previous)
    for (const previous of pendingUpdate.values()) if (previous) synced.push(previous)
    return { synced, errors, ...(fontNotes.size ? { fontNotes: [...fontNotes] } : {}) }
  }

  try {
    onProgress({ done, total, phase: 'template' })
    if (inserts.length) await bridge.request('ensureTemplate', { timelineId, drbPath: templatePath(), clipName: TEMPLATE_CLIP_NAME }, z.strictObject({ imported: z.boolean() }), COMMAND_TIMEOUT_MS)
    progress('template')
    const trackIndex = remote.trackIndex ?? (inserts.length
      ? (await bridge.request('ensureTrack', { timelineId, name: trackName }, resolveTrackResultSchema)).trackIndex
      : null)
    progress('track')

    if (trackIndex !== null) {
      for (const batch of chunks([...pendingDelete.keys()], DELETE_BATCH)) {
        await bridge.request('deleteClips', { timelineId, trackIndex, clipIds: batch }, resolveDeleteClipsResultSchema, COMMAND_TIMEOUT_MS)
        for (const clipId of batch) pendingDelete.delete(clipId)
        progress('delete', batch.length)
      }

      for (const batch of chunkForCls(inserts, INSERT_BATCH, (spec) => spec.styleRanges.length > 0)) {
        const { clips } = await bridge.request('insertClips', { timelineId, trackIndex, templateName: TEMPLATE_CLIP_NAME, clips: batch.map(bridgeSpec) }, resolveInsertClipsResultSchema, COMMAND_TIMEOUT_MS)
        const specByKey = new Map(batch.map((spec) => [spec.key, spec]))
        let failed = 0
        for (const placed of clips) {
          const spec = specByKey.get(placed.key)
          if (!spec) continue
          if (placed.fontNote) fontNotes.add(placed.fontNote)
          if (placed.clipId === null || placed.startFrame === null || placed.endFrame === null) { failed++; errors.push(`${placed.key}: ${placed.error ?? 'not placed'}`); continue }
          if (placed.startFrame !== spec.startFrame || placed.endFrame !== spec.endFrame) {
            errors.push(`${placed.key}: placed at frames ${placed.startFrame}–${placed.endFrame} instead of ${spec.startFrame}–${spec.endFrame}`)
          }
          synced.push({ key: spec.key, clipId: placed.clipId, hash: spec.hash, startFrame: placed.startFrame, endFrame: placed.endFrame, text: spec.text })
        }
        progress('insert', batch.length)
        if (failed) throw new Error(`${failed} clip${failed === 1 ? '' : 's'} could not be placed in Resolve.`)
      }

      for (const batch of chunkForCls(plan.update, UPDATE_BATCH, (item) => item.spec.styleRanges.length > 0)) {
        const { clips } = await bridge.request('updateClips', { timelineId, trackIndex, clips: batch.map((item) => ({ clipId: item.clipId, spec: bridgeSpec(item.spec) })) }, resolveUpdateClipsResultSchema, COMMAND_TIMEOUT_MS)
        const errorById = new Map(clips.map((clip) => [clip.clipId, clip.error]))
        for (const clip of clips) if (clip.fontNote) fontNotes.add(clip.fontNote)
        let failed = 0
        for (const item of batch) {
          const error = errorById.get(item.clipId)
          if (error === null) {
            pendingUpdate.delete(item.clipId)
            synced.push({ key: item.spec.key, clipId: item.clipId, hash: item.spec.hash, startFrame: item.spec.startFrame, endFrame: item.spec.endFrame, text: item.spec.text })
          } else { failed++; errors.push(`${item.spec.key}: ${error ?? 'not updated'}`) }
        }
        progress('update', batch.length)
        if (failed) throw new Error(`${failed} clip${failed === 1 ? '' : 's'} could not be updated in Resolve.`)
      }
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'The sync stopped.')
  }
  return finish()
}

/** "Show in Resolve": moves Resolve's playhead to a clip's first frame. */
export async function jumpToFrame(bridge: ResolveBridge, timelineId: string, frame: number): Promise<void> {
  const info = await bridge.request('timelineInfo', {}, resolveTimelineInfoSchema)
  if (info.timelineId !== timelineId) throw new Error('Resolve has a different timeline open')
  const timecode = timelineFrameToTimecode(frame, parseResolveFps(info.frameRate), info.dropFrame)
  await bridge.request('jumpTo', { timelineId, timecode }, resolveEmptyResultSchema)
}
