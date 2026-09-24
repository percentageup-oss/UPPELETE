import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { CaptionFrame, Size } from './renderer'
import type { TextOverlay } from '../core/edit'
import { captionStyleInputs } from './style'
import { CaptionPreview } from './CaptionPreview'
import { decorativeTextCue, textMotionAt, titleMotionAt } from './textMotion'
import { maskStyle } from './maskStyle'

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
  const titleMotion = titleMotionAt(item, timestampUs)
  const [frame, setFrame] = useState<CaptionFrame | null>(null)
  const layoutRef = useRef<CaptionFrame['layout'] | null>(null)
  const captureFrame = (next: CaptionFrame | null) => {
    if (next && layoutRef.current !== next.layout) { layoutRef.current = next.layout; setFrame(next) }
    if (next) onFrame?.(next)
  }
  useEffect(() => { if (frame?.layout.status === 'ready') onLayout?.(frame) }, [frame?.layout, onLayout])
  // Stable identity: CaptionPreview re-measures whenever `inputs` changes, and its onFrame feeds the
  // setFrame above, so a fresh object per render would re-layout and re-render this actor forever.
  const style = useMemo(() => captionStyleInputs(item.style, composition), [item.style, composition.width, composition.height])
  const cue = useMemo(() => decorativeTextCue(item), [item.id, item.text, item.startUs, item.endUs])
  if (!motion.visible) return null
  const transform = `translate(${motion.x}px, ${motion.y}px) scale(${motion.scale})`
  // The mask sits on a static outer wrapper, so enter/exit motion moves the text under a fixed mask.
  const masked = maskStyle(item.mask, composition, null)
  const content = <div data-text-overlay-id={item.id}
    style={{ position: 'absolute', inset: 0, opacity: editing ? 0 : motion.opacity,
      transform, transformOrigin: 'center', pointerEvents: 'none' } as CSSProperties}>
    <CaptionPreview cue={cue} timestampUs={timestampUs} composition={composition} inputs={style}
      motion={item.style.motion} motionSpeed={item.style.motionSpeed} fontSample={item.text} diagnostics={false} onFrame={captureFrame}
      titleMotion={titleMotion} />
    {!editing && (onPointerDown || onDoubleClick) && frame?.layout.status === 'ready' && <div className="text-overlay-hit"
      role="button" tabIndex={0} aria-label={`Select title: ${item.text}`} data-text-overlay-hit={item.id}
      style={{ left: frame.layout.bounds.x, top: frame.layout.bounds.y, width: frame.layout.bounds.width, height: frame.layout.bounds.height,
        transform: `rotate(${item.style.appearance.rotation}deg)`, transformOrigin: 'center' } as CSSProperties}
      onPointerDown={(event) => { event.stopPropagation(); onPointerDown?.() }}
      onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); onDoubleClick?.() }}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onDoubleClick?.() } }} />}
  </div>
  return Object.keys(masked).length
    ? <div data-text-mask={item.id} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', ...masked }}>{content}</div>
    : content
}
