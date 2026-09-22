import { z } from 'zod'
import { cueSchema } from './model'
import { blurRegionSchema, clipSchema, markerSchema, projectAssetSchema, sequenceFormatSchema, trackSchema, compositionRectSchema } from './edit'
import { captionStyleSchema, motionSchema, motionSpeedSchema } from '../captions/style'
import { captionDisplaySchema } from '../captions/wordDisplay'
import type { EditCommand } from './commands'

/**
 * The zod boundary for `EditCommand` (`commands.ts`). `CaptionCommand` and `ItemCommand` are
 * TypeScript-only unions inside the app, built and applied in the same process as the React state
 * they act on — nothing outside the renderer ever needed to validate one before the MCP agent
 * bridge (`docs/MCP.md`). This file exists solely as that boundary: every command variant here
 * mirrors its type in `captionCommands.ts`/`assetCommands.ts`/`trackCommands.ts`/`clipCommands.ts`
 * field-for-field. The `_ParsedCommandIsEditCommand` check below turns drift between the two into a
 * compile error — whatever `editCommandSchema` accepts must be a real `EditCommand` `applyEditCommand`
 * can run unmodified.
 */

const itemId = z.string().min(1).max(128)
const editMode = z.enum(['overwrite', 'ripple'])
const groupingOptions = z.strictObject({
  maxWords: z.number().int().positive(),
  maxGraphemes: z.number().int().positive(),
  maxDurationUs: z.number().int().positive(),
  pauseUs: z.number().int().positive(),
})
const wordTarget = z.union([
  z.strictObject({ wordId: z.string().min(1) }),
  z.strictObject({ textStart: z.number().int().nonnegative() }),
])
const timeRange = z.strictObject({ startUs: z.number().int().nonnegative(), endUs: z.number().int().positive() })

// ---------------------------------------------------------------------------------------------
// CaptionCommand (captionCommands.ts)
// ---------------------------------------------------------------------------------------------

const toggleEmphasis = z.strictObject({ type: z.literal('toggle-emphasis'), cueId: itemId, textStart: z.number().int().nonnegative() })
const estimateWords = z.strictObject({ type: z.literal('estimate-words'), cueId: itemId, idPrefix: z.string().min(1), missingOnly: z.boolean().optional() })
const updateText = z.strictObject({ type: z.literal('update-text'), cueId: itemId, text: z.string(), estimateIfUntimed: z.string().optional() })
const updateTime = z.strictObject({ type: z.literal('update-time'), cueId: itemId, startUs: z.number().int().nonnegative(), endUs: z.number().int().positive() })
const shiftTime = z.strictObject({ type: z.literal('shift-time'), cueId: itemId, deltaUs: z.number().int() })
const addCue = z.strictObject({ type: z.literal('add'), cue: cueSchema })
const deleteCue = z.strictObject({ type: z.literal('delete'), cueId: itemId })
const deleteWord = z.strictObject({ type: z.literal('delete-word'), cueId: itemId, target: wordTarget })
const split = z.strictObject({ type: z.literal('split'), cueId: itemId, atUs: z.number().int().nonnegative(), rightCueId: itemId })
const mergeNext = z.strictObject({ type: z.literal('merge-next'), cueId: itemId })
const regroup = z.strictObject({ type: z.literal('regroup'), cueId: itemId, idPrefix: z.string().min(1), estimateMissing: z.boolean(), options: groupingOptions.optional() })
const regroupMany = z.strictObject({ type: z.literal('regroup-many'), cueIds: z.array(itemId).min(1), idPrefix: z.string().min(1), estimateMissing: z.boolean(), options: groupingOptions.optional() })
const setTimelineDisplay = z.strictObject({ type: z.literal('set-timeline-display'), display: captionDisplaySchema })
/** Legacy command name retained for project integrations; see `captionCommands.ts`. */
const setDisplay = z.strictObject({ type: z.literal('set-display'), display: captionDisplaySchema, idPrefix: z.string().min(1).optional() })
const setCaptionDisplay = z.strictObject({ type: z.literal('set-caption-display'), display: captionDisplaySchema })
const applyTemplate = z.strictObject({ type: z.literal('apply-template'), style: captionStyleSchema, idPrefix: z.string().min(1) })
const setMotionOverride = z.strictObject({
  type: z.literal('set-motion-override'), cueId: itemId,
  override: z.strictObject({ motion: motionSchema.optional(), motionSpeed: motionSpeedSchema.optional() }).optional(),
})
const resetMotionOverrides = z.strictObject({ type: z.literal('reset-motion-overrides') })
const lineBreakBeforeWord = z.strictObject({ type: z.literal('line-break-before-word'), cueId: itemId, target: wordTarget })
const splitBeforeWord = z.strictObject({ type: z.literal('split-before-word'), cueId: itemId, wordId: z.string().min(1), rightCueId: itemId })
const moveFromWordToNext = z.strictObject({ type: z.literal('move-from-word-to-next'), cueId: itemId, wordId: z.string().min(1) })
const moveThroughWordToPrevious = z.strictObject({ type: z.literal('move-through-word-to-previous'), cueId: itemId, wordId: z.string().min(1) })

export const captionCommandSchema = z.discriminatedUnion('type', [
  toggleEmphasis, estimateWords, updateText, updateTime, shiftTime, addCue, deleteCue, deleteWord, split, mergeNext,
  regroup, regroupMany, setTimelineDisplay, setDisplay, setCaptionDisplay, applyTemplate, setMotionOverride,
  resetMotionOverrides, lineBreakBeforeWord, splitBeforeWord, moveFromWordToNext, moveThroughWordToPrevious,
])

// ---------------------------------------------------------------------------------------------
// AssetCommand (assetCommands.ts)
// ---------------------------------------------------------------------------------------------

const assetChanges = projectAssetSchema.omit({ id: true, kind: true }).partial()
const assetAdd = z.strictObject({ type: z.literal('asset-add'), asset: projectAssetSchema })
const assetRemove = z.strictObject({ type: z.literal('asset-remove'), assetId: itemId })
const assetUpdate = z.strictObject({ type: z.literal('asset-update'), assetId: itemId, changes: assetChanges })

export const assetCommandSchema = z.discriminatedUnion('type', [assetAdd, assetRemove, assetUpdate])

// ---------------------------------------------------------------------------------------------
// TrackCommand (trackCommands.ts)
// ---------------------------------------------------------------------------------------------

const trackFlags = trackSchema.pick({ name: true, muted: true, hidden: true, locked: true, heightPx: true }).partial()
const trackAdd = z.strictObject({ type: z.literal('track-add'), track: trackSchema, index: z.number().int().nonnegative().optional() })
const trackRemove = z.strictObject({ type: z.literal('track-remove'), trackId: itemId })
const trackUpdate = z.strictObject({ type: z.literal('track-update'), trackId: itemId, changes: trackFlags })
const trackReorder = z.strictObject({ type: z.literal('track-reorder'), trackId: itemId, direction: z.enum(['forward', 'backward', 'front', 'back']) })

export const trackCommandSchema = z.discriminatedUnion('type', [trackAdd, trackRemove, trackUpdate, trackReorder])

// ---------------------------------------------------------------------------------------------
// ClipCommand (clipCommands.ts)
// ---------------------------------------------------------------------------------------------

const clipChanges = z.strictObject({
  rect: compositionRectSchema.nullable().optional(),
  opacity: z.number().finite().min(0).max(1).optional(),
  fit: z.enum(['contain', 'cover', 'stretch']).optional(),
  gain: z.number().finite().min(0).max(4).optional(),
})
const clipAdd = z.strictObject({
  type: z.literal('clip-add'), clip: clipSchema, asset: projectAssetSchema.optional(), track: trackSchema.optional(),
  mode: editMode.optional(), idPrefix: z.string().min(1).optional(),
})
const clipMove = z.strictObject({
  type: z.literal('clip-move'), clipId: itemId, trackId: itemId, startUs: z.number().int().nonnegative(),
  mode: editMode, idPrefix: z.string().min(1), track: trackSchema.optional(),
})
const clipTrim = z.strictObject({ type: z.literal('clip-trim'), clipId: itemId, edge: z.enum(['start', 'end']), deltaUs: z.number().int(), mode: editMode })
const clipUpdate = z.strictObject({ type: z.literal('clip-update'), clipId: itemId, changes: clipChanges })
const clipSplit = z.strictObject({ type: z.literal('clip-split'), atUs: z.number().int().nonnegative(), clipIds: z.array(itemId).optional(), idPrefix: z.string().min(1) })
const clipDelete = z.strictObject({ type: z.literal('clip-delete'), clipId: itemId, mode: editMode })
const gapClose = z.strictObject({ type: z.literal('gap-close'), trackId: itemId, atUs: z.number().int().nonnegative() })
const clipsSet = z.strictObject({
  type: z.literal('clips-set'),
  keptByAsset: z.array(z.strictObject({ assetId: itemId, ranges: z.array(timeRange) })),
  idPrefix: z.string().min(1),
})
const clipsRestore = z.strictObject({ type: z.literal('clips-restore') })
const formatSet = z.strictObject({ type: z.literal('format-set'), format: sequenceFormatSchema })
/** `blurRegionSchema` carries a top-level `.refine()` (end after start), which zod cannot `.omit()`
 * from — the change set is spelled out instead of derived. */
const blurChanges = z.strictObject({
  startUs: z.number().int().nonnegative().optional(),
  endUs: z.number().int().positive().optional(),
  rect: compositionRectSchema.optional(),
  radius: z.number().finite().min(1).max(100).optional(),
})
const blurAdd = z.strictObject({ type: z.literal('blur-add'), region: blurRegionSchema })
const blurUpdate = z.strictObject({ type: z.literal('blur-update'), blurId: itemId, changes: blurChanges })
const blurDelete = z.strictObject({ type: z.literal('blur-delete'), blurId: itemId })

/** `markerSchema` has no top-level `.refine()`, so `.omit()` works directly here. */
const markerChanges = markerSchema.omit({ id: true }).partial()
const markerAdd = z.strictObject({ type: z.literal('marker-add'), marker: markerSchema })
const markerUpdate = z.strictObject({ type: z.literal('marker-update'), markerId: itemId, changes: markerChanges })
const markerDelete = z.strictObject({ type: z.literal('marker-delete'), markerId: itemId })

export const clipCommandSchema = z.discriminatedUnion('type', [
  clipAdd, clipMove, clipTrim, clipUpdate, clipSplit, clipDelete, gapClose, clipsSet, clipsRestore, formatSet,
  blurAdd, blurUpdate, blurDelete, markerAdd, markerUpdate, markerDelete,
])

// ---------------------------------------------------------------------------------------------
// The full boundary
// ---------------------------------------------------------------------------------------------

export const itemCommandSchema = z.discriminatedUnion('type', [
  assetAdd, assetRemove, assetUpdate, trackAdd, trackRemove, trackUpdate, trackReorder,
  clipAdd, clipMove, clipTrim, clipUpdate, clipSplit, clipDelete, gapClose, clipsSet, clipsRestore, formatSet,
  blurAdd, blurUpdate, blurDelete, markerAdd, markerUpdate, markerDelete,
])

/** Every `CaptionCommand`/`ItemCommand` variant, keyed by `type` — the schema `edit`'s MCP tool
 * (and any other out-of-process caller) validates against before a command ever reaches
 * `applyEditCommand`. `word-action-menu`/App.tsx-issued commands never cross this boundary and
 * stay on the plain TypeScript types; this is deliberately not the same object as `EditCommand`. */
export const editCommandSchema = z.discriminatedUnion('type', [
  toggleEmphasis, estimateWords, updateText, updateTime, shiftTime, addCue, deleteCue, deleteWord, split, mergeNext,
  regroup, regroupMany, setTimelineDisplay, setDisplay, setCaptionDisplay, applyTemplate, setMotionOverride,
  resetMotionOverrides, lineBreakBeforeWord, splitBeforeWord, moveFromWordToNext, moveThroughWordToPrevious,
  assetAdd, assetRemove, assetUpdate, trackAdd, trackRemove, trackUpdate, trackReorder,
  clipAdd, clipMove, clipTrim, clipUpdate, clipSplit, clipDelete, gapClose, clipsSet, clipsRestore, formatSet,
  blurAdd, blurUpdate, blurDelete, markerAdd, markerUpdate, markerDelete,
])

export type EditCommandInput = z.infer<typeof editCommandSchema>

/** Compile-time drift guard: every parsed command must satisfy the real `EditCommand` union that
 * `applyEditCommand` (`commands.ts`) consumes. If a command type gains or renames a field here
 * without a matching change there (or vice versa), this line stops building. */
type _ParsedCommandIsEditCommand = EditCommandInput extends EditCommand ? true : never
const _parsedCommandIsEditCommand: _ParsedCommandIsEditCommand = true
void _parsedCommandIsEditCommand
