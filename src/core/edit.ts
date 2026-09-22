import { z } from 'zod'
import { projectMediaSchema, rationalSchema } from './media'

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

/** An effect over the composited program: sequence-timed, with no asset, source or in point. */
export const blurRegionSchema = z.strictObject({
  id: itemId,
  ...timeRange,
  rect: compositionRectSchema,
  /** Gaussian sigma in composition units; CSS `blur(r)` is Gaussian with σ = r, matching `gblur`. */
  radius: z.number().finite().min(1).max(100),
}).refine(endAfterStart, 'Blur region end must follow its start')

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
export type VideoClip = z.infer<typeof videoClipSchema>
export type ImageClip = z.infer<typeof imageClipSchema>
export type AudioClip = z.infer<typeof audioClipSchema>
export type Clip = z.infer<typeof clipSchema>
export type ClipKind = Clip['kind']
export type VisualClip = VideoClip | ImageClip
export type BlurRegion = z.infer<typeof blurRegionSchema>
export type Marker = z.infer<typeof markerSchema>
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
