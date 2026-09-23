import { z } from 'zod'
import { projectMediaSchema, rationalSchema } from './media'
import { captionStyleSchema } from '../captions/style'

/**
 * Composition space (docs/EDITING.md): a fixed 1080-unit-wide canvas whose height is
 * `1080 / display aspect`, so composition → output pixels is the single scalar
 * `output.width / COMPOSITION_WIDTH` (src/core/composition.ts).
 */
export const COMPOSITION_WIDTH = 1080

const sourceUs = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const positiveUs = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const itemId = z.string().min(1).max(128)

/**
 * The **width** bound belongs here because the composition is always 1080 units wide. The
 * **height** bound does not: it depends on the sequence format's aspect, which can change. A rect
 * taller than the current composition is a command-time warning (`CommandContext.compositionHeight`)
 * — never a schema error, so changing the format can never make a saved project unloadable.
 */
export const compositionRectSchema = z.strictObject({
  x: z.number().finite().min(0).max(COMPOSITION_WIDTH),
  y: z.number().finite().min(0),
  width: z.number().finite().positive().max(COMPOSITION_WIDTH),
  height: z.number().finite().positive(),
}).refine((rect) => rect.x + rect.width <= COMPOSITION_WIDTH, 'Rect must stay inside the composition width')

/** Assets reuse the media reference/fingerprint/metadata shape, so portable relative paths,
 * identity checks and relinking (electron/projectMedia.ts) apply to them unchanged. */
export const projectAssetSchema = projectMediaSchema.extend({
  id: itemId,
  kind: z.enum(['image', 'audio', 'video']),
})

const timeRange = { startUs: sourceUs, endUs: positiveUs }
const endAfterStart = (item: { startUs: number; endUs: number }) => item.endUs > item.startUs

/** Cues name the video asset whose source time they are stored in (docs/EDITING.md "Schema 5"). */
export const mediaAssetIdSchema = itemId.optional()

const fitSchema = z.enum(['contain', 'cover', 'stretch'])

// ---------------------------------------------------------------------------------------------
// Schema 5: a stacked multi-track timeline.
// ---------------------------------------------------------------------------------------------

/**
 * One timeline lane. `project.tracks` is ordered **back to front** — the same convention
 * `project.overlays` used — so a video track later in the array paints over an earlier one. The
 * timeline draws video tracks in reverse array order (V2 above V1) and audio tracks in array order.
 */
export const trackSchema = z.strictObject({
  id: itemId,
  kind: z.enum(['video', 'audio']),
  /** Empty derives `V1`/`V2`/`A1` from the track's position among tracks of its kind. */
  name: z.string().max(120).default(''),
  muted: z.boolean().default(false),
  /** Video tracks only: hidden tracks neither paint in preview nor reach the export. */
  hidden: z.boolean().default(false),
  locked: z.boolean().default(false),
  heightPx: z.number().int().min(24).max(400).optional(),
})

/**
 * One caption lane (docs/EDITING.md "Schema 6"): an organizational track cues can be grouped and
 * reordered onto, and locked against edits. `project.captionTracks` is ordered back to front like
 * `project.tracks`. Cues reference one by `cue.captionTrackId`. Deliberately no `hidden` yet:
 * preview and export do not yet pick one cue per visible caption track the way they already do for
 * stacked video (`activeCueAt` still finds the first time-matching cue across every caption track,
 * unchanged) — a `hidden` flag here would look like it removes a track from the output without
 * doing so. It lands with that slice instead.
 */
export const captionTrackSchema = z.strictObject({
  id: itemId,
  /** Empty derives `C1`/`C2` from the track's position, the same way a video/audio track's does. */
  name: z.string().max(120).default(''),
  locked: z.boolean().default(false),
})

/**
 * Every clip sits at an **absolute** sequence position, so gaps are allowed and array order carries
 * no information. There is deliberately no `rate`/speed field: a clip's timeline length is always
 * `sourceEndUs - sourceStartUs`, which is what keeps every source↔sequence mapping a pure
 * translation (src/core/timelineModel.ts). Retiming would add a scale to all of them.
 */
const clipBase = {
  id: itemId,
  trackId: itemId,
  assetId: itemId,
  timelineStartUs: sourceUs,
  sourceStartUs: sourceUs,
  sourceEndUs: positiveUs,
}
const sourceEndAfterStart = (clip: { sourceStartUs: number; sourceEndUs: number }) => clip.sourceEndUs > clip.sourceStartUs
const clipLengthMessage = 'A clip’s source end must follow its start'

const visualShape = {
  ...clipBase,
  /** Absent fills the frame; present places the clip picture-in-picture, in composition units. */
  rect: compositionRectSchema.optional(),
  opacity: z.number().finite().min(0).max(1).default(1),
  fit: fitSchema.default('contain'),
}

export const videoClipSchema = z.strictObject({
  kind: z.literal('video'), ...visualShape,
  /** The video's own audio. Preview clamps anything above 1 to 1; export honours it. */
  gain: z.number().finite().min(0).max(4).default(1),
}).refine(sourceEndAfterStart, clipLengthMessage)

/** An image has no source time of its own: its source range is synthetic, always starting at 0, so
 * one length formula, one trim gesture and one split implementation serve every clip kind. */
export const imageClipSchema = z.strictObject({ kind: z.literal('image'), ...visualShape }).refine(sourceEndAfterStart, clipLengthMessage)

export const audioClipSchema = z.strictObject({
  kind: z.literal('audio'), ...clipBase,
  gain: z.number().finite().min(0).max(4).default(1),
}).refine(sourceEndAfterStart, clipLengthMessage)

export const clipSchema = z.discriminatedUnion('kind', [videoClipSchema, imageClipSchema, audioClipSchema])

/**
 * A point note on the sequence-time ruler — not an edit, just a place to come back to. Authored by
 * the user or, over MCP (`docs/MCP.md`), by an agent proposing a shot list from the transcript; the
 * user accepts or dismisses each one on the timeline rather than the suggestion living only in chat.
 */
export const markerSchema = z.strictObject({
  id: itemId,
  atUs: sourceUs,
  text: z.string().max(200).default(''),
  color: z.string().regex(/^#[\da-fA-F]{6}$/).optional(),
})

export const textAnimationSchema = z.strictObject({
  kind: z.enum(['none', 'fade', 'pop', 'slide']),
  durationUs: z.number().int().nonnegative().max(5_000_000).default(250_000),
  direction: z.enum(['left', 'right', 'up', 'down']).optional(),
}).superRefine((animation, context) => {
  if (animation.kind === 'slide' && !animation.direction) context.addIssue({ code: 'custom', path: ['direction'], message: 'Slide animation needs a direction.' })
})
export const textOverlaySchema = z.strictObject({
  id: itemId,
  text: z.string().trim().min(1).max(16000),
  startUs: sourceUs,
  endUs: positiveUs,
  style: captionStyleSchema,
  enter: textAnimationSchema,
  exit: textAnimationSchema,
  /** Negative values paint below captions; positive values paint above them. */
  layerOrder: z.number().int().min(-10000).max(10000).default(1),
}).refine((overlay) => overlay.endUs > overlay.startUs, 'Text end must follow its start')

/** An effect over the composited program: sequence-timed, with no asset, source or in point.
 * `enabled` (schema 8) bypasses the effect without deleting it: preview and export both skip a
 * disabled region, but it keeps its place in the lane and still counts toward the non-overlap rule. */
export const blurRegionSchema = z.strictObject({
  id: itemId,
  ...timeRange,
  rect: compositionRectSchema,
  /** Gaussian sigma in composition units; CSS `blur(r)` is Gaussian with σ = r, matching `gblur`. */
  radius: z.number().finite().min(1).max(100),
  enabled: z.boolean().default(true),
}).refine(endAfterStart, 'Blur region end must follow its start')

/**
 * A camera move over the composited program (docs/EDITING.md "Zoom regions"): sequence-timed, with
 * no asset, source or in point — the same shape as `blurRegionSchema`. `rect` is the target framing
 * in composition units; the picture eases from the full frame into it over `easeInUs`, holds, and
 * eases back out over `easeOutUs`. Deliberately one static target rather than keyframed `from`/`to`
 * rects: one rect is one gizmo drag, and it covers both "zoom in and hold" and "start tight, pull
 * out" (`easeInUs: 0`). Only the video picture zooms — captions and host-painted overlays stay
 * pinned to the output frame, which is what keeps export's frame-signature dedup (layerPlan.ts)
 * untouched by this feature. `enabled` (schema 8) bypasses the zoom the same way as blur, above.
 */
export const zoomRegionSchema = z.strictObject({
  id: itemId,
  ...timeRange,
  rect: compositionRectSchema,
  easeInUs: z.number().int().nonnegative().max(5_000_000).default(500_000),
  easeOutUs: z.number().int().nonnegative().max(5_000_000).default(500_000),
  enabled: z.boolean().default(true),
}).refine(endAfterStart, 'Zoom region end must follow its start')

const hexColor = z.string().regex(/^#[\da-fA-F]{6}$/)
const easeUs = z.number().int().nonnegative().max(5_000_000)

/**
 * Frame-paint effects (docs/EDITING.md "Frame-paint effects"): sequence-timed, with no asset,
 * source or in point — the same shape blur and zoom regions use — but painted by the shared React
 * caption/overlay host layer (`CompositionLayers.tsx`) in both preview and export rather than by an
 * FFmpeg filter, so parity is exact by construction instead of a measured tolerance. Vignette and
 * letterbox paint under the captions, pinned to the output frame like a host-painted image overlay
 * (they never zoom with the picture); fade paints over everything, including captions. Each kind is
 * its own lane with its own non-overlap rule (`model.ts`) — unlike zoom's one lane, two regions of
 * *different* kinds may freely overlap in time (e.g. a vignette held under a fade to black).
 */
const effectRegionBase = { id: itemId, ...timeRange, enabled: z.boolean().default(true) }
export const vignetteEffectSchema = z.strictObject({
  ...effectRegionBase, kind: z.literal('vignette'),
  amount: z.number().finite().min(0).max(1),
  softness: z.number().finite().min(0).max(1),
}).refine(endAfterStart, 'Effect end must follow its start')
export const letterboxEffectSchema = z.strictObject({
  ...effectRegionBase, kind: z.literal('letterbox'),
  /** Target display aspect (width / height), e.g. 2.39. Bars land top/bottom or left/right,
   * whichever the composition's own aspect calls for (`frameEffects.ts`). */
  aspect: z.number().finite().min(0.2).max(5),
  color: hexColor.default('#000000'),
  easeInUs: easeUs.default(300_000),
  easeOutUs: easeUs.default(300_000),
}).refine(endAfterStart, 'Effect end must follow its start')
export const fadeEffectSchema = z.strictObject({
  ...effectRegionBase, kind: z.literal('fade'),
  shape: z.enum(['in', 'out', 'dip']),
  color: hexColor.default('#000000'),
  /** Only `dip` uses both edges; `in`/`out` ramp across the region's whole length. */
  easeInUs: easeUs.default(300_000),
  easeOutUs: easeUs.default(300_000),
}).refine(endAfterStart, 'Effect end must follow its start')
export const effectRegionSchema = z.discriminatedUnion('kind', [vignetteEffectSchema, letterboxEffectSchema, fadeEffectSchema])

/**
 * The output frame. Load-bearing: the caption composition is derived from it, so stacked videos
 * of different aspects never re-layout captions mid-playback. Set from the first video's probed
 * media — exactly what `formatFromMedia` (src/core/format.ts) computes — and editable later.
 */
export const sequenceFormatSchema = z.strictObject({
  width: z.number().int().min(16).max(3840).multipleOf(2),
  height: z.number().int().min(16).max(3840).multipleOf(2),
  frameRate: rationalSchema.refine((rate) => rate.numerator / rate.denominator >= 1 && rate.numerator / rate.denominator <= 60, 'Frame rate must be between 1 and 60 fps'),
})

export type CompositionRect = z.infer<typeof compositionRectSchema>
export type ProjectAsset = z.infer<typeof projectAssetSchema>
export type Track = z.infer<typeof trackSchema>
export type TrackKind = Track['kind']
export type CaptionTrack = z.infer<typeof captionTrackSchema>
export type VideoClip = z.infer<typeof videoClipSchema>
export type ImageClip = z.infer<typeof imageClipSchema>
export type AudioClip = z.infer<typeof audioClipSchema>
export type Clip = z.infer<typeof clipSchema>
export type ClipKind = Clip['kind']
export type VisualClip = VideoClip | ImageClip
export type BlurRegion = z.infer<typeof blurRegionSchema>
export type ZoomRegion = z.infer<typeof zoomRegionSchema>
export type EffectRegion = z.infer<typeof effectRegionSchema>
export type VignetteEffect = z.infer<typeof vignetteEffectSchema>
export type LetterboxEffect = z.infer<typeof letterboxEffectSchema>
export type FadeEffect = z.infer<typeof fadeEffectSchema>
export type EffectRegionKind = EffectRegion['kind']
export type Marker = z.infer<typeof markerSchema>
export type TextAnimation = z.infer<typeof textAnimationSchema>
export type TextOverlay = z.infer<typeof textOverlaySchema>
export type SequenceFormat = z.infer<typeof sequenceFormatSchema>
export type ClipFit = z.infer<typeof fitSchema>

// ---------------------------------------------------------------------------------------------
// Schemas 3 and 4, retained verbatim so their files still parse and migrate (src/core/migrateV4.ts).
// ---------------------------------------------------------------------------------------------

export const legacyImageOverlaySchema = z.strictObject({
  id: itemId,
  ...timeRange,
  mediaAssetId: mediaAssetIdSchema,
  assetId: itemId,
  rect: compositionRectSchema,
  opacity: z.number().finite().min(0).max(1).default(1),
  fit: fitSchema.default('contain'),
}).refine(endAfterStart, 'Overlay end must follow its start')

export const legacyBlurRegionSchema = z.strictObject({
  id: itemId,
  ...timeRange,
  mediaAssetId: mediaAssetIdSchema,
  rect: compositionRectSchema,
  radius: z.number().finite().min(1).max(100),
}).refine(endAfterStart, 'Blur region end must follow its start')

export const legacyAudioClipSchema = z.strictObject({
  id: itemId,
  assetId: itemId,
  /** The video asset `atUs` is anchored in (not the sound file, which is `assetId`). */
  mediaAssetId: mediaAssetIdSchema,
  /** A source-time anchor. */
  atUs: sourceUs,
  inPointUs: sourceUs.default(0),
  durationUs: positiveUs.nullable().default(null),
  gain: z.number().finite().min(0).max(4).default(1),
})

/** One kept source range of schema 3. */
export const segmentSchema = z.strictObject({ id: itemId, ...timeRange })
  .refine(endAfterStart, 'Segment end must follow its start')

/** Schema 4's clip: a source range of a video asset, positioned by its index in `project.clips`. */
export const legacyClipSchema = z.strictObject({ id: itemId, assetId: itemId, ...timeRange })
  .refine(endAfterStart, 'Clip end must follow its start')

export type LegacyImageOverlay = z.infer<typeof legacyImageOverlaySchema>
export type LegacyBlurRegion = z.infer<typeof legacyBlurRegionSchema>
export type LegacyAudioClip = z.infer<typeof legacyAudioClipSchema>
export type LegacyClip = z.infer<typeof legacyClipSchema>
export type Segment = z.infer<typeof segmentSchema>
