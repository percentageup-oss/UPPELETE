import { z } from 'zod'

/**
 * Mailbox protocol v1 (docs/plans/resolve-textplus/README.md): plain JSON files under
 * `<userData>/resolve-bridge/`, written as `<name>.tmp` then renamed. `app.json` and `request.json`
 * are written by KathaCut (`electron/resolve/bridge.ts`); `status.json` and `response.json` are
 * written by the Lua bridge running inside DaVinci Resolve (`resources/resolve/bridge.lua`).
 *
 * The spike (ADR 0008) found that Resolve's `GetSetting`/`GetSettings` calls return some fields as
 * strings that the README assumed would be numbers/booleans (timeline resolution width/height,
 * the drop-frame flag). `numericLike`/`boolishLike` coerce either representation rather than
 * assuming a JSON-native type.
 */
const numericLike = z.union([z.number(), z.string()]).transform((value) => (typeof value === 'string' ? Number(value) : value))
const boolishLike = z.union([z.boolean(), z.string(), z.number()]).transform((value) => (typeof value === 'string' ? value !== '0' : Boolean(value)))

export const resolveAppFileSchema = z.strictObject({
  v: z.literal(1),
  pid: z.number().int(),
  heartbeatAt: z.number(),
  quitting: z.boolean().optional(),
})
export type ResolveAppFile = z.infer<typeof resolveAppFileSchema>

export const resolveStatusFileSchema = z.strictObject({
  v: z.literal(1),
  sessionId: z.string().min(1),
  heartbeatAt: z.number(),
  product: z.string(),
  version: z.string(),
  projectName: z.string().nullable(),
  timelineName: z.string().nullable(),
  busy: z.boolean(),
  closed: z.boolean().optional(),
})
export type ResolveStatusFile = z.infer<typeof resolveStatusFileSchema>

export const resolveRequestFileSchema = z.strictObject({
  v: z.literal(1),
  sessionId: z.string().min(1),
  seq: z.number().int(),
  command: z.string(),
  params: z.unknown(),
})
export type ResolveRequestFile = z.infer<typeof resolveRequestFileSchema>

export const resolveResponseFileSchema = z.discriminatedUnion('ok', [
  z.strictObject({ v: z.literal(1), sessionId: z.string().min(1), seq: z.number().int(), ok: z.literal(true), result: z.unknown() }),
  z.strictObject({ v: z.literal(1), sessionId: z.string().min(1), seq: z.number().int(), ok: z.literal(false), error: z.string() }),
])
export type ResolveResponseFile = z.infer<typeof resolveResponseFileSchema>

/** Result of the `timelineInfo` command (03). `frameRate` is Resolve's raw setting string
 * (`src/resolve/frames.ts`'s `parseResolveFps` turns it into an exact rational). */
export const resolveTimelineInfoSchema = z.strictObject({
  projectName: z.string(),
  timelineName: z.string(),
  timelineId: z.string(),
  startFrame: z.number().int(),
  endFrame: z.number().int(),
  frameRate: z.string(),
  dropFrame: boolishLike,
  width: numericLike,
  height: numericLike,
})
export type ResolveTimelineInfo = z.infer<typeof resolveTimelineInfoSchema>

/** Result of the `ping` command: not exposed over IPC yet (03 only wires `timelineInfo` and
 * `disconnect`), but the handler and this schema exist so the mailbox round trip is testable. */
export const resolvePingResultSchema = z.strictObject({ pong: z.literal(true), version: z.number().int() })

/** Result of the `disconnect` command. */
export const resolveEmptyResultSchema = z.strictObject({})

/** The renderer's view of the connection (`window.captionStudio.resolveStatus` /
 * `onResolveStatus`), derived from `status.json`'s freshness by `electron/resolve/bridge.ts`. */
export const resolveStatusViewSchema = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('disconnected') }),
  z.strictObject({
    state: z.literal('connected'),
    sessionId: z.string(),
    product: z.string(),
    version: z.string(),
    projectName: z.string().nullable(),
    timelineName: z.string().nullable(),
    busy: z.boolean(),
  }),
])
export type ResolveStatus = z.infer<typeof resolveStatusViewSchema>
