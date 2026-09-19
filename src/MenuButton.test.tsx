import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MenuButton } from './MenuButton'

const entries = [
  { id: 'open', label: 'Open project…', onSelect: () => {}, shortcut: '⌘O' },
  { id: 'sep', separator: true as const },
  { id: 'export', label: 'Export video', onSelect: () => {}, disabledReason: 'Open or relink the video first' },
]

it('renders a collapsed menu button without the popup', () => {
  const html = renderToStaticMarkup(<MenuButton label="File" entries={entries} />)
  expect(html).toContain('aria-haspopup="menu"')
  expect(html).toContain('aria-expanded="false"')
  expect(html).not.toContain('role="menu"')
})

it('renders items, separators, shortcuts and the reason a disabled item is unavailable', () => {
  const html = renderToStaticMarkup(<MenuButton label="File" entries={entries} initiallyOpen />)
  expect(html).toContain('aria-expanded="true"')
  expect(html).toContain('role="menu"')
  expect(html.match(/role="menuitem"/g)).toHaveLength(2)
  expect(html).toContain('role="separator"')
  expect(html).toContain('<kbd>⌘O</kbd>')
  expect(html).toMatch(/aria-disabled="true"[^>]*title="Open or relink the video first"/)
  expect(html).toContain('<small>Open or relink the video first</small>')
})
