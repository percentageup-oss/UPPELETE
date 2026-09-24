import { useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import type { TextOverlay } from '../core/edit'
import { packTextOverlays } from '../core/textLayout'
import { timeToPixel } from '../core/timeline'
import { formatClock } from '../core/time'

type Gesture = { id: string; mode: 'move' | 'start' | 'end'; x: number; width: number; delta: number; pointerId: number }
export function TextLane({ items, durationUs, selectedId, onSelect, onSeekTrack, onMove, onTrim }: {
  items: readonly TextOverlay[]; durationUs: number; selectedId: string | null
  onSelect: (id: string) => void; onSeekTrack: (event: ReactPointerEvent<HTMLDivElement>) => void
  onMove: (id: string, startUs: number) => void; onTrim: (id: string, edge: 'start' | 'end', deltaUs: number) => void
}) {
  const { rows } = packTextOverlays(items)
  const [gesture, setGesture] = useState<Gesture | null>(null)
  const shown = (item: TextOverlay) => {
    if (gesture?.id !== item.id || !gesture.delta) return item
    const deltaUs = Math.round(gesture.delta / gesture.width * durationUs)
    return gesture.mode === 'move' ? { ...item, startUs: Math.max(0, item.startUs + deltaUs), endUs: Math.max(1, item.endUs + deltaUs) }
      : gesture.mode === 'start' ? { ...item, startUs: Math.max(0, Math.min(item.endUs - 1, item.startUs + deltaUs)) }
        : { ...item, endUs: Math.max(item.startUs + 1, item.endUs + deltaUs) }
  }
  const begin = (event: ReactPointerEvent<HTMLDivElement>, item: TextOverlay) => {
    if (event.button !== 0) return
    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); onSelect(item.id)
    const mode = (event.target as HTMLElement).closest('[data-handle]')?.getAttribute('data-handle') === 'start' ? 'start'
      : (event.target as HTMLElement).closest('[data-handle]')?.getAttribute('data-handle') === 'end' ? 'end' : 'move'
    const box = event.currentTarget.parentElement!.getBoundingClientRect()
    setGesture({ id: item.id, mode, x: event.clientX, width: box.width, delta: 0, pointerId: event.pointerId })
  }
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!gesture || event.pointerId !== gesture.pointerId) return
    setGesture({ ...gesture, delta: event.clientX - gesture.x })
  }
  const finish = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!gesture || event.pointerId !== gesture.pointerId) return
    const deltaUs = Math.round((event.clientX - gesture.x) / gesture.width * durationUs)
    if (gesture.mode === 'move') onMove(gesture.id, Math.max(0, items.find((item) => item.id === gesture.id)!.startUs + deltaUs))
    else onTrim(gesture.id, gesture.mode, deltaUs)
    setGesture(null)
  }
  const place = (item: TextOverlay) => ({ left: `${timeToPixel(item.startUs, durationUs, 100)}%`, width: `${Math.max(.04, timeToPixel(item.endUs - item.startUs, durationUs, 100))}%` })
  return <div className="track text-lane" onPointerDown={onSeekTrack} role="group" aria-label="Text layers timeline">
    {rows.map((row, rowIndex) => row.map((source) => { const item = shown(source)
      return <div key={item.id} data-item-kind="text" data-item-id={item.id} role="button" tabIndex={0} aria-pressed={item.id === selectedId}
        aria-label={`Text ${item.text}, ${formatClock(source.startUs)} to ${formatClock(source.endUs)}`}
        className={`text-block ${item.id === selectedId ? 'active' : ''} ${gesture?.id === item.id ? 'dragging' : ''}`}
        style={{ ...place(item), top: 2 + rowIndex * 18, zIndex: item.layerOrder + 10001 }}
        onPointerDown={(event) => begin(event, source)} onPointerMove={move} onPointerUp={finish} onPointerCancel={() => setGesture(null)}
        onKeyDown={(event: ReactKeyboardEvent<HTMLDivElement>) => { if (event.key === 'Enter') { event.preventDefault(); onSelect(source.id) } }}>
        <span className="cue-handle start" data-handle="start" aria-hidden="true" />
        <span className="text-block-label">{source.text}</span>
        <span className="cue-handle end" data-handle="end" aria-hidden="true" />
      </div>
    }))}
  </div>
}
