import type { AudioClip, BlurRegion, Clip, ImageClip, LegacyAudioClip, LegacyClip, ProjectAsset, Track } from './edit'
import { formatFromMedia } from './format'
import type { CaptionProjectV4 } from './model'
import { normalizeClips, type TimeRange } from './timelineModel'

/**
 * Schema 4 → 5 (docs/EDITING.md "Migration 4 → 5"). Schema 4's flat `clips` list — array index is
 * position, clips always touch — becomes absolute positions on a `V1` track; overlays become image
 * clips on tracks above it; sound effects move from source-time anchors to sequence time on audio
 * tracks. Cues are untouched.
 *
 * **A migrated project is exactly gapless by construction** (V1's clips sit at the running prefix
 * sums), which is what makes the export parity argument structural: a migrated single-video project
 * still exports through manifest v2's byte-identical route.
 *
 * Nothing is dropped. An overlay or sound effect whose anchor schema 4 no longer played (inside a
 * removed range) is **parked** on a muted, hidden track at its best-guess position, and every such
 * case — plus every lossy duration resolution — is reported so the app can say so.
 */
export type MigrationNote = {
  kind: 'parked' | 'split' | 'duration-resolved' | 'duration-placeholder' | 'duration-clamped' | 'blur-moved'
  itemId: string
  message: string
}

/** A sound effect whose asset's length was never probed plays this long, as schema 4 did. */
const PLACEHOLDER_SFX_US = 1_000_000

type SequencePoint = { sequenceUs: number; kept: boolean }
type Span = TimeRange & { sourceStartUs: number; sourceEndUs: number }

const lengthOf = (range: TimeRange) => range.endUs - range.startUs

// ------ Schema 4's own mapping rules, kept private here: the migration is their last consumer. ------

/** Schema 4's `spansInSequenceForAsset`: one span per clip of the asset, in sequence order. */
function spansForAsset(range: TimeRange, assetId: string, clips: readonly LegacyClip[]): Span[] {
  const spans: Span[] = []
  let elapsed = 0
  for (const clip of clips) {
    if (clip.assetId === assetId) {
      const startUs = Math.max(range.startUs, clip.startUs)
      const endUs = Math.min(range.endUs, clip.endUs)
      if (endUs > startUs) spans.push({ startUs: elapsed + (startUs - clip.startUs), endUs: elapsed + (endUs - clip.startUs), sourceStartUs: startUs, sourceEndUs: endUs })
    }
    elapsed += lengthOf(clip)
  }
  return spans
}

/** Schema 4's `sourceToSequenceForAsset`: the first clip containing the time wins; outside every
 * clip it collapses to the preceding cut instant (or the asset's first clip start). */
function sourceToSequence(assetId: string, sourceUs: number, clips: readonly LegacyClip[]): SequencePoint {
  const at = Math.round(sourceUs)
  let elapsed = 0
  let firstStart: number | null = null
  let bestEndUs = -Infinity
  let before: number | null = null
  for (const clip of clips) {
    if (clip.assetId === assetId) {
      if (at >= clip.startUs && at < clip.endUs) return { sequenceUs: elapsed + (at - clip.startUs), kept: true }
      if (firstStart === null) firstStart = elapsed
      if (clip.endUs <= at && clip.endUs > bestEndUs) { bestEndUs = clip.endUs; before = elapsed + lengthOf(clip) }
    }
    elapsed += lengthOf(clip)
  }
  return { sequenceUs: before ?? firstStart ?? 0, kept: false }
}

/** Contiguous spans (a range straddling a cut collapses to touching spans) become one range. */
function mergeRuns(spans: readonly TimeRange[]): TimeRange[] {
  const runs: TimeRange[] = []
  for (const span of [...spans].sort((a, b) => a.startUs - b.startUs)) {
    const last = runs[runs.length - 1]
    if (last && last.endUs === span.startUs) last.endUs = span.endUs
    else runs.push({ startUs: span.startUs, endUs: span.endUs })
  }
  return runs
}

const overlaps = (a: readonly TimeRange[], b: readonly TimeRange[]) =>
  a.some((x) => b.some((y) => x.startUs < y.endUs && y.startUs < x.endUs))

/** Greedy interval packing: the lowest lane whose ranges none of `ranges` intersects. */
function packInto(lanes: TimeRange[][], ranges: readonly TimeRange[]): number {
  let lane = lanes.findIndex((occupied) => !overlaps(occupied, ranges))
  if (lane < 0) { lane = lanes.length; lanes.push([]) }
  lanes[lane].push(...ranges)
  return lane
}

const track = (id: string, kind: Track['kind'], extra: Partial<Track> = {}): Track =>
  ({ id, kind, name: '', muted: false, hidden: false, locked: false, ...extra })

const PARKED_NAME = 'Parked by migration'

/** The single-clip-era primary video: the first clip's asset, else the first video asset. */
function primaryVideo(project: CaptionProjectV4): ProjectAsset | undefined {
  const first = project.clips[0]
  return (first && project.assets.find((asset) => asset.id === first.assetId && asset.kind === 'video'))
    ?? project.assets.find((asset) => asset.kind === 'video')
}

function sfxLength(clip: LegacyAudioClip, asset: ProjectAsset | undefined, notes: MigrationNote[], name: string): { startUs: number; endUs: number } {
  const assetUs = asset?.metadata?.durationUs ?? null
  let length = clip.durationUs
  if (length === null) {
    if (assetUs !== null) {
      length = Math.max(1, assetUs - clip.inPointUs)
      notes.push({ kind: 'duration-resolved', itemId: clip.id, message: `${name} now has an explicit out point at the end of its file.` })
    } else {
      length = PLACEHOLDER_SFX_US
      notes.push({ kind: 'duration-placeholder', itemId: clip.id, message: `${name}’s file length was never read, so it was given a one-second placeholder; trim it once the file is relinked.` })
    }
  }
  let startUs = clip.inPointUs
  let endUs = startUs + length
  if (assetUs !== null && endUs > assetUs) {
    endUs = assetUs
    if (endUs <= startUs) startUs = Math.max(0, endUs - Math.min(length, assetUs))
    notes.push({ kind: 'duration-clamped', itemId: clip.id, message: `${name} ran past the end of its file and was shortened to fit.` })
  }
  return { startUs, endUs: Math.max(endUs, startUs + 1) }
}

export function migrateV4(project: CaptionProjectV4, newId: () => string): { project: Record<string, unknown>; notes: MigrationNote[] } {
  const { overlays, audioClips, clips: oldClips, blurRegions: oldBlur, schemaVersion: _version, ...rest } = project
  const notes: MigrationNote[] = []
  const assets = new Map(project.assets.map((asset) => [asset.id, asset]))
  const assetName = (id: string, fallback: string) => assets.get(id)?.name ?? fallback

  // 1. Tracks, and 2. schema 4's clips on V1 at their prefix sums — gapless by construction.
  const v1 = track(newId(), 'video')
  const clips: Clip[] = []
  let elapsed = 0
  for (const clip of oldClips) {
    clips.push({ kind: 'video', id: clip.id, trackId: v1.id, assetId: clip.assetId, timelineStartUs: elapsed, sourceStartUs: clip.startUs, sourceEndUs: clip.endUs, opacity: 1, fit: 'contain', gain: 1 })
    elapsed += lengthOf(clip)
  }

  // Where a source-time range of schema 4 lands in the sequence. With no clips there was no video,
  // so the sequence simply was source time.
  const runsOf = (range: TimeRange, mediaAssetId: string | undefined): TimeRange[] =>
    mediaAssetId && oldClips.length ? mergeRuns(spansForAsset(range, mediaAssetId, oldClips)) : [{ startUs: range.startUs, endUs: range.endUs }]
  const pointOf = (sourceUs: number, mediaAssetId: string | undefined): SequencePoint =>
    mediaAssetId && oldClips.length ? sourceToSequence(mediaAssetId, sourceUs, oldClips) : { sequenceUs: sourceUs, kept: true }

  // 3. Overlays → image clips. Array order was the stacking order (later on top), so each overlay
  // goes on the lowest overlay track above every earlier overlay it overlaps in the sequence: current
  // preview stacking is preserved exactly and no track holds two overlapping clips.
  const overlayLevels: TimeRange[][] = []
  const placedOverlays: { level: number; ranges: TimeRange[] }[] = []
  const parkedVideo: TimeRange[][] = []
  const imageClips: { level: number | null; parkedLane: number | null; clip: Omit<ImageClip, 'trackId'> }[] = []
  for (const overlay of overlays) {
    const name = assetName(overlay.assetId, 'An overlay')
    const runs = runsOf(overlay, overlay.mediaAssetId)
    const base = { kind: 'image' as const, assetId: overlay.assetId, rect: overlay.rect, opacity: overlay.opacity, fit: overlay.fit }
    if (!runs.length) {
      const startUs = pointOf(overlay.startUs, overlay.mediaAssetId).sequenceUs
      const range = { startUs, endUs: startUs + lengthOf(overlay) }
      const lane = packInto(parkedVideo, [range])
      imageClips.push({ level: null, parkedLane: lane, clip: { ...base, id: overlay.id, timelineStartUs: range.startUs, sourceStartUs: 0, sourceEndUs: lengthOf(range) } })
      notes.push({ kind: 'parked', itemId: overlay.id, message: `${name} sat entirely inside a removed range, so it was parked on a hidden track instead of being deleted.` })
      continue
    }
    const level = placedOverlays.filter((placed) => overlaps(placed.ranges, runs)).reduce((max, placed) => Math.max(max, placed.level + 1), 0)
    while (overlayLevels.length <= level) overlayLevels.push([])
    overlayLevels[level].push(...runs)
    placedOverlays.push({ level, ranges: runs })
    runs.forEach((run, index) => imageClips.push({ level, parkedLane: null, clip: { ...base, id: index === 0 ? overlay.id : newId(), timelineStartUs: run.startUs, sourceStartUs: 0, sourceEndUs: lengthOf(run) } }))
    if (runs.length > 1) notes.push({ kind: 'split', itemId: overlay.id, message: `${name} spanned reordered or repeated clips and became ${runs.length} image clips.` })
  }
  const overlayTracks = overlayLevels.map(() => track(newId(), 'video'))
  const parkedVideoTracks = parkedVideo.map(() => track(newId(), 'video', { name: PARKED_NAME, hidden: true, muted: true }))
  for (const entry of imageClips) {
    const trackId = entry.level !== null ? overlayTracks[entry.level].id : parkedVideoTracks[entry.parkedLane!].id
    clips.push({ ...entry.clip, trackId })
  }

  // 4. Sound effects → audio clips in sequence time, lane-packed onto A1..An, so a music bed
  // survives reordering or deleting the video it was anchored in.
  const audioLanes: TimeRange[][] = []
  const parkedAudio: TimeRange[][] = []
  const audioPlaced: { lane: number; parked: boolean; clip: Omit<AudioClip, 'trackId'> }[] = []
  for (const clip of [...audioClips].sort((a, b) => a.atUs - b.atUs || a.id.localeCompare(b.id))) {
    const name = assetName(clip.assetId, 'A sound effect')
    const source = sfxLength(clip, assets.get(clip.assetId), notes, name)
    const point = pointOf(clip.atUs, clip.mediaAssetId)
    const range = { startUs: point.sequenceUs, endUs: point.sequenceUs + lengthOf(source) }
    const parked = !point.kept
    const lane = packInto(parked ? parkedAudio : audioLanes, [range])
    audioPlaced.push({ lane, parked, clip: { kind: 'audio', id: clip.id, assetId: clip.assetId, timelineStartUs: range.startUs, sourceStartUs: source.startUs, sourceEndUs: source.endUs, gain: clip.gain } })
    if (parked) notes.push({ kind: 'parked', itemId: clip.id, message: `${name} was anchored inside a removed range and did not play, so it was parked on a muted track instead of being deleted.` })
  }
  const audioTracks = (audioLanes.length ? audioLanes : [[]]).map(() => track(newId(), 'audio'))
  const parkedAudioTracks = parkedAudio.map(() => track(newId(), 'audio', { name: PARKED_NAME, muted: true }))
  for (const entry of audioPlaced) clips.push({ ...entry.clip, trackId: (entry.parked ? parkedAudioTracks : audioTracks)[entry.lane].id })

  // 5. Blur regions: the same span rule, `mediaAssetId` dropped — a blur is an effect over the
  // composited program. In practice this never fires: export still refuses blur and there is no UI
  // entry point, so `blurRegions` is empty in every real file.
  const blurRegions: BlurRegion[] = []
  for (const region of oldBlur) {
    const runs = runsOf(region, region.mediaAssetId)
    const shape = { rect: region.rect, radius: region.radius }
    if (!runs.length) {
      const startUs = pointOf(region.startUs, region.mediaAssetId).sequenceUs
      blurRegions.push({ id: region.id, startUs, endUs: startUs + lengthOf(region), ...shape })
      notes.push({ kind: 'blur-moved', itemId: region.id, message: 'A blur region inside a removed range was moved to the cut instead of being deleted.' })
      continue
    }
    runs.forEach((run, index) => blurRegions.push({ id: index === 0 ? region.id : newId(), ...run, ...shape }))
  }

  // 6. Cues are untouched. 7. `format` is byte for byte what `planFromMedia` produced from the
  // primary video — the export parity hinge.
  const format = formatFromMedia(primaryVideo(project)?.metadata)
  const tracks = [v1, ...overlayTracks, ...parkedVideoTracks, ...audioTracks, ...parkedAudioTracks]
  return {
    project: { ...rest, schemaVersion: 5, tracks, clips: normalizeClips(tracks, clips), blurRegions: blurRegions.sort((a, b) => a.startUs - b.startUs || a.id.localeCompare(b.id)), ...(format ? { format } : {}) },
    notes,
  }
}
