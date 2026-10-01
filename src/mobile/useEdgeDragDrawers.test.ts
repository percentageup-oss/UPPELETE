import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import { useEdgeDragDrawers } from './useEdgeDragDrawers'

function TestComponent({ forceMobile }: { forceMobile?: boolean }) {
  const drawers = useEdgeDragDrawers(899, forceMobile)
  return createElement(
    'div',
    {
      'data-testid': 'drawer-test',
      'data-active': drawers.activeDrawer ?? 'none',
      style: drawers.getDrawerStyle('left'),
    },
    'Test'
  )
}

describe('useEdgeDragDrawers', () => {
  it('renders with initial closed style when in mobile mode', () => {
    const html = renderToStaticMarkup(createElement(TestComponent, { forceMobile: true }))
    expect(html).toContain('data-active="none"')
    expect(html).toContain('transform:translateX(-100%)')
  })

  it('renders with desktop style when in desktop mode', () => {
    const html = renderToStaticMarkup(createElement(TestComponent, { forceMobile: false }))
    expect(html).toContain('data-active="none"')
    expect(html).not.toContain('transform:translateX(-100%)')
  })
})
