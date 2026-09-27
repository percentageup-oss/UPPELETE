import { z } from 'zod'
import { projectMediaSchema } from './media'
import { resolveLinkSchema } from './model'
import { LUA_INPUT_WHITELIST } from '../resolve/textPlusInputs'

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

/** `AddRenderJob()`'s id: documented as a string, but its real type was never exercised by the spike
 * (T15). Passed through opaquely (never coerced) so the exact value handed back to `renderStatus` /
 * `renderCancel` is byte-for-byte what Lua returned, regardless of which type it turns out to be. */
const jobIdLike = z.union([z.string(), z.number()])

/** Result of the `renderProxyStart` command (04): Lua computes the scaled output size itself so its
 * own `SetRenderSettings` call and this response can never disagree. */
export const resolveRenderStartResultSchema = z.strictObject({
  jobId: jobIdLike,
  width: numericLike,
  height: numericLike,
})
export type ResolveRenderStartResult = z.infer<typeof resolveRenderStartResultSchema>

/** Result of the `renderStatus` command (04): Resolve's own `JobStatus` strings
 * ("Ready" | "Rendering" | "Complete" | "Failed" | "Cancelled"), unconfirmed by the spike (T15 was
 * never run) — `renderTimelineProxy` (electron/resolve/proxy.ts) treats any other value as still running. */
export const resolveRenderStatusResultSchema = z.strictObject({
  status: z.string().min(1),
  percent: numericLike.optional(),
  error: z.string().nullable().optional(),
})
export type ResolveRenderStatusResult = z.infer<typeof resolveRenderStatusResultSchema>

/** A rational frame rate, as `src/resolve/frames.ts`'s `parseResolveFps` produces from the timeline's
 * raw `frameRate` string. */
export const resolveFpsSchema = z.strictObject({
  num: z.number().int().positive(),
  den: z.number().int().positive(),
})
export type ResolveFps = z.infer<typeof resolveFpsSchema>

/** One rendered proxy inspected the same way `dialog:open-video` inspects a picked file
 * (`electron/main.ts`'s `inspectMedia`), narrowed to the video case since a rendered proxy is always
 * one. Matches the video variant of `InspectedFile` (src/core/assetImport.ts) so it can go straight
 * into the renderer's `addAssetsFromInspected`. */
export const resolveInspectedVideoSchema = z.strictObject({
  ok: z.literal(true),
  kind: z.literal('video'),
  media: projectMediaSchema,
  url: z.string(),
})
export type ResolveInspectedVideo = z.infer<typeof resolveInspectedVideoSchema>

/** What `renderTimelineProxy` resolves with, and the payload of a successful `resolve:proxy-done`. */
export const resolveProxyResultSchema = z.strictObject({
  inspected: resolveInspectedVideoSchema,
  timeline: z.strictObject({ ...resolveTimelineInfoSchema.shape, fps: resolveFpsSchema }),
})
export type ResolveProxyResult = z.infer<typeof resolveProxyResultSchema>

/** Payload of the `resolve:proxy-progress` event (04): one render's percent complete. */
export const resolveProxyProgressSchema = z.strictObject({ requestId: z.string().min(1), percent: z.number().min(0).max(100) })
export type ResolveProxyProgress = z.infer<typeof resolveProxyProgressSchema>

/** Payload of the `resolve:proxy-done` event (04), matched to its request by `requestId`. */
export const resolveProxyDoneSchema = z.discriminatedUnion('ok', [
  z.strictObject({ requestId: z.string().min(1), ok: z.literal(true), result: resolveProxyResultSchema }),
  z.strictObject({ requestId: z.string().min(1), ok: z.literal(false), message: z.string() }),
])
export type ResolveProxyDone = z.infer<typeof resolveProxyDoneSchema>

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

// ---------------------------------------------------------------------------------------------------------------
// Sync to Resolve (06). Specs come from the renderer's planner (`src/resolve/textPlusPlan.ts`); main re-reads the
// Resolve track and recomputes the diff itself (`src/resolve/syncDiff.ts`) rather than trusting a plan from the
// renderer. Only whitelisted Text+ input ids pass validation; the Lua bridge checks the same whitelist again.
// ---------------------------------------------------------------------------------------------------------------

const inputIdSchema = z.string().refine((id) => LUA_INPUT_WHITELIST.includes(id), { message: 'Not a whitelisted Text+ input.' })
const inputValueSchema = z.union([
  z.number().finite(),
  z.string().max(4000),
  z.strictObject({ x: z.number().finite(), y: z.number().finite() }),
])

export const resolveSyncSpecSchema = z.strictObject({
  key: z.string().min(1).max(256),
  startFrame: z.number().int().nonnegative(),
  endFrame: z.number().int().positive(),
  text: z.string().max(4000),
  inputs: z.record(inputIdSchema, inputValueSchema),
  hash: z.string().min(1).max(64),
}).refine((spec) => spec.endFrame > spec.startFrame, { message: 'A clip must be at least one frame long.' })
export type ResolveSyncSpec = z.infer<typeof resolveSyncSpecSchema>

const syncBaseSchema = {
  timelineId: z.string().min(1).max(256),
  trackName: z.string().min(1).max(64),
  specs: z.array(resolveSyncSpecSchema).max(20000),
  synced: resolveLinkSchema.shape.synced,
}

export const resolveSyncPreviewRequestSchema = z.strictObject(syncBaseSchema)
export type ResolveSyncPreviewRequest = z.infer<typeof resolveSyncPreviewRequestSchema>

export const resolveSyncApplyRequestSchema = z.strictObject({
  ...syncBaseSchema,
  decisions: z.record(z.string().max(256), z.enum(['keep-resolve', 'overwrite'])),
})
export type ResolveSyncApplyRequest = z.infer<typeof resolveSyncApplyRequestSchema>

export const resolveSyncConflictViewSchema = z.strictObject({
  key: z.string(),
  kind: z.enum(['changed-in-resolve', 'deleted-in-resolve', 'untracked-in-resolve']),
  clipId: z.string().optional(),
  resolveText: z.string().nullable().optional(),
  keptText: z.string().nullable(),
  startFrame: z.number().int().optional(),
})
export type ResolveSyncConflictView = z.infer<typeof resolveSyncConflictViewSchema>

/** What `resolve:sync-preview` returns: counts and conflicts only, never the specs themselves. */
export const resolveSyncPreviewSchema = z.strictObject({
  trackExists: z.boolean(),
  insert: z.number().int(),
  update: z.number().int(),
  replace: z.number().int(),
  remove: z.number().int(),
  unchanged: z.number().int(),
  foreign: z.number().int(),
  conflicts: z.array(resolveSyncConflictViewSchema),
})
export type ResolveSyncPreview = z.infer<typeof resolveSyncPreviewSchema>

export const resolveSyncResultSchema = z.strictObject({
  synced: resolveLinkSchema.shape.synced,
  errors: z.array(z.string()),
})
export type ResolveSyncResult = z.infer<typeof resolveSyncResultSchema>

export const resolveSyncProgressSchema = z.strictObject({
  done: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  phase: z.enum(['template', 'track', 'delete', 'insert', 'update']),
})
export type ResolveSyncProgress = z.infer<typeof resolveSyncProgressSchema>

// ---------------------------------------------------------------------------------------------------------------
// Import the timeline edit (11). The Lua result is validated here; main inspects the files and plans the clips
// (`src/resolve/editToProject.ts`), and the renderer only ever receives the plan, never a path to open itself.
// ---------------------------------------------------------------------------------------------------------------

const resolvePathSchema = z.string().min(1).max(32768).refine((value) => !value.includes('\0'), 'NUL in path')
const frameSchema = z.number().int()

export const RESOLVE_EDIT_KINDS = ['file', 'title', 'generator', 'fusion', 'compound', 'multicam', 'retimed', 'unknown'] as const
export type ResolveEditKind = typeof RESOLVE_EDIT_KINDS[number]

/** Result of the `readTimelineEdit` command: absolute record frames (`GetEnd` exclusive), source frames in the
 * file's own fps counted from its first frame (ADR 0009). */
export const resolveTimelineEditSchema = z.strictObject({
  timeline: resolveTimelineInfoSchema,
  items: z.array(z.strictObject({
    trackIndex: z.number().int().positive(),
    recordStart: frameSchema.nullable(),
    recordEnd: frameSchema.nullable(),
    sourceStart: frameSchema.nullable(),
    sourceEnd: frameSchema.nullable(),
    filePath: resolvePathSchema.nullable(),
    fileFps: z.string().max(32).nullable(),
    clipType: z.string().max(256).nullable(),
    name: z.string().max(1024).nullable(),
    kind: z.enum(RESOLVE_EDIT_KINDS),
  })).max(5000),
  audioItems: z.array(z.strictObject({
    trackIndex: z.number().int().positive(),
    recordStart: frameSchema.nullable(),
    filePath: resolvePathSchema.nullable(),
    name: z.string().max(1024).nullable(),
  })).max(5000),
  truncated: z.boolean(),
})
export type ResolveTimelineEdit = z.infer<typeof resolveTimelineEditSchema>

export const resolveEditSkipSchema = z.strictObject({
  track: z.string().max(16),
  name: z.string().max(1024),
  startUs: z.number().int().nullable(),
  reason: z.string().max(512),
})
export type ResolveEditSkip = z.infer<typeof resolveEditSkipSchema>

export const resolvePlannedClipSchema = z.strictObject({
  assetIndex: z.number().int().nonnegative(),
  /** Resolve's 1-based video track index; KathaCut makes one video track per Resolve track that has clips. */
  trackIndex: z.number().int().positive(),
  timelineStartUs: z.number().int().nonnegative(),
  sourceStartUs: z.number().int().nonnegative(),
  sourceEndUs: z.number().int().positive(),
})
export type ResolvePlannedClip = z.infer<typeof resolvePlannedClipSchema>

/** What `resolve:import-edit` returns. `notImported` is separately recorded audio (v1 imports embedded audio only). */
export const resolveImportEditResultSchema = z.strictObject({
  timeline: z.strictObject({ ...resolveTimelineInfoSchema.shape, fps: resolveFpsSchema }),
  assets: z.array(resolveInspectedVideoSchema).max(5000),
  clips: z.array(resolvePlannedClipSchema).max(5000),
  unsupported: z.array(resolveEditSkipSchema).max(5000),
  notImported: z.array(resolveEditSkipSchema).max(5000),
  truncated: z.boolean(),
})
export type ResolveImportEditResult = z.infer<typeof resolveImportEditResultSchema>

export const resolveImportEditProgressSchema = z.strictObject({ done: z.number().int().nonnegative(), total: z.number().int().nonnegative() })
export type ResolveImportEditProgress = z.infer<typeof resolveImportEditProgressSchema>

export const resolveJumpRequestSchema =z.strictObject({ timelineId: z.string().min(1).max(256), frame: z.number().int().nonnegative() })

// Bridge command results (06).
export const resolveFindTrackResultSchema = z.strictObject({ trackIndex: z.number().int().positive().nullable() })
export const resolveTrackResultSchema = z.strictObject({ trackIndex: z.number().int().positive() })
export const resolveReadClipsResultSchema = z.strictObject({
  clips: z.array(z.strictObject({
    clipId: z.string().min(1),
    startFrame: z.number().int(),
    endFrame: z.number().int(),
    key: z.string().nullable(),
    text: z.string().nullable(),
  })),
})
export const resolveInsertClipsResultSchema = z.strictObject({
  clips: z.array(z.strictObject({
    key: z.string(),
    clipId: z.string().nullable(),
    startFrame: z.number().int().nullable(),
    endFrame: z.number().int().nullable(),
    error: z.string().nullable(),
  })),
})
export const resolveUpdateClipsResultSchema = z.strictObject({
  clips: z.array(z.strictObject({ clipId: z.string(), error: z.string().nullable() })),
})
export const resolveDeleteClipsResultSchema = z.strictObject({ deleted: z.number().int().nonnegative(), missing: z.number().int().nonnegative() })
