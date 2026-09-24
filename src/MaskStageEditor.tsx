import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { COMPOSITION_WIDTH, type CompositionRect, type LayerMask, type MaskPathPoint } from './core/edit'
import type { Size } from './core/composition'
import { activeMask, maskBounds } from './core/layerMask'
import { moveRect, resizeRect, roundRect, type RectHandle } from './core/overlayRect'
import { pathD } from './core/layerMask'
import { appendPoint, closesPath, hitTestPath, insertPointNear, MIN_PATH_POINTS, moveAnchor, moveHandle, pullHandles, removePoint, toggleSmooth } from './core/penPath'
import { useCompositionProjection } from './captions/CaptionPreview'
import { maskStyle } from './captions/maskStyle'

const HANDLES: RectHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const CURSORS: Record<RectHandle, string> = { nw: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', se: 'nwse-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' }
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
 * close) and then edited (drag anchors and handles, Alt-click to switch corner/smooth, double-click
 * the outline to add a point, Delete to remove one). One gesture is one `onCommit`, so it is one undo
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

  useEffect(() => { setPending([]); setSelected(null) }, [drawing])

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
    if (closesPath(pending, at, 9 * unit)) { onCommitDrawn(pending); return }
    const next = appendPoint(pending, at)
    setPending(next)
    beginDrag(event, { kind: 'pull', index: next.length - 1, pointerId: event.pointerId })
  }

  const renderPath = (list: readonly MaskPathPoint[], closed: boolean) => {
    const d = pathD(list)
    return closed ? d : d.replace(/ Z$/, '')
  }

  return <div ref={rootRef} className="overlay-stage mask-stage-editor">
    {tint && <div className="mask-tint" style={{ position: 'absolute', left: projection.x, top: projection.y, width: composition.width, height: composition.height, transform: `scale(${scale})`, transformOrigin: 'top left', pointerEvents: 'none', ...tint }} />}
    <svg ref={svgRef} className="mask-svg" style={frame} viewBox={`0 0 ${composition.width} ${composition.height}`} role="group" aria-label={drawing ? 'Draw pen mask' : 'Edit mask'}>
      {drawing && <>
        <rect x={0} y={0} width={composition.width} height={composition.height} fill="transparent" style={{ cursor: 'crosshair' }} onPointerDown={onDrawDown} />
        {pending.length > 1 && <path d={renderPath(pending, false)} className="mask-outline" fill="none" strokeWidth={1.5 * unit} />}
        {pending.map((point, index) => <g key={index}>
          {point.out && <><line x1={point.x} y1={point.y} x2={point.out.x} y2={point.out.y} className="mask-handle-line" strokeWidth={unit} />
            <line x1={point.x} y1={point.y} x2={point.in!.x} y2={point.in!.y} className="mask-handle-line" strokeWidth={unit} /></>}
          <rect x={point.x - handleSize / 2} y={point.y - handleSize / 2} width={handleSize} height={handleSize} className={index === 0 && pending.length >= MIN_PATH_POINTS ? 'mask-anchor first' : 'mask-anchor'} strokeWidth={1.5 * unit} pointerEvents="none" />
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
        <path d={pathD(points)} className="mask-outline" fill="transparent" strokeWidth={1.5 * unit} style={{ cursor: 'copy' }}
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
          <rect x={point.x - handleSize / 2} y={point.y - handleSize / 2} width={handleSize} height={handleSize} className={selected === index ? 'mask-anchor selected' : 'mask-anchor'} strokeWidth={1.5 * unit} style={{ cursor: 'move' }}
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
    {active === null && mask && !drawing && <span className="overlay-readout" style={{ left: projection.x + 8, top: projection.y + 8 }}>Mask is turned off</span>}
  </div>
}
