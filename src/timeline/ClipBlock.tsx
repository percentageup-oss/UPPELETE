import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import type { Clip } from '../core/edit'
import type { ClipDragMode } from '../core/clipDrag'
import { speedBadge } from '../core/clipTime'

/** One clip on its track: body (drag to move, Alt+drag to clone), trim handles, label and selection. */
export function ClipBlock({ clip, label, title, leftPct, widthPct, selected, dragging, locked, linked = false, linkedSelected = false, onBeginDrag, onKeyDown, children }: {
  clip: Clip
  label: string
  title: string
  leftPct: number
  widthPct: number
  selected: boolean
  dragging: boolean
  locked: boolean
  /** Has link partners (a video and its audio move, cut and trim together). */
  linked?: boolean
  /** A partner of the selected clip: highlighted so the group reads as one. */
  linkedSelected?: boolean
  onBeginDrag: (event: ReactPointerEvent<HTMLElement>, mode: ClipDragMode) => void
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void
  children?: ReactNode
}) {
  return <div role="button" tabIndex={0} aria-pressed={selected} aria-label={title} title={title} data-clip-id={clip.id} data-item-kind="clip" data-item-id={clip.id}
    className={`clip-block ${clip.kind} ${selected ? 'active' : ''} ${dragging ? 'dragging' : ''} ${locked ? 'locked' : ''} ${clip.enabled === false ? 'disabled' : ''} ${linked ? 'linked' : ''} ${linkedSelected ? 'linked-selected' : ''}`}
    style={{ left: `${leftPct}%`, width: `${Math.max(.02, widthPct)}%` }}
    onPointerDown={(event) => onBeginDrag(event, 'move')} onKeyDown={onKeyDown}>
    <div className="clip-content" aria-hidden="true">{children}</div>
    {!locked && <span className="cue-handle start" data-handle="start" aria-hidden="true" onPointerDown={(event) => onBeginDrag(event, 'start')} />}
    <span className="clip-label">{linked && <svg className="clip-link-icon" viewBox="0 0 12 12" width="10" height="10" aria-label="Linked" role="img"><path d="M5 7l2-2M4.2 8.3l-1 1a1.6 1.6 0 01-2.3-2.3l1.6-1.6a1.6 1.6 0 012.3 0M7.8 3.7l1-1a1.6 1.6 0 012.3 2.3L9.5 6.6a1.6 1.6 0 01-2.3 0" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>}{label}</span>
    {(clip.kind === 'video' || clip.kind === 'audio') && speedBadge(clip) && <span className="clip-speed-badge" aria-hidden="true">{speedBadge(clip)}</span>}
    {!locked && <span className="cue-handle end" data-handle="end" aria-hidden="true" onPointerDown={(event) => onBeginDrag(event, 'end')} />}
  </div>
}
