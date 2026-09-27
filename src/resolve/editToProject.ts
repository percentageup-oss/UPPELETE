import type { SequenceFormat } from '../core/edit'
import { fittedFrameRate } from '../core/format'
import type { ResolveEditKind, ResolveEditSkip, ResolveTimelineEdit } from '../core/resolveIpc'
import { parseResolveFps, timelineFrameToUs } from './frames'

type Fps = { num: number; den: number }

/** One unique file from the edit, as main's probe saw it. */
export type InspectedForEdit =
  | { ok: true; kind: 'video' | 'image' | 'audio'; durationUs: number | null; frameRate: Fps | null }
  | { ok: false; message: string }

export type PlannedEditClip = {
  filePath: string
  trackIndex: number
  timelineStartUs: number
  sourceStartUs: number
  sourceEndUs: number
}

export type EditImportPlan = { clips: PlannedEditClip[]; unsupported: ResolveEditSkip[]; notImported: ResolveEditSkip[] }

export const KIND_REASON: Record<Exclude<ResolveEditKind, 'file'>, string> = {
  title: 'Title (KathaCut makes its own captions)',
  generator: 'Generator',
  fusion: 'Fusion clip or a clip with a Fusion effect',
  compound: 'Compound clip or nested timeline',
  multicam: 'Multicam clip',
  retimed: 'Retimed clip (speed change)',
  unknown: 'Could not read this clip',
}

const framesToUs = (frames: number, fps: Fps) => timelineFrameToUs(frames, { startFrame: 0, fps })
export const baseName = (filePath: string) => filePath.split(/[\\/]/).pop() || filePath

function sourceFpsOf(raw: string | null, fallback: Fps | null): Fps | null {
  if (raw) {
    try { return parseResolveFps(raw) } catch { /* use the probe's rate */ }
  }
  return fallback
}

/**
 * Maps a Resolve timeline's video items onto KathaCut clips (docs/plans/resolve-textplus/11-import-edit.md,
 * ADR 0009). Record frames become sequence µs as an offset from the timeline's start frame, each boundary
 * converted on its own. The source in-point comes from `GetSourceStartFrame` in the file's own fps (counted
 * from its first frame); the source length is the record length, because `GetSourceEndFrame` is only accurate
 * to ±1 frame. `GetSourceEndFrame` is used only to spot a speed change. Everything that isn't a plain,
 * readable video file is returned in `unsupported` with a reason, never dropped.
 */
export function planEditImport(edit: ResolveTimelineEdit, fps: Fps, inspectedByPath: ReadonlyMap<string, InspectedForEdit>): EditImportPlan {
  const link = { startFrame: edit.timeline.startFrame, fps }
  const clips: PlannedEditClip[] = []
  const unsupported: ResolveEditSkip[] = []

  for (const item of edit.items) {
    const name = item.name ?? (item.filePath ? baseName(item.filePath) : 'Untitled clip')
    const placed = item.recordStart !== null && item.recordEnd !== null && item.recordStart >= link.startFrame && item.recordEnd > item.recordStart
    const startUs = placed ? timelineFrameToUs(item.recordStart!, link) : null
    const skip = (reason: string) => { unsupported.push({ track: `V${item.trackIndex}`, name, startUs, reason }) }
    if (!placed) { skip('Its position on the timeline could not be read'); continue }
    if (item.kind !== 'file') { skip(KIND_REASON[item.kind]); continue }
    if (!item.filePath) { skip(KIND_REASON.unknown); continue }

    const inspected = inspectedByPath.get(item.filePath)
    if (!inspected) { skip('File missing'); continue }
    if (!inspected.ok) { skip(inspected.message); continue }
    if (inspected.kind !== 'video') { skip(inspected.kind === 'image' ? 'Still image (not imported yet)' : 'Audio-only file on a video track'); continue }
    if (inspected.durationUs === null || inspected.durationUs <= 0) { skip('The file’s duration could not be read'); continue }
    const sourceFps = sourceFpsOf(item.fileFps, inspected.frameRate)
    if (!sourceFps || item.sourceStart === null || item.sourceStart < 0) { skip('Its source range could not be read'); continue }

    const timelineStartUs = startUs!
    const lengthUs = timelineFrameToUs(item.recordEnd!, link) - timelineStartUs
    if (item.sourceEnd !== null) {
      const sourceSpanUs = framesToUs(Math.max(0, item.sourceEnd - item.sourceStart + 1), sourceFps)
      const toleranceUs = Math.max(framesToUs(2, sourceFps), framesToUs(2, fps))
      if (Math.abs(sourceSpanUs - lengthUs) > toleranceUs) { skip(KIND_REASON.retimed); continue }
    }

    let sourceStartUs = framesToUs(item.sourceStart, sourceFps)
    let sourceEndUs = sourceStartUs + lengthUs
    // Clamp to the media, keeping the clip's length (and so its place in the sequence) where the file allows.
    if (sourceEndUs > inspected.durationUs) {
      sourceEndUs = inspected.durationUs
      sourceStartUs = Math.max(0, sourceEndUs - lengthUs)
    }
    if (sourceEndUs <= sourceStartUs) { skip('Its source range is outside the file'); continue }
    clips.push({ filePath: item.filePath, trackIndex: item.trackIndex, timelineStartUs, sourceStartUs, sourceEndUs })
  }

  // A video clip's embedded audio also sits on an audio track; only audio with no matching video item is separate.
  const videoKey = (recordStart: number | null, filePath: string | null, name: string | null) => `${recordStart}|${filePath ?? name ?? ''}`
  const videoKeys = new Set(edit.items.map((item) => videoKey(item.recordStart, item.filePath, item.name)))
  const notImported: ResolveEditSkip[] = edit.audioItems
    .filter((item) => !videoKeys.has(videoKey(item.recordStart, item.filePath, item.name)))
    .map((item) => ({
      track: `A${item.trackIndex}`,
      name: item.name ?? (item.filePath ? baseName(item.filePath) : 'Untitled clip'),
      startUs: item.recordStart !== null && item.recordStart >= link.startFrame ? timelineFrameToUs(item.recordStart, link) : null,
      reason: 'Separate audio-track clip (not imported yet)',
    }))

  return { clips, unsupported, notImported }
}

/** The KathaCut sequence frame that matches the Resolve timeline, so synced captions land where they were placed.
 * Same size rule as `formatFromMedia` (even, long side ≤ 3840). */
export function sequenceFormatForTimeline(timeline: { width: number; height: number; fps: Fps }): SequenceFormat | null {
  if (!(timeline.width > 0 && timeline.height > 0)) return null
  const scale = Math.min(1, 3840 / Math.max(timeline.width, timeline.height))
  const even = (value: number) => Math.max(16, Math.round(value * scale / 2) * 2)
  return { width: even(timeline.width), height: even(timeline.height), frameRate: fittedFrameRate({ numerator: timeline.fps.num, denominator: timeline.fps.den }) }
}
