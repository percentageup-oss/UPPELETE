export type ShortcutAction =
  | 'toggle-playback'
  | 'seek-backward'
  | 'seek-forward'
  | 'split-cue'
  | 'delete-cue'
  // Timeline clips (schema 5): Cmd/Ctrl+B splits every clip under the playhead (or the selected
  // clip); Shift+Delete removes the selected clip and closes the gap it leaves.
  | 'split-clips'
  // D disables / enables the selected clip; Cmd/Ctrl+Alt+L links or unlinks a video with its audio.
  | 'toggle-clip-enabled'
  | 'toggle-clip-link'
  | 'ripple-delete'
  // Q / W trim the start / end of the clips under the playhead to the playhead.
  // I / O mark the sequence In / Out range, Shift+I / Shift+O jump to them, X clears both.
  | 'mark-in'
  | 'mark-out'
  | 'go-to-in'
  | 'go-to-out'
  | 'clear-range'
  | 'trim-start-to-playhead'
  | 'trim-end-to-playhead'
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
  if (modifier && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'b') return 'split-clips'
  if (modifier && event.altKey && !event.shiftKey && event.key.toLowerCase() === 'l') return 'toggle-clip-link'
  if (modifier || event.altKey) return null
  if (event.shiftKey && (event.key === 'Delete' || event.key === 'Backspace')) return 'ripple-delete'

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
    case 'i':
    case 'I': return event.shiftKey ? 'go-to-in' : 'mark-in'
    case 'o':
    case 'O': return event.shiftKey ? 'go-to-out' : 'mark-out'
    case 'x':
    case 'X': return 'clear-range'
    case 'd':
    case 'D': return 'toggle-clip-enabled'
    case 'q':
    case 'Q': return 'trim-start-to-playhead'
    case 'w':
    case 'W': return 'trim-end-to-playhead'
    default: return event.key.toLowerCase() === 's' ? 'split-cue' : null
  }
}
