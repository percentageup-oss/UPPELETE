import { z } from 'zod'
import { projectMediaSchema, rationalSchema } from './media'
import { captionStyleSchema, titleMotionSchema } from '../captions/style'
import { LOOKS } from '../color/looks'
import type { LogProfile } from '../color/transfer'

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

/**
 * Layer mask (schema 12, docs/EDITING.md "Layer masks"): one optional static shape per masked item,
 * in composition units — outside the shape the item is transparent (or, inverted, inside). Points
 * are not bound to the frame: a mask may overhang it. Rendered by one shared generator
 * (`layerMask.ts`) so preview, the export host and FFmpeg's mask input all agree.
 */
const maskCoord = z.number().finite().min(-20000).max(20000)
const maskPoint = z.strictObject({ x: maskCoord, y: maskCoord })
export const maskPathPointSchema = z.strictObject({
  ...maskPoint.shape,
  /** Bezier handles, absolute positions. Absent means a corner on that side. */
  in: maskPoint.optional(),
  out: maskPoint.optional(),
})
const maskBox = z.strictObject({
  x: maskCoord, y: maskCoord,
  width: z.number().finite().positive().max(40000), height: z.number().finite().positive().max(40000),
})
export const maskShapeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('rect'), rect: maskBox, cornerRadius: z.number().finite().min(0).max(20000).default(0) }),
  z.strictObject({ kind: z.literal('ellipse'), rect: maskBox }),
  z.strictObject({ kind: z.literal('path'), points: z.array(maskPathPointSchema).min(3).max(256) }),
])
export const layerMaskSchema = z.strictObject({
  enabled: z.boolean().default(true),
  invert: z.boolean().default(false),
  /** Soft edge width in composition units (Gaussian σ = feather / 2). */
  feather: z.number().finite().min(0).max(200).default(0),
  /** How much of the item shows inside the mask, 0–1. */
  density: z.number().finite().min(0).max(1).default(1),
  shape: maskShapeSchema,
})
export type LayerMask = z.infer<typeof layerMaskSchema>
export type MaskShape = z.infer<typeof maskShapeSchema>
export type MaskPathPoint = z.infer<typeof maskPathPointSchema>

/** Assets reuse the media reference/fingerprint/metadata shape, so portable relative paths,
 * identity checks and relinking (electron/projectMedia.ts) apply to them unchanged. */
export const projectAssetSchema = projectMediaSchema.extend({
  id: itemId,
  /** Schema 16: `lut` is a user-imported `.cube` file (`src/color/cube.ts`), referenced the same way
   * as media — relative/absolute path, fingerprint and relinking (electron/projectMedia.ts) — even
   * though it has no video/audio streams of its own. */
  kind: z.enum(['image', 'audio', 'video', 'lut']),
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
  /** Schema 15, audio tracks: when any audio track is soloed only soloed tracks are heard. Absent = off. */
  solo: z.boolean().optional(),
  /** Schema 15, audio tracks: the track fader (linear gain, 1 = 0 dB). Absent = 1. */
  volume: z.number().finite().min(0).max(4).optional(),
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
  /** Schema 12: masks the whole caption plane of this track (every cue). */
  mask: layerMaskSchema.optional(),
})

/**
 * Every clip sits at an **absolute** sequence position, so gaps are allowed and array order carries
 * no information. A clip's timeline length is `sourceEndUs - sourceStartUs` unless it carries a
 * `speed` curve (schema 14, video and audio clips only); every source↔sequence conversion goes
 * through src/core/clipTime.ts, which is a pure translation while `speed` is absent.
 */
const clipTiming = {
  id: itemId,
  trackId: itemId,
  timelineStartUs: sourceUs,
  sourceStartUs: sourceUs,
  sourceEndUs: positiveUs,
  /** Schema 15: a disabled clip stays on the timeline but is skipped by preview and export. Absent = enabled. */
  enabled: z.boolean().optional(),
}

/**
 * Schema 14: a clip's playback speed as a piecewise-linear curve over the asset's **source** time, so
 * splitting or trimming never rewrites it. One point (or all rates equal) is constant speed; the rate
 * holds its first/last value outside the points. Rates are bounded so the export graph stays sane.
 */
export const SPEED_MIN = 0.1
export const SPEED_MAX = 10
export const speedPointSchema = z.strictObject({ sourceUs, rate: z.number().finite().min(SPEED_MIN).max(SPEED_MAX) })
export const clipSpeedSchema = z.strictObject({ points: z.array(speedPointSchema).min(1).max(32) })
  .refine((speed) => speed.points.every((point, index) => index === 0 || point.sourceUs > speed.points[index - 1].sourceUs), 'Speed points must be in strictly increasing source order')
export type ClipSpeed = z.infer<typeof clipSpeedSchema>
const clipBase = { ...clipTiming, assetId: itemId }
const sourceEndAfterStart = (clip: { sourceStartUs: number; sourceEndUs: number }) => clip.sourceEndUs > clip.sourceStartUs
const clipLengthMessage = 'A clip’s source end must follow its start'

const visualFields = {
  /** Absent fills the frame; present places the clip picture-in-picture, in composition units. */
  rect: compositionRectSchema.optional(),
  opacity: z.number().finite().min(0).max(1).default(1),
  fit: fitSchema.default('contain'),
  mask: layerMaskSchema.optional(),
}
const visualShape = { ...clipBase, ...visualFields }

export const videoClipSchema = z.strictObject({
  kind: z.literal('video'), ...visualShape,
  /** The video's own audio. Preview clamps anything above 1 to 1; export honours it. */
  gain: z.number().finite().min(0).max(4).default(1),
  speed: clipSpeedSchema.optional(),
  /** Schema 15: true when the video's sound lives in a linked audio clip instead — the video is then
   * silent. Absent/false is the legacy behaviour: the video carries its own sound. */
  detachedAudio: z.boolean().optional(),
  /** Schema 15: clips sharing a `linkId` are cut, moved, trimmed and deleted together (one video at most). */
  linkId: itemId.optional(),
}).refine(sourceEndAfterStart, clipLengthMessage)

/** An image has no source time of its own: its source range is synthetic, always starting at 0, so
 * one length formula, one trim gesture and one split implementation serve every clip kind. */
export const imageClipSchema = z.strictObject({ kind: z.literal('image'), ...visualShape }).refine(sourceEndAfterStart, clipLengthMessage)

export const audioClipSchema = z.strictObject({
  kind: z.literal('audio'), ...clipBase,
  gain: z.number().finite().min(0).max(4).default(1),
  speed: clipSpeedSchema.optional(),
  /** Schema 15: see `videoClipSchema.linkId`. An audio clip may reference a video asset (its first audio stream). */
  linkId: itemId.optional(),
}).refine(sourceEndAfterStart, clipLengthMessage)

const fillHex = z.string().regex(/^#[\da-fA-F]{6}$/)

/** A generated picture with no media behind it: a flat color or a two-stop linear gradient. `angle`
 * follows CSS `linear-gradient` (0° points up, 90° right), so preview and export derive the same line. */
export const fillSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('solid'), color: fillHex }),
  z.strictObject({ type: z.literal('gradient'), from: fillHex, to: fillHex, angle: z.number().finite().min(0).max(360) }),
  // A grid of `line` over `background`. `cell` and `thickness` are composition units (1080 wide);
  // for `perspective` they are measured at the bottom centre of the frame and `horizon` is where the
  // floor vanishes, as a fraction of the frame height (absent → `DEFAULT_GRID_HORIZON`).
  z.strictObject({
    type: z.literal('grid'), pattern: z.enum(['lines', 'dots', 'perspective']), background: fillHex, line: fillHex,
    cell: z.number().finite().min(8).max(400), thickness: z.number().finite().min(1).max(48), horizon: z.number().finite().min(0.1).max(0.8).optional(),
  }).refine((grid) => grid.thickness < grid.cell, { path: ['thickness'], message: 'Grid lines must be thinner than a cell.' }),
])

/** Preset motion for a color clip (schema 13). The loop phase is a pure function of time since the
 * clip's synthetic source start, so it survives moves and splits; `periodUs` is one full there-and-back. */
const motionPeriod = z.number().int().min(1_000_000).max(20_000_000)
export const backgroundMotionSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('shift'), to: fillSchema, periodUs: motionPeriod }),
  z.strictObject({ type: z.literal('pulse'), toward: z.enum(['black', 'white']), depth: z.number().finite().min(0).max(1), periodUs: motionPeriod }),
  z.strictObject({ type: z.literal('drift'), direction: z.number().finite().min(0).max(360), periodUs: motionPeriod }),
  // Grid fills only: the pattern travels continuously one cell per `periodUs` toward `direction`
  // (CSS angle). It has no there-and-back and no seam, so it may be faster than a loop can be.
  z.strictObject({ type: z.literal('scroll'), direction: z.number().finite().min(0).max(360), periodUs: z.number().int().min(250_000).max(20_000_000) }),
])

/** Like an image, its source range is synthetic and starts at 0; there is no asset. */
export const colorClipSchema = z.strictObject({
  kind: z.literal('color'), ...clipTiming, ...visualFields,
  fill: fillSchema,
  motion: backgroundMotionSchema.optional(),
}).refine(sourceEndAfterStart, clipLengthMessage)

// ---------------------------------------------------------------------------------------------
// Schema 16: adjustment layers (docs/EDITING.md "Color: adjustment layers"). A DaVinci-style clip
// that grades every picture clip on the tracks below it, for its own time range, instead of
// carrying a picture of its own — see `src/color/bake.ts` for the grade → LUT pipeline this mirrors.
// ---------------------------------------------------------------------------------------------

const rgbTripletSchema = z.tuple([
  z.number().finite().min(-1).max(1), z.number().finite().min(-1).max(1), z.number().finite().min(-1).max(1),
])

/** Mirrors `ToneShape` in `src/color/primaries.ts` — see that file for what each control means. */
export const toneShapeSchema = z.strictObject({
  contrast: z.number().finite().min(-1).max(1).default(0),
  highlights: z.number().finite().min(-1).max(1).default(0),
  shadows: z.number().finite().min(-1).max(1).default(0),
  saturation: z.number().finite().min(-1).max(2).default(0),
  lift: rgbTripletSchema.default([0, 0, 0]),
  gamma: rgbTripletSchema.default([0, 0, 0]),
  gain: rgbTripletSchema.default([0, 0, 0]),
})

/** Mirrors `PrimariesGrade` in `src/color/primaries.ts`. */
export const primariesGradeSchema = z.strictObject({
  ...toneShapeSchema.shape,
  exposureStops: z.number().finite().min(-5).max(5).default(0),
  temperature: z.number().finite().min(-1).max(1).default(0),
  tint: z.number().finite().min(-1).max(1).default(0),
})

/** The six built-in camera log curves `src/color/transfer.ts` implements; kept in sync with its
 * `LogProfile` union by the `satisfies` check below. */
const LOG_PROFILES = ['f-log', 'f-log2', 's-log3', 'apple-log', 'v-log', 'c-log3'] as const satisfies readonly LogProfile[]
export const logProfileSchema = z.enum(LOG_PROFILES)

/** `'lut'` names a `lut`-kind asset rather than embedding the (potentially large) baked cube in every
 * clip; preview and export resolve it to a `Cube3D` (`src/color/cube.ts`) before evaluating the grade. */
export const gradeInputSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('none') }),
  z.strictObject({ type: z.literal('log'), profile: logProfileSchema }),
  z.strictObject({ type: z.literal('lut'), assetId: itemId }),
])

/** Validated against the live `LOOKS` library (`src/color/looks.ts`) rather than a hardcoded id list,
 * so a project file always names a look this build actually ships. */
export const gradeLookSchema = z.strictObject({
  id: z.string().refine((id) => LOOKS.some((look) => look.id === id), 'Unknown look id'),
  strength: z.number().finite().min(0).max(1).default(1),
})

/** Mirrors `Grade` in `src/color/bake.ts`, modulo `input`'s `lut` variant (see `gradeInputSchema`). */
export const gradeSchema = z.strictObject({
  input: gradeInputSchema,
  primaries: primariesGradeSchema,
  look: gradeLookSchema.nullable().default(null),
  intensity: z.number().finite().min(0).max(1).default(1),
})

/** No asset, no picture of its own — its synthetic source range starts at 0, like a color clip.
 * `enabled` (inherited from `clipTiming`) is the grade's own bypass toggle. */
export const adjustmentClipSchema = z.strictObject({
  kind: z.literal('adjustment'), ...clipTiming,
  grade: gradeSchema,
}).refine(sourceEndAfterStart, clipLengthMessage)

export const clipSchema = z.discriminatedUnion('kind', [videoClipSchema, imageClipSchema, colorClipSchema, audioClipSchema, adjustmentClipSchema])

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
  /** Optional sequence-time entrance treatment. Older authored titles have no such motion. */
  titleMotion: titleMotionSchema.optional(),
  /** Negative values paint below captions; positive values paint above them. */
  layerOrder: z.number().int().min(-10000).max(10000).default(1),
  mask: layerMaskSchema.optional(),
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
  mask: layerMaskSchema.optional(),
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
  /** Schema 11 pan / Ken Burns: when present the picture moves `fromRect → rect` across the whole
   * region (no hold, no return to the full frame). Absent means the plain zoom above. */
  fromRect: compositionRectSchema.optional(),
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
/** Schema 12: frame-paint effects are host-painted, so they can be masked; glow reads the picture and cannot. */
const maskableEffectBase = { ...effectRegionBase, mask: layerMaskSchema.optional() }
export const vignetteEffectSchema = z.strictObject({
  ...maskableEffectBase, kind: z.literal('vignette'),
  amount: z.number().finite().min(0).max(1),
  softness: z.number().finite().min(0).max(1),
}).refine(endAfterStart, 'Effect end must follow its start')
export const letterboxEffectSchema = z.strictObject({
  ...maskableEffectBase, kind: z.literal('letterbox'),
  /** Target display aspect (width / height), e.g. 2.39. Bars land top/bottom or left/right,
   * whichever the composition's own aspect calls for (`frameEffects.ts`). */
  aspect: z.number().finite().min(0.2).max(5),
  color: hexColor.default('#000000'),
  easeInUs: easeUs.default(300_000),
  easeOutUs: easeUs.default(300_000),
}).refine(endAfterStart, 'Effect end must follow its start')
export const fadeEffectSchema = z.strictObject({
  ...maskableEffectBase, kind: z.literal('fade'),
  shape: z.enum(['in', 'out', 'dip']),
  color: hexColor.default('#000000'),
  /** Only `dip` uses both edges; `in`/`out` ramp across the region's whole length. */
  easeInUs: easeUs.default(300_000),
  easeOutUs: easeUs.default(300_000),
}).refine(endAfterStart, 'Effect end must follow its start')
/** Film grain and VHS are texture overlays: painted over the picture (under captions, so text stays
 * crisp) and animated in absolute sequence time — the noise re-seeds at a fixed 24 Hz "film rate"
 * (`frameEffects.ts`), never per rendered frame, so preview and export show the same texture. VHS is
 * an overlay-only look (scanlines, tracking band, color bleed, flicker): it cannot displace or
 * channel-split the picture itself, which FFmpeg composes before the host layer exists. */
export const grainEffectSchema = z.strictObject({
  ...maskableEffectBase, kind: z.literal('grain'),
  amount: z.number().finite().min(0).max(1),
  /** Grain cell size in composition units. */
  size: z.number().finite().min(0.5).max(6),
}).refine(endAfterStart, 'Effect end must follow its start')
export const vhsEffectSchema = z.strictObject({
  ...maskableEffectBase, kind: z.literal('vhs'),
  /** Overall strength; scales every component below. */
  amount: z.number().finite().min(0).max(1),
  scanlines: z.number().finite().min(0).max(1),
  /** Strength of the rolling tracking-noise band and the bottom head-switching noise. */
  tracking: z.number().finite().min(0).max(1),
}).refine(endAfterStart, 'Effect end must follow its start')
/** Light particles are generated in the shared transparent frame-paint layer. Their positions are
 * derived from effect identity and the absolute 60 Hz sequence tick, so seeking and export agree. */
export const particlesEffectSchema = z.strictObject({
  ...maskableEffectBase, kind: z.literal('particles'),
  amount: z.number().finite().min(0).max(1),
  /** Maximum particle radius in composition units. */
  size: z.number().finite().min(1).max(12),
  /** Motion multiplier; zero freezes drift and two doubles the default rate. */
  speed: z.number().finite().min(0).max(2),
  color: hexColor.default('#FFD6A0'),
}).refine(endAfterStart, 'Effect end must follow its start')
/** Dreamy glow is a *picture* effect, not frame-paint: it reads the picture's own pixels (bright areas
 * are isolated, blurred and screened back), so preview applies it as a filter on the picture and
 * export as an FFmpeg chain after zoom (`pictureEffectsAt`, `pictureEffectChain`). Captions stay crisp. */
export const glowEffectSchema = z.strictObject({
  ...effectRegionBase, kind: z.literal('glow'),
  /** Screen-blend strength of the bloom. */
  amount: z.number().finite().min(0).max(1),
  /** Blur radius in composition units. */
  radius: z.number().finite().min(2).max(80),
  /** Luminance (0–1) above which the picture starts to bloom. */
  threshold: z.number().finite().min(0).max(0.95),
}).refine(endAfterStart, 'Effect end must follow its start')
export const effectRegionSchema = z.discriminatedUnion('kind', [vignetteEffectSchema, letterboxEffectSchema, fadeEffectSchema, grainEffectSchema, vhsEffectSchema, particlesEffectSchema, glowEffectSchema])

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
/** A clip backed by a media asset (everything but the generated `color` and `adjustment` kinds). */
export type MediaClip = Exclude<Clip, { kind: 'color' | 'adjustment' }>
export type Fill = z.infer<typeof fillSchema>
export type BackgroundMotion = z.infer<typeof backgroundMotionSchema>
export type ColorClip = Extract<Clip, { kind: 'color' }>
export type ToneShape = z.infer<typeof toneShapeSchema>
export type PrimariesGrade = z.infer<typeof primariesGradeSchema>
export type GradeInput = z.infer<typeof gradeInputSchema>
export type GradeLook = z.infer<typeof gradeLookSchema>
export type Grade = z.infer<typeof gradeSchema>
export type AdjustmentClip = z.infer<typeof adjustmentClipSchema>
/** The asset a clip plays, or null for a generated clip (`color`, `adjustment`). Comparisons against
 * a real asset id are therefore never true for either. */
export const assetIdOf = (clip: Clip): string | null => clip.kind === 'color' || clip.kind === 'adjustment' ? null : clip.assetId
export type ClipKind = Clip['kind']
export type VisualClip = VideoClip | ImageClip | ColorClip
export type BlurRegion = z.infer<typeof blurRegionSchema>
export type ZoomRegion = z.infer<typeof zoomRegionSchema>
export type EffectRegion = z.infer<typeof effectRegionSchema>
export type VignetteEffect = z.infer<typeof vignetteEffectSchema>
export type LetterboxEffect = z.infer<typeof letterboxEffectSchema>
export type FadeEffect = z.infer<typeof fadeEffectSchema>
export type GrainEffect = z.infer<typeof grainEffectSchema>
export type VhsEffect = z.infer<typeof vhsEffectSchema>
export type ParticlesEffect = z.infer<typeof particlesEffectSchema>
export type GlowEffect = z.infer<typeof glowEffectSchema>
export type EffectRegionKind = EffectRegion['kind']
export type Marker = z.infer<typeof markerSchema>
export type TextAnimation = z.infer<typeof textAnimationSchema>
export type TitleMotion = z.infer<typeof titleMotionSchema>
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
