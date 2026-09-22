import { useMemo } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { rulerStep, timeToPixel } from '../core/timeline'
import { formatTimestamp } from '../core/time'
import type { Marker } from '../core/edit'

function formatRulerTime(timeUs: number): string {
  const timestamp = formatTimestamp(timeUs, '.')
  return timestamp.startsWith('00:') ? timestamp.slice(3) : timestamp
}

export function useRulerTicks(durationUs: number, zoom: number): number[] {
  const stepUs = rulerStep(durationUs, zoom)
  return useMemo(() => {
    const values: number[] = []
    for (let timeUs = 0; timeUs <= durationUs; timeUs += stepUs) values.push(timeUs)
    return values
  }, [durationUs, stepUs])
}

/** The sequence-time ruler: click or drag to move the playhead. Markers (docs/MCP.md) are
 * diamonds pinned to the ruler; a click seeks and selects instead of scrubbing. */
export function TimelineRuler({ ticks, durationUs, onPointerDown, onPointerMove, onPointerUp, markers = [], selectedMarkerId = null, onSelectMarker }: {
  ticks: readonly number[]; durationUs: number
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void
  markers?: readonly Marker[]
  selectedMarkerId?: string | null
  onSelectMarker?: (markerId: string, atUs: number) => void
}) {
  return <div className="ruler" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} aria-label="Time ruler. Click or drag to move the playhead.">
    {ticks.map((timeUs) => <span key={timeUs} style={{ left: `${timeToPixel(timeUs, durationUs, 100)}%` }}>{formatRulerTime(timeUs)}</span>)}
    {markers.map((marker) => (
      <button key={marker.id} type="button" className="ruler-marker" aria-label={marker.text ? `Marker: ${marker.text}` : 'Marker'}
        aria-pressed={marker.id === selectedMarkerId} title={marker.text || formatRulerTime(marker.atUs)}
        style={{ left: `${timeToPixel(marker.atUs, durationUs, 100)}%`, ...(marker.color ? { '--marker-color': marker.color } as CSSProperties : {}) }}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => { event.stopPropagation(); onSelectMarker?.(marker.id, marker.atUs) }} />
    ))}
  </div>
}
