import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import { ContextMenu } from './ContextMenu'

test('renders actions, separators, shortcuts and disabled reasons at the pointer', () => {
  const html = renderToStaticMarkup(<ContextMenu x={40} y={60} onClose={() => {}} entries={[
    { id: 'a', label: 'Unlink (2 clips)', onSelect: () => {}, shortcut: '⌘⌥L' },
    { id: 's', separator: true },
    { id: 'b', label: 'Split at playhead', onSelect: () => {}, disabledReason: 'Move the playhead onto this clip' },
  ]} />)
  expect(html).toContain('role="menu"')
  expect(html).toContain('left:40px;top:60px')
  expect(html).toContain('Unlink (2 clips)')
  expect(html).toContain('role="separator"')
  expect(html).toMatch(/aria-disabled="true"[^>]*title="Move the playhead onto this clip"/)
})
