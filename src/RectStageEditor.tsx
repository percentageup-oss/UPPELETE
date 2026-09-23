import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import type { CompositionRect } from './core/edit'
import type { Size } from './core/composition'
import { moveRect, nudgeRect, resizeRect, roundRect, type RectHandle } from './core/overlayRect'
import { useCompositionProjection } from './captions/CaptionPreview'

const HANDLES: RectHandle[] = ['nw', 'ne', 'sw', 'se']
const CURSORS: Record<RectHandle, string> = { nw: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', se: 'nwse-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' }
type Drag = { kind: 'move'; base: CompositionRect; pointerId: number; x: number; y: number } | { kind: 'resize'; base: CompositionRect; handle: RectHandle; pointerId: number; x: number; y: number }

/**
 * The stage rect gizmo every region-with-a-target-rect effect shares (docs/EDITING.md "Zoom
 * regions"): move by dragging the box, resize from a corner, nudge with arrow keys, Escape cancels
 * a drag in progress. It deliberately has no keyframes — one gesture edits the one target rect and
 * commits as one history entry. Originally `ZoomStageEditor`; generalized (still one rect, one
 * region) when blur got its own stage editor with the same gesture but no aspect lock.
 */
export function RectStageEditor<T extends { id: string; rect: CompositionRect }>({ region, composition, selected, keepAspect, label, hitClassName, onSelect, onDraft, onCommit }: {
  region: T | null
  composition: Size
  selected: boolean
  /** Zoom keeps the composition's aspect ratio (it becomes an FFmpeg crop window); blur does not. */
  keepAspect: boolean
  /** Accessible name and live readout prefix, e.g. "Zoom target" or "Blur area". */
  label: string
  /** CSS modifier class for this effect's accent color, e.g. `zoom-hit` or `blur-hit`. */
  hitClassName: string
  onSelect: (id: string) => void
  onDraft: (rect: CompositionRect | null) => void
  onCommit: (rect: CompositionRect) => void
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const projection = useCompositionProjection(rootRef, composition)
  const [drag, setDrag] = useState<Drag | null>(null)
  const draftRef = useRef(onDraft); draftRef.current = onDraft
  const commitRef = useRef(onCommit); commitRef.current = onCommit

  useEffect(() => {
    if (!drag || !region) return
    const rectAt = (event: PointerEvent) => {
      const scale = projection?.scale ?? 1
      const dx = (event.clientX - drag.x) / scale
      const dy = (event.clientY - drag.y) / scale
      return drag.kind === 'move' ? moveRect(drag.base, dx, dy, composition)
        : resizeRect(drag.base, drag.handle, dx, dy, { composition, keepAspect })
    }
    const move = (event: PointerEvent) => { if (event.pointerId === drag.pointerId) draftRef.current(rectAt(event)) }
    const end = (event: PointerEvent, commit: boolean) => {
      if (event.pointerId !== drag.pointerId) return
      setDrag(null)
      if (commit) commitRef.current(roundRect(rectAt(event)))
      else draftRef.current(null)
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setDrag(null); draftRef.current(null) } }
    const up = (event: PointerEvent) => end(event, true)
    const cancel = (event: PointerEvent) => end(event, false)
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancel); window.addEventListener('keydown', escape)
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel); window.removeEventListener('keydown', escape) }
  }, [drag, projection, composition, keepAspect])

  const begin = (event: ReactPointerEvent<HTMLElement>, kind: Drag['kind'], handle?: RectHandle) => {
    if (event.button !== 0 || !region) return
    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId)
    onSelect(region.id)
    setDrag(kind === 'move' ? { kind, base: region.rect, pointerId: event.pointerId, x: event.clientX, y: event.clientY }
      : { kind, handle: handle!, base: region.rect, pointerId: event.pointerId, x: event.clientX, y: event.clientY })
  }
  const nudge = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (!region) return
    const step = event.shiftKey ? 10 : 1
    const delta = event.key === 'ArrowLeft' ? [-step, 0] : event.key === 'ArrowRight' ? [step, 0] : event.key === 'ArrowUp' ? [0, -step] : event.key === 'ArrowDown' ? [0, step] : null
    if (!delta) return
    event.preventDefault(); event.stopPropagation(); onCommit(nudgeRect(region.rect, delta[0], delta[1], composition))
  }
  if (!projection || !region) return <div ref={rootRef} className="overlay-stage" aria-hidden="true" />
  const { rect } = region
  const box = { left: projection.x + rect.x * projection.scale, top: projection.y + rect.y * projection.scale, width: rect.width * projection.scale, height: rect.height * projection.scale }
  return <div ref={rootRef} className="overlay-stage rect-stage-editor">
    <div className={`overlay-hit ${hitClassName} ${selected ? 'selected' : ''} ${drag ? 'dragging' : ''}`} style={box} role="button" tabIndex={selected ? 0 : -1}
      aria-label={`${label} framing`} onPointerDown={(event) => begin(event, 'move')} onKeyDown={nudge}>
      {selected && HANDLES.map((handle) => <span key={handle} className="overlay-handle" data-handle={handle} style={{ cursor: CURSORS[handle] }} onPointerDown={(event) => begin(event, 'resize', handle)} />)}
      {drag && <span className="overlay-readout">{label} · {Math.round(rect.x)}, {Math.round(rect.y)} · {Math.round(rect.width)}×{Math.round(rect.height)}</span>}
    </div>
  </div>
}
