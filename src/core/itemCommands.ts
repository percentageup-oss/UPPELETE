import { COMPOSITION_WIDTH, type BlurRegion, type Clip, type ClipKind, type CompositionRect, type ProjectAsset, type SequenceFormat, type Track } from './edit'
import { projectSchema, type CaptionProject } from './model'
import { assetDurations, bindUnboundItems, defaultBindingAssetId } from './projectClips'
import type { ClipEdge, EditMode } from './clipEdits'
import type { TimeRange } from './timelineModel'
import type { CommandContext, CommandResult, ValidationIssue } from './captionCommands'
import { issue, isItemFailure } from './itemStep'
import { applyAssetCommand, type AssetCommand } from './assetCommands'
import { applyTrackCommand, type TrackCommand } from './trackCommands'
import { applyClipCommand, type ClipCommand } from './clipCommands'

/**
 * The second command union, beside `CaptionCommand`. It shares `CommandResult`/`ValidationIssue`
 * with caption editing and produces a whole new project, so `history.ts`'s project snapshots give
 * every item the same undo/redo captions already have (docs/EDITING.md). The verbs live in
 * `assetCommands.ts`, `trackCommands.ts` and `clipCommands.ts`; this module owns the union, the
 * shared validation and the one epilogue every item command runs through.
 */
export type ItemCommand = AssetCommand | TrackCommand | ClipCommand
export type { AssetCommand, TrackCommand, ClipCommand, ClipEdge, EditMode }
export type { BlurRegion, Clip, ClipKind, ProjectAsset, SequenceFormat, TimeRange, Track }

export const ITEM_COMMAND_TYPES: ReadonlySet<ItemCommand['type']> = new Set<ItemCommand['type']>([
  'asset-add', 'asset-remove', 'asset-update',
  'track-add', 'track-remove', 'track-update', 'track-reorder',
  'clip-add', 'clip-move', 'clip-trim', 'clip-update', 'clip-split', 'clip-delete', 'gap-close', 'clips-set', 'clips-restore', 'format-set',
  'blur-add', 'blur-update', 'blur-delete', 'marker-add', 'marker-update', 'marker-delete',
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
  const noun: Record<ClipKind, string> = { video: 'A video clip', image: 'An image clip', audio: 'An audio clip' }

  for (const clip of project.clips) {
    const what = noun[clip.kind]
    const asset = assets.get(clip.assetId)
    if (!asset) errors.push(issue('asset-missing', [clip.id], `${what} references media that is no longer in the project.`))
    else if (asset.kind !== clip.kind) errors.push(issue('asset-kind', [clip.id], `${what} must reference ${clip.kind === 'image' ? 'an image' : `a ${clip.kind}`} file.`))
    if (!Number.isSafeInteger(clip.timelineStartUs) || clip.timelineStartUs < 0 || !Number.isSafeInteger(clip.sourceStartUs) || clip.sourceStartUs < 0
      || !Number.isSafeInteger(clip.sourceEndUs) || clip.sourceEndUs <= clip.sourceStartUs) {
      errors.push(issue('invalid-duration', [clip.id], `${what} must end after its non-negative start.`))
    } else if (clip.kind !== 'image') {
      const boundUs = durationOf(clip.assetId)
      if (boundUs !== null && clip.sourceEndUs > boundUs) errors.push(issue('media-bounds', [clip.id], `${what} must stay within its file’s known duration.`))
    }
    if (clip.kind !== 'audio' && clip.rect) checkRect(clip.id, clip.rect, what)
    if (clip.kind !== 'image' && !(clip.gain >= 0 && clip.gain <= 4)) errors.push(issue('gain-range', [clip.id], `${what}’s gain must be between 0 and 4.`))
  }
  for (const region of project.blurRegions) {
    if (!Number.isSafeInteger(region.startUs) || !Number.isSafeInteger(region.endUs) || region.startUs < 0 || region.endUs <= region.startUs) {
      errors.push(issue('invalid-duration', [region.id], 'A blur region must end after its non-negative start.'))
    }
    checkRect(region.id, region.rect, 'A blur region')
  }
  return { errors, warnings }
}

export function applyItemCommand(project: CaptionProject, command: ItemCommand, context: CommandContext = {}): CommandResult {
  const step = command.type.startsWith('asset-') ? applyAssetCommand(project, command as AssetCommand, context)
    : command.type.startsWith('track-') ? applyTrackCommand(project, command as TrackCommand)
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
