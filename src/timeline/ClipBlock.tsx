import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import type { Clip } from '../core/edit'
import type { ClipDragMode } from '../core/clipDrag'

/** One clip on its track: body (drag to move, Alt+drag to clone), trim handles, label and selection. */
export function ClipBlock({ clip, label, title, leftPct, widthPct, selected, dragging, locked, onBeginDrag, onKeyDown, children }: {
  clip: Clip
  label: string
  title: string
  leftPct: number
  widthPct: number
  selected: boolean
  dragging: boolean
  locked: boolean
  onBeginDrag: (event: ReactPointerEvent<HTMLElement>, mode: ClipDragMode) => void
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void
  children?: ReactNode
}) {
  return <div role="button" tabIndex={0} aria-pressed={selected} aria-label={title} title={title} data-clip-id={clip.id}
    className={`clip-block ${clip.kind} ${selected ? 'active' : ''} ${dragging ? 'dragging' : ''} ${locked ? 'locked' : ''}`}
    style={{ left: `${leftPct}%`, width: `${Math.max(.02, widthPct)}%` }}
    onPointerDown={(event) => onBeginDrag(event, 'move')} onKeyDown={onKeyDown}>
    <div className="clip-content" aria-hidden="true">{children}</div>
    {!locked && <span className="cue-handle start" data-handle="start" aria-hidden="true" onPointerDown={(event) => onBeginDrag(event, 'start')} />}
    <span className="clip-label">{label}</span>
    {!locked && <span className="cue-handle end" data-handle="end" aria-hidden="true" onPointerDown={(event) => onBeginDrag(event, 'end')} />}
  </div>
}
