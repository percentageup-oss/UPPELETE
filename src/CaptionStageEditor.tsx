import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react'
import type { CaptionFrame, Rect } from './captions/renderer'
import type { Size } from './core/composition'
import { movePlacement, nudgePlacement, pointerScaleFactor, rotationAt, scaleFontSize, type CaptionPlacement } from './core/captionPlacement'
import { useCompositionProjection } from './captions/CaptionPreview'

/** The four placement fields a caption's appearance carries; a gesture patches only the ones it
 * actually changes (move: horizontal/vertical; resize: fontSize; rotate: rotation), so a scoped
 * commit (Alt-drag) only ever pins the field that gesture touched, in `CaptionStyle['appearance']`
 * or a cue's own `placementOverride` alike. */
export type CaptionPlacementPatch = Partial<{ horizontal: number; vertical: number; fontSize: number; rotation: number }>
type CaptionAppearancePlacement = CaptionPlacement & { fontSize: number; rotation: number }
type PlacementScope = 'project' | 'cue'

const CORNERS = ['nw', 'ne', 'sw', 'se'] as const
type CornerHandle = (typeof CORNERS)[number]
const CURSOR_FOR_CORNER: Record<CornerHandle, string> = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize' }

type MoveDrag = { kind: 'move'; scope: PlacementScope; base: CaptionAppearancePlacement; baseBounds: Rect; baseSafeRect: Rect; startClientX: number; startClientY: number; pointerId: number }
type ResizeDrag = { kind: 'resize'; scope: PlacementScope; base: CaptionAppearancePlacement; centerClientX: number; centerClientY: number; startClientX: number; startClientY: number; pointerId: number }
type RotateDrag = { kind: 'rotate'; scope: PlacementScope; base: CaptionAppearancePlacement; centerClientX: number; centerClientY: number; startClientX: number; startClientY: number; pointerId: number; snap: boolean }
type DragState = MoveDrag | ResizeDrag | RotateDrag

/**
 * The stage manipulation layer for the caption itself: move by dragging the block, resize by
 * dragging a corner (font size — the block has no independent width/height, `captionPlacement.ts`),
 * rotate with the handle above it. Rendered as a sibling of `ClipStageEditor` inside `.video-frame`
 * (mounted by `CaptionStage`, which alone knows the cue currently showing and its evaluated
 * `CaptionFrame`). Coordinate mapping reuses `useCompositionProjection`, the same projection
 * `CaptionPreview` positions its own wrapper with, and the same one `ClipStageEditor` reuses for
 * clips — a handle always sits exactly on the painted caption's edge.
 *
 * Move needs a composition-unit pointer delta (`useCompositionProjection`'s scale), but resize and
 * rotate only ever compare a distance or an angle to the block's own center — both are invariant to
 * a uniform scale, so those two gestures work directly in raw viewport (client) pixels and need no
 * projection math at all.
 *
 * A plain drag/resize/rotate is `scope: 'project'`; Alt held at the moment the gesture starts pins
 * it to `scope: 'cue'` for the caption showing right now — fixed for the whole gesture, exactly like
 * `ClipStageEditor`'s Alt-clone decision at pointerdown.
 */
export function CaptionStageEditor({ frame, composition, appearance, selected, onSelect, onDraft, onCommit, fixedScope, onDoubleClick }: {
  frame: CaptionFrame | null
  composition: Size
  appearance: CaptionAppearancePlacement
  selected: boolean
  onSelect: () => void
  onDraft: (patch: CaptionPlacementPatch, scope: PlacementScope) => void
  onCommit: (patch: CaptionPlacementPatch, scope: PlacementScope) => void
  fixedScope?: PlacementScope
  onDoubleClick?: (event: ReactMouseEvent<HTMLElement>) => void
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  // Mirrors ClipStageEditor's own pattern: callbacks live in refs, not the effect's dependency
  // array, so a parent re-render mid-drag (every `onDraft` call causes one) never tears down and
  // re-adds the window listeners — only a change of `drag` itself does.
  const draftRef = useRef(onDraft); draftRef.current = onDraft
  const commitRef = useRef(onCommit); commitRef.current = onCommit

  const projection = useCompositionProjection(rootRef, composition)
  const scopeFor = (altKey: boolean): PlacementScope => fixedScope ?? (altKey ? 'cue' : 'project')
  const bounds = frame?.visible && frame.layout.status === 'ready' ? frame.layout.bounds : null
  const safeRect = frame?.visible && frame.layout.status === 'ready' ? frame.layout.safeRect : null

  useEffect(() => {
    if (!drag) return
    const patchFor = (kind: DragState['kind'], placement: CaptionAppearancePlacement): CaptionPlacementPatch =>
      kind === 'move' ? { horizontal: placement.horizontal, vertical: placement.vertical }
        : kind === 'resize' ? { fontSize: placement.fontSize } : { rotation: placement.rotation }
    const placementAt = (event: PointerEvent): CaptionAppearancePlacement => {
      if (drag.kind === 'move') {
        if (!projection) return drag.base
        const dx = (event.clientX - drag.startClientX) / projection.scale
        const dy = (event.clientY - drag.startClientY) / projection.scale
        return { ...drag.base, ...movePlacement(drag.base, dx, dy, drag.baseSafeRect, drag.baseBounds) }
      }
      const center = { x: drag.centerClientX, y: drag.centerClientY }
      const start = { x: drag.startClientX, y: drag.startClientY }
      const current = { x: event.clientX, y: event.clientY }
      if (drag.kind === 'resize') return { ...drag.base, fontSize: scaleFontSize(drag.base.fontSize, pointerScaleFactor(center, start, current)) }
      return { ...drag.base, rotation: rotationAt(center, start, current, drag.base.rotation, drag.snap) }
    }
    const move = (event: PointerEvent) => {
      if (event.pointerId !== drag.pointerId) return
      draftRef.current(patchFor(drag.kind, placementAt(event)), drag.scope)
    }
    const end = (event: PointerEvent, commit: boolean) => {
      if (event.pointerId !== drag.pointerId) return
      setDrag(null)
      if (commit) commitRef.current(patchFor(drag.kind, placementAt(event)), drag.scope)
      else draftRef.current(patchFor(drag.kind, drag.base), drag.scope)
    }
    const up = (event: PointerEvent) => end(event, true)
    const cancel = (event: PointerEvent) => end(event, false)
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setDrag(null)
      draftRef.current(patchFor(drag.kind, drag.base), drag.scope)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', keydown)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', keydown)
    }
  }, [drag, projection])

  // The block's own center in viewport pixels — the fixed pivot resize/rotate compare every pointer
  // point against. Rotating around it leaves it in place, so it is captured once at gesture start
  // and never recomputed mid-drag (matching every other "base" field here).
  const centerClient = (box: Rect) => {
    const stageRect = rootRef.current!.getBoundingClientRect()
    return { x: stageRect.left + (projection?.x ?? 0) + (box.x + box.width / 2) * (projection?.scale ?? 1),
      y: stageRect.top + (projection?.y ?? 0) + (box.y + box.height / 2) * (projection?.scale ?? 1) }
  }

  const beginMove = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || !bounds || !safeRect) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    onSelect()
    setDrag({ kind: 'move', scope: scopeFor(event.altKey), base: appearance, baseBounds: bounds, baseSafeRect: safeRect,
      startClientX: event.clientX, startClientY: event.clientY, pointerId: event.pointerId })
  }

  const beginResize = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || !bounds) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    const center = centerClient(bounds)
    setDrag({ kind: 'resize', scope: scopeFor(event.altKey), base: appearance,
      centerClientX: center.x, centerClientY: center.y, startClientX: event.clientX, startClientY: event.clientY, pointerId: event.pointerId })
  }

  const beginRotate = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || !bounds) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    const center = centerClient(bounds)
    setDrag({ kind: 'rotate', scope: scopeFor(event.altKey), base: appearance,
      centerClientX: center.x, centerClientY: center.y, startClientX: event.clientX, startClientY: event.clientY, pointerId: event.pointerId, snap: event.shiftKey })
  }

  const handleKeyNudge = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (!bounds || !safeRect) return
    const step = event.shiftKey ? 10 : 1
    let dx = 0, dy = 0
    if (event.key === 'ArrowLeft') dx = -step
    else if (event.key === 'ArrowRight') dx = step
    else if (event.key === 'ArrowUp') dy = -step
    else if (event.key === 'ArrowDown') dy = step
    else return
    event.preventDefault()
    event.stopPropagation()
    onCommit(nudgePlacement(appearance, dx, dy, safeRect, bounds), scopeFor(event.altKey))
  }

  // Reflects the parent's live (drafted) `appearance` each render, exactly like ClipStageEditor's
  // own readout reads the caller's current drafted rect rather than the gesture's starting point.
  const readout = useMemo(() => {
    if (!drag) return null
    if (drag.kind === 'move') return `${Math.round(appearance.horizontal * 100)}% · ${Math.round(appearance.vertical * 100)}%`
    if (drag.kind === 'resize') return `${Math.round(appearance.fontSize)}px`
    return `${Math.round(appearance.rotation)}°`
  }, [drag, appearance])

  if (!projection || !bounds) return <div ref={rootRef} className="overlay-stage caption-overlay-stage" aria-hidden="true" />

  const box = { left: projection.x + bounds.x * projection.scale, top: projection.y + bounds.y * projection.scale,
    width: bounds.width * projection.scale, height: bounds.height * projection.scale }
  const dragging = drag !== null

  return <div ref={rootRef} className="overlay-stage caption-overlay-stage">
    {/* `appearance` is the parent's already-live value (its committed style, or its own in-progress
      * draft while a gesture is in flight), so this box's rotation and label always match what
      * `CaptionView` is painting right now — no separate derivation needed. */}
    <div className={`overlay-hit caption-overlay-hit ${selected ? 'selected' : ''} ${dragging ? 'dragging' : ''}`}
      style={{ left: box.left, top: box.top, width: box.width, height: box.height, transform: `rotate(${appearance.rotation}deg)`, transformOrigin: 'center' }}
      tabIndex={selected ? 0 : -1}
      role="button"
      aria-label={`Caption placement: ${Math.round(appearance.horizontal * 100)}%, ${Math.round(appearance.vertical * 100)}%, ${Math.round(appearance.fontSize)}px, ${Math.round(appearance.rotation)} degrees`}
      onPointerDown={beginMove}
      onDoubleClick={(event) => { if (onDoubleClick) { event.preventDefault(); event.stopPropagation(); onDoubleClick(event) } }}
      onKeyDown={handleKeyNudge}>
      {selected && CORNERS.map((corner) => <span key={corner} className="overlay-handle" data-handle={corner}
        style={{ cursor: CURSOR_FOR_CORNER[corner] }} onPointerDown={beginResize} />)}
      {selected && <span className="overlay-handle" data-handle="rotate" onPointerDown={beginRotate} />}
      {dragging && <span className="overlay-readout">{readout}</span>}
    </div>
  </div>
}
