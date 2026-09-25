import type { BlendMode, Clip, CompositionRect, LayerMask } from './edit'
import type { Size } from './composition'
import type { CaptionProject } from './model'
import type { MaskTarget } from './maskCommands'
import type { Selection } from './timelineItems'
import { compareLayered } from './graphicsOrder'
import { imagesHostPainted } from './hostPainted'
import { shapeBox } from './shapePath'
import { groupSpan } from './groupCommands'
import { activeClipsAt, activeCueAt, captionTrackLabel, trackLabel } from './timelineModel'

/**
 * The Layers tab's list (docs/EDITING.md "Layer masks"): what is painted at `sequenceUs`, **front to
 * back**, in the exact order `CaptionStage` (preview) and `frameHarness` + FFmpeg (export) composite
 * it — fade, text above captions, the caption plane, text below, pinned frame-paint effects,
 * host-painted images, blur, then the picture clips from the topmost track down. Zoom, glow and
 * markers paint no layer of their own, so they are absent.
 */
export type LayerRow = {
  key: string
  kind: 'fade' | 'text' | 'shape' | 'captions' | 'effect' | 'blur' | 'image' | 'video'
  label: string
  /** A short kind hint shown beside the label. */
  detail: string
  target: MaskTarget
  mask: LayerMask | null
  /** 0-1, or null when the layer has no opacity (effects, blur, fade). Absent on the item reads as 1. */
  opacity: number | null
  /** Only picture clips blend; null everywhere else. Absent on the clip reads as 'normal'. */
  blendMode: BlendMode | null
  /** What clicking the row selects on the timeline (a caption plane selects its active cue). */
  selection: Selection | null
  /** The group this shape or title belongs to (schema 22); the Layers tab nests such rows under a group row. */
  groupId?: string
  /** False for a caption track with no caption showing at this instant (listed only once the project has captions). */
  active: boolean
}

/** Frame-paint effect kinds painted under the captions, front to back (`pinnedEffectLayers` reversed). */
const PINNED_FRONT_TO_BACK = ['letterbox', 'particles', 'grain', 'vhs', 'vignette'] as const
const EFFECT_NAME: Record<string, string> = { letterbox: 'Letterbox', grain: 'Film grain', vhs: 'VHS', particles: 'Light particles', vignette: 'Vignette', fade: 'Fade' }

const snippet = (text: string) => { const line = text.replace(/\s+/g, ' ').trim(); return line.length > 28 ? `${line.slice(0, 27)}…` : line }

export function layerStackAt(project: CaptionProject, sequenceUs: number): LayerRow[] {
  const rows: LayerRow[] = []
  const at = Math.round(sequenceUs)
  const activeEffect = (kind: string) => project.effects.find((effect) => effect.kind === kind && effect.enabled && at >= effect.startUs && at < effect.endUs)
  const effectRow = (kind: 'fade' | 'effect', effect: NonNullable<ReturnType<typeof activeEffect>>): LayerRow => ({
    key: effect.id, kind, label: EFFECT_NAME[effect.kind] ?? effect.kind, detail: 'Effect', target: { kind: 'effect', id: effect.id },
    mask: 'mask' in effect ? effect.mask ?? null : null, opacity: null, blendMode: null, selection: { kind: 'effect', id: effect.id }, active: true,
  })
  const textRow = (item: CaptionProject['textOverlays'][number]): LayerRow => ({
    key: item.id, kind: 'text', label: snippet(item.text) || 'Title', detail: 'Title', target: { kind: 'text', id: item.id },
    mask: item.mask ?? null, opacity: item.opacity ?? 1, blendMode: null, selection: { kind: 'text', id: item.id }, active: true,
    ...(item.groupId ? { groupId: item.groupId } : {}),
  })

  const shapeRow = (item: CaptionProject['shapes'][number]): LayerRow => ({
    key: item.id, kind: 'shape', label: item.name?.trim() || item.geometry.kind, detail: 'Graphic', target: { kind: 'shape', id: item.id },
    mask: item.mask ?? null, opacity: item.opacity, blendMode: item.blendMode ?? 'normal', selection: { kind: 'shape', id: item.id }, active: true,
    ...(item.groupId ? { groupId: item.groupId } : {}),
  })

  const fade = activeEffect('fade')
  if (fade) rows.push(effectRow('fade', fade))

  // Text and shapes share one layer order (`graphicsOrder.ts`), exactly as preview and export sort them.
  const activeText = [
    ...project.textOverlays.filter((item) => item.startUs <= at && at < item.endUs).map((item) => ({ order: item, row: textRow(item) })),
    ...project.shapes.filter((item) => item.startUs <= at && at < item.endUs).map((item) => ({ order: item, row: shapeRow(item) })),
  ].sort((a, b) => compareLayered(a.order, b.order))
  rows.push(...activeText.filter(({ order }) => order.layerOrder >= 0).reverse().map(({ row }) => row))

  const shown = activeCueAt(at, project.tracks, project.clips, project.cues)
  const trackIds = shown?.cue.captionTrackId ? [shown.cue.captionTrackId] : shown ? [] : project.cues.length ? project.captionTracks.map((track) => track.id) : []
  for (const id of trackIds) {
    const track = project.captionTracks.find((candidate) => candidate.id === id)
    if (!track) continue
    rows.push({ key: `captions:${track.id}`, kind: 'captions', label: captionTrackLabel(track, project.captionTracks), detail: 'Captions',
      target: { kind: 'captionTrack', id: track.id }, mask: track.mask ?? null, opacity: track.opacity ?? 1, blendMode: null, selection: shown?.cue.captionTrackId === id ? { kind: 'cue', id: shown.cue.id } : null, active: Boolean(shown) })
  }

  rows.push(...activeText.filter(({ order }) => order.layerOrder < 0).reverse().map(({ row }) => row))
  for (const kind of PINNED_FRONT_TO_BACK) {
    const effect = activeEffect(kind)
    if (effect) rows.push(effectRow('effect', effect))
  }

  // Same rule as `CaptionStage`/`buildExportManifest`: images are host-painted (pinned, above the
  // picture) only when every image track sits above every video track.

  const hiddenTracks = new Set(project.tracks.filter((track) => track.hidden).map((track) => track.id))
  const hostPaintedImages = imagesHostPainted(project.clips, project.tracks, { adjustments: project.clips.some((clip) => clip.kind === 'adjustment' && clip.enabled !== false && !hiddenTracks.has(clip.trackId)) })
  const assets = new Map(project.assets.map((asset) => [asset.id, asset]))
  const visual = activeClipsAt(at, project.tracks, project.clips.filter((clip) => clip.kind !== 'audio' && clip.kind !== 'adjustment'), { skipHidden: true })
    .filter((entry): entry is { clip: Exclude<Clip, { kind: 'audio' | 'adjustment' }>; track: CaptionProject['tracks'][number]; sourceUs: number } => entry.clip.kind !== 'adjustment')
  const clipRow = ({ clip, track }: { clip: Exclude<Clip, { kind: 'audio' | 'adjustment' }>; track: CaptionProject['tracks'][number] }): LayerRow => ({
    key: clip.id, kind: clip.kind === 'image' ? 'image' : 'video', label: clip.kind === 'color' ? (clip.fill.type === 'solid' ? 'Color background' : 'Gradient background') : assets.get(clip.assetId)?.name ?? 'Missing file',
    detail: `${clip.kind === 'image' ? 'Image' : clip.kind === 'color' ? 'Background' : 'Video'} · ${trackLabel(track, project.tracks)}`, target: { kind: 'clip', id: clip.id },
    mask: clip.mask ?? null, opacity: clip.opacity, blendMode: clip.blendMode ?? 'normal', selection: { kind: 'clip', id: clip.id }, active: true,
  })
  const front = [...visual].reverse()
  if (hostPaintedImages) rows.push(...front.filter(({ clip }) => clip.kind === 'image').map(clipRow))
  for (const region of project.blurRegions.filter((candidate) => candidate.enabled && at >= candidate.startUs && at < candidate.endUs).reverse()) {
    rows.push({ key: region.id, kind: 'blur', label: 'Blur', detail: 'Blur area', target: { kind: 'blur', id: region.id }, mask: region.mask ?? null, opacity: null, blendMode: null,
      selection: { kind: 'blur', id: region.id }, active: true })
  }
  rows.push(...front.filter(({ clip }) => clip.kind !== 'image' || !hostPaintedImages).map(clipRow))
  return rows
}

/**
 * Where a new mask starts: the item's own footprint when it has one (a picture-in-picture clip, a
 * blur area), otherwise a centred region covering 70% of the frame, ready to be reshaped.
 */
export function defaultMaskBounds(row: LayerRow, project: CaptionProject, composition: Size): CompositionRect {
  if (row.target.kind === 'clip') {
    const clip = project.clips.find((candidate) => candidate.id === row.target.id)
    if (clip && clip.kind !== 'audio' && clip.kind !== 'adjustment' && clip.rect) return clip.rect
  } else if (row.target.kind === 'shape') {
    const shape = project.shapes.find((candidate) => candidate.id === row.target.id)
    if (shape) return shapeBox(shape.geometry)
  } else if (row.target.kind === 'blur') {
    const region = project.blurRegions.find((candidate) => candidate.id === row.target.id)
    if (region) return region.rect
  }
  return { x: composition.width * .15, y: composition.height * .15, width: composition.width * .7, height: composition.height * .7 }
}

/** Start time of a timeline item, for "jump to it" when the selection is not under the playhead. */
export function itemStartUs(project: CaptionProject, selection: Selection): number | null {
  if (selection.kind === 'clip') return project.clips.find((clip) => clip.id === selection.id)?.timelineStartUs ?? null
  if (selection.kind === 'text') return project.textOverlays.find((item) => item.id === selection.id)?.startUs ?? null
  if (selection.kind === 'shape') return project.shapes.find((item) => item.id === selection.id)?.startUs ?? null
  if (selection.kind === 'group') return groupSpan(project, selection.id)?.startUs ?? null
  if (selection.kind === 'blur') return project.blurRegions.find((region) => region.id === selection.id)?.startUs ?? null
  if (selection.kind === 'effect') return project.effects.find((effect) => effect.id === selection.id)?.startUs ?? null
  return null
}
