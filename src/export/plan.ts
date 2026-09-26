import { z } from 'zod'
import { rationalSchema, type MediaMetadata, type Rational } from '../core/media'
import { projectSchema, type CaptionProject, type Cue } from '../core/model'
import {
  COMPOSITION_WIDTH, compositionRectSchema, effectRegionSchema, layerMaskSchema, type LayerMask, sequenceFormatSchema, type AdjustmentClip, type Clip, type CompositionRect,
  type Grade, type ProjectAsset, type SequenceFormat, type Track,
} from '../core/edit'
import { bakeGrade, composeLuts, type Grade as BakedGrade } from '../color/bake'
import { encodeCubeData, type Cube3D } from '../color/cube'
import { adjustmentsOver } from '../core/gradeStack'
import { compositionFor, compositionScalarToPixels, compositionToPixels } from '../core/composition'
import { fittedFrameRate, formatAspect, formatFromMedia } from '../core/format'
import { activeCueAt, clipEndUs, sourceUsAt, type ActiveCue, type TimeRange } from '../core/timelineModel'
import { timelineLengthUs } from '../core/clipTime'
import { effectiveGain } from '../core/clipLinks'
import { frameRequestSchema, frameRequestV1Schema, type FrameRequest } from './frameRequest'
import { DEFAULT_CAPTION_STYLE, resolveCaptionStyle } from '../captions/style'
import { decorativeTextCue, textMotionAt } from '../captions/textMotion'
import { compareLayered } from '../core/graphicsOrder'
import { BLEND_MODES, type BlendMode, backgroundMotionSchema, clipSpeedSchema, fillSchema, textOverlaySchema, shapeSchema, type AudioClip, type ImageClip, type MediaClip, type TextOverlay, type VideoClip, type VisualClip } from '../core/edit'
import { captionDisplaySchema, displayCue } from '../captions/wordDisplay'
import { frameEffectsAt } from '../core/frameEffects'
import { activeMask } from '../core/layerMask'
import { imagesHostPainted } from '../core/hostPainted'
import { graphicsPasses, passOf } from '../core/graphicsPasses'
import { displayedCues } from '../core/captionLanguages'
import { resolveExportFormat, type ExportSettings } from './settings'

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
  mask: layerMaskSchema.optional(),
}).refine((overlay) => overlay.endUs > overlay.startUs, 'Overlay end must follow its start')
export const manifestBlurRegionSchema = z.strictObject({
  id: z.string().min(1).max(128),
  /** Sequence time, after any concat — exactly what an FFmpeg `enable` expression needs. */
  sequence: z.strictObject({ startUs: manifestUs, endUs: manifestUs }).refine((range) => range.endUs > range.startUs, 'Blur window end must follow its start'),
  /** Output pixels, already scaled and clamped by `compositionToPixels`. */
  rect: z.strictObject({ x: pixel, y: pixel, width: pixel.min(1), height: pixel.min(1) }),
  sigmaPx: z.number().finite().positive().max(1024),
  /** Schema 12: composition units. FFmpeg applies it through a host-rasterized alpha image. */
  mask: layerMaskSchema.optional(),
})
/** Picture effects (dreamy glow) are applied by FFmpeg after zoom, so — like blur — the radius is
 * already resolved to output pixels here and the worker never converts units. */
export const manifestPictureEffectSchema = z.strictObject({
  id: z.string().min(1).max(128), kind: z.literal('glow'),
  sequence: z.strictObject({ startUs: manifestUs, endUs: manifestUs }).refine((range) => range.endUs > range.startUs, 'Picture effect window end must follow its start'),
  sigmaPx: z.number().finite().positive().max(1024),
  amount: z.number().finite().min(0).max(1),
  threshold: z.number().finite().min(0).max(0.95),
})
/** Pixel-space camera target over the sequence picture. Captions and host-painted overlays are
 * deliberately not part of this data: FFmpeg applies it before the transparent host layer. */
export const manifestZoomRegionSchema = z.strictObject({
  id: z.string().min(1).max(128),
  sequence: z.strictObject({ startUs: manifestUs, endUs: manifestUs }).refine((range) => range.endUs > range.startUs, 'Zoom window end must follow its start'),
  rect: z.strictObject({ x: pixel, y: pixel, width: pixel.min(1), height: pixel.min(1) }),
  /** Pan / Ken Burns start framing (schema 11); when present the region eases `fromRect → rect`. */
  fromRect: z.strictObject({ x: pixel, y: pixel, width: pixel.min(1), height: pixel.min(1) }).optional(),
  easeInUs: z.number().int().nonnegative().max(5_000_000),
  easeOutUs: z.number().int().nonnegative().max(5_000_000),
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
  /** Index into `inputs`; the worker passes inputs to FFmpeg in exactly that order. Absent for a
   * generated `color` clip, which FFmpeg synthesises from `fill` and never reads a file for. */
  inputIndex: z.number().int().nonnegative().max(255).optional(),
  /** The asset the clip plays, so captions bound to it can be found (`activeCueAt`). Absent for `color`. */
  assetId: z.string().min(1).max(128).optional(),
  kind: z.enum(['video', 'image', 'audio', 'color']),
  /** `color` clips only (schema 13): the generated picture and its optional preset motion. */
  fill: fillSchema.optional(),
  motion: backgroundMotionSchema.optional(),
  /** Stacking order among visual clips: higher paints on top. */
  trackIndex: z.number().int().nonnegative().max(63),
  timelineStartUs: manifestUs, sourceStartUs: manifestUs, sourceEndUs: manifestUs,
  /** Schema 14, video and audio clips: the playback-speed curve in source time. The clip's length on the
   * timeline is `timelineLengthUs`, not `sourceEndUs - sourceStartUs`. */
  speed: clipSpeedSchema.optional(),
  /** Output pixels (`compositionToPixels`); absent fills the frame. */
  rect: manifestPixelRectSchema.optional(),
  opacity: z.number().finite().min(0).max(1), fit: z.enum(['contain', 'cover', 'stretch']),
  /** Schema 18, picture clips only; emitted only when not `normal`. Any blending clip forces the stacked route. */
  blendMode: z.enum(BLEND_MODES).optional(),
  /** 0 for a video on a muted track: its picture still plays, its sound does not. */
  gain: z.number().finite().min(0).max(4),
  /** Schema 12, composition units; FFmpeg-composited clips only (host-painted images carry it on the overlay). */
  mask: layerMaskSchema.optional(),
  /** Schema 16, video/image clips only: the baked LUT (`manifest.luts`) grading this clip, if any
   * adjustment layer is stacked above it (docs/EDITING.md "Color: adjustment layers"). A `color`
   * clip is never graded in v1 — the inspector says so. */
  lutId: z.string().min(1).max(128).optional(),
}).refine((clip) => clip.sourceEndUs > clip.sourceStartUs, 'Clip source end must follow its start')
  .superRefine((clip, context) => {
    if (clip.kind === 'color') {
      if (!clip.fill) context.addIssue({ code: 'custom', path: ['fill'], message: 'A color clip needs a fill.' })
      if (clip.inputIndex !== undefined || clip.assetId !== undefined) context.addIssue({ code: 'custom', path: ['inputIndex'], message: 'A color clip reads no input.' })
      if (clip.lutId !== undefined) context.addIssue({ code: 'custom', path: ['lutId'], message: 'A background is never graded.' })
    } else if (clip.inputIndex === undefined || clip.assetId === undefined || clip.fill || clip.motion) {
      context.addIssue({ code: 'custom', path: ['inputIndex'], message: 'A media clip needs an input and an asset, and no fill.' })
    } else if (clip.kind === 'audio' && clip.lutId !== undefined) {
      context.addIssue({ code: 'custom', path: ['lutId'], message: 'An audio clip has no picture to grade.' })
    }
  })

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
  zoomRegions: z.array(manifestZoomRegionSchema).max(200).default([]),
  /** Frame-paint effects (vignette/letterbox/fade), host-painted like `overlays` — composition
   * units and sequence time verbatim, never resolved to output pixels the way blur/zoom are, since
   * `CompositionLayers` (docs/EDITING.md "Frame-paint effects") does that scaling itself. */
  effects: z.array(effectRegionSchema).max(500).default([]),
  /** Glow etc., resolved for FFmpeg (the host layer above ignores these kinds). */
  pictureEffects: z.array(manifestPictureEffectSchema).max(500).default([]),
  textOverlays: z.array(textOverlaySchema).max(1000).default([]),
  /** Schema 17: vector shapes, host-painted like text, in composition units and sequence time. */
  shapes: z.array(shapeSchema).max(1000).default([]),
  /** Schema 12: caption-track id → mask, for tracks that have one; the frame request takes the active cue's. */
  captionMasks: z.record(z.string().min(1).max(128), layerMaskSchema).default({}),
  /** Schema 18: per caption track opacity, only entries below 1. */
  captionOpacities: z.record(z.string().min(1).max(128), z.number().finite().min(0).max(1)).default({}),
  /** Schema 16: baked 3D LUTs (`src/color/bake.ts`), one per distinct grade (or stacked-grade
   * composition) actually in use, deduped by content — `manifestClipSchema.lutId` names one of these.
   * The worker turns each into an on-disk `.cube` file and applies it with FFmpeg's `lut3d` filter. */
  luts: z.array(z.strictObject({
    id: z.string().min(1).max(128),
    size: z.number().int().min(2).max(65),
    /** Base64, little-endian float32, `size ** 3 * 3` elements, red-fastest (`cube.ts`). */
    data: z.string().min(1).max(8 * 1024 * 1024),
  })).max(256).default([]),
}).superRefine((manifest, context) => {
  const used = new Set<number>()
  const lutIds = new Set(manifest.luts.map((lut) => lut.id))
  for (const [index, clip] of manifest.clips.entries()) {
    if (clip.lutId !== undefined && !lutIds.has(clip.lutId)) context.addIssue({ code: 'custom', path: ['clips', index, 'lutId'], message: 'A clip must name a LUT that exists.' })
    if (clip.kind === 'color' || clip.inputIndex === undefined) continue
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
/** Same shape in v2 and v3 — output pixels, sequence time (docs/EDITING.md "Edit manifest v2"). */
export type ManifestBlurRegion = z.infer<typeof manifestBlurRegionSchema>
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
  const style = resolveCaptionStyle(manifest.style ?? DEFAULT_CAPTION_STYLE, active)
  const cue = shown ? { text: shown.text || ' ', startUs: shown.startUs, endUs: shown.endUs, words: shown.words, emphasized: shown.emphasized }
    : { text: ' ', startUs: 0, endUs: 1 }
  // Visible overlays join the frame request as v1's strict superset, so a manifest with none — every
  // project before V2, and every export today with no overlays — produces exactly X2's v1 request.
  const overlays = normalizeManifest(manifest).overlays.filter((overlay) => timestampUs >= overlay.startUs && timestampUs < overlay.endUs)
  const request = frameRequestSchema.parse({
    version: overlays.length ? 2 : 1, composition: { width: plan.width, height: plan.height }, cue,
    style, timestampUs,
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
    kind: 'video', id: clip.id, trackId: `t${clip.trackIndex}`, assetId: clip.assetId ?? '', timelineStartUs: clip.timelineStartUs,
    sourceStartUs: clip.sourceStartUs, sourceEndUs: clip.sourceEndUs, opacity: clip.opacity, fit: clip.fit, gain: clip.gain,
    ...(clip.speed ? { speed: clip.speed } : {}),
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
/** The host request that rasterizes one layer mask to an output-size PNG whose alpha is the mask
 * (frame request v5). Only the always-expired placeholder cue is present, so nothing else paints. */
export function maskFrameRequest(mask: LayerMask, width: number, height: number): FrameRequest {
  return frameRequestSchema.parse({ version: 5, composition: { width, height }, cue: { text: ' ', startUs: 0, endUs: 1 }, style: DEFAULT_CAPTION_STYLE, timestampUs: 1_000_000, maskFill: mask })
}

/** A fully transparent pass (docs/plans/shape-blend/02-export-passes.md): nothing pinned, no
 * caption, no graphics — the same shape `frameRequestAtSequence` builds for an empty band, kept as
 * its own function so the worker can render (and cache) one without a manifest at hand. */
export function blankFrameRequest(width: number, height: number): FrameRequest {
  return frameRequestSchema.parse({ version: 1, composition: { width, height }, cue: { text: ' ', startUs: 0, endUs: 1 }, style: DEFAULT_CAPTION_STYLE, timestampUs: 1_000_000, hideCaption: true })
}

/**
 * The v3 frame at output index `index`, for one band of the shape-blend pass model
 * (`graphicsPasses`, docs/plans/shape-blend/02-export-passes.md). `pass` defaults to 0: with no
 * blending shapes there is exactly one band (band 0 is also the caption band and the last band), so
 * every filter below is a no-op and the request is byte-identical to before passes existed.
 */
export function frameRequestAtSequence(manifest: ExportManifestV3, index: number, active?: ActiveCue | null, pass = 0): PlannedFrame {
  const sequenceUs = frameSourceUs(index, 0, manifest.format.frameRate)
  const found = active === undefined ? manifestActiveCue(manifest, sequenceUs) : active
  const timestampUs = found ? found.sourceUs : sequenceUs
  const shown = found ? displayCue(found.cue, manifest.display ?? 'line', timestampUs) : null
  const style = resolveCaptionStyle(manifest.style ?? DEFAULT_CAPTION_STYLE, found?.cue)
  const cue = shown ? { text: shown.text || ' ', startUs: shown.startUs, endUs: shown.endUs, words: shown.words, emphasized: shown.emphasized }
    : { text: ' ', startUs: 0, endUs: 1 }
  const passes = graphicsPasses(manifest.shapes)
  const captionPass = passOf({ kind: 'caption' }, passes)
  const lastPass = passes.count - 1
  const isBlendPass = pass % 2 === 1
  const overlays = pass === 0 ? manifest.overlays.filter((overlay) => sequenceUs >= overlay.startUs && sequenceUs < overlay.endUs) : []
  // Evaluated in composition units, the same space `CaptionStage`'s live preview uses — never the
  // manifest's own output-pixel `format` — so `CompositionLayers`' own scale factor is the only
  // pixel conversion either side ever does (docs/EDITING.md "Frame-paint effects").
  const allEffects = manifest.effects.length ? frameEffectsAt(manifest.effects, sequenceUs, compositionFor(formatAspect(manifest.format))) : {}
  // Pinned effects (vignette/letterbox/grain/vhs/particles) always land in band 0; fade always
  // lands in the last band — the same split `pinnedEffectLayers`/`fadeLayers` already make in
  // `frameHarness.tsx`, just decided here so an unrelated band's request never carries them twice.
  const frameEffects = {
    ...(pass === 0 ? { vignette: allEffects.vignette, letterbox: allEffects.letterbox, grain: allEffects.grain, vhs: allEffects.vhs, particles: allEffects.particles } : {}),
    ...(pass === lastPass ? { fade: allEffects.fade } : {}),
  }
  const textActors = !isBlendPass
    ? manifest.textOverlays.filter((item) => item.startUs <= sequenceUs && sequenceUs < item.endUs && passOf({ kind: 'graphic', item }, passes) === pass)
      .sort(compareLayered)
      .map((item) => {
        const { visible: _visible, ...motion } = textMotionAt(item, sequenceUs)
        return { item, cue: decorativeTextCue(item), timestampUs: sequenceUs, ...motion }
      })
    : []
  // An odd (blend) pass carries exactly its own blending shape — nothing else — and only when it is
  // actually on the timeline at this frame; an even (normal) pass never carries a blending shape,
  // since each one is isolated to its own band.
  const shapeActors = isBlendPass
    ? (() => {
      const { shape: passShape } = passes.bands[(pass - 1) / 2]
      return passShape.startUs <= sequenceUs && sequenceUs < passShape.endUs ? [{ shape: passShape, timestampUs: sequenceUs }] : []
    })()
    : manifest.shapes.filter((item) => item.blendMode === undefined && item.startUs <= sequenceUs && sequenceUs < item.endUs && passOf({ kind: 'graphic', item }, passes) === pass)
      .map((shape) => ({ shape, timestampUs: sequenceUs }))
  // A glass band is the opaque refraction map, not the shape (the surface paints in the even band after it).
  const glassMap = isBlendPass && passes.bands[(pass - 1) / 2].kind === 'glass' && shapeActors.length > 0
  const captionMaskValue = found?.cue.captionTrackId ? activeMask(manifest.captionMasks[found.cue.captionTrackId]) : null
  const captionOpacityValue = found?.cue.captionTrackId ? manifest.captionOpacities[found.cue.captionTrackId] : undefined
  const hasFrameEffects = Boolean(frameEffects.vignette || frameEffects.letterbox || frameEffects.fade || frameEffects.grain || frameEffects.vhs || frameEffects.particles)
  const hasText = textActors.length > 0 || shapeActors.length > 0
  const request = frameRequestSchema.parse({
    version: hasText ? 4 : hasFrameEffects ? 3 : overlays.length ? 2 : 1, composition: { width: manifest.format.width, height: manifest.format.height }, cue,
    style, timestampUs, ...(captionMaskValue ? { captionMask: captionMaskValue } : {}),
    ...(captionOpacityValue !== undefined && captionOpacityValue < 1 ? { captionOpacity: captionOpacityValue } : {}),
    ...(pass !== captionPass ? { hideCaption: true as const } : {}),
    ...(overlays.length || hasFrameEffects || hasText ? { overlays: overlays.map((overlay) => ({ id: overlay.id, assetUrl: overlay.assetUrl, rect: overlay.rect, opacity: overlay.opacity, fit: overlay.fit, ...(overlay.mask ? { mask: overlay.mask } : {}) })) } : {}),
    ...(hasFrameEffects ? { frameEffects } : {}),
    ...(hasText ? { frameEffects } : {}),
    ...(hasText ? { textActors } : {}),
    ...(shapeActors.length ? { shapeActors } : {}),
    ...(glassMap ? { glassMap: true as const } : {}),
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
  /** A `lut`-kind asset's parsed `.cube` contents, for baking into a grade (`bakeGrade`/`composeLuts`). */
  lutCube(asset: ProjectAsset): Cube3D
}
export type BuiltExport = { manifest: ExportManifestV2 | ExportManifestV3; plan: ExportPlan; inputPaths: string[] }

/** What reaches the export: hidden video tracks and disabled clips contribute nothing, and neither do
 * audio clips that are silent (muted or unsoloed track, or a gain of 0). */
function contributing(project: CaptionProject) {
  const hidden = new Set(project.tracks.filter((track) => track.kind === 'video' && track.hidden).map((track) => track.id))
  const muted = new Set(project.tracks.filter((track) => track.muted).map((track) => track.id))
  const order = new Map(project.tracks.map((track, index) => [track.id, index]))
  const visual = project.clips.filter((clip): clip is VisualClip => clip.kind !== 'audio' && clip.kind !== 'adjustment' && clip.enabled !== false && !hidden.has(clip.trackId))
  const audio = project.clips.filter((clip): clip is AudioClip => clip.kind === 'audio' && effectiveGain(clip, project.tracks) > 0)
  return { visual, audio, muted, order }
}

// ---------------------------------------------------------------------------------------------
// Color: adjustment layers (docs/EDITING.md "Color: adjustment layers"). A picture clip's grade
// stack can change mid-clip as adjustment-layer boundaries pass over it, so the clip is split into
// sub-segments with a constant stack before baking — the same segments become sibling manifest
// clips, each its own FFmpeg input. `color` (generated background) clips are never graded in v1.
// ---------------------------------------------------------------------------------------------

// `adjustmentsOver` (the enabled adjustment clips on a track above `trackIndex` that overlap `range`
// at all, bottom-up by track order) lives in `src/core/gradeStack.ts`, shared verbatim with the live
// preview's `gradeStackFor` — see that module's own doc comment.

/** Splits `range` at every adjustment-layer boundary inside it, so each piece has one constant,
 * possibly-empty grade stack. */
function gradeSegments(clips: readonly Clip[], order: ReadonlyMap<string, number>, trackIndex: number, range: TimeRange): { range: TimeRange; grades: AdjustmentClip[] }[] {
  const above = clips.filter((clip): clip is AdjustmentClip => clip.kind === 'adjustment' && clip.enabled !== false && (order.get(clip.trackId) ?? -1) > trackIndex)
  const cuts = new Set<number>([range.startUs, range.endUs])
  for (const adjustment of above) {
    if (adjustment.timelineStartUs > range.startUs && adjustment.timelineStartUs < range.endUs) cuts.add(adjustment.timelineStartUs)
    const end = clipEndUs(adjustment)
    if (end > range.startUs && end < range.endUs) cuts.add(end)
  }
  const points = [...cuts].sort((a, b) => a - b)
  return points.slice(0, -1).map((startUs, index) => {
    const segmentRange = { startUs, endUs: points[index + 1] }
    return { range: segmentRange, grades: adjustmentsOver(clips, order, trackIndex, segmentRange) }
  })
}

/** The persisted `Grade` (`src/core/edit.ts`, `input.type === 'lut'` names an asset) as the runtime
 * shape `bakeGrade`/`composeLuts` evaluate (`input.type === 'lut'` carries the parsed cube itself). */
function resolveGrade(grade: Grade, lutOf: (assetId: string) => Cube3D): BakedGrade {
  return { ...grade, input: grade.input.type === 'lut' ? { type: 'lut', cube: lutOf(grade.input.assetId) } : grade.input }
}

/**
 * Bakes (and content-dedupes) the single 3D LUT for one bottom-up grade stack, caching by a JSON key
 * of the stack's own grades — two different adjustment clips with identical settings share one baked
 * LUT. Returns the manifest id (`manifest.luts[].id`) `bakeStackLut` assigned or reused.
 */
function bakeStackLut(grades: readonly AdjustmentClip[], lutOf: (assetId: string) => Cube3D, cache: Map<string, { id: string; cube: Cube3D }>): string {
  const key = JSON.stringify(grades.map((clip) => clip.grade))
  const cached = cache.get(key)
  if (cached) return cached.id
  const cube = grades.map((clip) => bakeGrade(resolveGrade(clip.grade, lutOf))).reduce((composed, next) => composed ? composeLuts(composed, next) : next, null as Cube3D | null)!
  const id = `lut-${cache.size + 1}`
  cache.set(key, { id, cube })
  return id
}

/**
 * A detached video's linked audio that says exactly what the video's own sound would: same file,
 * same source range and position, unity gain on an audible track. Manifest v2 plays a video's own
 * sound at unity, so for such a pair (the normal result of importing a video) it *is* that sound and
 * needs no separate audio clip. Returns the mirrors' ids, or `null` when a detached video has no such
 * partner (then only the stacked v3 route can express its sound).
 */
function mirroredAudio(project: CaptionProject, videos: readonly VideoClip[], audio: readonly AudioClip[]): Set<string> | null {
  const mirrors = new Set<string>()
  for (const video of videos) {
    if (!video.detachedAudio) continue
    const partner = video.linkId ? audio.find((clip) => clip.linkId === video.linkId && clip.assetId === video.assetId && !clip.speed
      && clip.timelineStartUs === video.timelineStartUs && clip.sourceStartUs === video.sourceStartUs && clip.sourceEndUs === video.sourceEndUs
      && effectiveGain(clip, project.tracks) === 1) : undefined
    if (!partner) return null
    mirrors.add(partner.id)
  }
  return mirrors
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
export function flatSequence(project: CaptionProject): { asset: ProjectAsset; videos: VideoClip[]; images: ImageClip[]; identity: boolean; /** Linked audio clips that are the video's own sound, so v2 plays them as `[0:a:0]`. */ mirroredAudioIds: ReadonlySet<string> } | null {
  // v2 has no camera-transform field. Route zoom projects through v3 rather than silently emit
  // the old manifest and lose the effect. A project whose zoom regions are all bypassed has nothing
  // left to lose, so it still takes the plain v2 path.
  if (project.zoomRegions.some((region) => region.enabled)) return null
  // v2's frame request builder (`frameRequestAt`) never evaluates frame-paint effects — the same
  // reason zoom forces v3, above.
  if (project.effects.some((effect) => effect.enabled)) return null
  if (project.textOverlays.length || project.shapes.length) return null
  // v2 has no blend either: a blending clip needs the stacked v3 route.
  if (project.clips.some((clip) => (clip.kind === 'video' || clip.kind === 'image' || clip.kind === 'color') && (clip.blendMode ?? 'normal') !== 'normal')) return null
  // v2 has no mask input either: any active mask routes through v3.
  if (project.captionTracks.some((track) => activeMask(track.mask) || (track.opacity ?? 1) < 1) || project.blurRegions.some((region) => region.enabled && activeMask(region.mask))
    || project.clips.some((clip) => clip.kind !== 'audio' && clip.kind !== 'adjustment' && activeMask(clip.mask))) return null
  // v2 cannot synthesise a picture, or apply a grade: a generated background or an adjustment layer
  // needs the stacked v3 route (v3 baking the grade into a `lut3d` filter — docs/EDITING.md).
  if (project.clips.some((clip) => clip.kind === 'color' || clip.kind === 'adjustment')) return null
  // v2 places each kept segment end to end at 1× and has no retiming: a speed change needs v3.
  if (project.clips.some((clip) => (clip.kind === 'video' || clip.kind === 'audio') && clip.speed)) return null
  const { visual, audio, muted, order } = contributing(project)
  const videos = visual.filter((clip): clip is VideoClip => clip.kind === 'video').sort((a, b) => a.timelineStartUs - b.timelineStartUs)
  if (!videos.length) return null
  const { trackId, assetId } = videos[0]
  if (muted.has(trackId) || videos.some((clip) => clip.trackId !== trackId || clip.assetId !== assetId)) return null
  const mirrored = mirroredAudio(project, videos, audio)
  if (!mirrored) return null
  // Solo silences an unsoloed video's own sound (the fader-free unity check below is v2's whole audio rule).
  if (videos.some((clip) => !clip.detachedAudio && effectiveGain(clip, project.tracks) !== 1)) return null
  let cursor = 0
  for (const clip of videos) {
    if (clip.kind !== 'video' || clip.timelineStartUs !== cursor || clip.rect || clip.opacity !== 1 || clip.fit !== 'contain' || (!clip.detachedAudio && clip.gain !== 1)) return null
    cursor = clipEndUs(clip)
  }
  const asset = project.assets.find((candidate) => candidate.id === assetId)
  const durationUs = asset?.metadata?.durationUs ?? null
  if (!asset || durationUs === null) return null
  const identity = videos.length === 1 && videos[0].sourceStartUs === 0 && videos[0].sourceEndUs === durationUs
  const images = visual.filter((clip): clip is ImageClip => clip.kind === 'image')
  if (images.length && (!identity || images.some((clip) => (order.get(clip.trackId) ?? 0) <= (order.get(trackId) ?? 0)))) return null
  const extraAudio = audio.filter((clip) => !mirrored.has(clip.id))
  if ([...images, ...extraAudio].some((clip) => clipEndUs(clip) > cursor)) return null
  return { asset, videos, images, identity, mirroredAudioIds: mirrored }
}

const blendField = (mode: BlendMode | undefined) => mode && mode !== 'normal' ? { blendMode: mode } : {}

/** The output frame: the project's own, else the caller's fallback (main derives it from the probed first video). */
export function buildExportManifest(project: CaptionProject, resolver: ExportResolver, fallbackFormat?: SequenceFormat | null, settings?: ExportSettings): BuiltExport {
  const projectFormat = project.format ?? fallbackFormat ?? null
  if (!projectFormat) throw new Error('Export needs the output size and frame rate; relink the first video so it can be probed.')
  // Geometry is composition units until here, so a scaled output format scales captions and effects consistently.
  const format = resolveExportFormat(projectFormat, settings)
  const output = { width: format.width, height: format.height }
  const assets = new Map(project.assets.map((asset) => [asset.id, asset]))
  const style = project.captionStyle ?? DEFAULT_CAPTION_STYLE
  const display = project.captionDisplay ?? 'line'
  const { visual, audio, muted, order } = contributing(project)
  const assetOf = (clip: MediaClip) => {
    const asset = assets.get(clip.assetId)
    if (!asset) throw new Error('A clip on the timeline refers to a file that is no longer in the project.')
    return asset
  }
  const blurFor = (endUs: number) => project.blurRegions.filter((region) => region.enabled && region.startUs < endUs).map((region) => ({
    id: region.id,
    // Blur is applied by FFmpeg, so its geometry is resolved to output pixels here — the worker never
    // converts composition units itself. Its window is already sequence time.
    sequence: { startUs: region.startUs, endUs: Math.min(region.endUs, endUs) },
    rect: compositionToPixels(region.rect, output),
    sigmaPx: compositionScalarToPixels(region.radius, output),
    ...(activeMask(region.mask) ? { mask: region.mask } : {}),
  }))
  const zoomFor = (endUs: number) => project.zoomRegions.filter((region) => region.enabled && region.startUs < endUs).map((region) => ({
    id: region.id,
    // A pan's progress is a function of the region's whole length, so it keeps its true end even
    // past the sequence end (frames simply stop first); truncating would speed the pan up vs preview.
    sequence: { startUs: region.startUs, endUs: region.fromRect ? region.endUs : Math.min(region.endUs, endUs) },
    rect: compositionToPixels(region.rect, output),
    ...(region.fromRect ? { fromRect: compositionToPixels(region.fromRect, output) } : {}),
    easeInUs: region.easeInUs,
    easeOutUs: region.easeOutUs,
  })).filter((region) => region.sequence.endUs > region.sequence.startUs)
  // Composition units and sequence time verbatim — no pixel conversion, unlike blur/zoom above,
  // since the export host paints these with the same `CompositionLayers` scaling preview uses.
  const pictureEffectsFor = (endUs: number) => project.effects.flatMap((effect) => effect.kind === 'glow' && effect.enabled && effect.startUs < endUs && effect.amount > 0
    ? [{ id: effect.id, kind: 'glow' as const, sequence: { startUs: effect.startUs, endUs: Math.min(effect.endUs, endUs) },
      sigmaPx: compositionScalarToPixels(effect.radius, output), amount: effect.amount, threshold: effect.threshold }]
    : [])
  const effectsFor = (endUs: number) => project.effects.filter((effect) => effect.enabled && effect.startUs < endUs)
    .map((effect) => ({ ...effect, endUs: Math.min(effect.endUs, endUs) }))
  const audioPath = (clip: MediaClip) => resolver.assetPath(assetOf(clip))

  const flat = flatSequence(project)
  if (flat) {
    const durationUs = flat.asset.metadata!.durationUs!
    const path = resolver.assetPath(flat.asset)
    const manifest = exportManifestV2Schema.parse({
      version: 2,
      cues: displayedCues(project.cues, project.shownTranslation).filter((cue) => !cue.mediaAssetId || cue.mediaAssetId === flat.asset.id),
      style, display,
      ...(flat.identity ? {} : { segments: flat.videos.map((clip) => ({ startUs: clip.sourceStartUs, endUs: clip.sourceEndUs })) }),
      // The identity edit only: sequence time equals source time, so image clips are v2 overlays verbatim.
      overlays: flat.images.map((clip) => ({
        id: clip.id, startUs: clip.timelineStartUs, endUs: clipEndUs(clip), assetUrl: resolver.assetUrl(assetOf(clip)),
        rect: (clip.kind === 'image' && clip.rect) || fullFrameRect(format), opacity: clip.kind === 'image' ? clip.opacity : 1, fit: clip.kind === 'image' ? clip.fit : 'contain',
      })),
      blurRegions: blurFor(clipEndUs(flat.videos[flat.videos.length - 1])),
      audioClips: audio.filter((clip) => !flat.mirroredAudioIds.has(clip.id)).map((clip) => ({
        id: clip.id, path: audioPath(clip), delayUs: clip.timelineStartUs, inPointUs: clip.sourceStartUs,
        durationUs: clip.sourceEndUs - clip.sourceStartUs, gain: effectiveGain(clip, project.tracks),
      })),
    })
    return { manifest, plan: planForFormat(format, durationUs), inputPaths: [path] }
  }

  // v3. Images are painted by the export host — exact preview parity, ADR 0003 — whenever every image
  // sits above every video; only an image genuinely under a video is composited by FFmpeg (ADR 0005).
  // A generated background is composited by FFmpeg like video, so it counts as "under" a host image too.
  const hiddenAdjustmentTracks = new Set(project.tracks.filter((track) => track.hidden).map((track) => track.id))
  const adjustments = project.clips.filter((clip): clip is AdjustmentClip => clip.kind === 'adjustment' && clip.enabled !== false && !hiddenAdjustmentTracks.has(clip.trackId))
  // Host-painted images bypass FFmpeg's per-clip LUT chain. Route images through FFmpeg whenever
  // an adjustment is present so a graded image can never disappear from the grading path.
  const hostImages = imagesHostPainted(visual, project.tracks, { adjustments: adjustments.length > 0 })
  // One input per clip FFmpeg reads — never shared — so each clip gets its own decoder, seeked
  // straight to its source range (workers/media/exportArguments.ts `exportFilterGraphV3`).
  const inputs: { path: string; kind: 'video' | 'image' | 'audio' }[] = []
  const inputFor = (clip: MediaClip): number => inputs.push({ path: resolver.assetPath(assetOf(clip)), kind: clip.kind }) - 1
  const clips: ManifestClip[] = []
  const overlays: ExportManifestV3['overlays'] = []
  // A grade-free timeline never enters any of the code below (skipped by `hasAdjustments`, checked
  // once here), so its manifest — and FFmpeg arguments — stay byte-for-byte what they were before
  // this feature existed.
  const hasAdjustments = adjustments.length > 0
  const gradingClips: readonly Clip[] = [...visual, ...adjustments]
  const lutCache = new Map<string, { id: string; cube: Cube3D }>()
  const lutAssetOf = (assetId: string): ProjectAsset => {
    const asset = assets.get(assetId)
    if (!asset) throw new Error('An adjustment layer’s LUT is no longer in the project.')
    return asset
  }
  for (const clip of [...visual, ...audio].sort((a, b) => (order.get(a.trackId) ?? 0) - (order.get(b.trackId) ?? 0) || a.timelineStartUs - b.timelineStartUs)) {
    const trackIndex = order.get(clip.trackId) ?? 0
    if (clip.kind === 'image' && hostImages) {
      overlays.push({ id: clip.id, startUs: clip.timelineStartUs, endUs: clipEndUs(clip), assetUrl: resolver.assetUrl(assetOf(clip)),
        rect: clip.rect ?? fullFrameRect(format), opacity: clip.opacity, fit: clip.fit, ...(activeMask(clip.mask) ? { mask: clip.mask } : {}) })
      continue
    }
    if (clip.kind === 'color') {
      // A background is never graded in v1 (docs/EDITING.md), so it is never segmented either.
      clips.push({
        id: clip.id, kind: 'color', trackIndex, timelineStartUs: clip.timelineStartUs, sourceStartUs: clip.sourceStartUs, sourceEndUs: clip.sourceEndUs,
        fill: clip.fill, ...(clip.motion ? { motion: clip.motion } : {}), ...(clip.rect ? { rect: compositionToPixels(clip.rect, output) } : {}),
        opacity: clip.opacity, fit: 'contain', gain: 0, ...blendField(clip.blendMode), ...(activeMask(clip.mask) ? { mask: clip.mask } : {}),
      })
      continue
    }
    if (clip.kind === 'audio') {
      clips.push({ id: clip.id, inputIndex: inputFor(clip), assetId: clip.assetId, kind: 'audio', trackIndex,
        timelineStartUs: clip.timelineStartUs, sourceStartUs: clip.sourceStartUs, sourceEndUs: clip.sourceEndUs,
        ...(clip.speed ? { speed: clip.speed } : {}), opacity: 1, fit: 'contain', gain: effectiveGain(clip, project.tracks) })
      continue
    }
    // Video or image, FFmpeg-composited: split at grade boundaries when any adjustment layer exists
    // anywhere in the project — a segment with no adjustment above it bakes to no `lutId` at all.
    const range = { startUs: clip.timelineStartUs, endUs: clipEndUs(clip) }
    const segments = hasAdjustments ? gradeSegments(gradingClips, order, trackIndex, range) : [{ range, grades: [] as AdjustmentClip[] }]
    segments.forEach((segment, segmentIndex) => {
      const lutId = segment.grades.length ? bakeStackLut(segment.grades, (assetId) => resolver.lutCube(lutAssetOf(assetId)), lutCache) : undefined
      // A clip with nothing to split it (the overwhelming common case) keeps its own stored source
      // range verbatim rather than round-tripping it through `sourceUsAt`, so a project with no
      // overlapping grade over this particular clip — including every grade-free project — produces
      // byte-identical output to before this feature existed, speed curves included.
      const sourceStartUs = segments.length > 1 ? sourceUsAt(clip, segment.range.startUs) : clip.sourceStartUs
      const sourceEndUs = segments.length > 1 ? sourceUsAt(clip, segment.range.endUs) : clip.sourceEndUs
      clips.push({
        id: segments.length > 1 ? `${clip.id}#${segmentIndex}` : clip.id, inputIndex: inputFor(clip), assetId: clip.assetId, kind: clip.kind, trackIndex,
        timelineStartUs: segment.range.startUs, sourceStartUs, sourceEndUs,
        ...(clip.kind !== 'image' && clip.speed ? { speed: clip.speed } : {}),
        ...(clip.rect ? { rect: compositionToPixels(clip.rect, output) } : {}), opacity: clip.opacity, fit: clip.fit,
        gain: clip.kind === 'video' ? effectiveGain(clip, project.tracks) : 0,
        ...blendField(clip.blendMode),
        ...(activeMask(clip.mask) ? { mask: clip.mask } : {}),
        ...(lutId ? { lutId } : {}),
      })
    })
  }
  if (inputs.length > 250) throw new Error(`This timeline reads ${inputs.length} clips; one export can read at most 250. Join or remove some clips first.`)
  const sequenceDurationUs = Math.max(0, ...clips.map((clip) => clip.timelineStartUs + timelineLengthUs(clip)), ...overlays.map((overlay) => overlay.endUs))
  if (sequenceDurationUs <= 0) throw new Error('Add a video, image or sound to the timeline before exporting a video.')
  const captionAssets = new Set(clips.flatMap((clip) => clip.kind === 'video' && clip.assetId ? [clip.assetId] : []))
  const luts = [...lutCache.values()].map(({ id, cube }) => ({ id, size: cube.size, data: encodeCubeData(cube.data) }))
  const manifest = exportManifestV3Schema.parse({
    version: 3,
    cues: displayedCues(project.cues, project.shownTranslation).filter((cue) => cue.mediaAssetId ? captionAssets.has(cue.mediaAssetId) : !captionAssets.size),
    style, display, format, sequenceDurationUs, inputs, clips, overlays, luts,
    blurRegions: blurFor(sequenceDurationUs),
    zoomRegions: zoomFor(sequenceDurationUs),
    effects: effectsFor(sequenceDurationUs),
    pictureEffects: pictureEffectsFor(sequenceDurationUs),
    textOverlays: project.textOverlays.filter((item) => item.startUs < sequenceDurationUs).map((item) => ({ ...item, endUs: Math.min(item.endUs, sequenceDurationUs) })),
    shapes: project.shapes.filter((item) => item.startUs < sequenceDurationUs).map((item) => ({ ...item, endUs: Math.min(item.endUs, sequenceDurationUs) })),
    captionMasks: Object.fromEntries(project.captionTracks.flatMap((track) => activeMask(track.mask) ? [[track.id, track.mask]] : [])),
    captionOpacities: Object.fromEntries(project.captionTracks.flatMap((track) => track.opacity !== undefined && track.opacity < 1 ? [[track.id, track.opacity]] : [])),
  })
  return { manifest, plan: planForFormat(format, sequenceDurationUs), inputPaths: inputs.map((input) => input.path) }
}
