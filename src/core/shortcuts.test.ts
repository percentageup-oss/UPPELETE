import { describe, expect, it } from 'vitest'
import { shortcutForEvent } from './shortcuts'

function key(key: string, modifiers: Partial<KeyboardEvent> = {}) {
  return { key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...modifiers } as KeyboardEvent
}

describe('shortcut routing', () => {
  it('routes the linked-audio shortcuts: D disables, Cmd/Ctrl+Alt+L links or unlinks', () => {
    expect(shortcutForEvent(key('d'), null)).toBe('toggle-clip-enabled')
    expect(shortcutForEvent(key('l', { metaKey: true, altKey: true }), null)).toBe('toggle-clip-link')
    expect(shortcutForEvent(key('l', { ctrlKey: true, altKey: true }), null)).toBe('toggle-clip-link')
    expect(shortcutForEvent(key('d', { metaKey: true }), null)).toBeNull()
  })

  it('routes each implemented non-editing shortcut', () => {
    expect(shortcutForEvent(key(' '), null)).toBe('toggle-playback')
    expect(shortcutForEvent(key('ArrowLeft'), null)).toBe('seek-backward')
    expect(shortcutForEvent(key('ArrowRight'), null)).toBe('seek-forward')
    expect(shortcutForEvent(key('s'), null)).toBe('split-cue')
    expect(shortcutForEvent(key('Delete'), null)).toBe('delete-cue')
    expect(shortcutForEvent(key('z', { metaKey: true }), null)).toBe('undo')
    expect(shortcutForEvent(key('z', { metaKey: true, shiftKey: true }), null)).toBe('redo')
    expect(shortcutForEvent(key('y', { ctrlKey: true }), null)).toBe('redo')
    expect(shortcutForEvent(key('ArrowUp'), null)).toBe('previous-cue')
    expect(shortcutForEvent(key('ArrowDown'), null)).toBe('next-cue')
    expect(shortcutForEvent(key('b', { metaKey: true }), null)).toBe('split-clips')
    expect(shortcutForEvent(key('B', { ctrlKey: true }), null)).toBe('split-clips')
    expect(shortcutForEvent(key('i'), null)).toBe('mark-in')
    expect(shortcutForEvent(key('O', { shiftKey: true }), null)).toBe('go-to-out')
    expect(shortcutForEvent(key('x'), null)).toBe('clear-range')
    expect(shortcutForEvent(key('i', { metaKey: true }), null)).toBeNull()
    expect(shortcutForEvent(key('q'), null)).toBe('trim-start-to-playhead')
    expect(shortcutForEvent(key('W'), null)).toBe('trim-end-to-playhead')
    expect(shortcutForEvent(key('q', { metaKey: true }), null)).toBeNull()
    expect(shortcutForEvent(key('Delete', { shiftKey: true }), null)).toBe('ripple-delete')
    expect(shortcutForEvent(key('Backspace', { shiftKey: true }), null)).toBe('ripple-delete')
  })

  it('routes Cmd/Ctrl+C and Cmd/Ctrl+V to copy/paste on both macOS and Windows/Linux', () => {
    expect(shortcutForEvent(key('c', { metaKey: true }), null)).toBe('copy-item')
    expect(shortcutForEvent(key('C', { ctrlKey: true }), null)).toBe('copy-item')
    expect(shortcutForEvent(key('v', { metaKey: true }), null)).toBe('paste-item')
    expect(shortcutForEvent(key('V', { ctrlKey: true }), null)).toBe('paste-item')
    expect(shortcutForEvent(key('c'), null)).toBeNull()
    expect(shortcutForEvent(key('c', { metaKey: true }), { tagName: 'INPUT' } as unknown as EventTarget)).toBeNull()
  })

  it('leaves shortcut keys alone in text, timestamp, and contenteditable fields', () => {
    const textarea = { tagName: 'TEXTAREA' } as unknown as EventTarget
    const input = { tagName: 'INPUT' } as unknown as EventTarget
    const editable = { isContentEditable: true } as unknown as EventTarget
    for (const target of [textarea, input, editable]) {
      expect(shortcutForEvent(key('s'), target)).toBeNull()
      expect(shortcutForEvent(key('Delete'), target)).toBeNull()
      expect(shortcutForEvent(key('z', { metaKey: true }), target)).toBeNull()
      expect(shortcutForEvent(key('ArrowRight'), target)).toBeNull()
    }
  })
})

it('opens the shortcut reference with ? outside text fields only', () => {
  expect(shortcutForEvent({ key: '?', ctrlKey: false, metaKey: false, shiftKey: true, altKey: false }, null)).toBe('show-shortcuts')
  expect(shortcutForEvent({ key: '?', ctrlKey: false, metaKey: false, shiftKey: true, altKey: false }, { tagName: 'TEXTAREA' } as unknown as EventTarget)).toBeNull()
})
