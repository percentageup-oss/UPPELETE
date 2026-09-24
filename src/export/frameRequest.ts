import { z } from 'zod'
import { cueSchema, wordSchema } from '../core/model'
import { captionStyleSchema } from '../captions/style'
import { compositionRectSchema, layerMaskSchema } from '../core/edit'
import { textOverlaySchema } from '../core/edit'
import type { CaptionFrame } from '../captions/renderer'

const sourceUs = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const frameRequestBaseShape = {
  composition: z.strictObject({ width: z.number().int().min(16).max(3840), height: z.number().int().min(16).max(3840) }),
  cue: z.strictObject({ text: z.string().min(1).max(16000), startUs: sourceUs, endUs: sourceUs,
    emphasized: cueSchema.shape.emphasized,
    words: z.array(wordSchema.strict()).max(2000).optional() }).refine((cue) => cue.endUs > cue.startUs, 'Positive cue duration required').refine((cue) => cueSchema.safeParse({ ...cue, id: 'frame' }).success, 'Invalid caption word or emphasis spans'),
  style: captionStyleSchema,
  timestampUs: sourceUs,
  /** Schema 12: the active caption track's mask (the whole caption plane). Optional, so no version bump. */
  captionMask: layerMaskSchema.optional(),
}
/** Prototype-only data contract. No paths, CSS or executable arguments; `overlays[].assetUrl` (v2)
 * is a `media://` URL the export host itself resolves against its own `--asset` allow-list. */
export const frameRequestV1Schema = z.strictObject({ version: z.literal(1), ...frameRequestBaseShape })
const overlaysShape = z.array(z.strictObject({
  id: z.string().min(1).max(128), assetUrl: z.string().min(1).max(32768), rect: compositionRectSchema,
  opacity: z.number().finite().min(0).max(1), fit: z.enum(['contain', 'cover', 'stretch']),
  mask: layerMaskSchema.optional(),
})).max(1000)
export const frameRequestV2Schema = z.strictObject({ version: z.literal(2), ...frameRequestBaseShape, overlays: overlaysShape })

const hexColor = z.string().regex(/^#[\da-fA-F]{6}$/)
/** Already evaluated at this frame's sequence timestamp (`frameEffectsAt`), not the raw regions —
 * the same "resolve, then send only what is visible" shape v2's `overlays` uses. Painted by the
 * export host with the identical `CompositionLayers`/`overCaption` components preview uses, so no
 * FFmpeg filter is involved on either side (docs/EDITING.md "Frame-paint effects"). */
const frameEffectsShape = z.strictObject({
  vignette: z.strictObject({ amount: z.number().finite().min(0).max(1), softness: z.number().finite().min(0).max(1), mask: layerMaskSchema.optional() }).optional(),
  letterbox: z.strictObject({ orientation: z.enum(['horizontal', 'vertical']), barPx: z.number().finite().min(0), color: hexColor, mask: layerMaskSchema.optional() }).optional(),
  fade: z.strictObject({ color: hexColor, opacity: z.number().finite().min(0).max(1), mask: layerMaskSchema.optional() }).optional(),
  grain: z.strictObject({ amount: z.number().finite().min(0).max(1), size: z.number().finite().min(0.5).max(6), seed: z.number().int().nonnegative(), mask: layerMaskSchema.optional() }).optional(),
  vhs: z.strictObject({
    amount: z.number().finite().min(0).max(1), scanlines: z.number().finite().min(0).max(1), tracking: z.number().finite().min(0).max(1),
    bandY: z.number().finite().min(0).max(1), jitter: z.number().finite().min(-1).max(1), flicker: z.number().finite().min(0).max(1), seed: z.number().int().nonnegative(), mask: layerMaskSchema.optional(),
  }).optional(),
  particles: z.strictObject({
    id: z.string().min(1).max(128), amount: z.number().finite().min(0).max(1), size: z.number().finite().min(1).max(12),
    speed: z.number().finite().min(0).max(2), color: hexColor, tick: z.number().int().nonnegative(),
    opacity: z.number().finite().min(0).max(1), seed: z.number().int().nonnegative(), mask: layerMaskSchema.optional(),
  }).optional(),
})
export const frameRequestV3Schema = z.strictObject({ version: z.literal(3), ...frameRequestBaseShape, overlays: overlaysShape, frameEffects: frameEffectsShape })
const textActorCueSchema = z.strictObject({ text: z.string().min(1).max(16000), startUs: sourceUs, endUs: sourceUs,
  words: z.array(z.strictObject({ id: z.string().min(1), text: z.string().min(1), textStart: z.number().int().nonnegative(), textEnd: z.number().int().positive(), startUs: sourceUs, endUs: sourceUs,
    timingSource: z.literal('decorative'), needsReview: z.literal(false) })).max(2000) })
const textActorSchema = z.strictObject({
  item: textOverlaySchema, cue: textActorCueSchema,
  timestampUs: sourceUs,
  opacity: z.number().finite().min(0).max(1), scale: z.number().finite().positive().max(3),
  x: z.number().finite(), y: z.number().finite(),
})
export const frameRequestV4Schema = z.strictObject({ version: z.literal(4), ...frameRequestBaseShape, overlays: overlaysShape,
  frameEffects: frameEffectsShape, textActors: z.array(textActorSchema).max(1000) })
/** Not a video frame: asks the host to paint one layer mask as an opaque white fill through that mask
 * (schema 12), so the PNG's alpha channel *is* the mask. The export worker turns each into an image
 * FFmpeg multiplies onto a video clip or blur region — the same SVG the preview masks with. */
export const frameRequestV5Schema = z.strictObject({ version: z.literal(5), ...frameRequestBaseShape, maskFill: layerMaskSchema })
export const frameRequestSchema = z.discriminatedUnion('version', [frameRequestV1Schema, frameRequestV2Schema, frameRequestV3Schema, frameRequestV4Schema, frameRequestV5Schema])
export type FrameRequestV1 = z.infer<typeof frameRequestV1Schema>
export type FrameRequestV2 = z.infer<typeof frameRequestV2Schema>
export type FrameRequestV3 = z.infer<typeof frameRequestV3Schema>
export type FrameRequestV4 = z.infer<typeof frameRequestV4Schema>
export type FrameRequestV5 = z.infer<typeof frameRequestV5Schema>
export type FrameRequest = z.infer<typeof frameRequestSchema>

/** Font revision is a local cache epoch, not visible composition state. Keep all geometry and motion. */
export function parityState(frame: CaptionFrame) {
  return JSON.parse(JSON.stringify(frame, (key, value) => key === 'revision' ? undefined : value)) as CaptionFrame
}
