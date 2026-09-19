import type { Cue } from './model'

/**
 * The timeline's generic vocabulary. With schema 5 there are three kinds of things the timeline
 * can draw, select and drag: captions (stored in their video's source time), clips (video, image
 * and audio, at absolute sequence positions) and blur regions (sequence time).
 */
export type TimelineItemKind = 'cue' | 'clip' | 'blur'

/** Clamps for one drag gesture, in the item's own time base. */
export type DragBounds = {
  minStartUs: number
  maxStartUs: number
  minEndUs: number
  maxEndUs: number
}

export type TimelineItem = {
  kind: TimelineItemKind
  id: string
  startUs: number
  endUs: number
  label: string
  /** Precomputed clamps for this item; the captions track derives them from word containment. */
  bounds?: DragBounds
}

/** What is selected anywhere in the editor. One ID namespace (model.ts) makes `{kind, id}` exact. */
export type Selection = { kind: TimelineItemKind; id: string }

export function cueItem(cue: Cue): TimelineItem {
  return { kind: 'cue', id: cue.id, startUs: cue.startUs, endUs: cue.endUs, label: cue.text }
}

export function isSelected(selection: Selection | null, kind: TimelineItemKind, id: string): boolean {
  return selection?.kind === kind && selection.id === id
}

/** The selected ID when the selection is of this kind, else null — for read sites that only care
 * about one kind (the caption inspector, transcript list and caption shortcuts). */
export function selectedIdOfKind(selection: Selection | null, kind: TimelineItemKind): string | null {
  return selection?.kind === kind ? selection.id : null
}
