import { assetIdOf, compositionRectSchema } from './edit'
import { groupMembers } from './groupCommands'
import { projectMediaSchema } from './media'
import { z } from 'zod'
import type { CaptionProject, Cue } from './model'
import type { Selection } from './timelineItems'
import type { ValidationIssue } from './captionCommands'
import { clipLengthUs, sequenceDurationUs, videoUnderPlayhead } from './timelineModel'
import { captionAppearanceSchema, FONT_FAMILY_CHOICES, MOTIONS, TEXT_TRANSFORMS, ALIGNMENTS } from '../captions/style'
import { CAPTION_TEMPLATES } from '../captions/templates'
import { editCommandSchema } from './editCommandSchema'

/**
 * The IPC contract between the Electron-main MCP server (`electron/mcp/`) and the renderer's
 * `useAgentBridge` (`src/agent/useAgentBridge.ts`). Project state lives only in `App.tsx`'s
 * history (docs/PRODUCT.md: transcript/preview/bin/timeline are one state) — main never keeps a
 * copy, so every read and every edit crosses this boundary as one request/response pair.
 */

export const agentRequestKinds = [
  'get-state', 'get-captions', 'get-transcript', 'run-commands', 'seek', 'select', 'undo', 'redo', 'prepare-snapshot', 'match-reference', 'import-inspected', 'place-image',
] as const
export type AgentRequestKind = (typeof agentRequestKinds)[number]

const base = { id: z.string().min(1).max(128) }
/** Where an imported or existing picture lands on the timeline. Every time is SEQUENCE microseconds. */
export const agentPlacementSchema = z.strictObject({
  startUs: z.number().int().nonnegative(),
  /** Default: the app's standard still length. */
  durationUs: z.number().int().positive().max(3_600_000_000).optional(),
  /** Composition units (1080 wide); default: the app's standard overlay size for that picture. */
  rect: compositionRectSchema.optional(),
  /** Preferred track; a free one is used when it is occupied, a new one when none is. */
  trackId: z.string().min(1).max(128).optional(),
})
export type AgentPlacement = z.infer<typeof agentPlacementSchema>

export const agentRequestSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...base, kind: z.literal('get-state') }),
  z.strictObject({
    ...base, kind: z.literal('get-captions'),
    // Each cue's own `startUs`/`endUs` — the source time of the video it names, per `docs/EDITING.md`
    // "Time: source stays canonical". Not sequence time: a project can have several videos on
    // different source timelines, so there is no single sequence-time range to filter cues by
    // without first picking one; filtering on the cue's own stored time avoids that ambiguity.
    range: z.strictObject({ startUs: z.number().int().nonnegative(), endUs: z.number().int().positive() }).optional(),
    cueIds: z.array(z.string().min(1)).max(500).optional(),
    words: z.boolean().optional(),
    limit: z.number().int().positive().max(500).optional(),
    offset: z.number().int().nonnegative().optional(),
  }),
  z.strictObject({
    ...base, kind: z.literal('get-transcript'),
    // Unlike `get-captions`, every time here is SEQUENCE time (what the timeline shows, after cuts and
    // speed changes), so it lines up with clips, zoom regions, effects and text overlays.
    range: z.strictObject({ startUs: z.number().int().nonnegative(), endUs: z.number().int().positive() }).optional(),
    words: z.boolean().optional(),
    limit: z.number().int().positive().max(500).optional(),
    offset: z.number().int().nonnegative().optional(),
  }),
  z.strictObject({ ...base, kind: z.literal('run-commands'), commands: z.array(editCommandSchema).min(1).max(200) }),
  z.strictObject({ ...base, kind: z.literal('seek'), sequenceUs: z.number().int().nonnegative() }),
  z.strictObject({ ...base, kind: z.literal('select'), selection: z.strictObject({ kind: z.enum(['cue', 'clip', 'blur', 'effect', 'text', 'shape', 'marker']), id: z.string().min(1) }).nullable() }),
  z.strictObject({ ...base, kind: z.literal('undo') }),
  z.strictObject({ ...base, kind: z.literal('redo') }),
  z.strictObject({ ...base, kind: z.literal('prepare-snapshot'), sequenceUs: z.number().int().nonnegative() }),
  z.strictObject({
    ...base, kind: z.literal('match-reference'),
    // The reference picture, already read and size-capped by main (`electron/mcp/referenceImage.ts`).
    imageBase64: z.string().min(1).max(14_000_000),
    mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp']),
    /** Which frame of the project to match from (sequence µs); default: under the playhead. */
    sequenceUs: z.number().int().nonnegative().optional(),
    /** Where the grade applies (sequence µs); default: the whole program. */
    startUs: z.number().int().nonnegative().optional(),
    endUs: z.number().int().positive().optional(),
    strength: z.number().min(0).max(1).default(1),
    name: z.string().trim().min(1).max(100).optional(),
  }),
  z.strictObject({
    ...base, kind: z.literal('import-inspected'),
    // A file main already landed on disk and probed through the same path a dragged-in file takes
    // (`electron/assetInspect.ts`), so the renderer only has to register it and (optionally) place it.
    inspected: z.strictObject({ kind: z.enum(['image', 'audio', 'video']), media: projectMediaSchema, url: z.string().min(1).max(4096) }),
    /** Images only: adds the picture as a clip in the same undo step as the asset. */
    placement: agentPlacementSchema.optional(),
  }),
  z.strictObject({ ...base, kind: z.literal('place-image'), assetId: z.string().min(1).max(128), placement: agentPlacementSchema }),
])
export type AgentRequest = z.infer<typeof agentRequestSchema>

/** One command's outcome inside a `run-commands` batch. All-or-nothing: the renderer stops and
 * reports the failing index instead of committing a partial edit (`editCommandSchema.ts` header). */
export type CommandOutcome =
  | { ok: true; warnings: ValidationIssue[] }
  | { ok: false; errors: ValidationIssue[]; warnings: ValidationIssue[] }

export type AgentResponse =
  // get-state, seek, select, undo, redo all resolve to the project's current summary — `state`
  // already carries `selection` and `playheadUs`, so there is no separate seek/select shape.
  | { id: string; ok: true; state: ProjectSummary }
  | { id: string; ok: true; captions: CaptionSummary[]; total: number; /** get-transcript only: cues wholly inside removed ranges, which have no sequence time. */ omitted?: number }
  | { id: string; ok: true; outcomes: CommandOutcome[]; failedIndex: number | null; state: ProjectSummary }
  | { id: string; ok: true; match: MatchReferenceResult; state: ProjectSummary }
  | { id: string; ok: true; rect: { x: number; y: number; width: number; height: number } | null }
  | { id: string; ok: true; imported: ImportedMediaResult; state: ProjectSummary }
  | { id: string; ok: true; placed: PlacedImageResult; state: ProjectSummary }
  | { id: string; ok: false; message: string }

/** What `import_media` reports: the asset now in the project, and the clip when it was placed. */
export type ImportedMediaResult = { assetId: string; kind: 'image' | 'audio' | 'video'; name: string; alreadyInProject: boolean; clipId: string | null; startUs: number | null; endUs: number | null }
/** What `place_at_word`/`place-image` reports about the clip it added. */
export type PlacedImageResult = { clipId: string; assetId: string; trackId: string; startUs: number; endUs: number }

/** What `match_color_to_reference` reports back: the LUT it derived and the adjustment layer that carries it. */
export type MatchReferenceResult = { lutName: string; lutPath: string | null; clipId: string; startUs: number; endUs: number; sourceFrameUs: number }

/** A cue trimmed to what an agent needs to reason about timing/placement without shipping the
 * app's full internal word-provenance shape. `words`/`emphasized` are included only when asked. */
export type CaptionSummary = {
  id: string
  mediaAssetId: string | undefined
  startUs: number
  endUs: number
  text: string
  timingSource: Cue['timingSource']
  needsReview: boolean
  words?: { id: string; text: string; startUs: number; endUs: number; timingSource: Cue['words'][number]['timingSource'] }[]
}

export function summarizeCue(cue: Cue, includeWords: boolean): CaptionSummary {
  return {
    id: cue.id, mediaAssetId: cue.mediaAssetId, startUs: cue.startUs, endUs: cue.endUs, text: cue.text,
    timingSource: cue.timingSource, needsReview: cue.needsReview,
    ...(includeWords ? { words: cue.words.map((word) => ({ id: word.id, text: word.text, startUs: word.startUs, endUs: word.endUs, timingSource: word.timingSource })) } : {}),
  }
}

/** Everything an agent needs to orient itself in one call, without the full project (media
 * fingerprints, saved presets, migration history) it has no use for. */
export type ProjectSummary = {
  title: string
  path: string | null
  schemaVersion: number
  format: CaptionProject['format']
  durationUs: number
  playheadUs: number
  underPlayhead: { assetId: string; clipId: string } | null
  selection: Selection | null
  assets: { id: string; kind: string; name: string }[]
  tracks: { id: string; kind: string; name: string; muted: boolean; hidden: boolean; locked: boolean; solo?: boolean; volume?: number }[]
  clips: { id: string; kind: string; trackId: string; assetId: string | null; fill?: unknown; motion?: unknown; /** Schema 16, `adjustment` clips only: the grade it applies to every picture clip on the tracks below it (`clip-update`'s `changes.grade`, docs/EDITING.md "Color: adjustment layers"). */ grade?: unknown; timelineStartUs: number; sourceStartUs: number; sourceEndUs: number; /** Length on the timeline; differs from the source span when `speed` is set. */ timelineLengthUs: number; speed?: unknown; /** Schema 15: clips sharing a linkId are edited together; a disabled clip plays and paints nothing. */ linkId?: string; enabled?: false; gain?: number; /** A video whose sound is a separate linked audio clip. */ detachedAudio?: true }[]
  blurRegions: { id: string; startUs: number; endUs: number }[]
  zoomRegions: { id: string; startUs: number; endUs: number; rect: unknown; fromRect?: unknown; enabled: boolean }[]
  markers: { id: string; atUs: number; text: string }[]
  effects: { id: string; kind: string; startUs: number; endUs: number; enabled: boolean }[]
  textOverlays: { id: string; text: string; startUs: number; endUs: number; layerOrder: number; titleMotion?: unknown; /** Schema 22: the group it belongs to. */ groupId?: string }[]
  /** Schema 17 vector graphics; edit them with the `shape-*` commands. */
  shapes: { id: string; name?: string; kind: string; startUs: number; endUs: number; layerOrder: number; groupId?: string }[]
  /** Schema 22: shapes and texts sharing a `groupId` move, retime and duplicate together (`group-*` commands). */
  groups: { id: string; name: string; memberIds: string[] }[]
  captionStyle: CaptionProject['captionStyle']
  cueCount: number
  warnings: ValidationIssue[]
}

export function summarizeProject(
  project: CaptionProject, projectPath: string | null, playheadUs: number, selection: Selection | null, warnings: ValidationIssue[],
): ProjectSummary {
  const under = videoUnderPlayhead(playheadUs, project.tracks, project.clips)
  return {
    title: project.title, path: projectPath, schemaVersion: project.schemaVersion, format: project.format,
    durationUs: sequenceDurationUs(project.clips), playheadUs, selection,
    underPlayhead: under && under.clip.kind === 'video' ? { assetId: under.clip.assetId, clipId: under.clip.id } : null,
    assets: project.assets.map((asset) => ({ id: asset.id, kind: asset.kind, name: asset.name })),
    tracks: project.tracks.map((track) => ({ id: track.id, kind: track.kind, name: track.name, muted: track.muted, hidden: track.hidden, locked: track.locked, ...(track.solo ? { solo: true } : {}), ...(track.volume !== undefined ? { volume: track.volume } : {}) })),
    clips: project.clips.map((clip) => ({ id: clip.id, kind: clip.kind, trackId: clip.trackId, assetId: assetIdOf(clip), ...(clip.kind === 'color' ? { fill: clip.fill, motion: clip.motion ?? null } : {}), ...(clip.kind === 'adjustment' ? { grade: clip.grade } : {}), timelineStartUs: clip.timelineStartUs, sourceStartUs: clip.sourceStartUs, sourceEndUs: clip.sourceEndUs, timelineLengthUs: clipLengthUs(clip), ...((clip.kind === 'video' || clip.kind === 'audio') && clip.speed ? { speed: clip.speed } : {}), ...(clip.enabled === false ? { enabled: false as const } : {}), ...((clip.kind === 'video' || clip.kind === 'audio') ? { gain: clip.gain, ...(clip.linkId ? { linkId: clip.linkId } : {}) } : {}), ...(clip.kind === 'video' && clip.detachedAudio ? { detachedAudio: true as const } : {}) })),
    blurRegions: project.blurRegions.map((region) => ({ id: region.id, startUs: region.startUs, endUs: region.endUs })),
    zoomRegions: project.zoomRegions.map((region) => ({ id: region.id, startUs: region.startUs, endUs: region.endUs, rect: region.rect, ...(region.fromRect ? { fromRect: region.fromRect } : {}), enabled: region.enabled })),
    markers: project.markers.map((marker) => ({ id: marker.id, atUs: marker.atUs, text: marker.text })),
    effects: project.effects.map((effect) => ({ id: effect.id, kind: effect.kind, startUs: effect.startUs, endUs: effect.endUs, enabled: effect.enabled })),
    textOverlays: project.textOverlays.map(({ id, text, startUs, endUs, layerOrder, titleMotion, groupId }) => ({ id, text, startUs, endUs, layerOrder, ...(titleMotion ? { titleMotion } : {}), ...(groupId ? { groupId } : {}) })),
    shapes: project.shapes.map(({ id, name, geometry, startUs, endUs, layerOrder, groupId }) => ({ id, ...(name ? { name } : {}), kind: geometry.kind, startUs, endUs, layerOrder, ...(groupId ? { groupId } : {}) })),
    groups: (project.groups ?? []).map(({ id, name }) => ({ id, name, memberIds: groupMembers(project, id).map((member) => member.item.id) })),
    captionStyle: project.captionStyle, cueCount: project.cues.length, warnings,
  }
}

// ---------------------------------------------------------------------------------------------
// Style field ranges — generated from captionAppearanceSchema so a range can never drift from what
// the schema will actually accept (`list_style_options` MCP tool, slice 2).
// ---------------------------------------------------------------------------------------------

export type StyleFieldRange =
  | { kind: 'number'; min: number | null; max: number | null }
  | { kind: 'enum'; options: readonly string[] }
  | { kind: 'boolean' }
  | { kind: 'color' }
  | { kind: 'string' }

function rangeOf(key: string, field: z.core.$ZodType): StyleFieldRange {
  // Nearly every appearance field carries `.default(...)`, which wraps the real type — unwrap it
  // (repeatedly, in case of a future `.optional().default(...)` chain) before inspecting.
  let inner = field as { type?: string; unwrap?: () => z.core.$ZodType }
  while (inner.type === 'default' || inner.type === 'optional') inner = (inner.unwrap?.() ?? inner) as typeof inner
  const type = inner.type
  field = inner as z.core.$ZodType
  if (type === 'number') {
    const numberField = field as unknown as { minValue: number | null; maxValue: number | null }
    return { kind: 'number', min: numberField.minValue, max: numberField.maxValue }
  }
  if (type === 'enum') return { kind: 'enum', options: (field as unknown as { options: readonly string[] }).options }
  if (type === 'boolean') return { kind: 'boolean' }
  if (type === 'string' && /color/i.test(key)) return { kind: 'color' }
  return { kind: 'string' }
}

/** Every `captionAppearanceSchema` field with its accepted range/options, so `set_caption_style`
 * callers can build valid values instead of guessing at the ~50-field schema in `captions/style.ts`. */
export function styleFieldRanges(): Record<string, StyleFieldRange> {
  const shape = captionAppearanceSchema.shape as Record<string, z.core.$ZodType>
  return Object.fromEntries(Object.entries(shape).map(([key, field]) => [key, rangeOf(key, field)]))
}

export function listStyleOptions() {
  return {
    motions: MOTIONS,
    fontFamilies: FONT_FAMILY_CHOICES,
    textTransforms: TEXT_TRANSFORMS,
    alignments: ALIGNMENTS,
    templates: CAPTION_TEMPLATES.map((template) => ({ id: template.id, name: template.name, description: template.description, tags: template.tags })),
    appearanceFieldRanges: styleFieldRanges(),
  }
}
