import { describe, expect, it } from 'vitest'
import { shortcutForEvent } from './shortcuts'

function key(key: string, modifiers: Partial<KeyboardEvent> = {}) {
  return { key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...modifiers } as KeyboardEvent
}

describe('shortcut routing', () => {
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
