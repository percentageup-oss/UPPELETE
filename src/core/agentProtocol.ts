import { z } from 'zod'
import type { CaptionProject, Cue } from './model'
import type { Selection } from './timelineItems'
import type { ValidationIssue } from './captionCommands'
import { sequenceDurationUs, videoUnderPlayhead } from './timelineModel'
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
  'get-state', 'get-captions', 'run-commands', 'seek', 'select', 'undo', 'redo', 'prepare-snapshot',
] as const
export type AgentRequestKind = (typeof agentRequestKinds)[number]

const base = { id: z.string().min(1).max(128) }
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
  z.strictObject({ ...base, kind: z.literal('run-commands'), commands: z.array(editCommandSchema).min(1).max(200) }),
  z.strictObject({ ...base, kind: z.literal('seek'), sequenceUs: z.number().int().nonnegative() }),
  z.strictObject({ ...base, kind: z.literal('select'), selection: z.strictObject({ kind: z.enum(['cue', 'clip', 'blur', 'marker']), id: z.string().min(1) }).nullable() }),
  z.strictObject({ ...base, kind: z.literal('undo') }),
  z.strictObject({ ...base, kind: z.literal('redo') }),
  z.strictObject({ ...base, kind: z.literal('prepare-snapshot'), sequenceUs: z.number().int().nonnegative() }),
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
  | { id: string; ok: true; captions: CaptionSummary[]; total: number }
  | { id: string; ok: true; outcomes: CommandOutcome[]; failedIndex: number | null; state: ProjectSummary }
  | { id: string; ok: true; rect: { x: number; y: number; width: number; height: number } | null }
  | { id: string; ok: false; message: string }

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
  tracks: { id: string; kind: string; name: string; muted: boolean; hidden: boolean; locked: boolean }[]
  clips: { id: string; kind: string; trackId: string; assetId: string; timelineStartUs: number; sourceStartUs: number; sourceEndUs: number }[]
  blurRegions: { id: string; startUs: number; endUs: number }[]
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
    underPlayhead: under ? { assetId: under.clip.assetId, clipId: under.clip.id } : null,
    assets: project.assets.map((asset) => ({ id: asset.id, kind: asset.kind, name: asset.name })),
    tracks: project.tracks.map((track) => ({ id: track.id, kind: track.kind, name: track.name, muted: track.muted, hidden: track.hidden, locked: track.locked })),
    clips: project.clips.map((clip) => ({ id: clip.id, kind: clip.kind, trackId: clip.trackId, assetId: clip.assetId, timelineStartUs: clip.timelineStartUs, sourceStartUs: clip.sourceStartUs, sourceEndUs: clip.sourceEndUs })),
    blurRegions: project.blurRegions.map((region) => ({ id: region.id, startUs: region.startUs, endUs: region.endUs })),
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
