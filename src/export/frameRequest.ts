import { z } from 'zod'
import { cueSchema, wordSchema } from '../core/model'
import { captionStyleSchema } from '../captions/style'
import { compositionRectSchema } from '../core/edit'
import type { CaptionFrame } from '../captions/renderer'

const sourceUs = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const frameRequestBaseShape = {
  composition: z.strictObject({ width: z.number().int().min(16).max(3840), height: z.number().int().min(16).max(3840) }),
  cue: z.strictObject({ text: z.string().min(1).max(16000), startUs: sourceUs, endUs: sourceUs,
    emphasized: cueSchema.shape.emphasized,
    words: z.array(wordSchema.strict()).max(2000).optional() }).refine((cue) => cue.endUs > cue.startUs, 'Positive cue duration required').refine((cue) => cueSchema.safeParse({ ...cue, id: 'frame' }).success, 'Invalid caption word or emphasis spans'),
  style: captionStyleSchema,
  timestampUs: sourceUs,
}
/** Prototype-only data contract. No paths, CSS or executable arguments; `overlays[].assetUrl` (v2)
 * is a `media://` URL the export host itself resolves against its own `--asset` allow-list. */
export const frameRequestV1Schema = z.strictObject({ version: z.literal(1), ...frameRequestBaseShape })
export const frameRequestV2Schema = z.strictObject({
  version: z.literal(2), ...frameRequestBaseShape,
  overlays: z.array(z.strictObject({
    id: z.string().min(1).max(128), assetUrl: z.string().min(1).max(32768), rect: compositionRectSchema,
    opacity: z.number().finite().min(0).max(1), fit: z.enum(['contain', 'cover', 'stretch']),
  })).max(1000),
})
export const frameRequestSchema = z.discriminatedUnion('version', [frameRequestV1Schema, frameRequestV2Schema])
export type FrameRequestV1 = z.infer<typeof frameRequestV1Schema>
export type FrameRequestV2 = z.infer<typeof frameRequestV2Schema>
export type FrameRequest = z.infer<typeof frameRequestSchema>

/** Font revision is a local cache epoch, not visible composition state. Keep all geometry and motion. */
export function parityState(frame: CaptionFrame) {
  return JSON.parse(JSON.stringify(frame, (key, value) => key === 'revision' ? undefined : value)) as CaptionFrame
}
