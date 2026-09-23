import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import type { EffectRegion, EffectRegionKind } from '../core/edit'
import type { EffectDragMode } from '../core/effectCommands'
import { timeToPixel } from '../core/timeline'
import { formatClock } from '../core/time'

const EFFECT_LANE_LABEL: Record<EffectRegionKind, string> = { vignette: 'Vignette', letterbox: 'Letterbox', fade: 'Fade' }

/**
 * One frame-paint effect's lane (docs/EDITING.md "Frame-paint effects"): the same fixed-row,
 * one-lane-per-kind draw/drag shape `ZoomLane.tsx` uses (a region is sequence-timed and belongs to
 * no clip or track), generalized across kinds instead of one component per kind. Regions in one
 * lane share a kind, so — like zoom, unlike blur — they never overlap each other here; a different
 * kind's lane is free to hold an overlapping region at the same time.
 */
export function EffectLane({ effectKind, regions, durationUs, selectedId, draggingId, onBeginDrag, onKeyboardSelect, onSeekTrack }: {
  effectKind: EffectRegionKind
  regions: readonly EffectRegion[]
  durationUs: number
  selectedId: string | null
  draggingId: string | null
  onBeginDrag: (event: ReactPointerEvent<HTMLElement>, region: EffectRegion, mode: EffectDragMode) => void
  onKeyboardSelect: (event: ReactKeyboardEvent<HTMLDivElement>, region: EffectRegion) => void
  onSeekTrack: (event: ReactPointerEvent<HTMLDivElement>) => void
}) {
  const label = EFFECT_LANE_LABEL[effectKind]
  const place = (region: EffectRegion) => ({ left: `${timeToPixel(region.startUs, durationUs, 100)}%`, width: `${Math.max(.02, timeToPixel(region.endUs - region.startUs, durationUs, 100))}%` })
  return <div className={`track effect-lane ${effectKind}-lane`} onPointerDown={onSeekTrack} role="group"
    aria-label={`${label} regions. Tab to a region, then press Enter to select and seek to it.`}>
    {regions.map((region) => <div key={region.id} role="button" tabIndex={0}
      aria-label={`${label} region, ${formatClock(region.startUs)} to ${formatClock(region.endUs)}${region.enabled ? '' : ', bypassed'}`}
      aria-pressed={region.id === selectedId}
      className={`zoom-block effect-block ${effectKind}-block ${region.id === selectedId ? 'active' : ''} ${draggingId === region.id ? 'dragging' : ''} ${region.enabled ? '' : 'disabled'}`}
      style={place(region)}
      onPointerDown={(event) => onBeginDrag(event, region, 'move')}
      onKeyDown={(event) => onKeyboardSelect(event, region)}
    >
      <span className="cue-handle start" data-handle="start" aria-hidden="true" onPointerDown={(event) => onBeginDrag(event, region, 'start')} />
      <span className="zoom-block-label" aria-hidden="true">{label}</span>
      <span className="cue-handle end" data-handle="end" aria-hidden="true" onPointerDown={(event) => onBeginDrag(event, region, 'end')} />
    </div>)}
  </div>
}
