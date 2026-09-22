import { z } from 'zod'
import { rationalSchema, type MediaMetadata, type Rational } from '../core/media'
import { projectSchema, type CaptionProject, type Cue } from '../core/model'
import {
  COMPOSITION_WIDTH, compositionRectSchema, sequenceFormatSchema, type Clip, type CompositionRect, type ProjectAsset, type SequenceFormat, type Track,
} from '../core/edit'
import { compositionScalarToPixels, compositionToPixels } from '../core/composition'
import { fittedFrameRate, formatAspect, formatFromMedia } from '../core/format'
import { activeCueAt, clipEndUs, type ActiveCue } from '../core/timelineModel'
import { frameRequestSchema, frameRequestV1Schema, type FrameRequest } from './frameRequest'
import { DEFAULT_CAPTION_STYLE, resolveCaptionMotion } from '../captions/style'
import { captionDisplaySchema, displayCue } from '../captions/wordDisplay'

/**
 * What main tells the media worker to render. Arbitrary FFmpeg flags never cross the worker
 * boundary — this versioned manifest does (docs/MEDIA_WORKER.md).
 *
 * v1 is X2's shipped shape. v2 is a strict superset adding the single-source edits: kept source
 * `segments`, image `overlays` (consumed by the export host, never by FFmpeg), `blurRegions`
 * already resolved to **output pixels and sequence time**, and sound-effect `audioClips` whose
 * delay is in sequence time. v3 is the multi-track timeline (docs/EDITING.md "Export — manifest
 * v3"): several inputs, clips at absolute sequence positions on stacked tracks. All three are
 * accepted so an in-flight job of any version is never broken.
 *
 * **Parity is a code path, not a coincidence.** `buildExportManifest` emits v2 — whose encoder
 * arguments are snapshot-pinned byte for byte — whenever the sequence is flat enough for it
 * (`flatSequence`), which includes every project migrated from schema 4 with one video. v3 is
 * emitted only for what v2 cannot express, and both routes are kept permanently.
 */
export const exportManifestV1Schema = z.strictObject({ version: z.literal(1), cues: projectSchema.shape.cues, style: frameRequestV1Schema.shape.style, display: captionDisplaySchema.optional() })

const manifestUs = z.number().int().nonnegative().safe()
const pixel = z.number().int().nonnegative().max(8192)

export const manifestSegmentSchema = z.strictObject({ startUs: manifestUs, endUs: manifestUs })
  .refine((range) => range.endUs > range.startUs, 'Segment end must follow its start')
export const manifestOverlaySchema = z.strictObject({
  id: z.string().min(1).max(128), startUs: manifestUs, endUs: manifestUs,
  assetUrl: z.string().min(1).max(32768), rect: compositionRectSchema,
  opacity: z.number().finite().min(0).max(1), fit: z.enum(['contain', 'cover', 'stretch']),
}).refine((overlay) => overlay.endUs > overlay.startUs, 'Overlay end must follow its start')
export const manifestBlurRegionSchema = z.strictObject({
  id: z.string().min(1).max(128),
  /** Sequence time, after any concat — exactly what an FFmpeg `enable` expression needs. */
  sequence: z.strictObject({ startUs: manifestUs, endUs: manifestUs }).refine((range) => range.endUs > range.startUs, 'Blur window end must follow its start'),
  /** Output pixels, already scaled and clamped by `compositionToPixels`. */
  rect: z.strictObject({ x: pixel, y: pixel, width: pixel.min(1), height: pixel.min(1) }),
  sigmaPx: z.number().finite().positive().max(1024),
})
// Mirrors `workers/media/protocol.ts`'s `filePath` (not imported from here — that module imports
// this one, and a cross-import would cycle). An asset path never comes from the project JSON at
// this point (see `buildExportManifest`'s `assetPath` callback), but the shape is validated the
// same way every other worker-bound path is.
const manifestAudioClipPath = z.string().min(1).max(32768)
  .refine((s) => !s.includes('\0'), 'NUL in path')
  .refine((s) => s.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(s) || /^\\\\[^\\]+\\[^\\]+/.test(s), 'Path must be absolute')
export const manifestAudioClipSchema = z.strictObject({
  id: z.string().min(1).max(128), path: manifestAudioClipPath,
  /** Sequence time, so `adelay` needs no further mapping. */
  delayUs: manifestUs, inPointUs: manifestUs,
  durationUs: z.number().int().positive().safe().nullable(), gain: z.number().finite().min(0).max(4),
})

export const exportManifestV2Schema = exportManifestV1Schema.extend({
  version: z.literal(2),
  /** Source time, ascending. The identity edit is a single range covering the whole export. */
  segments: z.array(manifestSegmentSchema).min(1).max(1000).optional(),
  overlays: z.array(manifestOverlaySchema).max(1000).default([]),
  blurRegions: z.array(manifestBlurRegionSchema).max(1000).default([]),
  audioClips: z.array(manifestAudioClipSchema).max(1000).default([]),
})

// ---- v3 ----
const manifestPath = manifestAudioClipPath
export const manifestInputSchema = z.strictObject({ path: manifestPath, kind: z.enum(['video', 'image', 'audio']) })
export const manifestPixelRectSchema = z.strictObject({ x: pixel, y: pixel, width: pixel.min(1), height: pixel.min(1) })
export const manifestClipSchema = z.strictObject({
  id: z.string().min(1).max(128),
  /** Index into `inputs`; the worker passes inputs to FFmpeg in exactly that order. */
  inputIndex: z.number().int().nonnegative().max(255),
  /** The asset the clip plays, so captions bound to it can be found (`activeCueAt`). */
  assetId: z.string().min(1).max(128),
  kind: z.enum(['video', 'image', 'audio']),
  /** Stacking order among visual clips: higher paints on top. */
  trackIndex: z.number().int().nonnegative().max(63),
  timelineStartUs: manifestUs, sourceStartUs: manifestUs, sourceEndUs: manifestUs,
  /** Output pixels (`compositionToPixels`); absent fills the frame. */
  rect: manifestPixelRectSchema.optional(),
  opacity: z.number().finite().min(0).max(1), fit: z.enum(['contain', 'cover', 'stretch']),
  /** 0 for a video on a muted track: its picture still plays, its sound does not. */
  gain: z.number().finite().min(0).max(4),
}).refine((clip) => clip.sourceEndUs > clip.sourceStartUs, 'Clip source end must follow its start')

export const exportManifestV3Schema = z.strictObject({
  version: z.literal(3),
  cues: projectSchema.shape.cues,
  style: frameRequestV1Schema.shape.style,
  display: captionDisplaySchema.optional(),
  format: sequenceFormatSchema,
  sequenceDurationUs: z.number().int().positive().safe(),
  /** One per clip FFmpeg reads (never shared between clips); host-painted images need none. */
  inputs: z.array(manifestInputSchema).max(256),
  clips: z.array(manifestClipSchema).max(4000),
  /** Image clips painted by the export host into the caption layer, in **sequence** time (v2's are source time). */
  overlays: z.array(manifestOverlaySchema).max(4000).default([]),
  blurRegions: z.array(manifestBlurRegionSchema).max(1000).default([]),
}).superRefine((manifest, context) => {
  const used = new Set<number>()
  for (const [index, clip] of manifest.clips.entries()) {
    if (used.has(clip.inputIndex)) context.addIssue({ code: 'custom', path: ['clips', index, 'inputIndex'], message: 'Each input belongs to exactly one clip.' })
    used.add(clip.inputIndex)
    const input = manifest.inputs[clip.inputIndex]
    if (!input) context.addIssue({ code: 'custom', path: ['clips', index, 'inputIndex'], message: 'A clip must name an input that exists.' })
    else if (input.kind !== clip.kind) context.addIssue({ code: 'custom', path: ['clips', index, 'inputIndex'], message: 'A clip must play an input of its own kind.' })
  }
})

export const exportManifestSchema = z.discriminatedUnion('version', [exportManifestV1Schema, exportManifestV2Schema, exportManifestV3Schema])
export type ExportManifestV1 = z.infer<typeof exportManifestV1Schema>
export type ExportManifestV2 = z.infer<typeof exportManifestV2Schema>
export type ExportManifestV3 = z.infer<typeof exportManifestV3Schema>
export type ManifestClip = z.infer<typeof manifestClipSchema>
export type ExportManifest = z.infer<typeof exportManifestSchema>

/** One shape for every v1/v2 consumer: a v1 manifest is a v2 manifest with no edits. */
export function normalizeManifest(manifest: ExportManifestV1 | ExportManifestV2): ExportManifestV2 {
  return manifest.version === 2 ? manifest : { ...manifest, version: 2, overlays: [], blurRegions: [], audioClips: [] }
}
export const exportPlanSchema = z.strictObject({
  width: z.number().int().min(16).max(3840).multipleOf(2), height: z.number().int().min(16).max(3840).multipleOf(2),
  frameRate: rationalSchema.refine((r) => r.numerator / r.denominator >= 1 && r.numerator / r.denominator <= 60),
  range: z.strictObject({ startUs: z.number().int().nonnegative().safe(), endUs: z.number().int().positive().safe() })
    .refine((r) => r.endUs > r.startUs),
})
export type ExportPlan = z.infer<typeof exportPlanSchema>

/** Index arithmetic stays rational until the single floor at the source-microsecond boundary. */
export function frameSourceUs(index: number, startUs: number, rate: Rational): number {
  if (!Number.isSafeInteger(index) || index < 0) throw new Error('Invalid frame index')
  const value = BigInt(startUs) + BigInt(index) * 1_000_000n * BigInt(rate.denominator) / BigInt(rate.numerator)
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Source timestamp overflow')
  return Number(value)
}
/**
 * Sequence-time output length: v3 carries it outright; v2 sums its kept segments, or is the whole
 * planned range for the identity edit (absent segments, or X2-style callers with no manifest at all).
 */
export function exportOutputDurationUs(plan: ExportPlan, manifest?: ExportManifestV2 | ExportManifestV3): number {
  if (manifest?.version === 3) return manifest.sequenceDurationUs
  const segments = manifest?.segments
  if (!segments?.length) return plan.range.endUs - plan.range.startUs
  return segments.reduce((total, segment) => total + (segment.endUs - segment.startUs), 0)
}
export function exportFrameCountFor(durationUs: number, rate: Rational): number {
  const n = BigInt(durationUs) * BigInt(rate.numerator)
  const d = 1_000_000n * BigInt(rate.denominator)
  const count = Number((n + d - 1n) / d)
  if (!Number.isSafeInteger(count) || count < 1) throw new Error('Invalid export frame count')
  return count
}
/** Kept as a thin wrapper so existing byte-for-byte identity-edit callers are untouched. */
export function exportFrameCount(plan: ExportPlan): number {
  return exportFrameCountFor(plan.range.endUs - plan.range.startUs, plan.frameRate)
}
/** H.264 bitrate class by pixel count. Deterministic, not a measured-quality claim. */
export function exportBitrate(width: number, height: number): string {
  const pixels = width * height
  if (pixels <= 921_600) return '5M' // ~720p
  if (pixels <= 2_073_600) return '8M' // ~1080p
  return '16M' // up to the 3840px cap
}
export { fittedFrameRate }
/** X2's plan for one probed media: its output frame (`formatFromMedia`) over its whole duration. */
export function planFromMedia(metadata: MediaMetadata): ExportPlan {
  const format = formatFromMedia(metadata)
  if (!format || !metadata.durationUs) throw new Error('Export needs probed dimensions and duration')
  return exportPlanSchema.parse({ ...format, range: { startUs: 0, endUs: metadata.durationUs } })
}
/** The plan for an output frame over `[0, durationUs)` of sequence (or, for v2, source) time. */
export function planForFormat(format: SequenceFormat, durationUs: number): ExportPlan {
  return exportPlanSchema.parse({ width: format.width, height: format.height, frameRate: format.frameRate, range: { startUs: 0, endUs: durationUs } })
}
export type PlannedFrame = { request: FrameRequest; active: boolean }
/**
 * `active` is false for a frame with no cue showing — `export.ts` reuses one previously rendered
 * transparent PNG for every such gap frame instead of round-tripping the export host again.
 */
/**
 * `sourceUsOverride` lets a caller supply the source timestamp a **sequence** frame maps to
 * (`layerPlan.ts`), which differs from plain index arithmetic once cuts exist. Omitting it keeps
 * X2's identity behaviour exactly.
 */
export function frameRequestAt(manifest: ExportManifestV1 | ExportManifestV2, plan: ExportPlan, index: number, sourceUsOverride?: number): PlannedFrame {
  const timestampUs = sourceUsOverride ?? frameSourceUs(index, plan.range.startUs, plan.frameRate)
  // Same first-active-cue/half-open policy as App.tsx. Overlaps never rewrite the project.
  const active: Cue | undefined = manifest.cues.find((cue) => timestampUs >= cue.startUs && timestampUs < cue.endUs)
  // Same WORD/LINE display choice as the preview's CaptionStage, made once here so the exported
  // frame request already carries the shown (line or single-word) cue.
  const shown = active ? displayCue(active, manifest.display ?? 'line', timestampUs) : null
  const resolved = resolveCaptionMotion(manifest.style ?? DEFAULT_CAPTION_STYLE, active?.motionOverride)
  const cue = shown ? { text: shown.text || ' ', startUs: shown.startUs, endUs: shown.endUs, words: shown.words, emphasized: shown.emphasized }
    : { text: ' ', startUs: 0, endUs: 1 }
  // Visible overlays join the frame request as v1's strict superset, so a manifest with none — every
  // project before V2, and every export today with no overlays — produces exactly X2's v1 request.
  const overlays = normalizeManifest(manifest).overlays.filter((overlay) => timestampUs >= overlay.startUs && timestampUs < overlay.endUs)
  const request = frameRequestSchema.parse({
    version: overlays.length ? 2 : 1, composition: { width: plan.width, height: plan.height }, cue,
    style: { ...(manifest.style ?? DEFAULT_CAPTION_STYLE), ...resolved }, timestampUs,
    ...(overlays.length ? { overlays: overlays.map((overlay) => ({ id: overlay.id, assetUrl: overlay.assetUrl, rect: overlay.rect, opacity: overlay.opacity, fit: overlay.fit })) } : {}),
  })
  return { request, active: Boolean(active) }
}
export function usDecimal(us: number): string { return `${Math.floor(us / 1_000_000)}.${String(us % 1_000_000).padStart(6, '0')}` }


// ---------------------------------------------------------------------------------------------
// v3 frame requests: the caption comes from the one shared active-cue rule, overlays from sequence time.
// ---------------------------------------------------------------------------------------------

type ManifestTimeline = { tracks: Track[]; clips: Clip[] }
const timelines = new WeakMap<ExportManifestV3, ManifestTimeline>()

/** The manifest's clips as a schema-5 timeline (tracks named by stacking index), for `activeCueAt`. */
export function manifestTimeline(manifest: ExportManifestV3): ManifestTimeline {
  const cached = timelines.get(manifest)
  if (cached) return cached
  const indices = [...new Set(manifest.clips.map((clip) => clip.trackIndex))].sort((a, b) => a - b)
  const tracks: Track[] = indices.map((index) => ({ id: `t${index}`, kind: 'video', name: '', muted: false, hidden: false, locked: false }))
  const clips = manifest.clips.filter((clip) => clip.kind === 'video').map((clip): Clip => ({
    kind: 'video', id: clip.id, trackId: `t${clip.trackIndex}`, assetId: clip.assetId, timelineStartUs: clip.timelineStartUs,
    sourceStartUs: clip.sourceStartUs, sourceEndUs: clip.sourceEndUs, opacity: clip.opacity, fit: clip.fit, gain: clip.gain,
  }))
  const timeline = { tracks, clips }
  timelines.set(manifest, timeline)
  return timeline
}

export function manifestActiveCue(manifest: ExportManifestV3, sequenceUs: number): ActiveCue | null {
  const { tracks, clips } = manifestTimeline(manifest)
  return activeCueAt(sequenceUs, tracks, clips, manifest.cues)
}

/**
 * The v3 frame at output index `index`. `active` may be passed in when the caller (the layer plan)
 * already resolved it; the caption is evaluated at the cue's own **source** time, overlays at
 * sequence time. A frame with no cue gets the same always-expired placeholder v1 uses.
 */
export function frameRequestAtSequence(manifest: ExportManifestV3, index: number, active?: ActiveCue | null): PlannedFrame {
  const sequenceUs = frameSourceUs(index, 0, manifest.format.frameRate)
  const found = active === undefined ? manifestActiveCue(manifest, sequenceUs) : active
  const timestampUs = found ? found.sourceUs : sequenceUs
  const shown = found ? displayCue(found.cue, manifest.display ?? 'line', timestampUs) : null
  const resolved = resolveCaptionMotion(manifest.style ?? DEFAULT_CAPTION_STYLE, found?.cue.motionOverride)
  const cue = shown ? { text: shown.text || ' ', startUs: shown.startUs, endUs: shown.endUs, words: shown.words, emphasized: shown.emphasized }
    : { text: ' ', startUs: 0, endUs: 1 }
  const overlays = manifest.overlays.filter((overlay) => sequenceUs >= overlay.startUs && sequenceUs < overlay.endUs)
  const request = frameRequestSchema.parse({
    version: overlays.length ? 2 : 1, composition: { width: manifest.format.width, height: manifest.format.height }, cue,
    style: { ...(manifest.style ?? DEFAULT_CAPTION_STYLE), ...resolved }, timestampUs,
    ...(overlays.length ? { overlays: overlays.map((overlay) => ({ id: overlay.id, assetUrl: overlay.assetUrl, rect: overlay.rect, opacity: overlay.opacity, fit: overlay.fit })) } : {}),
  })
  return { request, active: Boolean(found) }
}

// ---------------------------------------------------------------------------------------------
// Building the manifest from a schema-5 project.
// ---------------------------------------------------------------------------------------------

/** Resolves an asset to what the export may read. Both throw, naming the asset, when it is not
 * registered this session — a missing file refuses the export rather than silently dropping it. */
export type ExportResolver = {
  /** A `media://` URL the export host may load (host-painted images). */
  assetUrl(asset: ProjectAsset): string
  /** The file FFmpeg reads (video, audio and FFmpeg-composited images). */
  assetPath(asset: ProjectAsset): string
}
export type BuiltExport = { manifest: ExportManifestV2 | ExportManifestV3; plan: ExportPlan; inputPaths: string[] }

/** What reaches the export: hidden video tracks contribute nothing; muted audio tracks nothing. */
function contributing(project: CaptionProject) {
  const hidden = new Set(project.tracks.filter((track) => track.kind === 'video' && track.hidden).map((track) => track.id))
  const muted = new Set(project.tracks.filter((track) => track.muted).map((track) => track.id))
  const order = new Map(project.tracks.map((track, index) => [track.id, index]))
  const visual = project.clips.filter((clip) => clip.kind !== 'audio' && !hidden.has(clip.trackId))
  const audio = project.clips.filter((clip) => clip.kind === 'audio' && !muted.has(clip.trackId))
  return { visual, audio, muted, order }
}

/** A full-frame rect in composition units for the format's aspect (a clip with no `rect`). */
export function fullFrameRect(format: SequenceFormat): CompositionRect {
  return { x: 0, y: 0, width: COMPOSITION_WIDTH, height: COMPOSITION_WIDTH / formatAspect(format) }
}

/**
 * The sequences manifest v2 can express exactly: one video's clips on one visible, unmuted track,
 * gapless from 0, full frame, opaque, `contain`, unity gain — and, only for the identity edit (one
 * clip over the whole file, where sequence time *is* source time), images on tracks above it, which
 * the export host paints as v2 overlays. Nothing may run past the video's end. Every project that
 * existed before schema 5 with a single video is one of these.
 */
export function flatSequence(project: CaptionProject): { asset: ProjectAsset; videos: Clip[]; images: Clip[]; identity: boolean } | null {
  const { visual, audio, muted, order } = contributing(project)
  const videos = visual.filter((clip) => clip.kind === 'video').sort((a, b) => a.timelineStartUs - b.timelineStartUs)
  if (!videos.length) return null
  const { trackId, assetId } = videos[0]
  if (muted.has(trackId) || videos.some((clip) => clip.trackId !== trackId || clip.assetId !== assetId)) return null
  let cursor = 0
  for (const clip of videos) {
    if (clip.kind !== 'video' || clip.timelineStartUs !== cursor || clip.rect || clip.opacity !== 1 || clip.fit !== 'contain' || clip.gain !== 1) return null
    cursor = clipEndUs(clip)
  }
  const asset = project.assets.find((candidate) => candidate.id === assetId)
  const durationUs = asset?.metadata?.durationUs ?? null
  if (!asset || durationUs === null) return null
  const identity = videos.length === 1 && videos[0].sourceStartUs === 0 && videos[0].sourceEndUs === durationUs
  const images = visual.filter((clip) => clip.kind === 'image')
  if (images.length && (!identity || images.some((clip) => (order.get(clip.trackId) ?? 0) <= (order.get(trackId) ?? 0)))) return null
  if ([...images, ...audio].some((clip) => clipEndUs(clip) > cursor)) return null
  return { asset, videos, images, identity }
}

/** The output frame: the project's own, else the caller's fallback (main derives it from the probed first video). */
export function buildExportManifest(project: CaptionProject, resolver: ExportResolver, fallbackFormat?: SequenceFormat | null): BuiltExport {
  const format = project.format ?? fallbackFormat ?? null
  if (!format) throw new Error('Export needs the output size and frame rate; relink the first video so it can be probed.')
  const output = { width: format.width, height: format.height }
  const assets = new Map(project.assets.map((asset) => [asset.id, asset]))
  const style = project.captionStyle ?? DEFAULT_CAPTION_STYLE
  const display = project.captionDisplay ?? 'line'
  const { visual, audio, muted, order } = contributing(project)
  const assetOf = (clip: Clip) => {
    const asset = assets.get(clip.assetId)
    if (!asset) throw new Error('A clip on the timeline refers to a file that is no longer in the project.')
    return asset
  }
  const blurFor = (endUs: number) => project.blurRegions.filter((region) => region.startUs < endUs).map((region) => ({
    id: region.id,
    // Blur is applied by FFmpeg, so its geometry is resolved to output pixels here — the worker never
    // converts composition units itself. Its window is already sequence time.
    sequence: { startUs: region.startUs, endUs: Math.min(region.endUs, endUs) },
    rect: compositionToPixels(region.rect, output),
    sigmaPx: compositionScalarToPixels(region.radius, output),
  }))
  const audioPath = (clip: Clip) => resolver.assetPath(assetOf(clip))

  const flat = flatSequence(project)
  if (flat) {
    const durationUs = flat.asset.metadata!.durationUs!
    const path = resolver.assetPath(flat.asset)
    const manifest = exportManifestV2Schema.parse({
      version: 2,
      cues: project.cues.filter((cue) => !cue.mediaAssetId || cue.mediaAssetId === flat.asset.id),
      style, display,
      ...(flat.identity ? {} : { segments: flat.videos.map((clip) => ({ startUs: clip.sourceStartUs, endUs: clip.sourceEndUs })) }),
      // The identity edit only: sequence time equals source time, so image clips are v2 overlays verbatim.
      overlays: flat.images.map((clip) => ({
        id: clip.id, startUs: clip.timelineStartUs, endUs: clipEndUs(clip), assetUrl: resolver.assetUrl(assetOf(clip)),
        rect: (clip.kind === 'image' && clip.rect) || fullFrameRect(format), opacity: clip.kind === 'image' ? clip.opacity : 1, fit: clip.kind === 'image' ? clip.fit : 'contain',
      })),
      blurRegions: blurFor(clipEndUs(flat.videos[flat.videos.length - 1])),
      audioClips: audio.map((clip) => ({
        id: clip.id, path: audioPath(clip), delayUs: clip.timelineStartUs, inPointUs: clip.sourceStartUs,
        durationUs: clip.sourceEndUs - clip.sourceStartUs, gain: clip.kind === 'audio' ? clip.gain : 1,
      })),
    })
    return { manifest, plan: planForFormat(format, durationUs), inputPaths: [path] }
  }

  // v3. Images are painted by the export host — exact preview parity, ADR 0003 — whenever every image
  // sits above every video; only an image genuinely under a video is composited by FFmpeg (ADR 0005).
  const videoTrackTop = Math.max(-1, ...visual.filter((clip) => clip.kind === 'video').map((clip) => order.get(clip.trackId) ?? 0))
  const hostImages = visual.every((clip) => clip.kind !== 'image' || (order.get(clip.trackId) ?? 0) > videoTrackTop)
  // One input per clip FFmpeg reads — never shared — so each clip gets its own decoder, seeked
  // straight to its source range (workers/media/exportArguments.ts `exportFilterGraphV3`).
  const inputs: { path: string; kind: 'video' | 'image' | 'audio' }[] = []
  const inputFor = (clip: Clip): number => inputs.push({ path: resolver.assetPath(assetOf(clip)), kind: clip.kind }) - 1
  const clips: ManifestClip[] = []
  const overlays: ExportManifestV3['overlays'] = []
  for (const clip of [...visual, ...audio].sort((a, b) => (order.get(a.trackId) ?? 0) - (order.get(b.trackId) ?? 0) || a.timelineStartUs - b.timelineStartUs)) {
    const trackIndex = order.get(clip.trackId) ?? 0
    if (clip.kind === 'image' && hostImages) {
      overlays.push({ id: clip.id, startUs: clip.timelineStartUs, endUs: clipEndUs(clip), assetUrl: resolver.assetUrl(assetOf(clip)),
        rect: clip.rect ?? fullFrameRect(format), opacity: clip.opacity, fit: clip.fit })
      continue
    }
    const base = { id: clip.id, inputIndex: inputFor(clip), assetId: clip.assetId, kind: clip.kind, trackIndex,
      timelineStartUs: clip.timelineStartUs, sourceStartUs: clip.sourceStartUs, sourceEndUs: clip.sourceEndUs }
    if (clip.kind === 'audio') clips.push({ ...base, opacity: 1, fit: 'contain', gain: clip.gain })
    else clips.push({
      ...base, ...(clip.rect ? { rect: compositionToPixels(clip.rect, output) } : {}), opacity: clip.opacity, fit: clip.fit,
      gain: clip.kind === 'video' && !muted.has(clip.trackId) ? clip.gain : 0,
    })
  }
  if (inputs.length > 250) throw new Error(`This timeline reads ${inputs.length} clips; one export can read at most 250. Join or remove some clips first.`)
  const sequenceDurationUs = Math.max(0, ...clips.map((clip) => clip.timelineStartUs + clip.sourceEndUs - clip.sourceStartUs), ...overlays.map((overlay) => overlay.endUs))
  if (sequenceDurationUs <= 0) throw new Error('Add a video, image or sound to the timeline before exporting a video.')
  const captionAssets = new Set(clips.filter((clip) => clip.kind === 'video').map((clip) => clip.assetId))
  const manifest = exportManifestV3Schema.parse({
    version: 3,
    cues: project.cues.filter((cue) => cue.mediaAssetId ? captionAssets.has(cue.mediaAssetId) : !captionAssets.size),
    style, display, format, sequenceDurationUs, inputs, clips, overlays,
    blurRegions: blurFor(sequenceDurationUs),
  })
  return { manifest, plan: planForFormat(format, sequenceDurationUs), inputPaths: inputs.map((input) => input.path) }
}
