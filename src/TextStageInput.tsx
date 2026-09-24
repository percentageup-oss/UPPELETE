import { useEffect, useRef, useState, type CSSProperties, type FocusEvent, type KeyboardEvent } from 'react'
import type { CaptionFrame } from './captions/renderer'
import type { TextOverlay } from './core/edit'

/** A temporary, composition-aligned editor over the selected rendered text actor. */
export function TextStageInput({ item, frame, composition, selectAll = false, onFinish, onCommit }: {
  item: TextOverlay; frame: CaptionFrame | null; composition: { width: number; height: number }
  selectAll?: boolean; onFinish: () => void; onCommit: (text: string) => void
}) {
  const input = useRef<HTMLTextAreaElement>(null)
  const finished = useRef(false)
  const [value, setValue] = useState(item.text)
  const ready = frame?.layout.status === 'ready'
  useEffect(() => { setValue(item.text); finished.current = false }, [item.id])
  useEffect(() => {
    const element = input.current
    if (!element) return
    element.focus()
    if (selectAll) element.select()
    else { const end = element.value.length; element.setSelectionRange(end, end) }
  }, [item.id, selectAll, ready])

  const finish = () => {
    if (finished.current) return
    finished.current = true
    const text = value.trim()
    if (text && text !== item.text) onCommit(text)
    onFinish()
  }
  const style: CSSProperties | undefined = frame?.layout.status === 'ready' ? {
    left: `${frame.layout.bounds.x / composition.width * 100}%`,
    top: `${frame.layout.bounds.y / composition.height * 100}%`,
    width: `${Math.max(1, frame.layout.bounds.width / composition.width * 100)}%`,
    height: `${Math.max(1, frame.layout.bounds.height / composition.height * 100)}%`,
    transform: `rotate(${item.style.appearance.rotation}deg)`,
    transformOrigin: 'center',
    fontFamily: `"${item.style.appearance.fontFamily}", sans-serif`,
    fontSize: `${item.style.appearance.fontSize / 1080 * 100}cqw`,
    fontWeight: item.style.appearance.fontWeight,
    color: item.style.appearance.primaryColor,
    textAlign: item.style.appearance.alignment,
    lineHeight: item.style.appearance.lineHeight,
    textShadow: item.style.appearance.shadowEnabled ? `${item.style.appearance.shadowOffset}px ${item.style.appearance.shadowOffset}px ${item.style.appearance.shadowBlur}px ${item.style.appearance.shadowColor}` : 'none',
    background: item.style.appearance.backgroundEnabled ? `${item.style.appearance.backgroundColor}${Math.round(item.style.appearance.backgroundOpacity * 255).toString(16).padStart(2, '0')}` : 'transparent',
    padding: `${item.style.appearance.padding / 1080 * 100}cqw`,
  } : undefined

  if (!ready || !style) return null
  return <textarea ref={input} className="text-stage-input" aria-label="Edit title on preview" value={value} style={style}
    onChange={(event) => setValue(event.target.value)} onBlur={finish}
    onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Escape' || (event.key === 'Enter' && (event.metaKey || event.ctrlKey))) { event.preventDefault(); finish() }
    }} onDoubleClick={(event) => event.stopPropagation()}
    onFocus={(event: FocusEvent<HTMLTextAreaElement>) => { if (selectAll) event.currentTarget.select() }} />
}
