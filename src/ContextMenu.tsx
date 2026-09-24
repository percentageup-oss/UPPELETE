import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { MenuEntry } from './MenuButton'

type ActionEntry = Extract<MenuEntry, { label: string }>
const isAction = (entry: MenuEntry): entry is ActionEntry => !('separator' in entry)

/**
 * Right-click menu at a screen point. Shares the MenuButton item styling and semantics: disabled items
 * stay focusable and say why. Key events are stopped here so global editor shortcuts never fire.
 */
export function ContextMenu({ x, y, entries, label = 'Timeline actions', onClose }: {
  x: number
  y: number
  entries: MenuEntry[]
  label?: string
  onClose: () => void
}) {
  const root = useRef<HTMLDivElement>(null)
  const items = useRef<(HTMLButtonElement | null)[]>([])
  const [position, setPosition] = useState({ left: x, top: y })
  const actions = entries.filter(isAction)
  items.current.length = actions.length

  // Keep the menu on screen: flip/clamp once its real size is known.
  useLayoutEffect(() => {
    const box = root.current?.getBoundingClientRect()
    if (!box) return
    setPosition({ left: Math.max(4, Math.min(x, window.innerWidth - box.width - 4)), top: Math.max(4, Math.min(y, window.innerHeight - box.height - 4)) })
  }, [x, y, entries.length])

  useEffect(() => {
    items.current.find((item) => item)?.focus()
    const dismiss = (event: Event) => { if (!(event instanceof PointerEvent) || !root.current?.contains(event.target as Node)) onClose() }
    document.addEventListener('pointerdown', dismiss)
    window.addEventListener('blur', dismiss)
    window.addEventListener('resize', dismiss)
    window.addEventListener('wheel', dismiss, { passive: true })
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      window.removeEventListener('blur', dismiss)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('wheel', dismiss)
    }
  }, [onClose])

  const focusItem = (index: number) => items.current[(index + actions.length) % actions.length]?.focus()
  const onKey = (event: ReactKeyboardEvent) => {
    event.stopPropagation()
    const current = items.current.findIndex((item) => item === document.activeElement)
    switch (event.key) {
      case 'ArrowDown': event.preventDefault(); focusItem(current + 1); break
      case 'ArrowUp': event.preventDefault(); focusItem(current - 1); break
      case 'Home': event.preventDefault(); focusItem(0); break
      case 'End': event.preventDefault(); focusItem(actions.length - 1); break
      case 'Escape': event.preventDefault(); onClose(); break
      case 'Tab': event.preventDefault(); onClose(); break
    }
  }

  let actionIndex = 0
  return <div ref={root} className="menu-popover context-menu" role="menu" aria-label={label} style={position}
    onKeyDown={onKey} onContextMenu={(event) => event.preventDefault()}>
    {entries.map((entry) => {
      if (!isAction(entry)) return <div key={entry.id} role="separator" className="menu-separator" />
      const index = actionIndex++
      const disabled = Boolean(entry.disabledReason)
      return <button key={entry.id} role="menuitem" tabIndex={-1} aria-disabled={disabled || undefined} className="menu-item"
        ref={(element) => { items.current[index] = element }} title={entry.disabledReason ?? undefined}
        onClick={() => { if (disabled) return; onClose(); entry.onSelect() }}>
        <span className="menu-item-label">{entry.label}{disabled && <small>{entry.disabledReason}</small>}</span>
        {entry.shortcut && <kbd>{entry.shortcut}</kbd>}
      </button>
    })}
  </div>
}
