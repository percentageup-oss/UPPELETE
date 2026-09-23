import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import type { ZoomRegion } from '../core/edit'
import type { ZoomDragMode } from '../core/zoomRegion'
import { timeToPixel } from '../core/timeline'
import { formatClock } from '../core/time'

/**
 * The zoom lane: one fixed row over the whole program (docs/EDITING.md "Zoom regions"), the same
 * draw/drag shape as `CaptionsTrack.tsx`'s LINE mode minus word mode and per-span clipping — a zoom
 * region is sequence-timed and belongs to no clip, so there is exactly one block per region, never
 * split by a cut. Labeled "Effects" (matching the left rail's Effects tab) rather than "Zoom" in
 * every user-visible string; the component, its props and the data model stay zoom-specific.
 */
export function ZoomLane({ regions, durationUs, selectedZoomId, draggingId, onBeginDrag, onKeyboardSelect, onSeekTrack }: {
  regions: readonly ZoomRegion[]
  durationUs: number
  selectedZoomId: string | null
  draggingId: string | null
  onBeginDrag: (event: ReactPointerEvent<HTMLElement>, region: ZoomRegion, mode: ZoomDragMode) => void
  onKeyboardSelect: (event: ReactKeyboardEvent<HTMLDivElement>, region: ZoomRegion) => void
  onSeekTrack: (event: ReactPointerEvent<HTMLDivElement>) => void
}) {
  const place = (region: ZoomRegion) => ({ left: `${timeToPixel(region.startUs, durationUs, 100)}%`, width: `${Math.max(.02, timeToPixel(region.endUs - region.startUs, durationUs, 100))}%` })
  return <div className="track zoom-lane" onPointerDown={onSeekTrack} role="group"
    aria-label="Effect regions. Tab to a region, then press Enter to select and seek to it.">
    {regions.map((region) => <div key={region.id} role="button" tabIndex={0}
      aria-label={`Effect region, ${formatClock(region.startUs)} to ${formatClock(region.endUs)}${region.enabled ? '' : ', bypassed'}`}
      aria-pressed={region.id === selectedZoomId}
      className={`zoom-block ${region.id === selectedZoomId ? 'active' : ''} ${draggingId === region.id ? 'dragging' : ''} ${region.enabled ? '' : 'disabled'}`}
      style={place(region)}
      onPointerDown={(event) => onBeginDrag(event, region, 'move')}
      onKeyDown={(event) => onKeyboardSelect(event, region)}
    >
      <span className="cue-handle start" data-handle="start" aria-hidden="true" onPointerDown={(event) => onBeginDrag(event, region, 'start')} />
      <span className="zoom-block-label" aria-hidden="true">{region.fromRect ? 'Pan' : 'Effects'}</span>
      <span className="cue-handle end" data-handle="end" aria-hidden="true" onPointerDown={(event) => onBeginDrag(event, region, 'end')} />
    </div>)}
  </div>
}
