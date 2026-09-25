import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { BubbleTail, ShapeGeometry } from './core/edit'
import type { Size } from './core/composition'
import { bubbleTailTip } from './core/shapePath'
import { useCompositionProjection } from './captions/CaptionPreview'

type Bubble = Extract<ShapeGeometry, { kind: 'bubble' }>

/** Which side, how far along it and how far out a point (in the bubble's unrotated space) puts the tail. */
export function tailAtPoint(geometry: Bubble, point: { x: number; y: number }): BubbleTail {
  const { rect, tail } = geometry
  const cx = rect.x + rect.width / 2, cy = rect.y + rect.height / 2
  const nx = (point.x - cx) / Math.max(1, rect.width / 2), ny = (point.y - cy) / Math.max(1, rect.height / 2)
  const side: BubbleTail['side'] = Math.abs(nx) > Math.abs(ny) ? (nx < 0 ? 'left' : 'right') : (ny < 0 ? 'top' : 'bottom')
  const horizontal = side === 'top' || side === 'bottom'
  const along = horizontal ? point.x - rect.x : point.y - rect.y
  const span = horizontal ? rect.width : rect.height
  const room = Math.max(1, span - tail.width)
  const offset = Math.max(0, Math.min(1, (along - tail.width / 2) / room))
  const out = side === 'top' ? rect.y - point.y : side === 'bottom' ? point.y - (rect.y + rect.height) : side === 'left' ? rect.x - point.x : point.x - (rect.x + rect.width)
  return { ...tail, side, offset: Number(offset.toFixed(3)), length: Math.round(Math.max(4, Math.min(2000, out))) }
}

const rotateAbout = (point: { x: number; y: number }, cx: number, cy: number, degrees: number) => {
  const radians = degrees * Math.PI / 180, cos = Math.cos(radians), sin = Math.sin(radians)
  return { x: cx + (point.x - cx) * cos - (point.y - cy) * sin, y: cy + (point.x - cx) * sin + (point.y - cy) * cos }
}

/** The stage handle on a bubble's tail tip: drag it to move the tail to another side or position and to change its length. */
export function BubbleTailHandle({ geometry, composition, onDraft, onCommit }: {
  geometry: Bubble; composition: Size
  onDraft: (geometry: Bubble | null) => void
  onCommit: (geometry: Bubble) => void
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const projection = useCompositionProjection(rootRef, composition)
  const [drag, setDrag] = useState<{ pointerId: number } | null>(null)
  const draftRef = useRef(onDraft); draftRef.current = onDraft
  const commitRef = useRef(onCommit); commitRef.current = onCommit
  const geometryRef = useRef(geometry); geometryRef.current = geometry
  const cx = geometry.rect.x + geometry.rect.width / 2, cy = geometry.rect.y + geometry.rect.height / 2

  useEffect(() => {
    if (!drag || !projection) return
    const next = (event: PointerEvent): Bubble => {
      const root = rootRef.current!.getBoundingClientRect()
      const world = { x: (event.clientX - root.left - projection.x) / projection.scale, y: (event.clientY - root.top - projection.y) / projection.scale }
      const base = geometryRef.current
      return { ...base, tail: tailAtPoint(base, rotateAbout(world, cx, cy, -base.rotation)) }
    }
    const move = (event: PointerEvent) => { if (event.pointerId === drag.pointerId) draftRef.current(next(event)) }
    const up = (event: PointerEvent) => { if (event.pointerId === drag.pointerId) { setDrag(null); commitRef.current(next(event)) } }
    const cancel = (event: PointerEvent) => { if (event.pointerId === drag.pointerId) { setDrag(null); draftRef.current(null) } }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setDrag(null); draftRef.current(null) } }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancel); window.addEventListener('keydown', escape)
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel); window.removeEventListener('keydown', escape) }
  }, [drag, projection, cx, cy])

  const tip = bubbleTailTip(geometry)
  if (!projection || !tip) return <div ref={rootRef} className="overlay-stage" aria-hidden="true" />
  const shown = rotateAbout(tip, cx, cy, geometry.rotation)
  const begin = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId)
    setDrag({ pointerId: event.pointerId })
  }
  return <div ref={rootRef} className="overlay-stage bubble-tail-editor">
    <span className="overlay-handle bubble-tail-handle" role="button" aria-label="Bubble tail" title="Drag to move or lengthen the tail"
      style={{ left: projection.x + shown.x * projection.scale, top: projection.y + shown.y * projection.scale, cursor: 'move' }} onPointerDown={begin} />
  </div>
}
