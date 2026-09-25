import { z } from 'zod'
import { cueSchema } from './model'
import { blurRegionSchema, captionTrackSchema, clipSchema, effectRegionSchema, markerSchema, projectAssetSchema, sequenceFormatSchema, trackSchema, zoomRegionSchema, compositionRectSchema, textOverlaySchema, layerMaskSchema, shapeSchema, glassSchema, fillSchema, backgroundMotionSchema, clipSpeedSchema, gradeSchema, BLEND_MODES } from './edit'
import { captionAppearanceSchema, captionStyleSchema, motionSchema, motionSpeedSchema } from '../captions/style'
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
const duplicateCue = z.strictObject({ type: z.literal('duplicate'), cueId: itemId, duplicateId: itemId })
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
const setPlacementOverride = z.strictObject({
  type: z.literal('set-placement-override'), cueId: itemId,
  override: z.strictObject({
    horizontal: captionAppearanceSchema.shape.horizontal.optional(),
    vertical: captionAppearanceSchema.shape.vertical.optional(),
    fontSize: captionAppearanceSchema.shape.fontSize.optional(),
    rotation: captionAppearanceSchema.shape.rotation.optional(),
  }).optional(),
})
const resetPlacementOverrides = z.strictObject({ type: z.literal('reset-placement-overrides') })
const lineBreakBeforeWord = z.strictObject({ type: z.literal('line-break-before-word'), cueId: itemId, target: wordTarget })
const splitBeforeWord = z.strictObject({ type: z.literal('split-before-word'), cueId: itemId, wordId: z.string().min(1), rightCueId: itemId })
const moveFromWordToNext = z.strictObject({ type: z.literal('move-from-word-to-next'), cueId: itemId, wordId: z.string().min(1) })
const moveThroughWordToPrevious = z.strictObject({ type: z.literal('move-through-word-to-previous'), cueId: itemId, wordId: z.string().min(1) })

export const captionCommandSchema = z.discriminatedUnion('type', [
  toggleEmphasis, estimateWords, updateText, updateTime, shiftTime, addCue, duplicateCue, deleteCue, deleteWord, split, mergeNext,
  regroup, regroupMany, setTimelineDisplay, setDisplay, setCaptionDisplay, applyTemplate, setMotionOverride,
  resetMotionOverrides, setPlacementOverride, resetPlacementOverrides, lineBreakBeforeWord, splitBeforeWord, moveFromWordToNext, moveThroughWordToPrevious,
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

const trackFlags = trackSchema.pick({ name: true, muted: true, hidden: true, locked: true, heightPx: true, solo: true, volume: true }).partial()
const trackAdd = z.strictObject({ type: z.literal('track-add'), track: trackSchema, index: z.number().int().nonnegative().optional() })
const trackRemove = z.strictObject({ type: z.literal('track-remove'), trackId: itemId })
const trackUpdate = z.strictObject({ type: z.literal('track-update'), trackId: itemId, changes: trackFlags })
const trackReorder = z.strictObject({ type: z.literal('track-reorder'), trackId: itemId, direction: z.enum(['forward', 'backward', 'front', 'back']) })

export const trackCommandSchema = z.discriminatedUnion('type', [trackAdd, trackRemove, trackUpdate, trackReorder])

// ---------------------------------------------------------------------------------------------
// CaptionTrackCommand (captionTrackCommands.ts)
// ---------------------------------------------------------------------------------------------

const captionTrackFlags = captionTrackSchema.pick({ name: true, locked: true }).partial()
const captionTrackAdd = z.strictObject({ type: z.literal('caption-track-add'), track: captionTrackSchema, index: z.number().int().nonnegative().optional() })
const captionTrackRemove = z.strictObject({ type: z.literal('caption-track-remove'), trackId: itemId })
const captionTrackUpdate = z.strictObject({ type: z.literal('caption-track-update'), trackId: itemId, changes: captionTrackFlags })
const captionTrackReorder = z.strictObject({ type: z.literal('caption-track-reorder'), trackId: itemId, direction: z.enum(['forward', 'backward', 'front', 'back']) })
const captionTrackMoveCue = z.strictObject({ type: z.literal('caption-track-move-cue'), cueId: itemId, trackId: itemId })

export const captionTrackCommandSchema = z.discriminatedUnion('type', [captionTrackAdd, captionTrackRemove, captionTrackUpdate, captionTrackReorder, captionTrackMoveCue])

// ---------------------------------------------------------------------------------------------
// ClipCommand (clipCommands.ts)
// ---------------------------------------------------------------------------------------------

const clipChanges = z.strictObject({
  rect: compositionRectSchema.nullable().optional(),
  opacity: z.number().finite().min(0).max(1).optional(),
  fit: z.enum(['contain', 'cover', 'stretch']).optional(),
  gain: z.number().finite().min(0).max(4).optional(),
  fill: fillSchema.optional(),
  motion: backgroundMotionSchema.nullable().optional(),
  /** Adjustment layers only (docs/EDITING.md "Color: adjustment layers"). */
  grade: gradeSchema.optional(),
  speed: clipSpeedSchema.nullable().optional(),
  enabled: z.boolean().optional(),
})
const unlinked = z.boolean().optional()
const clipAdd = z.strictObject({
  type: z.literal('clip-add'), clip: clipSchema, asset: projectAssetSchema.optional(), track: trackSchema.optional(), trackIndex: z.number().int().min(0).max(63).optional(),
  mode: editMode.optional(), idPrefix: z.string().min(1).optional(),
})
const clipMove = z.strictObject({
  type: z.literal('clip-move'), clipId: itemId, trackId: itemId, startUs: z.number().int().nonnegative(),
  mode: editMode, idPrefix: z.string().min(1), track: trackSchema.optional(), unlinked,
})
const clipTrim = z.strictObject({ type: z.literal('clip-trim'), clipId: itemId, edge: z.enum(['start', 'end']), deltaUs: z.number().int(), mode: editMode, unlinked })
const clipTrimTo = z.strictObject({ type: z.literal('clip-trim-to'), atUs: z.number().int().nonnegative(), edge: z.enum(['start', 'end']), clipIds: z.array(itemId).optional(), mode: editMode, unlinked })
const clipUpdate = z.strictObject({ type: z.literal('clip-update'), clipId: itemId, changes: clipChanges, unlinked })
const clipSplit = z.strictObject({ type: z.literal('clip-split'), atUs: z.number().int().nonnegative(), clipIds: z.array(itemId).optional(), idPrefix: z.string().min(1), unlinked })
const clipDelete = z.strictObject({ type: z.literal('clip-delete'), clipId: itemId, mode: editMode, unlinked })
const clipsLink = z.strictObject({ type: z.literal('clips-link'), clipIds: z.array(itemId).min(2).max(64), linkId: itemId })
const clipsUnlink = z.strictObject({ type: z.literal('clips-unlink'), clipIds: z.array(itemId).min(1).max(64) })
const clipDetachAudio = z.strictObject({ type: z.literal('clip-detach-audio'), clipId: itemId, audioClipId: itemId, linkId: itemId, trackId: itemId, track: trackSchema.optional() })
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
  enabled: z.boolean().optional(),
})
const blurAdd = z.strictObject({ type: z.literal('blur-add'), region: blurRegionSchema })
const blurUpdate = z.strictObject({ type: z.literal('blur-update'), blurId: itemId, changes: blurChanges })
const blurDelete = z.strictObject({ type: z.literal('blur-delete'), blurId: itemId })

/** `zoomRegionSchema` carries a top-level `.refine()` (end after start) like blur, so the change set
 * is spelled out; timing changes go through `zoom-region-move`/`zoom-region-trim` instead. */
const zoomRegionChanges = z.strictObject({
  rect: compositionRectSchema.optional(),
  /** `null` clears the pan start framing. */
  fromRect: compositionRectSchema.nullable().optional(),
  easeInUs: z.number().int().nonnegative().max(5_000_000).optional(),
  easeOutUs: z.number().int().nonnegative().max(5_000_000).optional(),
  enabled: z.boolean().optional(),
})
const zoomRegionAdd = z.strictObject({ type: z.literal('zoom-region-add'), region: zoomRegionSchema })
const zoomRegionMove = z.strictObject({ type: z.literal('zoom-region-move'), zoomId: itemId, startUs: z.number().int().nonnegative() })
const zoomRegionTrim = z.strictObject({ type: z.literal('zoom-region-trim'), zoomId: itemId, edge: z.enum(['start', 'end']), deltaUs: z.number().int() })
const zoomRegionUpdate = z.strictObject({ type: z.literal('zoom-region-update'), zoomId: itemId, changes: zoomRegionChanges })
const zoomRegionDelete = z.strictObject({ type: z.literal('zoom-region-delete'), zoomId: itemId })

export const zoomRegionCommandSchema = z.discriminatedUnion('type', [zoomRegionAdd, zoomRegionMove, zoomRegionTrim, zoomRegionUpdate, zoomRegionDelete])

/** `effectRegionSchema` carries a top-level `.refine()` per kind like blur/zoom, so the change set
 * is spelled out per kind (a plain, non-discriminated union — a caller's `changes` object always
 * matches exactly one kind's shape by which fields it sets); timing goes through
 * `effect-move`/`effect-trim` instead. */
const effectHexColor = z.string().regex(/^#[\da-fA-F]{6}$/)
const effectEaseUs = z.number().int().nonnegative().max(5_000_000)
const vignetteChanges = z.strictObject({ amount: z.number().finite().min(0).max(1).optional(), softness: z.number().finite().min(0).max(1).optional(), enabled: z.boolean().optional() })
const letterboxChanges = z.strictObject({ aspect: z.number().finite().min(0.2).max(5).optional(), color: effectHexColor.optional(), easeInUs: effectEaseUs.optional(), easeOutUs: effectEaseUs.optional(), enabled: z.boolean().optional() })
const fadeChanges = z.strictObject({ shape: z.enum(['in', 'out', 'dip']).optional(), color: effectHexColor.optional(), easeInUs: effectEaseUs.optional(), easeOutUs: effectEaseUs.optional(), enabled: z.boolean().optional() })
const grainChanges = z.strictObject({ amount: z.number().finite().min(0).max(1).optional(), size: z.number().finite().min(0.5).max(6).optional(), enabled: z.boolean().optional() })
const vhsChanges = z.strictObject({ amount: z.number().finite().min(0).max(1).optional(), scanlines: z.number().finite().min(0).max(1).optional(), tracking: z.number().finite().min(0).max(1).optional(), enabled: z.boolean().optional() })
const particlesChanges = z.strictObject({ amount: z.number().finite().min(0).max(1).optional(), size: z.number().finite().min(1).max(12).optional(), speed: z.number().finite().min(0).max(2).optional(), color: effectHexColor.optional(), enabled: z.boolean().optional() })
const glowChanges = z.strictObject({ amount: z.number().finite().min(0).max(1).optional(), radius: z.number().finite().min(2).max(80).optional(), threshold: z.number().finite().min(0).max(0.95).optional(), enabled: z.boolean().optional() })
const effectChanges = z.union([vignetteChanges, letterboxChanges, fadeChanges, grainChanges, vhsChanges, particlesChanges, glowChanges])
const effectAdd = z.strictObject({ type: z.literal('effect-add'), effect: effectRegionSchema })
const effectMove = z.strictObject({ type: z.literal('effect-move'), effectId: itemId, startUs: z.number().int().nonnegative() })
const effectTrim = z.strictObject({ type: z.literal('effect-trim'), effectId: itemId, edge: z.enum(['start', 'end']), deltaUs: z.number().int() })
const effectUpdate = z.strictObject({ type: z.literal('effect-update'), effectId: itemId, changes: effectChanges })
const effectDelete = z.strictObject({ type: z.literal('effect-delete'), effectId: itemId })

export const effectCommandSchema = z.discriminatedUnion('type', [effectAdd, effectMove, effectTrim, effectUpdate, effectDelete])

/** `markerSchema` has no top-level `.refine()`, so `.omit()` works directly here. */
const markerChanges = markerSchema.omit({ id: true }).partial()
const markerAdd = z.strictObject({ type: z.literal('marker-add'), marker: markerSchema })
const markerUpdate = z.strictObject({ type: z.literal('marker-update'), markerId: itemId, changes: markerChanges })
const markerDelete = z.strictObject({ type: z.literal('marker-delete'), markerId: itemId })
const textChanges = z.strictObject({
  text: textOverlaySchema.shape.text.optional(), style: captionStyleSchema.optional(),
  enter: textOverlaySchema.shape.enter.optional(), exit: textOverlaySchema.shape.exit.optional(),
  titleMotion: textOverlaySchema.shape.titleMotion,
  layerOrder: textOverlaySchema.shape.layerOrder.optional(),
})
const textAdd = z.strictObject({ type: z.literal('text-add'), overlay: textOverlaySchema })
const textUpdate = z.strictObject({ type: z.literal('text-update'), textId: itemId, changes: textChanges })
const textMove = z.strictObject({ type: z.literal('text-move'), textId: itemId, startUs: z.number().int().nonnegative() })
const textTrim = z.strictObject({ type: z.literal('text-trim'), textId: itemId, edge: z.enum(['start', 'end']), deltaUs: z.number().int() })
const textDuplicate = z.strictObject({ type: z.literal('text-duplicate'), textId: itemId, duplicateId: itemId })
const textDelete = z.strictObject({ type: z.literal('text-delete'), textId: itemId })
const textReorder = z.strictObject({ type: z.literal('text-reorder'), textId: itemId, direction: z.enum(['forward', 'backward', 'above-captions', 'below-captions']) })

const shapeChanges = z.strictObject({
  name: shapeSchema.shape.name, geometry: shapeSchema.shape.geometry.optional(),
  stroke: shapeSchema.shape.stroke.optional(), fill: shapeSchema.shape.fill.optional(),
  arrowStart: shapeSchema.shape.arrowStart.optional(), arrowEnd: shapeSchema.shape.arrowEnd.optional(),
  opacity: shapeSchema.shape.opacity.optional(), enter: shapeSchema.shape.enter.optional(), exit: shapeSchema.shape.exit.optional(),
  layerOrder: shapeSchema.shape.layerOrder.optional(),
  /** `null` removes the glass look. */
  glass: glassSchema.nullable().optional(),
  fitTo: shapeSchema.shape.fitTo, fitPadding: shapeSchema.shape.fitPadding,
})
const shapeAdd = z.strictObject({ type: z.literal('shape-add'), shape: shapeSchema })
const shapeUpdate = z.strictObject({ type: z.literal('shape-update'), shapeId: itemId, changes: shapeChanges })
const shapeMove = z.strictObject({ type: z.literal('shape-move'), shapeId: itemId, startUs: z.number().int().nonnegative() })
const shapeTrim = z.strictObject({ type: z.literal('shape-trim'), shapeId: itemId, edge: z.enum(['start', 'end']), deltaUs: z.number().int() })
const shapeDuplicate = z.strictObject({ type: z.literal('shape-duplicate'), shapeId: itemId, duplicateId: itemId })
const shapeDelete = z.strictObject({ type: z.literal('shape-delete'), shapeId: itemId })
const shapeReorder = z.strictObject({ type: z.literal('shape-reorder'), shapeId: itemId, direction: z.enum(['forward', 'backward', 'above-captions', 'below-captions']) })

const groupCreate = z.strictObject({ type: z.literal('group-create'), groupId: itemId, name: z.string().max(200).optional(), itemIds: z.array(itemId).min(2).max(1000) })
const groupUngroup = z.strictObject({ type: z.literal('group-ungroup'), groupId: itemId })
const groupRename = z.strictObject({ type: z.literal('group-rename'), groupId: itemId, name: z.string().max(200) })
const groupMove = z.strictObject({ type: z.literal('group-move'), groupId: itemId, startUs: z.number().int().nonnegative() })
const groupTranslate = z.strictObject({ type: z.literal('group-translate'), groupId: itemId, dx: z.number().finite().min(-20000).max(20000), dy: z.number().finite().min(-20000).max(20000) })
const groupScale = z.strictObject({ type: z.literal('group-scale'), groupId: itemId, factor: z.number().finite().min(0.05).max(20), anchor: z.strictObject({ x: z.number().finite().min(-20000).max(20000), y: z.number().finite().min(-20000).max(20000) }) })
const groupDuplicate = z.strictObject({ type: z.literal('group-duplicate'), groupId: itemId, idMap: z.record(itemId, itemId) })
const groupDelete = z.strictObject({ type: z.literal('group-delete'), groupId: itemId })

const templateInsert = z.strictObject({
  type: z.literal('template-insert'), templateId: z.string().min(1).max(100),
  startUs: z.number().int().nonnegative(), endUs: z.number().int().positive(),
  ids: z.strictObject({ group: itemId, items: z.record(z.string().min(1).max(100), itemId) }),
  at: z.strictObject({ x: z.number().finite().min(-20000).max(20000), y: z.number().finite().min(-20000).max(20000) }),
  measured: z.record(z.string().min(1).max(100), z.strictObject({ width: z.number().finite().positive().max(40000), height: z.number().finite().positive().max(40000) })),
  glass: z.boolean().optional(),
})

const maskTarget = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('clip'), id: itemId }), z.strictObject({ kind: z.literal('text'), id: itemId }), z.strictObject({ kind: z.literal('shape'), id: itemId }),
  z.strictObject({ kind: z.literal('captionTrack'), id: itemId }), z.strictObject({ kind: z.literal('blur'), id: itemId }),
  z.strictObject({ kind: z.literal('effect'), id: itemId }),
])
const maskSet = z.strictObject({ type: z.literal('mask-set'), target: maskTarget, mask: layerMaskSchema.nullable() })
const layerLookSet = z.strictObject({ type: z.literal('layer-look-set'), target: maskTarget, opacity: z.number().finite().min(0).max(1).optional(), blendMode: z.enum(BLEND_MODES).nullable().optional() })

export const clipCommandSchema = z.discriminatedUnion('type', [
  clipAdd, clipMove, clipTrim, clipTrimTo, clipUpdate, clipSplit, clipDelete, clipsLink, clipsUnlink, clipDetachAudio, gapClose, clipsSet, clipsRestore, formatSet,
  blurAdd, blurUpdate, blurDelete, markerAdd, markerUpdate, markerDelete,
])

// ---------------------------------------------------------------------------------------------
// The full boundary
// ---------------------------------------------------------------------------------------------

export const itemCommandSchema = z.discriminatedUnion('type', [
  assetAdd, assetRemove, assetUpdate, trackAdd, trackRemove, trackUpdate, trackReorder,
  captionTrackAdd, captionTrackRemove, captionTrackUpdate, captionTrackReorder, captionTrackMoveCue,
  clipAdd, clipMove, clipTrim, clipTrimTo, clipUpdate, clipSplit, clipDelete, clipsLink, clipsUnlink, clipDetachAudio, gapClose, clipsSet, clipsRestore, formatSet,
  blurAdd, blurUpdate, blurDelete, zoomRegionAdd, zoomRegionMove, zoomRegionTrim, zoomRegionUpdate, zoomRegionDelete,
  effectAdd, effectMove, effectTrim, effectUpdate, effectDelete,
  textAdd, textUpdate, textMove, textTrim, textDuplicate, textDelete, textReorder,
  shapeAdd, shapeUpdate, shapeMove, shapeTrim, shapeDuplicate, shapeDelete, shapeReorder, groupCreate, groupUngroup, groupRename, groupMove, groupTranslate, groupScale, groupDuplicate, groupDelete, templateInsert, maskSet, layerLookSet,
  markerAdd, markerUpdate, markerDelete,
])

/** Every `CaptionCommand`/`ItemCommand` variant, keyed by `type` — the schema `edit`'s MCP tool
 * (and any other out-of-process caller) validates against before a command ever reaches
 * `applyEditCommand`. `word-action-menu`/App.tsx-issued commands never cross this boundary and
 * stay on the plain TypeScript types; this is deliberately not the same object as `EditCommand`. */
export const editCommandSchema = z.discriminatedUnion('type', [
  toggleEmphasis, estimateWords, updateText, updateTime, shiftTime, addCue, duplicateCue, deleteCue, deleteWord, split, mergeNext,
  regroup, regroupMany, setTimelineDisplay, setDisplay, setCaptionDisplay, applyTemplate, setMotionOverride,
  resetMotionOverrides, setPlacementOverride, resetPlacementOverrides, lineBreakBeforeWord, splitBeforeWord, moveFromWordToNext, moveThroughWordToPrevious,
  assetAdd, assetRemove, assetUpdate, trackAdd, trackRemove, trackUpdate, trackReorder,
  captionTrackAdd, captionTrackRemove, captionTrackUpdate, captionTrackReorder, captionTrackMoveCue,
  clipAdd, clipMove, clipTrim, clipTrimTo, clipUpdate, clipSplit, clipDelete, clipsLink, clipsUnlink, clipDetachAudio, gapClose, clipsSet, clipsRestore, formatSet,
  blurAdd, blurUpdate, blurDelete, zoomRegionAdd, zoomRegionMove, zoomRegionTrim, zoomRegionUpdate, zoomRegionDelete,
  effectAdd, effectMove, effectTrim, effectUpdate, effectDelete,
  textAdd, textUpdate, textMove, textTrim, textDuplicate, textDelete, textReorder,
  shapeAdd, shapeUpdate, shapeMove, shapeTrim, shapeDuplicate, shapeDelete, shapeReorder, groupCreate, groupUngroup, groupRename, groupMove, groupTranslate, groupScale, groupDuplicate, groupDelete, templateInsert, maskSet, layerLookSet,
  markerAdd, markerUpdate, markerDelete,
])

export type EditCommandInput = z.infer<typeof editCommandSchema>

/** Compile-time drift guard: every parsed command must satisfy the real `EditCommand` union that
 * `applyEditCommand` (`commands.ts`) consumes. If a command type gains or renames a field here
 * without a matching change there (or vice versa), this line stops building. */
type _ParsedCommandIsEditCommand = EditCommandInput extends EditCommand ? true : never
const _parsedCommandIsEditCommand: _ParsedCommandIsEditCommand = true
void _parsedCommandIsEditCommand
