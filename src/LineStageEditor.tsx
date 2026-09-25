import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { ShapeGeometry } from './core/edit'
import type { Size } from './core/composition'
import { useCompositionProjection } from './captions/CaptionPreview'

type Line = Extract<ShapeGeometry, { kind: 'line' }>
type Point = { x: number; y: number }
type Part = 'from' | 'to' | 'control' | 'move'
type Drag = { part: Part; base: Line; pointerId: number; x: number; y: number }

const round = (point: Point): Point => ({ x: Math.round(point.x), y: Math.round(point.y) })
/** Snaps `point` to the nearest 15° direction around `anchor`, keeping its distance. */
function snapAngle(point: Point, anchor: Point): Point {
  const dx = point.x - anchor.x, dy = point.y - anchor.y
  const step = Math.PI / 12, angle = Math.round(Math.atan2(dy, dx) / step) * step, length = Math.hypot(dx, dy)
  return { x: anchor.x + Math.cos(angle) * length, y: anchor.y + Math.sin(angle) * length }
}

/** Where dragging `part` by (`dx`,`dy`) composition units puts the line. Pure so it can be tested. */
export function dragLine(base: Line, part: Part, dx: number, dy: number, snap: boolean): Line {
  const shift = (point: Point): Point => ({ x: point.x + dx, y: point.y + dy })
  if (part === 'move') return { ...base, from: round(shift(base.from)), to: round(shift(base.to)), ...(base.control ? { control: round(shift(base.control)) } : {}) }
  if (part === 'control') return { ...base, control: round(shift(base.control ?? midpoint(base))) }
  const anchor = part === 'from' ? base.to : base.from
  const moved = shift(base[part])
  return { ...base, [part]: round(snap ? snapAngle(moved, anchor) : moved) }
}
const midpoint = (line: Line): Point => ({ x: (line.from.x + line.to.x) / 2, y: (line.from.y + line.to.y) / 2 })

/**
 * The stage gizmo for a line or arrow: a handle on each end, one on the curve control (when the line
 * is curved) and a move handle mid-line. Like `RectStageEditor` it edits one geometry per gesture,
 * drafting outside history and committing one undoable update on release; Escape cancels, Shift snaps
 * an end to 15° steps.
 */
export function LineStageEditor({ line, composition, onDraft, onCommit }: {
  line: Line | null
  composition: Size
  onDraft: (line: Line | null) => void
  onCommit: (line: Line) => void
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const projection = useCompositionProjection(rootRef, composition)
  const [drag, setDrag] = useState<Drag | null>(null)
  const draftRef = useRef(onDraft); draftRef.current = onDraft
  const commitRef = useRef(onCommit); commitRef.current = onCommit

  useEffect(() => {
    if (!drag) return
    const scale = projection?.scale ?? 1
    const lineAt = (event: PointerEvent) => dragLine(drag.base, drag.part, (event.clientX - drag.x) / scale, (event.clientY - drag.y) / scale, event.shiftKey)
    const move = (event: PointerEvent) => { if (event.pointerId === drag.pointerId) draftRef.current(lineAt(event)) }
    const end = (event: PointerEvent, commit: boolean) => {
      if (event.pointerId !== drag.pointerId) return
      setDrag(null)
      if (commit) commitRef.current(lineAt(event)); else draftRef.current(null)
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setDrag(null); draftRef.current(null) } }
    const up = (event: PointerEvent) => end(event, true)
    const cancel = (event: PointerEvent) => end(event, false)
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancel); window.addEventListener('keydown', escape)
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel); window.removeEventListener('keydown', escape) }
  }, [drag, projection])

  const begin = (event: ReactPointerEvent<HTMLElement>, part: Part) => {
    if (event.button !== 0 || !line) return
    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId)
    setDrag({ part, base: line, pointerId: event.pointerId, x: event.clientX, y: event.clientY })
  }
  if (!projection || !line) return <div ref={rootRef} className="overlay-stage" aria-hidden="true" />
  const at = (point: Point) => ({ left: projection.x + point.x * projection.scale, top: projection.y + point.y * projection.scale })
  const handle = (part: Part, point: Point, label: string, className = '') => <span key={part} role="button" tabIndex={0} aria-label={label}
    className={`overlay-handle line-handle ${className}`} data-handle={part} style={at(point)} onPointerDown={(event) => begin(event, part)} />
  return <div ref={rootRef} className={`overlay-stage line-stage-editor ${drag ? 'dragging' : ''}`}>
    {handle('from', line.from, 'Line start')}
    {handle('to', line.to, 'Line end')}
    {line.control && handle('control', line.control, 'Curve bend', 'control')}
    {handle('move', line.control ? { x: (line.from.x + 2 * line.control.x + line.to.x) / 4, y: (line.from.y + 2 * line.control.y + line.to.y) / 4 } : midpoint(line), 'Move line', 'move')}
    {drag && <span className="overlay-readout" style={at(line.to)}>{Math.round(line.from.x)}, {Math.round(line.from.y)} → {Math.round(line.to.x)}, {Math.round(line.to.y)}</span>}
  </div>
}
