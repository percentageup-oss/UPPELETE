import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import type { BlurRegion } from '../core/edit'
import type { BlurDragMode } from '../core/blurRegion'
import { timeToPixel } from '../core/timeline'
import { formatClock } from '../core/time'

/**
 * The blur lane: one fixed row over the whole program, the same draw/drag shape as `ZoomLane.tsx`
 * — a blur region is sequence-timed and belongs to no clip or track. Unlike the zoom lane, regions
 * here may overlap (`blurRegion.ts`), so overlapping blocks currently stack in DOM order (the later
 * one drawn on top); sub-row packing is not yet built (docs/STATUS.md).
 */
export function BlurLane({ regions, durationUs, selectedBlurId, draggingId, onBeginDrag, onKeyboardSelect, onSeekTrack }: {
  regions: readonly BlurRegion[]
  durationUs: number
  selectedBlurId: string | null
  draggingId: string | null
  onBeginDrag: (event: ReactPointerEvent<HTMLElement>, region: BlurRegion, mode: BlurDragMode) => void
  onKeyboardSelect: (event: ReactKeyboardEvent<HTMLDivElement>, region: BlurRegion) => void
  onSeekTrack: (event: ReactPointerEvent<HTMLDivElement>) => void
}) {
  const place = (region: BlurRegion) => ({ left: `${timeToPixel(region.startUs, durationUs, 100)}%`, width: `${Math.max(.02, timeToPixel(region.endUs - region.startUs, durationUs, 100))}%` })
  return <div className="track blur-lane" onPointerDown={onSeekTrack} role="group"
    aria-label="Blur regions. Tab to a region, then press Enter to select and seek to it.">
    {regions.map((region) => <div key={region.id} role="button" tabIndex={0}
      aria-label={`Blur region, ${formatClock(region.startUs)} to ${formatClock(region.endUs)}${region.enabled ? '' : ', bypassed'}`}
      aria-pressed={region.id === selectedBlurId}
      className={`zoom-block blur-block ${region.id === selectedBlurId ? 'active' : ''} ${draggingId === region.id ? 'dragging' : ''} ${region.enabled ? '' : 'disabled'}`}
      style={place(region)}
      onPointerDown={(event) => onBeginDrag(event, region, 'move')}
      onKeyDown={(event) => onKeyboardSelect(event, region)}
    >
      <span className="cue-handle start" data-handle="start" aria-hidden="true" onPointerDown={(event) => onBeginDrag(event, region, 'start')} />
      <span className="zoom-block-label" aria-hidden="true">Blur</span>
      <span className="cue-handle end" data-handle="end" aria-hidden="true" onPointerDown={(event) => onBeginDrag(event, region, 'end')} />
    </div>)}
  </div>
}
