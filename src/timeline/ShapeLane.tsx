import { useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import type { Shape } from '../core/edit'
import { packTextOverlays } from '../core/textLayout'
import { timeToPixel } from '../core/timeline'
import { formatClock } from '../core/time'
import { groupHue } from '../core/groupCommands'
import type { CSSProperties } from 'react'

type Gesture = { id: string; mode: 'move' | 'start' | 'end'; x: number; width: number; delta: number; pointerId: number }
const label = (item: Shape) => item.name?.trim() || item.geometry.kind

/** The Graphics lane (schema 17): the same move/trim gestures as `TextLane`, for vector shapes. */
export function ShapeLane({ items, durationUs, selectedId, selectedGroupId = null, pendingIds = [], groupNames, onSelect, onSeekTrack, onMove, onTrim }: {
  items: readonly Shape[]; durationUs: number; selectedId: string | null
  /** The selected group (schema 22): every member lights up. */
  selectedGroupId?: string | null
  /** Items picked with Ctrl/Shift-click, waiting for Ctrl+G. */
  pendingIds?: readonly string[]
  groupNames?: ReadonlyMap<string, string>
  onSelect: (id: string) => void; onSeekTrack: (event: ReactPointerEvent<HTMLDivElement>) => void
  onMove: (id: string, startUs: number) => void; onTrim: (id: string, edge: 'start' | 'end', deltaUs: number) => void
}) {
  const { rows } = packTextOverlays(items)
  const [gesture, setGesture] = useState<Gesture | null>(null)
  const shown = (item: Shape) => {
    if (gesture?.id !== item.id || !gesture.delta) return item
    const deltaUs = Math.round(gesture.delta / gesture.width * durationUs)
    return gesture.mode === 'move' ? { ...item, startUs: Math.max(0, item.startUs + deltaUs), endUs: Math.max(1, item.endUs + deltaUs) }
      : gesture.mode === 'start' ? { ...item, startUs: Math.max(0, Math.min(item.endUs - 1, item.startUs + deltaUs)) }
        : { ...item, endUs: Math.max(item.startUs + 1, item.endUs + deltaUs) }
  }
  const begin = (event: ReactPointerEvent<HTMLDivElement>, item: Shape) => {
    if (event.button !== 0) return
    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); onSelect(item.id)
    const handle = (event.target as HTMLElement).closest('[data-handle]')?.getAttribute('data-handle')
    const mode = handle === 'start' ? 'start' : handle === 'end' ? 'end' : 'move'
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
  const place = (item: Shape) => ({ left: `${timeToPixel(item.startUs, durationUs, 100)}%`, width: `${Math.max(.04, timeToPixel(item.endUs - item.startUs, durationUs, 100))}%` })
  return <div className="track text-lane shape-lane" onPointerDown={onSeekTrack} role="group" aria-label="Graphics timeline">
    {rows.map((row, rowIndex) => row.map((source) => { const item = shown(source)
      const groupActive = item.groupId !== undefined && item.groupId === selectedGroupId
      return <div key={item.id} data-item-kind="shape" data-item-id={item.id} role="button" tabIndex={0} aria-pressed={item.id === selectedId || groupActive}
        aria-label={`Shape ${label(source)}, ${formatClock(source.startUs)} to ${formatClock(source.endUs)}`}
        className={`text-block shape-block ${item.id === selectedId || groupActive ? 'active' : ''} ${item.groupId ? 'grouped' : ''} ${groupActive ? 'group-active' : ''} ${pendingIds.includes(item.id) ? 'pending' : ''} ${gesture?.id === item.id ? 'dragging' : ''}`}
        style={{ ...place(item), ...(item.groupId ? { '--group-hue': groupHue(item.groupId) } as CSSProperties : {}), top: 2 + rowIndex * 18 }}
        onPointerDown={(event) => begin(event, source)} onPointerMove={move} onPointerUp={finish} onPointerCancel={() => setGesture(null)}
        onKeyDown={(event: ReactKeyboardEvent<HTMLDivElement>) => { if (event.key === 'Enter') { event.preventDefault(); onSelect(source.id) } }}>
        <span className="cue-handle start" data-handle="start" aria-hidden="true" />
        {item.groupId && <span className="group-chip" title={`Group: ${groupNames?.get(item.groupId) || 'Group'}`} aria-hidden="true">⧉</span>}
        <span className="text-block-label">{label(source)}</span>
        <span className="cue-handle end" data-handle="end" aria-hidden="true" />
      </div>
    }))}
  </div>
}
