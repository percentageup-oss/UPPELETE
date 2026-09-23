import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { CaptionFrame, Size } from './renderer'
import type { TextOverlay } from '../core/edit'
import { captionStyleInputs } from './style'
import { CaptionPreview } from './CaptionPreview'
import { decorativeTextCue, textMotionAt } from './textMotion'

/** Authored text uses the exact caption layout, font loader and painter. The surrounding transform
 * adds only the item's sequence-time enter/exit motion; it never changes caption data. */
export function TextOverlayActor({ item, timestampUs, composition, onFrame, onLayout, onPointerDown, onDoubleClick, editing = false }: {
  item: TextOverlay; timestampUs: number; composition: Size
  onFrame?: Parameters<typeof CaptionPreview>[0]['onFrame']
  onLayout?: (frame: CaptionFrame) => void
  onPointerDown?: () => void; onDoubleClick?: () => void
  editing?: boolean
}) {
  const motion = textMotionAt(item, timestampUs)
  const [frame, setFrame] = useState<CaptionFrame | null>(null)
  const layoutRef = useRef<CaptionFrame['layout'] | null>(null)
  const captureFrame = (next: CaptionFrame | null) => {
    if (next && layoutRef.current !== next.layout) { layoutRef.current = next.layout; setFrame(next) }
    if (next) onFrame?.(next)
  }
  useEffect(() => { if (frame?.layout.status === 'ready') onLayout?.(frame) }, [frame?.layout, onLayout])
  if (!motion.visible) return null
  const style = captionStyleInputs(item.style, composition)
  const transform = `translate(${motion.x}px, ${motion.y}px) scale(${motion.scale})`
  return <div data-text-overlay-id={item.id}
    style={{ position: 'absolute', inset: 0, opacity: editing ? 0 : motion.opacity, transform, transformOrigin: 'center', pointerEvents: 'none' } as CSSProperties}>
    <CaptionPreview cue={decorativeTextCue(item)} timestampUs={timestampUs} composition={composition} inputs={style}
      motion={item.style.motion} motionSpeed={item.style.motionSpeed} fontSample={item.text} diagnostics={false} onFrame={captureFrame} />
    {!editing && (onPointerDown || onDoubleClick) && frame?.layout.status === 'ready' && <div className="text-overlay-hit"
      role="button" tabIndex={0} aria-label={`Select title: ${item.text}`} data-text-overlay-hit={item.id}
      style={{ left: frame.layout.bounds.x, top: frame.layout.bounds.y, width: frame.layout.bounds.width, height: frame.layout.bounds.height,
        transform: `rotate(${item.style.appearance.rotation}deg)`, transformOrigin: 'center' } as CSSProperties}
      onPointerDown={(event) => { event.stopPropagation(); onPointerDown?.() }}
      onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); onDoubleClick?.() }}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onDoubleClick?.() } }} />}
  </div>
}
