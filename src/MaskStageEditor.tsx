import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { COMPOSITION_WIDTH, type CompositionRect, type LayerMask, type MaskPathPoint } from './core/edit'
import type { Size } from './core/composition'
import { activeMask, drawnMask, maskBounds } from './core/layerMask'
import { moveRect, resizeRect, roundRect, type RectHandle } from './core/overlayRect'
import { pathD } from './core/layerMask'
import { appendPoint, closesPath, hitTestPath, insertPointNear, MIN_PATH_POINTS, moveAnchor, moveHandle, pullHandles, removePoint, toggleSmooth } from './core/penPath'
import { useCompositionProjection } from './captions/CaptionPreview'
import { maskStyle } from './captions/maskStyle'

const HANDLES: RectHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const CURSORS: Record<RectHandle, string> = { nw: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', se: 'nwse-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' }
const penNibSvg = (extra: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><g transform="translate(2 2) rotate(-45) scale(1.1)"><path d="M0 0 7 15Q8 18 5 20V25H-5V20Q-8 18-7 15Z" fill="#000" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/><path d="M0 11V3" stroke="#fff" stroke-width="1.2"/><circle cx="0" cy="13" r="1.8" fill="#fff"/></g>${extra}</svg>`
/** Photoshop-style pen-tool cursors: a fountain-pen nib whose tip (the hotspot) is at the top-left. */
const PEN_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(penNibSvg(''))}") 2 2, crosshair`
const PEN_ADD_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(penNibSvg('<path d="M27 22v10M22 27h10" stroke="#fff" stroke-width="4"/><path d="M27 22v10M22 27h10" stroke="#000" stroke-width="1.8"/>'))}") 2 2, copy`
const PEN_REMOVE_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(penNibSvg('<path d="M22 27h10" stroke="#fff" stroke-width="4"/><path d="M22 27h10" stroke="#000" stroke-width="1.8"/>'))}") 2 2, pointer`
const PEN_CLOSE_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(penNibSvg('<circle cx="27" cy="27" r="4" fill="none" stroke="#fff" stroke-width="4"/><circle cx="27" cy="27" r="4" fill="none" stroke="#000" stroke-width="1.8"/>'))}") 2 2, pointer`
const CLICK_SLOP = 3 // screen px: a press that moves less than this is a click, not a drag
type Vec = { x: number; y: number }
type Drag =
  | { kind: 'move'; base: CompositionRect; x: number; y: number; pointerId: number }
  | { kind: 'resize'; base: CompositionRect; handle: RectHandle; x: number; y: number; pointerId: number }
  | { kind: 'anchor'; index: number; base: MaskPathPoint[]; x: number; y: number; pointerId: number }
  | { kind: 'handle'; index: number; part: 'in' | 'out'; base: MaskPathPoint[]; x: number; y: number; pointerId: number }
  | { kind: 'pull'; index: number; pointerId: number }
const HANDLE_AT = (rect: CompositionRect, handle: RectHandle): Vec => ({
  x: handle.includes('w') ? rect.x : handle.includes('e') ? rect.x + rect.width : rect.x + rect.width / 2,
  y: handle.includes('n') ? rect.y : handle.includes('s') ? rect.y + rect.height : rect.y + rect.height / 2,
})

/**
 * The stage gizmo for a layer mask (docs/EDITING.md "Layer masks"): the area outside the mask is
 * tinted red like Photoshop's quick mask, a rectangle/ellipse is moved and resized by its box, and a
 * pen path is drawn (click a corner, click-drag a smooth point, click the first point or Enter to
 * close) and then edited (drag anchors and handles, click an anchor or press Delete to remove it, Alt-click
 * to switch corner/smooth, double-click the outline to add a point). While drawing, the masked layer
 * previews live (the outline stays open until closed). One gesture is one `onCommit`, so it is one undo
 * step; `onDraft` streams the in-flight mask for live preview. Escape leaves (or cancels a drag).
 */
export function MaskStageEditor({ composition, mask, drawing, onDraft, onCommit, onCommitDrawn, onExit }: {
  composition: Size
  mask: LayerMask | null
  /** Pen drawing mode: the mask does not exist yet; points collect here until closed. */
  drawing: boolean
  onDraft: (mask: LayerMask | null) => void
  onCommit: (mask: LayerMask) => void
  onCommitDrawn: (points: MaskPathPoint[]) => void
  onExit: () => void
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const projection = useCompositionProjection(rootRef, composition)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [pending, setPending] = useState<MaskPathPoint[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [hover, setHover] = useState<Vec | null>(null)
  const latest = useRef({ mask, pending, drag, selected, drawing })
  latest.current = { mask, pending, drag, selected, drawing }
  const scale = projection?.scale ?? 1
  const unit = 1 / scale // one screen pixel in composition units
  const pointAt = (clientX: number, clientY: number): Vec => {
    const box = svgRef.current!.getBoundingClientRect()
    return { x: (clientX - box.left) / scale, y: (clientY - box.top) / scale }
  }
  const withShape = (shape: LayerMask['shape']): LayerMask => ({ ...mask!, shape })
  const points = mask?.shape.kind === 'path' ? mask.shape.points : null

  useEffect(() => { setPending([]); setSelected(null); setHover(null) }, [drawing])

  // Live preview: once there are enough points, the layer shows the mask that closing now would give.
  useEffect(() => {
    if (drawing) onDraft(pending.length >= MIN_PATH_POINTS ? drawnMask(pending) : null)
  }, [drawing, pending])
  useEffect(() => () => { if (latest.current.drawing) onDraft(null) }, [])

  useEffect(() => {
    if (!drag) return
    const shapeFor = (event: PointerEvent): { mask?: LayerMask; pending?: MaskPathPoint[] } => {
      const dx = (event.clientX - ('x' in drag ? drag.x : 0)) / scale, dy = (event.clientY - ('y' in drag ? drag.y : 0)) / scale
      const current = latest.current.mask
      if (drag.kind === 'move' && current && current.shape.kind !== 'path') return { mask: { ...current, shape: { ...current.shape, rect: moveRect(drag.base, dx, dy, composition) } } }
      if (drag.kind === 'resize' && current && current.shape.kind !== 'path') return { mask: { ...current, shape: { ...current.shape, rect: resizeRect(drag.base, drag.handle, dx, dy, { composition, keepAspect: false }) } } }
      if (drag.kind === 'anchor' && current) return { mask: { ...current, shape: { kind: 'path', points: moveAnchor(drag.base, drag.index, dx, dy) } } }
      if (drag.kind === 'handle' && current) {
        const start = drag.base[drag.index][drag.part]!
        return { mask: { ...current, shape: { kind: 'path', points: moveHandle(drag.base, drag.index, drag.part, { x: start.x + dx, y: start.y + dy }) } } }
      }
      if (drag.kind === 'pull') {
        const at = pointAt(event.clientX, event.clientY)
        return { pending: latest.current.pending.map((point, index) => index === drag.index ? pullHandles(point, at) : point) }
      }
      return {}
    }
    const round = (next: LayerMask): LayerMask => next.shape.kind === 'path' ? next
      : { ...next, shape: { ...next.shape, rect: roundRect(next.shape.rect) } }
    const move = (event: PointerEvent) => {
      if (event.pointerId !== drag.pointerId) return
      const next = shapeFor(event)
      if (next.pending) setPending(next.pending)
      else if (next.mask) onDraft(next.mask)
    }
    const end = (event: PointerEvent, commit: boolean) => {
      if (event.pointerId !== drag.pointerId) return
      setDrag(null)
      const next = shapeFor(event)
      if (next.pending) { if (commit) setPending(next.pending); return }
      const current = latest.current.mask
      if (drag.kind === 'anchor' && commit && current && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < CLICK_SLOP) {
        // A press on an anchor that never moved is a click: delete it (never below the minimum).
        onDraft(null)
        if (drag.base.length > MIN_PATH_POINTS) { onCommit({ ...current, shape: { kind: 'path', points: removePoint(drag.base, drag.index) } }); setSelected(null) }
        return
      }
      if (commit && next.mask) onCommit(round(next.mask))
      else onDraft(null)
    }
    const up = (event: PointerEvent) => end(event, true)
    const cancel = (event: PointerEvent) => end(event, false)
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancel)
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel) }
  }, [drag, scale, composition])

  // Keys are handled in the capture phase and stopped, so Backspace/Delete removes a pen point
  // rather than also deleting the selected timeline item.
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      const state = latest.current
      const consume = () => { event.preventDefault(); event.stopPropagation() }
      if (event.key === 'Escape') {
        consume()
        if (state.drag) { setDrag(null); onDraft(null) } else onExit()
      } else if (state.drawing && event.key === 'Enter') {
        consume()
        if (state.pending.length >= MIN_PATH_POINTS) onCommitDrawn(state.pending)
      } else if (state.drawing && (event.key === 'Backspace' || event.key === 'Delete')) {
        consume(); setPending((list) => list.slice(0, -1))
      } else if (!state.drawing && state.mask?.shape.kind === 'path' && state.selected !== null && (event.key === 'Backspace' || event.key === 'Delete')) {
        consume()
        onCommit({ ...state.mask, shape: { kind: 'path', points: removePoint(state.mask.shape.points, state.selected) } }); setSelected(null)
      }
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [onDraft, onCommit, onCommitDrawn, onExit])

  if (!projection) return <div ref={rootRef} className="overlay-stage" aria-hidden="true" />
  const frame: CSSProperties = { left: projection.x, top: projection.y, width: composition.width * scale, height: composition.height * scale }
  const handleSize = 10 * unit
  const beginDrag = (event: ReactPointerEvent<Element>, next: Drag) => {
    if (event.button !== 0) return
    event.preventDefault(); event.stopPropagation(); (event.currentTarget as Element).setPointerCapture?.(event.pointerId)
    setDrag(next)
  }
  const active = activeMask(mask)
  const tint = mask && !drawing
    ? maskStyle({ ...mask, enabled: true, invert: !mask.invert, density: 1 }, composition, null) : null

  const onDrawDown = (event: ReactPointerEvent<SVGRectElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    const at = pointAt(event.clientX, event.clientY)
    if (closesPath(pending, at, 9 * unit)) { event.stopPropagation(); onCommitDrawn(pending); return }
    const hit = hitTestPath(pending, at, 6 * unit)
    if (hit && hit.part === 'anchor') { event.stopPropagation(); setPending(pending.filter((_, index) => index !== hit.index)); return }
    const next = appendPoint(pending, at)
    setPending(next)
    beginDrag(event, { kind: 'pull', index: next.length - 1, pointerId: event.pointerId })
  }

  const closable = drawing && hover !== null && closesPath(pending, hover, 9 * unit)
  const last = pending[pending.length - 1]
  const rubber = drawing && hover && last && drag?.kind !== 'pull'
    ? `M${last.x} ${last.y} C${(last.out ?? last).x} ${(last.out ?? last).y} ${hover.x} ${hover.y} ${hover.x} ${hover.y}` : null
  const canRemove = (points?.length ?? 0) > MIN_PATH_POINTS
  const hint = drawing
    ? closable ? 'Click to close the mask'
      : pending.length < MIN_PATH_POINTS ? 'Click to add points · drag for a curve · click a point to remove it · Esc to cancel'
      : 'Click the first point or press Enter to close · Backspace removes the last point'
    : points && !drag ? 'Drag to move · click a point to delete · double-click the outline to add · Alt-click for corner/smooth' : null

  return <div ref={rootRef} className="overlay-stage mask-stage-editor">
    {tint && <div className="mask-tint" style={{ position: 'absolute', left: projection.x, top: projection.y, width: composition.width, height: composition.height, transform: `scale(${scale})`, transformOrigin: 'top left', pointerEvents: 'none', ...tint }} />}
    <svg ref={svgRef} className="mask-svg" style={frame} viewBox={`0 0 ${composition.width} ${composition.height}`} role="group" aria-label={drawing ? 'Draw pen mask' : 'Edit mask'}>
      {drawing && <>
        <rect x={0} y={0} width={composition.width} height={composition.height} fill="transparent" style={{ cursor: closable ? PEN_CLOSE_CURSOR : PEN_CURSOR }} onPointerDown={onDrawDown}
          onPointerMove={(event) => setHover(pointAt(event.clientX, event.clientY))} onPointerLeave={() => setHover(null)} />
        {pending.length > 1 && <path d={pathD(pending, false)} className="mask-outline" fill="none" strokeWidth={1.5 * unit} pointerEvents="none" />}
        {rubber && <path d={rubber} className="mask-outline preview" fill="none" strokeWidth={1.5 * unit} strokeDasharray={`${4 * unit} ${3 * unit}`} pointerEvents="none" />}
        {pending.map((point, index) => <g key={index}>
          {point.out && <><line x1={point.x} y1={point.y} x2={point.out.x} y2={point.out.y} className="mask-handle-line" strokeWidth={unit} />
            <line x1={point.x} y1={point.y} x2={point.in!.x} y2={point.in!.y} className="mask-handle-line" strokeWidth={unit} /></>}
          <rect x={point.x - handleSize / 2} y={point.y - handleSize / 2} width={handleSize} height={handleSize} className={index === 0 && pending.length >= MIN_PATH_POINTS ? closable ? 'mask-anchor first closing' : 'mask-anchor first' : 'mask-anchor'} strokeWidth={1.5 * unit} pointerEvents="none" />
        </g>)}
      </>}
      {!drawing && mask && mask.shape.kind !== 'path' && (() => {
        const rect = mask.shape.rect
        return <>
          {mask.shape.kind === 'ellipse'
            ? <ellipse cx={rect.x + rect.width / 2} cy={rect.y + rect.height / 2} rx={rect.width / 2} ry={rect.height / 2} className="mask-outline" fill="transparent" strokeWidth={1.5 * unit} style={{ cursor: 'move' }}
              role="button" aria-label="Move mask" onPointerDown={(event) => beginDrag(event, { kind: 'move', base: rect, x: event.clientX, y: event.clientY, pointerId: event.pointerId })} />
            : <rect x={rect.x} y={rect.y} width={rect.width} height={rect.height} className="mask-outline" fill="transparent" strokeWidth={1.5 * unit} style={{ cursor: 'move' }}
              role="button" aria-label="Move mask" onPointerDown={(event) => beginDrag(event, { kind: 'move', base: rect, x: event.clientX, y: event.clientY, pointerId: event.pointerId })} />}
          {mask.shape.kind === 'ellipse' && <rect x={rect.x} y={rect.y} width={rect.width} height={rect.height} fill="none" className="mask-box" strokeWidth={unit} pointerEvents="none" />}
          {HANDLES.map((handle) => { const at = HANDLE_AT(rect, handle)
            return <rect key={handle} x={at.x - handleSize / 2} y={at.y - handleSize / 2} width={handleSize} height={handleSize} className="mask-anchor" strokeWidth={1.5 * unit}
              style={{ cursor: CURSORS[handle] }} data-handle={handle} onPointerDown={(event) => beginDrag(event, { kind: 'resize', base: rect, handle, x: event.clientX, y: event.clientY, pointerId: event.pointerId })} /> })}
        </>
      })()}
      {!drawing && points && <>
        <path d={pathD(points)} className="mask-outline" fill="transparent" strokeWidth={1.5 * unit} style={{ cursor: PEN_ADD_CURSOR }}
          onDoubleClick={(event) => {
            const inserted = insertPointNear(points, pointAt(event.clientX, event.clientY), 8 * unit)
            if (inserted) { event.stopPropagation(); onCommit(withShape({ kind: 'path', points: inserted.points })); setSelected(inserted.index) }
          }} />
        {points.map((point, index) => <g key={index}>
          {(point.in || point.out) && <>
            {point.in && <line x1={point.x} y1={point.y} x2={point.in.x} y2={point.in.y} className="mask-handle-line" strokeWidth={unit} />}
            {point.out && <line x1={point.x} y1={point.y} x2={point.out.x} y2={point.out.y} className="mask-handle-line" strokeWidth={unit} />}
            {(['in', 'out'] as const).map((part) => point[part] && <circle key={part} cx={point[part]!.x} cy={point[part]!.y} r={handleSize * .45} className="mask-handle" strokeWidth={1.5 * unit} style={{ cursor: 'pointer' }}
              onPointerDown={(event) => beginDrag(event, { kind: 'handle', index, part, base: points, x: event.clientX, y: event.clientY, pointerId: event.pointerId })} />)}
          </>}
          <rect x={point.x - handleSize / 2} y={point.y - handleSize / 2} width={handleSize} height={handleSize} className={selected === index ? 'mask-anchor selected' : 'mask-anchor'} strokeWidth={1.5 * unit} style={{ cursor: canRemove ? PEN_REMOVE_CURSOR : 'move' }}
            onPointerDown={(event) => {
              if (event.altKey) { event.preventDefault(); event.stopPropagation(); onCommit(withShape({ kind: 'path', points: toggleSmooth(points, index) })); return }
              setSelected(index)
              beginDrag(event, { kind: 'anchor', index, base: points, x: event.clientX, y: event.clientY, pointerId: event.pointerId })
            }} />
        </g>)}
      </>}
    </svg>
    {drag && drag.kind !== 'pull' && mask && <span className="overlay-readout" style={{ left: projection.x + 8, top: projection.y + 8 }}>
      Mask · {Math.round(maskBounds(mask.shape).width)}×{Math.round(maskBounds(mask.shape).height)}</span>}
    {hint && <span className="overlay-readout mask-hint" style={{ left: projection.x + 8, top: projection.y + composition.height * scale - 26 }}>{hint}</span>}
    {active === null && mask && !drawing && <span className="overlay-readout" style={{ left: projection.x + 8, top: projection.y + 8 }}>Mask is turned off</span>}
  </div>
}
