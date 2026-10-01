import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type TouchEvent as ReactTouchEvent } from 'react'
import type { MenuEntry } from './MenuButton'

type ActionEntry = Extract<MenuEntry, { label: string }>
const isAction = (entry: MenuEntry): entry is ActionEntry => !('separator' in entry)

function useIsMobile(breakpoint = 899): boolean {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
    return window.innerWidth <= breakpoint
  })

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(`(max-width: ${breakpoint}px)`)
    const update = () => setIsMobile(mql.matches)
    update()
    mql.addEventListener('change', update)
    return () => mql.removeEventListener('change', update)
  }, [breakpoint])

  return isMobile
}

/**
 * Context menu for desktop (pointer popover) and mobile devices (bottom-sheet).
 * On small touch screens, it slides up as a native mobile bottom sheet with drag-to-dismiss,
 * large touch targets, clear action labels, and a cancel button.
 */
export function ContextMenu({ x, y, entries, label = 'Timeline actions', mobile, onClose }: {
  x: number
  y: number
  entries: MenuEntry[]
  label?: string
  mobile?: boolean
  onClose: () => void
}) {
  const autoMobile = useIsMobile()
  const isMobile = mobile !== undefined ? mobile : autoMobile

  const root = useRef<HTMLDivElement>(null)
  const items = useRef<(HTMLButtonElement | null)[]>([])
  const [position, setPosition] = useState({ left: x, top: y })
  const actions = entries.filter(isAction)
  items.current.length = actions.length

  // Touch drag-to-dismiss state for mobile bottom-sheet
  const touchStartY = useRef<number | null>(null)

  // Keep the desktop menu on screen: flip/clamp once its real size is known.
  useLayoutEffect(() => {
    if (isMobile) return
    const box = root.current?.getBoundingClientRect()
    if (!box) return
    setPosition({
      left: Math.max(4, Math.min(x, window.innerWidth - box.width - 4)),
      top: Math.max(4, Math.min(y, window.innerHeight - box.height - 4)),
    })
  }, [x, y, entries.length, isMobile])

  useEffect(() => {
    items.current.find((item) => item)?.focus()
    const dismiss = (event: Event) => {
      if (isMobile) return // Mobile uses backdrop click or cancel button
      if (!(event instanceof PointerEvent) || !root.current?.contains(event.target as Node)) onClose()
    }
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
  }, [onClose, isMobile])

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

  const onTouchStart = (event: ReactTouchEvent) => {
    touchStartY.current = event.touches[0].clientY
  }

  const onTouchMove = (event: ReactTouchEvent) => {
    if (touchStartY.current === null || !root.current) return
    const deltaY = event.touches[0].clientY - touchStartY.current
    if (deltaY > 0) {
      root.current.style.transform = `translateY(${deltaY}px)`
    }
  }

  const onTouchEnd = (event: ReactTouchEvent) => {
    if (touchStartY.current === null) return
    const deltaY = event.changedTouches[0].clientY - touchStartY.current
    touchStartY.current = null
    if (deltaY > 60) {
      onClose()
    } else if (root.current) {
      root.current.style.transform = ''
    }
  }

  let actionIndex = 0

  if (isMobile) {
    return (
      <div className="bottom-sheet-backdrop" onClick={onClose} role="presentation">
        <div
          ref={root}
          className="bottom-sheet-modal context-menu-bottom-sheet"
          role="menu"
          aria-label={label}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={onKey}
          onContextMenu={(event) => event.preventDefault()}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          <div className="bottom-sheet-handle-bar">
            <div className="bottom-sheet-drag-pill" />
          </div>

          <div className="bottom-sheet-header">
            <span className="bottom-sheet-title">{label}</span>
            <button
              type="button"
              className="bottom-sheet-close-btn"
              aria-label="Close"
              onClick={onClose}
            >
              ✕
            </button>
          </div>

          <div className="bottom-sheet-items">
            {entries.map((entry) => {
              if (!isAction(entry)) {
                return <div key={entry.id} role="separator" className="bottom-sheet-separator" />
              }
              const index = actionIndex++
              const disabled = Boolean(entry.disabledReason)
              const lower = entry.label.toLowerCase()
              const isDanger = lower.includes('delete') || lower.includes('remove') || lower.includes('trash')
              return (
                <button
                  key={entry.id}
                  role="menuitem"
                  tabIndex={-1}
                  aria-disabled={disabled || undefined}
                  className={`bottom-sheet-item${isDanger ? ' danger' : ''}${disabled ? ' disabled' : ''}`}
                  ref={(element) => { items.current[index] = element }}
                  title={entry.disabledReason ?? undefined}
                  onClick={() => {
                    if (disabled) return
                    onClose()
                    entry.onSelect()
                  }}
                >
                  <div className="bottom-sheet-item-content">
                    <span className="bottom-sheet-item-label">{entry.label}</span>
                    {entry.disabledReason && (
                      <small className="bottom-sheet-item-disabled-reason">{entry.disabledReason}</small>
                    )}
                  </div>
                  {entry.shortcut && <kbd className="bottom-sheet-shortcut">{entry.shortcut}</kbd>}
                </button>
              )
            })}
          </div>

          <div className="bottom-sheet-footer">
            <button type="button" className="bottom-sheet-cancel-btn" onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={root}
      className="menu-popover context-menu"
      role="menu"
      aria-label={label}
      style={position}
      onKeyDown={onKey}
      onContextMenu={(event) => event.preventDefault()}
    >
      {entries.map((entry) => {
        if (!isAction(entry)) return <div key={entry.id} role="separator" className="menu-separator" />
        const index = actionIndex++
        const disabled = Boolean(entry.disabledReason)
        return (
          <button
            key={entry.id}
            role="menuitem"
            tabIndex={-1}
            aria-disabled={disabled || undefined}
            className="menu-item"
            ref={(element) => { items.current[index] = element }}
            title={entry.disabledReason ?? undefined}
            onClick={() => { if (disabled) return; onClose(); entry.onSelect() }}
          >
            <span className="menu-item-label">{entry.label}{disabled && <small>{entry.disabledReason}</small>}</span>
            {entry.shortcut && <kbd>{entry.shortcut}</kbd>}
          </button>
        )
      })}
    </div>
  )
}
