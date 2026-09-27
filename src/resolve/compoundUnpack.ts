import type { ResolveEditSkip, ResolveFps, ResolveTimelineEdit } from '../core/resolveIpc'
import { KIND_REASON, baseName } from './editToProject'
import { timelineFrameToUs, type ResolveFrameLink } from './frames'

type EditItem = ResolveTimelineEdit['items'][number]

/**
 * Unpacks a Resolve timeline's compound clips into their inner file clips, from the timeline's own OTIO export
 * (docs/plans/resolve-textplus/14-unpack-compound.md, ADR 0010). OTIO's shape is read defensively field by
 * field — anything this can't classify with confidence is reported in `skipped`, never guessed or dropped.
 *
 * Position bookkeeping: `global_start_time` and every `source_range` give a frame count at the node's own
 * rate, so everything is first turned into plain seconds (`toSeconds`), which composes safely across mixed
 * rates. A local coordinate's absolute Resolve frame is then computed **once, from that node's own known
 * anchor frame**, never by adding an already-rounded frame count to another — so nesting never accumulates
 * rounding (the brief's "convert each boundary on its own").
 */

type OtioRationalTime = { rate?: unknown; value?: unknown }
type OtioNode = {
  OTIO_SCHEMA?: unknown
  name?: unknown
  kind?: unknown
  source_range?: { start_time?: OtioRationalTime; duration?: OtioRationalTime } | null
  effects?: unknown
  metadata?: { Resolve_OTIO?: Record<string, unknown> } | null
  children?: unknown
  media_references?: Record<string, OtioMediaReference> | null
  media_reference?: OtioMediaReference | null
  active_media_reference_key?: unknown
  global_start_time?: OtioRationalTime
  tracks?: unknown
}
type OtioMediaReference = { OTIO_SCHEMA?: unknown; target_url?: unknown; available_range?: { start_time?: OtioRationalTime } | null }

const MAX_NESTING_DEPTH = 4

function asNode(value: unknown): OtioNode | null {
  return value !== null && typeof value === 'object' && typeof (value as OtioNode).OTIO_SCHEMA === 'string' ? (value as OtioNode) : null
}

function childrenOf(node: OtioNode): OtioNode[] {
  return Array.isArray(node.children) ? node.children.map(asNode).filter((child): child is OtioNode => child !== null) : []
}

function toSeconds(time: OtioRationalTime | null | undefined): number | null {
  const rate = typeof time?.rate === 'number' ? time.rate : null
  const value = typeof time?.value === 'number' ? time.value : null
  return rate !== null && value !== null && rate > 0 ? value / rate : null
}

function nameOf(node: OtioNode): string | null {
  return typeof node.name === 'string' && node.name.length > 0 ? node.name : null
}

function mediaReferenceOf(node: OtioNode): OtioMediaReference | null {
  const key = typeof node.active_media_reference_key === 'string' ? node.active_media_reference_key : 'DEFAULT_MEDIA'
  return node.media_references?.[key] ?? node.media_reference ?? null
}

/** True for a `Clip.2` (ADR 0010; `Clip.1` is accepted too, defensively) whose media reference is a real,
 * local file, i.e. one `unpackCompounds` could turn into a KathaCut clip. */
function hasFileReference(node: OtioNode): boolean {
  const schema = typeof node.OTIO_SCHEMA === 'string' ? node.OTIO_SCHEMA : ''
  if (!schema.startsWith('Clip.')) return false
  const ref = mediaReferenceOf(node)
  return !!ref && typeof ref.target_url === 'string' && ref.target_url.length > 0 && ref.OTIO_SCHEMA !== 'MissingReference.1'
}

/** A video track "inside" a compound only counts toward the "several video tracks" check if it actually holds
 * real media (ADR 0010's suggestion): a track with only a Text+ title doesn't stop the compound being unpacked. */
function hasMediaClip(node: OtioNode, depth: number): boolean {
  if (depth > MAX_NESTING_DEPTH) return false
  for (const child of childrenOf(node)) {
    if (hasFileReference(child)) return true
    if (child.OTIO_SCHEMA === 'Stack.1' && hasMediaClip(child, depth + 1)) return true
  }
  return false
}

/** ADR 0010, "Retime: unconfirmed" — treated conservatively (over-skipping is the safe direction). Flags a
 * named "Retime and Scaling" effect that actually has parameters (at 100% speed its parameter list is empty),
 * or an OTIO time-warp effect schema. */
function isRetimed(node: OtioNode): boolean {
  const effects = Array.isArray(node.effects) ? node.effects : []
  for (const raw of effects) {
    const effect = asNode(raw)
    if (!effect) continue
    const schema = typeof effect.OTIO_SCHEMA === 'string' ? effect.OTIO_SCHEMA : ''
    if (/LinearTimeWarp|FreezeFrame|TimeEffect/.test(schema)) return true
    const info = effect.metadata?.Resolve_OTIO
    const parameters = info?.['Parameters']
    if (info?.['Effect Name'] === 'Retime and Scaling' && Array.isArray(parameters) && parameters.length > 0) return true
  }
  return false
}

/** Decodes an OTIO `target_url` into an OS path (ADR 0010): Resolve on Windows writes a plain path as-is; a
 * `file://` URL (in case another platform/version writes one) is percent-decoded and its leading slash before
 * a drive letter is stripped. Anything else isn't a local file. */
function decodeTargetUrl(url: string): string | null {
  if (!url.startsWith('file://')) return url
  try {
    let rest = url.slice('file://'.length)
    if (rest.toLowerCase().startsWith('localhost')) rest = rest.slice('localhost'.length)
    rest = decodeURIComponent(rest)
    if (/^\/[A-Za-z]:/.test(rest)) rest = rest.slice(1)
    return rest.length > 0 ? rest : null
  } catch { return null }
}

function isCompoundStack(node: OtioNode): boolean {
  return node.OTIO_SCHEMA === 'Stack.1' && node.metadata?.Resolve_OTIO?.['Sequence Type'] === 'Compound Clip'
}

function videoTracksOf(stack: OtioNode): OtioNode[] {
  return childrenOf(stack).filter((child) => child.OTIO_SCHEMA === 'Track.1' && child.kind === 'Video')
}

/** One outer video track's direct children, each tagged with its position within that track measured from
 * the track's own start (seconds) — the same "sum of the earlier siblings' durations" rule ADR 0010 gives for
 * both the outer timeline (starting at `global_start_time`) and a compound's own inner tracks (starting at 0). */
function positionedChildren(track: OtioNode, startSeconds: number): { startSec: number; durationSec: number; node: OtioNode }[] {
  let pos = startSeconds
  const out: { startSec: number; durationSec: number; node: OtioNode }[] = []
  for (const node of childrenOf(track)) {
    const durationSec = toSeconds(node.source_range?.duration) ?? 0
    out.push({ startSec: pos, durationSec, node })
    pos += durationSec
  }
  return out
}

const frameFromSeconds = (seconds: number, fps: ResolveFps) => Math.round(seconds * fps.num / fps.den)

/** Finds the OTIO `Stack` a `kind: 'compound'` item corresponds to (ADR 0010's matching rule): the *n*-th
 * `Track` of `kind: 'Video'` under `tracks`, then a `Stack` child whose accumulated position matches the
 * item's `recordStart` within one outer-timeline frame. Name is checked too when both sides have one. Returns
 * `null` when nothing matches — the item is left as it is, to be skipped later with its existing reason. */
function findCompoundStack(doc: OtioNode, item: EditItem, fps: ResolveFps, used: Set<OtioNode>): OtioNode | null {
  const timelineTracks = asNode(doc.tracks)
  if (!timelineTracks || item.recordStart === null) return null
  const globalStartSec = toSeconds(doc.global_start_time) ?? 0
  const videoTracks = videoTracksOf(timelineTracks)
  const track = videoTracks[item.trackIndex - 1]
  if (!track) return null
  for (const entry of positionedChildren(track, globalStartSec)) {
    if (used.has(entry.node) || !isCompoundStack(entry.node)) continue
    const itemName = item.name
    const nodeName = nameOf(entry.node)
    if (itemName && nodeName && itemName !== nodeName) continue
    if (Math.abs(frameFromSeconds(entry.startSec, fps) - item.recordStart) > 1) continue
    return entry.node
  }
  return null
}

/** ADR 0010's window-verification check: the Stack's own `source_range.duration` (what it exposes of its
 * inner content) must match the compound item's outer record length, or its contents can't be trusted. */
function windowMatchesRecordLength(stack: OtioNode, item: EditItem, fps: ResolveFps): boolean {
  if (item.recordStart === null || item.recordEnd === null) return false
  const durationSec = toSeconds(stack.source_range?.duration)
  if (durationSec === null) return false
  const windowFrames = frameFromSeconds(durationSec, fps)
  return Math.abs(windowFrames - (item.recordEnd - item.recordStart)) <= 1
}

type WalkResult = { clips: EditItem[]; skips: ResolveEditSkip[] }

function skipEntry(item: EditItem, link: ResolveFrameLink, outerFrame: number, name: string, reason: string): ResolveEditSkip {
  return { track: `V${item.trackIndex}`, name, startUs: timelineFrameToUs(outerFrame, link), reason }
}

/**
 * Walks one compound's (or nested compound's) video track, clipping each child to the visible window and
 * converting boundaries via `toOuterFrame`/`toMediaFrame` (each one computed fresh, never by summing frame
 * deltas) into the outer timeline's frames and the media's own source frames. Nested compounds recurse
 * (depth <= 4); everything else that overlaps the window and can't be unpacked is reported in `skips`.
 */
function walkTrack(
  track: OtioNode, windowStart: number, windowEnd: number,
  toOuterFrame: (localSec: number) => number,
  item: EditItem, link: ResolveFrameLink, fps: ResolveFps, compoundName: string, depth: number,
): WalkResult {
  const clips: EditItem[] = []
  const skips: ResolveEditSkip[] = []
  const inside = (reason: string) => `${reason} (inside ${compoundName})`

  for (const entry of positionedChildren(track, 0)) {
    const childStart = entry.startSec
    const childEnd = entry.startSec + entry.durationSec
    const overlapStart = Math.max(childStart, windowStart)
    const overlapEnd = Math.min(childEnd, windowEnd)
    if (overlapEnd <= overlapStart) continue
    const node = entry.node
    const schema = typeof node.OTIO_SCHEMA === 'string' ? node.OTIO_SCHEMA : ''
    if (schema === 'Gap.1') continue
    const nodeName = nameOf(node) ?? 'Untitled clip'

    const outerStart = toOuterFrame(overlapStart)
    const outerEnd = toOuterFrame(overlapEnd)
    if (outerEnd <= outerStart) continue

    if (schema === 'Stack.1') {
      if (!isCompoundStack(node) || depth >= MAX_NESTING_DEPTH) {
        skips.push(skipEntry(item, link, outerStart, nodeName, inside(KIND_REASON.compound)))
        continue
      }
      const nestedWindowStart = toSeconds(node.source_range?.start_time) ?? 0
      const nestedWindowDuration = toSeconds(node.source_range?.duration)
      const nestedWindowEnd = nestedWindowStart + (nestedWindowDuration ?? (overlapEnd - overlapStart))
      const clippedNestedStart = nestedWindowStart + (overlapStart - childStart)
      const clippedNestedEnd = nestedWindowStart + (overlapEnd - childStart)
      const nestedToOuterFrame = (localSec: number) => toOuterFrame(childStart + (localSec - nestedWindowStart))
      const nestedVideoTracks = videoTracksOf(node)
      const qualifying = nestedVideoTracks.filter((t) => hasMediaClip(t, depth + 1))
      if (qualifying.length > 1) {
        skips.push(skipEntry(item, link, outerStart, nodeName, inside('Compound clip with several video tracks inside')))
        continue
      }
      for (const nestedTrack of nestedVideoTracks) {
        const result = walkTrack(nestedTrack, Math.max(clippedNestedStart, nestedWindowStart), Math.min(clippedNestedEnd, nestedWindowEnd),
          nestedToOuterFrame, item, link, fps, compoundName, depth + 1)
        clips.push(...result.clips)
        skips.push(...result.skips)
      }
      continue
    }

    if (!schema.startsWith('Clip.')) {
      skips.push(skipEntry(item, link, outerStart, nodeName, inside(KIND_REASON.unknown)))
      continue
    }

    const ref = mediaReferenceOf(node)
    if (!ref) { skips.push(skipEntry(item, link, outerStart, nodeName, inside(KIND_REASON.unknown))); continue }
    if (ref.OTIO_SCHEMA === 'MissingReference.1' || typeof ref.target_url !== 'string' || ref.target_url.length === 0) {
      skips.push(skipEntry(item, link, outerStart, nodeName, inside(KIND_REASON.title)))
      continue
    }
    if (isRetimed(node)) { skips.push(skipEntry(item, link, outerStart, nodeName, inside(KIND_REASON.retimed))); continue }
    const filePath = decodeTargetUrl(ref.target_url)
    if (!filePath) { skips.push(skipEntry(item, link, outerStart, nodeName, inside(KIND_REASON.unknown))); continue }

    const clipSourceStartSec = toSeconds(node.source_range?.start_time)
    const availableStart = ref.available_range?.start_time
    const mediaFps = typeof availableStart?.rate === 'number' ? availableStart.rate : null
    const availableStartSec = toSeconds(availableStart)
    if (clipSourceStartSec === null || mediaFps === null || mediaFps <= 0 || availableStartSec === null) {
      skips.push(skipEntry(item, link, outerStart, nodeName, inside(KIND_REASON.unknown)))
      continue
    }
    const toMediaFrame = (localSec: number) => Math.round((clipSourceStartSec + (localSec - childStart) - availableStartSec) * mediaFps)
    const sourceStart = toMediaFrame(overlapStart)
    const sourceEnd = toMediaFrame(overlapEnd) - 1
    if (sourceEnd < sourceStart) { skips.push(skipEntry(item, link, outerStart, nodeName, inside(KIND_REASON.unknown))); continue }

    clips.push({
      trackIndex: item.trackIndex, recordStart: outerStart, recordEnd: outerEnd,
      sourceStart, sourceEnd, filePath, fileFps: String(mediaFps), clipType: null,
      name: `${compoundName} › ${nameOf(node) ?? baseName(filePath)}`, kind: 'file',
    })
  }
  return { clips, skips }
}

function compoundAudioKey(recordStart: number | null, name: string | null): string {
  return `${recordStart}|${name ?? ''}`
}

/** Removes the audio-track entries `readTimelineEdit` reports for compounds this pass consumed (spliced out of
 * `edit.items`): a compound also appears as its own `Stack` on the audio track (ADR 0010), so leaving its entry
 * in `audioItems` would report it a second time as "separate audio", when its inner files' own embedded audio
 * now comes in as linked audio for the unpacked clips, same as for any file clip. */
function removeConsumedAudio(edit: ResolveTimelineEdit, consumed: Set<string>): ResolveTimelineEdit['audioItems'] {
  return edit.audioItems.filter((audio) => !consumed.has(compoundAudioKey(audio.recordStart, audio.name)))
}

/** Called when the OTIO export, read or validation failed (docs/plans/resolve-textplus/14-unpack-compound.md,
 * main step): every compound is left exactly as `readTimelineEdit` reported it, except given this brief's own
 * reason instead of the generic "Compound clip or nested timeline". */
export function skipUnreadableCompounds(edit: ResolveTimelineEdit, fps: ResolveFps): { edit: ResolveTimelineEdit; skipped: ResolveEditSkip[] } {
  const link: ResolveFrameLink = { startFrame: edit.timeline.startFrame, fps }
  const skipped: ResolveEditSkip[] = []
  const consumed = new Set<string>()
  const items = edit.items.filter((item) => {
    if (item.kind !== 'compound') return true
    consumed.add(compoundAudioKey(item.recordStart, item.name))
    skipped.push({
      track: `V${item.trackIndex}`, name: item.name ?? 'Untitled clip',
      startUs: item.recordStart !== null && item.recordStart >= link.startFrame ? timelineFrameToUs(item.recordStart, link) : null,
      reason: 'Could not read the compound clip’s contents',
    })
    return false
  })
  return { edit: { ...edit, items, audioItems: removeConsumedAudio(edit, consumed) }, skipped }
}

/**
 * Unpacks every `kind: 'compound'` item in `edit` using its already-exported, already-validated OTIO document
 * (docs/plans/resolve-textplus/14-unpack-compound.md, ADR 0010). A compound with no matching OTIO stack is left
 * as it is, to be skipped later with its existing "Compound clip or nested timeline" reason. Everything else
 * this can't confidently unpack is reported in `skipped`, never dropped.
 */
export function unpackCompounds(edit: ResolveTimelineEdit, otio: unknown, fps: ResolveFps): { edit: ResolveTimelineEdit; skipped: ResolveEditSkip[] } {
  const link: ResolveFrameLink = { startFrame: edit.timeline.startFrame, fps }
  const doc = asNode(otio)
  const skipped: ResolveEditSkip[] = []
  const consumedStacks = new Set<OtioNode>()
  const consumedAudio = new Set<string>()
  const items: EditItem[] = []

  for (const item of edit.items) {
    if (item.kind !== 'compound' || item.recordStart === null || item.recordEnd === null || !doc) { items.push(item); continue }
    const stack = findCompoundStack(doc, item, fps, consumedStacks)
    if (!stack) { items.push(item); continue }
    consumedStacks.add(stack)
    const compoundName = item.name ?? 'Compound clip'
    const drop = (reason: string) => {
      consumedAudio.add(compoundAudioKey(item.recordStart, item.name))
      skipped.push({ track: `V${item.trackIndex}`, name: compoundName, startUs: timelineFrameToUs(item.recordStart!, link), reason })
    }

    if (!windowMatchesRecordLength(stack, item, fps)) { drop('Could not read the compound clip’s contents'); continue }
    const videoTracks = videoTracksOf(stack)
    const qualifying = videoTracks.filter((track) => hasMediaClip(track, 1))
    if (qualifying.length > 1) { drop('Compound clip with several video tracks inside'); continue }

    const windowStart = toSeconds(stack.source_range?.start_time) ?? 0
    const windowDuration = toSeconds(stack.source_range?.duration) ?? 0
    const windowEnd = windowStart + windowDuration
    const toOuterFrame = (localSec: number) => item.recordStart! + frameFromSeconds(localSec - windowStart, fps)

    consumedAudio.add(compoundAudioKey(item.recordStart, item.name))
    for (const track of videoTracks) {
      const result = walkTrack(track, windowStart, windowEnd, toOuterFrame, item, link, fps, compoundName, 1)
      items.push(...result.clips)
      skipped.push(...result.skips)
    }
  }

  return { edit: { ...edit, items, audioItems: removeConsumedAudio(edit, consumedAudio) }, skipped }
}
