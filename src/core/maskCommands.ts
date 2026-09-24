import type { LayerMask } from './edit'
import type { CaptionProject } from './model'
import { failItem, replaceById, type ItemFailure, type ItemStep } from './itemStep'
import type { Selection } from './timelineItems'

/** What a mask can attach to. A caption track's mask covers its whole caption plane (every cue);
 * glow, zoom, audio clips and markers have no mask (docs/EDITING.md "Layer masks"). */
export type MaskTarget =
  | { kind: 'clip'; id: string }
  | { kind: 'text'; id: string }
  | { kind: 'captionTrack'; id: string }
  | { kind: 'blur'; id: string }
  | { kind: 'effect'; id: string }

export type MaskCommand =
  /** Sets (or, with `null`, removes) the one mask on an item. One command is one undo step, so a
   * whole stage gesture or slider commit is a single history entry. */
  | { type: 'mask-set'; target: MaskTarget; mask: LayerMask | null }

const withMask = <T extends object>(item: T, mask: LayerMask | null): T => {
  const { mask: _previous, ...rest } = item as T & { mask?: LayerMask }
  return (mask ? { ...rest, mask } : rest) as T
}

export function applyMaskCommand(project: CaptionProject, command: MaskCommand): ItemStep | ItemFailure {
  const { target, mask } = command
  const missing = failItem('asset-missing', [target.id], 'That layer no longer exists.')
  switch (target.kind) {
    case 'clip': {
      const clip = project.clips.find((item) => item.id === target.id)
      if (!clip) return missing
      if (clip.kind === 'audio') return failItem('asset-kind', [target.id], 'An audio clip has nothing to mask.')
      const clips = replaceById(project.clips, target.id, (item) => withMask(item, mask))!
      return { project: { ...project, clips }, selection: { kind: 'clip', id: target.id } satisfies Selection }
    }
    case 'text': {
      const textOverlays = replaceById(project.textOverlays, target.id, (item) => withMask(item, mask))
      return textOverlays ? { project: { ...project, textOverlays }, selection: { kind: 'text', id: target.id } } : missing
    }
    case 'captionTrack': {
      const captionTracks = replaceById(project.captionTracks, target.id, (item) => withMask(item, mask))
      return captionTracks ? { project: { ...project, captionTracks } } : missing
    }
    case 'blur': {
      const blurRegions = replaceById(project.blurRegions, target.id, (item) => withMask(item, mask))
      return blurRegions ? { project: { ...project, blurRegions }, selection: { kind: 'blur', id: target.id } } : missing
    }
    case 'effect': {
      const effect = project.effects.find((item) => item.id === target.id)
      if (!effect) return missing
      if (effect.kind === 'glow') return failItem('asset-kind', [target.id], 'Glow reads the picture itself and cannot be masked.')
      const effects = replaceById(project.effects, target.id, (item) => withMask(item, mask))!
      return { project: { ...project, effects }, selection: { kind: 'effect', id: target.id } }
    }
  }
}
