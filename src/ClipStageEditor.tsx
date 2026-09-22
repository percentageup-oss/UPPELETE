import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { Clip, CompositionRect, Track, VisualClip } from './core/edit'
import type { Size } from './core/composition'
import type { PlaybackClock } from './core/playbackClock'
import { moveRect, nudgeRect, resizeRect, roundRect, type RectHandle } from './core/overlayRect'
import { activeClipsAt } from './core/timelineModel'
import { useCompositionProjection } from './captions/CaptionPreview'

/** A picture clip placed in the frame: an image, or a video shown picture-in-picture. */
type Placed = VisualClip & { rect: CompositionRect }

const HANDLES: RectHandle[] = ['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se']

const CURSOR_FOR_HANDLE: Record<RectHandle, string> = {
  n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
  ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize',
}

type MoveDrag = { kind: 'move'; clipId: string; base: Placed; startClientX: number; startClientY: number; pointerId: number; clone: boolean }
type ResizeDrag = { kind: 'resize'; clipId: string; base: Placed; handle: RectHandle; startClientX: number; startClientY: number; pointerId: number; keepAspect: boolean }
type DragState = MoveDrag | ResizeDrag

/**
 * The stage manipulation layer (drag/resize/Alt-clone directly on the preview), rendered as a
 * sibling of `CaptionStage` inside `.video-frame`. It edits every picture clip under the playhead
 * that has a `rect` — images, and videos shown picture-in-picture; a full-frame clip has nothing to
 * drag (the inspector's Picture-in-picture toggle gives it a rect). Only hit boxes and their handles
 * are `pointer-events: auto`, so the rest of the stage stays click-through. Composition-unit ↔
 * screen-pixel mapping reuses `useCompositionProjection`, the exact projection `CaptionPreview`
 * positions its own wrapper with, so a handle always sits exactly on the painted clip's edge.
 *
 * `clips` is the caller's already-drafted list, so a rect this editor is actively dragging reflects
 * the live draft the moment the caller applies it; this component never keeps its own copy of the
 * dragged rect, only the gesture's starting point.
 */
export function ClipStageEditor({ tracks, clips, composition, clock, selectedId, onSelect, onRectDraft, onRectCommit, onCloneDraft, onCloneCommit }: {
  tracks: readonly Track[]
  clips: readonly Clip[]
  composition: Size
  clock: PlaybackClock
  selectedId: string | null
  onSelect: (id: string) => void
  onRectDraft: (rect: CompositionRect) => void
  onRectCommit: (rect: CompositionRect) => void
  onCloneDraft: (clip: VisualClip | null) => void
  onCloneCommit: (clip: VisualClip) => void
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const frameUs = useSyncExternalStore(clock.subscribe, clock.getUs)
  // Mirrors Timeline.tsx's own drag-effect pattern: callbacks live in refs, not the effect's
  // dependency array, so a parent re-render mid-drag (every `onRectDraft` call causes one) never
  // tears down and re-adds the window listeners — only a change of `drag` itself does.
  const rectDraftRef = useRef(onRectDraft); rectDraftRef.current = onRectDraft
  const rectCommitRef = useRef(onRectCommit); rectCommitRef.current = onRectCommit
  const cloneDraftRef = useRef(onCloneDraft); cloneDraftRef.current = onCloneDraft
  const cloneCommitRef = useRef(onCloneCommit); cloneCommitRef.current = onCloneCommit

  const projection = useCompositionProjection(rootRef, composition)
  // Back to front, so a picture on a higher track is hit first (it is also later in the DOM).
  const visible = useMemo(() => activeClipsAt(frameUs, tracks, clips.filter((clip) => clip.kind !== 'audio'), { skipHidden: true })
    .map((entry) => entry.clip).filter((clip): clip is Placed => clip.kind !== 'audio' && clip.rect !== undefined), [tracks, clips, frameUs])

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

  const beginMove = (event: ReactPointerEvent<HTMLElement>, overlay: Placed) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    onSelect(overlay.id)
    if (event.altKey) {
      const cloned: Placed = { ...overlay, id: crypto.randomUUID() }
      onCloneDraft(cloned)
      setDrag({ kind: 'move', clipId: cloned.id, base: cloned, startClientX: event.clientX, startClientY: event.clientY, pointerId: event.pointerId, clone: true })
    } else {
      setDrag({ kind: 'move', clipId: overlay.id, base: overlay, startClientX: event.clientX, startClientY: event.clientY, pointerId: event.pointerId, clone: false })
    }
  }

  const beginResize = (event: ReactPointerEvent<HTMLElement>, overlay: Placed, handle: RectHandle) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    setDrag({ kind: 'resize', clipId: overlay.id, base: overlay, handle, startClientX: event.clientX, startClientY: event.clientY, pointerId: event.pointerId, keepAspect: !event.shiftKey })
  }

  const handleKeyNudge = (event: ReactKeyboardEvent<HTMLElement>, overlay: Placed) => {
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

  const toPx = (rect: CompositionRect) => ({
    left: projection.x + rect.x * projection.scale, top: projection.y + rect.y * projection.scale,
    width: rect.width * projection.scale, height: rect.height * projection.scale,
  })

  return <div ref={rootRef} className="overlay-stage">
    {visible.map((overlay) => {
      const box = toPx(overlay.rect)
      const selected = overlay.id === selectedId
      const dragging = drag?.clipId === overlay.id
      return <div key={overlay.id} className={`overlay-hit ${selected ? 'selected' : ''} ${dragging ? 'dragging' : ''}`}
        style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
        tabIndex={selected ? 0 : -1}
        role="button"
        aria-label={`${overlay.kind === 'video' ? 'Picture-in-picture video' : 'Image'} at ${Math.round(overlay.rect.x)}, ${Math.round(overlay.rect.y)}`}
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
