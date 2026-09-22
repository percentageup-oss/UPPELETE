import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { ImageOverlay } from './core/edit'
import type { Size } from './core/composition'
import type { PlaybackClock } from './core/playbackClock'
import { moveRect, nudgeRect, resizeRect, roundRect, type RectHandle } from './core/overlayRect'
import { projectCaptionViewport } from './captions/renderer'

const HANDLES: RectHandle[] = ['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se']

const CURSOR_FOR_HANDLE: Record<RectHandle, string> = {
  n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
  ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize',
}

type MoveDrag = { kind: 'move'; overlayId: string; base: ImageOverlay; startClientX: number; startClientY: number; pointerId: number; clone: boolean }
type ResizeDrag = { kind: 'resize'; overlayId: string; base: ImageOverlay; handle: RectHandle; startClientX: number; startClientY: number; pointerId: number; keepAspect: boolean }
type DragState = MoveDrag | ResizeDrag

/**
 * The stage manipulation layer (drag/resize/Alt-clone directly on the preview), rendered as a
 * sibling of `CaptionStage` inside `.video-frame`. Only overlay hit boxes and their handles are
 * `pointer-events: auto` — the wrapper itself stays click-through so the native `<video controls>`
 * bar and the empty-stage buttons are unaffected. Composition-unit ↔ screen-pixel mapping reuses
 * `projectCaptionViewport`, the exact function `CaptionPreview` positions its own wrapper with, so
 * a handle always sits exactly on the painted overlay's edge.
 *
 * `overlays` is the caller's already-drafted, time-visible list — same contract as
 * `CaptionStage`'s `overlays` prop (`App.tsx`'s `visibleOverlays`) — so a rect this editor is
 * actively dragging reflects the live draft the moment the caller applies it; this component never
 * keeps its own copy of the dragged rect, only the gesture's starting point.
 */
export function OverlayStageEditor({ overlays, composition, clock, selectedId, onSelect, onRectDraft, onRectCommit, onCloneDraft, onCloneCommit }: {
  overlays: readonly ImageOverlay[]
  composition: Size
  clock: PlaybackClock
  selectedId: string | null
  onSelect: (id: string) => void
  onRectDraft: (rect: ImageOverlay['rect']) => void
  onRectCommit: (rect: ImageOverlay['rect']) => void
  onCloneDraft: (overlay: ImageOverlay | null) => void
  onCloneCommit: (overlay: ImageOverlay) => void
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [preview, setPreview] = useState<Size | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const frameUs = useSyncExternalStore(clock.subscribe, clock.getUs)
  // Mirrors Timeline.tsx's own drag-effect pattern: callbacks live in refs, not the effect's
  // dependency array, so a parent re-render mid-drag (every `onRectDraft` call causes one) never
  // tears down and re-adds the window listeners — only a change of `drag` itself does.
  const rectDraftRef = useRef(onRectDraft); rectDraftRef.current = onRectDraft
  const rectCommitRef = useRef(onRectCommit); rectCommitRef.current = onRectCommit
  const cloneDraftRef = useRef(onCloneDraft); cloneDraftRef.current = onCloneDraft
  const cloneCommitRef = useRef(onCloneCommit); cloneCommitRef.current = onCloneCommit

  useEffect(() => {
    const element = rootRef.current
    if (!element) return
    const resize = new ResizeObserver(([entry]) => setPreview({ width: entry.contentRect.width, height: entry.contentRect.height }))
    resize.observe(element)
    return () => resize.disconnect()
  }, [])

  const projection = preview && preview.width > 0 && preview.height > 0 ? projectCaptionViewport(composition, preview) : null
  const visible = useMemo(() => overlays.filter((overlay) => frameUs >= overlay.startUs && frameUs < overlay.endUs), [overlays, frameUs])

  useEffect(() => {
    if (!drag) return
    const rectAt = (event: PointerEvent) => {
      if (!projection) return drag.base.rect
      const dxUnits = (event.clientX - drag.startClientX) / projection.scale
      const dyUnits = (event.clientY - drag.startClientY) / projection.scale
      return drag.kind === 'move'
        ? moveRect(drag.base.rect, dxUnits, dyUnits, composition)
        : resizeRect(drag.base.rect, drag.handle, dxUnits, dyUnits, { composition, keepAspect: drag.keepAspect })
    }
    const move = (event: PointerEvent) => {
      if (event.pointerId !== drag.pointerId) return
      const rect = rectAt(event)
      if (drag.kind === 'move' && drag.clone) cloneDraftRef.current({ ...drag.base, rect })
      else rectDraftRef.current(rect)
    }
    const end = (event: PointerEvent, commit: boolean) => {
      if (event.pointerId !== drag.pointerId) return
      setDrag(null)
      if (drag.kind === 'move' && drag.clone) {
        if (commit) cloneCommitRef.current({ ...drag.base, rect: roundRect(rectAt(event)) })
        else cloneDraftRef.current(null)
        return
      }
      if (commit) rectCommitRef.current(roundRect(rectAt(event)))
      else rectDraftRef.current(drag.base.rect)
    }
    const up = (event: PointerEvent) => end(event, true)
    const cancel = (event: PointerEvent) => end(event, false)
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setDrag(null)
      if (drag.kind === 'move' && drag.clone) cloneDraftRef.current(null)
      else rectDraftRef.current(drag.base.rect)
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
  }, [drag, projection, composition])

  const beginMove = (event: ReactPointerEvent<HTMLElement>, overlay: ImageOverlay) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    onSelect(overlay.id)
    if (event.altKey) {
      const cloned: ImageOverlay = { ...overlay, id: crypto.randomUUID() }
      onCloneDraft(cloned)
      setDrag({ kind: 'move', overlayId: cloned.id, base: cloned, startClientX: event.clientX, startClientY: event.clientY, pointerId: event.pointerId, clone: true })
    } else {
      setDrag({ kind: 'move', overlayId: overlay.id, base: overlay, startClientX: event.clientX, startClientY: event.clientY, pointerId: event.pointerId, clone: false })
    }
  }

  const beginResize = (event: ReactPointerEvent<HTMLElement>, overlay: ImageOverlay, handle: RectHandle) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    setDrag({ kind: 'resize', overlayId: overlay.id, base: overlay, handle, startClientX: event.clientX, startClientY: event.clientY, pointerId: event.pointerId, keepAspect: !event.shiftKey })
  }

  const handleKeyNudge = (event: ReactKeyboardEvent<HTMLElement>, overlay: ImageOverlay) => {
    const step = event.shiftKey ? 10 : 1
    let dx = 0, dy = 0
    if (event.key === 'ArrowLeft') dx = -step
    else if (event.key === 'ArrowRight') dx = step
    else if (event.key === 'ArrowUp') dy = -step
    else if (event.key === 'ArrowDown') dy = step
    else return
    event.preventDefault()
    event.stopPropagation()
    onRectCommit(nudgeRect(overlay.rect, dx, dy, composition))
  }

  if (!projection) return <div ref={rootRef} className="overlay-stage" aria-hidden="true" />

  const toPx = (rect: ImageOverlay['rect']) => ({
    left: projection.x + rect.x * projection.scale, top: projection.y + rect.y * projection.scale,
    width: rect.width * projection.scale, height: rect.height * projection.scale,
  })

  return <div ref={rootRef} className="overlay-stage">
    {visible.map((overlay) => {
      const box = toPx(overlay.rect)
      const selected = overlay.id === selectedId
      const dragging = drag?.overlayId === overlay.id
      return <div key={overlay.id} className={`overlay-hit ${selected ? 'selected' : ''} ${dragging ? 'dragging' : ''}`}
        style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
        tabIndex={selected ? 0 : -1}
        role="button"
        aria-label={`Image overlay at ${Math.round(overlay.rect.x)}, ${Math.round(overlay.rect.y)}`}
        onPointerDown={(event) => beginMove(event, overlay)}
        onKeyDown={(event) => handleKeyNudge(event, overlay)}>
        {selected && HANDLES.map((handle) => <span key={handle} className="overlay-handle" data-handle={handle}
          style={{ cursor: CURSOR_FOR_HANDLE[handle] }}
          onPointerDown={(event) => beginResize(event, overlay, handle)} />)}
        {dragging && <span className="overlay-readout">{Math.round(overlay.rect.x)}, {Math.round(overlay.rect.y)} · {Math.round(overlay.rect.width)}×{Math.round(overlay.rect.height)}</span>}
      </div>
    })}
  </div>
}
