import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'

export type MenuEntry =
  | { id: string; label: string; onSelect(): void; shortcut?: string; disabledReason?: string | null }
  | { id: string; separator: true }

type ActionEntry = Extract<MenuEntry, { label: string }>
const isAction = (entry: MenuEntry): entry is ActionEntry => !('separator' in entry)

/**
 * Dependency-free WAI-ARIA menu button. Disabled items stay focusable and say why they are unavailable.
 * Key events are stopped at the menu so the editor's global shortcuts (arrows seek, Space plays) never fire.
 */
export function MenuButton({ label, entries, className, title, initiallyOpen = false }: {
  label: string
  entries: MenuEntry[]
  className?: string
  title?: string
  /** Rendering hook for markup tests only. */
  initiallyOpen?: boolean
}) {
  const [open, setOpen] = useState(initiallyOpen)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const items = useRef<(HTMLButtonElement | null)[]>([])
  const menuId = useId()
  const actions = entries.filter(isAction)
  items.current.length = actions.length

  const focusItem = (index: number) => items.current[(index + actions.length) % actions.length]?.focus()
  const close = (returnFocus: boolean) => { setOpen(false); if (returnFocus) trigger.current?.focus() }

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const openAt = (index: number) => { setOpen(true); requestAnimationFrame(() => focusItem(index)) }

  const onTriggerKey = (event: ReactKeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); openAt(0) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); event.stopPropagation(); openAt(actions.length - 1) }
  }

  const onMenuKey = (event: ReactKeyboardEvent) => {
    event.stopPropagation()
    const current = items.current.findIndex((item) => item === document.activeElement)
    switch (event.key) {
      case 'ArrowDown': event.preventDefault(); focusItem(current + 1); break
      case 'ArrowUp': event.preventDefault(); focusItem(current - 1); break
      case 'Home': event.preventDefault(); focusItem(0); break
      case 'End': event.preventDefault(); focusItem(actions.length - 1); break
      case 'Escape': event.preventDefault(); close(true); break
      case 'Tab': setOpen(false); break
    }
  }

  let actionIndex = 0
  return <div className="menu-button" ref={root}>
    <button ref={trigger} className={className} title={title} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
      onClick={() => open ? setOpen(false) : openAt(0)} onKeyDown={onTriggerKey}>
      {label}<span className="menu-caret" aria-hidden="true">▾</span>
    </button>
    {open && <div className="menu-popover" role="menu" id={menuId} aria-label={label} onKeyDown={onMenuKey}>
      {entries.map((entry) => {
        if (!isAction(entry)) return <div key={entry.id} role="separator" className="menu-separator" />
        const index = actionIndex++
        const disabled = Boolean(entry.disabledReason)
        return <button key={entry.id} role="menuitem" tabIndex={-1} aria-disabled={disabled || undefined} className="menu-item"
          ref={(element) => { items.current[index] = element }} title={entry.disabledReason ?? undefined}
          onClick={() => { if (disabled) return; close(true); entry.onSelect() }}>
          <span className="menu-item-label">{entry.label}{disabled && <small>{entry.disabledReason}</small>}</span>
          {entry.shortcut && <kbd>{entry.shortcut}</kbd>}
        </button>
      })}
    </div>}
  </div>
}
