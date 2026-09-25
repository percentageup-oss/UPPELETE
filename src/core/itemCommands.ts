import { COMPOSITION_WIDTH, assetIdOf, type BlurRegion, type Clip, type ClipKind, type CompositionRect, type ProjectAsset, type SequenceFormat, type Track } from './edit'
import { projectSchema, type CaptionProject } from './model'
import { assetDurations, bindUnboundItems, defaultBindingAssetId } from './projectClips'
import type { ClipEdge, EditMode } from './clipEdits'
import type { TimeRange } from './timelineModel'
import type { CommandContext, CommandResult, ValidationIssue } from './captionCommands'
import { issue, isItemFailure } from './itemStep'
import { applyAssetCommand, type AssetCommand } from './assetCommands'
import { applyTrackCommand, type TrackCommand } from './trackCommands'
import { applyCaptionTrackCommand, type CaptionTrackCommand } from './captionTrackCommands'
import { applyClipCommand, type ClipCommand } from './clipCommands'
import { applyZoomRegionCommand, type ZoomRegionCommand } from './zoomRegionCommands'
import { applyEffectCommand, type EffectCommand } from './effectCommands'
import { applyTextCommand, type TextCommand } from './textCommands'
import { applyShapeCommand, type ShapeCommand } from './shapeCommands'
import { applyGroupCommand, type GroupCommand } from './groupCommands'
import { applyMaskCommand, type MaskCommand } from './maskCommands'
import { applyLayerLookCommand, type LayerLookCommand } from './layerLookCommands'

/**
 * The second command union, beside `CaptionCommand`. It shares `CommandResult`/`ValidationIssue`
 * with caption editing and produces a whole new project, so `history.ts`'s project snapshots give
 * every item the same undo/redo captions already have (docs/EDITING.md). The verbs live in
 * `assetCommands.ts`, `trackCommands.ts`, `captionTrackCommands.ts`, `clipCommands.ts` and
 * `zoomRegionCommands.ts`; this module owns the union, the shared validation and the one epilogue
 * every item command runs through.
 */
export type ItemCommand = AssetCommand | TrackCommand | CaptionTrackCommand | ClipCommand | ZoomRegionCommand | EffectCommand | TextCommand | ShapeCommand | GroupCommand | MaskCommand | LayerLookCommand
export type { AssetCommand, TrackCommand, CaptionTrackCommand, ClipCommand, ZoomRegionCommand, EffectCommand, TextCommand, ShapeCommand, GroupCommand, MaskCommand, LayerLookCommand, ClipEdge, EditMode }
export type { BlurRegion, Clip, ClipKind, ProjectAsset, SequenceFormat, TimeRange, Track }

export const ITEM_COMMAND_TYPES: ReadonlySet<ItemCommand['type']> = new Set<ItemCommand['type']>([
  'asset-add', 'asset-remove', 'asset-update',
  'track-add', 'track-remove', 'track-update', 'track-reorder',
  'caption-track-add', 'caption-track-remove', 'caption-track-update', 'caption-track-reorder', 'caption-track-move-cue',
  'clip-add', 'clip-move', 'clip-trim', 'clip-trim-to', 'clip-update', 'clip-split', 'clip-delete', 'clips-link', 'clips-unlink', 'clip-detach-audio', 'gap-close', 'clips-set', 'clips-restore', 'format-set',
  'blur-add', 'blur-update', 'blur-delete',
  'zoom-region-add', 'zoom-region-move', 'zoom-region-trim', 'zoom-region-update', 'zoom-region-delete',
  'effect-add', 'effect-move', 'effect-trim', 'effect-update', 'effect-delete',
  'text-add', 'text-update', 'text-move', 'text-trim', 'text-duplicate', 'text-delete', 'text-reorder',
  'shape-add', 'shape-update', 'shape-move', 'shape-trim', 'shape-duplicate', 'shape-delete', 'shape-reorder',
  'group-create', 'group-ungroup', 'group-rename', 'group-move', 'group-translate', 'group-scale', 'group-duplicate', 'group-delete',
  'mask-set', 'layer-look-set',
  'marker-add', 'marker-update', 'marker-delete',
])

function rectOutsideHeight(rect: CompositionRect, compositionHeight: number | null | undefined): boolean {
  return typeof compositionHeight === 'number' && compositionHeight > 0 && rect.y + rect.height > compositionHeight + 0.5
}

/**
 * Runs after every item command, exactly as `validateCaptions` runs after every caption command.
 * Rect *height* produces a warning rather than an error — see `CommandContext.compositionHeight`.
 */
export function validateItems(project: CaptionProject, context: CommandContext = {}): { errors: ValidationIssue[]; warnings: ValidationIssue[] } {
  const errors: ValidationIssue[] = []
  const warnings: ValidationIssue[] = []
  const assets = new Map(project.assets.map((asset) => [asset.id, asset]))
  const durations = assetDurations(project)
  const durationOf = (assetId: string): number | null => context.assetDurationUs?.(assetId) ?? durations.get(assetId) ?? null

  const checkRect = (id: string, rect: CompositionRect, what: string) => {
    if (rect.x < 0 || rect.width <= 0 || rect.x + rect.width > COMPOSITION_WIDTH) {
      errors.push(issue('rect-bounds', [id], `${what} must stay inside the ${COMPOSITION_WIDTH}-unit composition width.`))
    }
    if (rectOutsideHeight(rect, context.compositionHeight)) {
      warnings.push(issue('rect-bounds', [id], `${what} extends below the visible frame at the current aspect ratio.`))
    }
  }
  const noun: Record<ClipKind, string> = { video: 'A video clip', image: 'An image clip', color: 'A background', audio: 'An audio clip', adjustment: 'An adjustment layer' }

  for (const clip of project.clips) {
    const what = noun[clip.kind]
    const asset = clip.kind === 'color' || clip.kind === 'adjustment' ? undefined : assets.get(clip.assetId)
    if (clip.kind === 'color' || clip.kind === 'adjustment') { /* generated: no asset */ }
    else if (!asset) errors.push(issue('asset-missing', [clip.id], `${what} references media that is no longer in the project.`))
    else if (asset.kind !== clip.kind && !(clip.kind === 'audio' && asset.kind === 'video')) errors.push(issue('asset-kind', [clip.id], `${what} must reference ${clip.kind === 'image' ? 'an image' : `a ${clip.kind}`} file.`))
    if (!Number.isSafeInteger(clip.timelineStartUs) || clip.timelineStartUs < 0 || !Number.isSafeInteger(clip.sourceStartUs) || clip.sourceStartUs < 0
      || !Number.isSafeInteger(clip.sourceEndUs) || clip.sourceEndUs <= clip.sourceStartUs) {
      errors.push(issue('invalid-duration', [clip.id], `${what} must end after its non-negative start.`))
    } else if (clip.kind === 'video' || clip.kind === 'audio') {
      const boundUs = durationOf(clip.assetId)
      if (boundUs !== null && clip.sourceEndUs > boundUs) errors.push(issue('media-bounds', [clip.id], `${what} must stay within its file’s known duration.`))
    }
    if (clip.kind !== 'audio' && clip.kind !== 'adjustment' && clip.rect) checkRect(clip.id, clip.rect, what)
    if ((clip.kind === 'video' || clip.kind === 'audio') && !(clip.gain >= 0 && clip.gain <= 4)) errors.push(issue('gain-range', [clip.id], `${what}’s gain must be between 0 and 4.`))
  }
  for (const region of project.blurRegions) {
    if (!Number.isSafeInteger(region.startUs) || !Number.isSafeInteger(region.endUs) || region.startUs < 0 || region.endUs <= region.startUs) {
      errors.push(issue('invalid-duration', [region.id], 'A blur region must end after its non-negative start.'))
    }
    checkRect(region.id, region.rect, 'A blur region')
  }
  // A rect of a different aspect than the output would make the export's FFmpeg crop distort the
  // picture — a warning, like the height bound above, since a later format change must never make
  // a saved project unloadable.
  const targetAspect = context.compositionHeight ? COMPOSITION_WIDTH / context.compositionHeight : null
  for (const region of project.zoomRegions) {
    if (!Number.isSafeInteger(region.startUs) || !Number.isSafeInteger(region.endUs) || region.startUs < 0 || region.endUs <= region.startUs) {
      errors.push(issue('invalid-duration', [region.id], 'A zoom region must end after its non-negative start.'))
    }
    if (!Number.isSafeInteger(region.easeInUs) || region.easeInUs < 0 || !Number.isSafeInteger(region.easeOutUs) || region.easeOutUs < 0) {
      errors.push(issue('invalid-duration', [region.id], 'A zoom region’s ease-in/out must be zero or positive.'))
    }
    checkRect(region.id, region.rect, 'A zoom region')
    if (targetAspect !== null) {
      const rectAspect = region.rect.width / region.rect.height
      if (Math.abs(rectAspect - targetAspect) > targetAspect * 0.02) {
        warnings.push(issue('rect-bounds', [region.id], 'A zoom region’s target framing should match the output aspect ratio, or the export will letterbox or distort it.'))
      }
    }
  }
  for (const shape of project.shapes) {
    if (!Number.isSafeInteger(shape.startUs) || !Number.isSafeInteger(shape.endUs) || shape.startUs < 0 || shape.endUs <= shape.startUs) {
      errors.push(issue('invalid-duration', [shape.id], 'A shape must end after its non-negative start.'))
    }
  }
  for (const effect of project.effects) {
    if (!Number.isSafeInteger(effect.startUs) || !Number.isSafeInteger(effect.endUs) || effect.startUs < 0 || effect.endUs <= effect.startUs) {
      errors.push(issue('invalid-duration', [effect.id], 'An effect must end after its non-negative start.'))
    }
  }
  return { errors, warnings }
}

export function applyItemCommand(project: CaptionProject, command: ItemCommand, context: CommandContext = {}): CommandResult {
  const step = command.type === 'layer-look-set' ? applyLayerLookCommand(project, command as LayerLookCommand)
    : command.type.startsWith('group-') ? applyGroupCommand(project, command as GroupCommand, context.compositionHeight)
    : command.type.startsWith('mask-') ? applyMaskCommand(project, command as MaskCommand)
    : command.type.startsWith('text-') ? applyTextCommand(project, command as TextCommand)
    : command.type.startsWith('shape-') ? applyShapeCommand(project, command as ShapeCommand)
    : command.type.startsWith('asset-') ? applyAssetCommand(project, command as AssetCommand, context)
    : command.type.startsWith('caption-track-') ? applyCaptionTrackCommand(project, command as CaptionTrackCommand)
    : command.type.startsWith('track-') ? applyTrackCommand(project, command as TrackCommand)
    : command.type.startsWith('zoom-region-') ? applyZoomRegionCommand(project, command as ZoomRegionCommand)
    : command.type.startsWith('effect-') ? applyEffectCommand(project, command as EffectCommand)
    : applyClipCommand(project, command as ClipCommand, context)
  if (isItemFailure(step)) return step

  // A caption created without a video (the caller did not say which) belongs to the sequence's only
  // video; the schema reports it when that is ambiguous.
  const next = bindUnboundItems(step.project, defaultBindingAssetId(step.project, context.defaultAssetId))
  if (next === project) return { ok: true, project, selectedId: undefined, selection: step.selection, warnings: validateItems(project, context).warnings }
  const validation = validateItems(next, context)
  if (validation.errors.length) return { ok: false, errors: validation.errors, warnings: validation.warnings }
  // The schema is the backstop for the rules commands cannot restate cheaply — the single ID
  // namespace, sorted clips, no overlap on a track and clip/track/asset kinds.
  const parsed = projectSchema.safeParse(next)
  if (!parsed.success) {
    return { ok: false, warnings: validation.warnings, errors: [issue('invalid-duration', [], parsed.error.issues.map((item) => item.message).join(' '))] }
  }
  return { ok: true, project: parsed.data, selectedId: undefined, selection: step.selection, warnings: validation.warnings }
}

export type { CompositionRect }
