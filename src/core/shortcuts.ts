export type ShortcutAction =
  | 'toggle-playback'
  | 'seek-backward'
  | 'seek-forward'
  | 'split-cue'
  | 'delete-cue'
  | 'undo'
  | 'redo'
  | 'previous-cue'
  | 'next-cue'
  | 'show-shortcuts'

export type KeyboardShortcutEvent = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false
  const element = target as EventTarget & { tagName?: string; isContentEditable?: boolean; closest?: (selector: string) => Element | null }
  if (element.isContentEditable) return true
  if (typeof element.closest === 'function') return Boolean(element.closest('input, textarea, select, [contenteditable="true"]'))
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName?.toUpperCase() ?? '')
}

/** Returns only shortcuts that are safe to handle outside an editing control. */
export function shortcutForEvent(event: KeyboardShortcutEvent, target: EventTarget | null): ShortcutAction | null {
  if (isEditableTarget(target)) return null

  const modifier = event.ctrlKey || event.metaKey
  if (modifier && !event.altKey && event.key.toLowerCase() === 'z') return event.shiftKey ? 'redo' : 'undo'
  if (event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === 'y') return 'redo'
  if (modifier || event.altKey) return null

  switch (event.key) {
    case ' ':
    case 'Spacebar': return 'toggle-playback'
    case 'ArrowLeft': return 'seek-backward'
    case 'ArrowRight': return 'seek-forward'
    case 'ArrowUp': return 'previous-cue'
    case 'ArrowDown': return 'next-cue'
    case 'Delete':
    case 'Backspace': return 'delete-cue'
    case '?': return 'show-shortcuts'
    default: return event.key.toLowerCase() === 's' ? 'split-cue' : null
  }
}
