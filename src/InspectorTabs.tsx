import { useState, type ReactNode } from 'react'

export type InspectorTab = 'edit' | 'style'
const TABS: { id: InspectorTab; label: string }[] = [
  { id: 'edit', label: 'Edit' }, { id: 'style', label: 'Text' },
]

/** A standard roving-tabindex tablist: only the active tab is in the tab order, Left/Right/Home/End
 * move focus and selection together, and only the selected panel is rendered. Templates moved to
 * the left rail's Transitions tab (TransitionsPanel.tsx), so this is Edit/Style only. */
export function InspectorTabs({ active, onChange, edit, style }: {
  active: InspectorTab; onChange: (tab: InspectorTab) => void
  edit: ReactNode; style: ReactNode
}) {
  const [focused, setFocused] = useState(active)
  const move = (delta: number) => {
    const index = TABS.findIndex((tab) => tab.id === focused)
    const next = TABS[(index + delta + TABS.length) % TABS.length].id
    setFocused(next)
    onChange(next)
    document.getElementById(`inspector-tab-${next}`)?.focus()
  }
  const panels: Record<InspectorTab, ReactNode> = { edit, style }
  return <>
    <div role="tablist" aria-label="Inspector" className="inspector-tabs" onKeyDown={(event) => {
      if (event.key === 'ArrowRight') { event.preventDefault(); move(1) }
      else if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1) }
      else if (event.key === 'Home') { event.preventDefault(); setFocused(TABS[0].id); onChange(TABS[0].id); document.getElementById(`inspector-tab-${TABS[0].id}`)?.focus() }
      else if (event.key === 'End') { event.preventDefault(); setFocused(TABS.at(-1)!.id); onChange(TABS.at(-1)!.id); document.getElementById(`inspector-tab-${TABS.at(-1)!.id}`)?.focus() }
    }}>
      {TABS.map((tab) => <button key={tab.id} id={`inspector-tab-${tab.id}`} role="tab" type="button"
        className={`inspector-tab ${active === tab.id ? 'active' : ''}`}
        aria-selected={active === tab.id} aria-controls={`inspector-panel-${tab.id}`}
        tabIndex={active === tab.id ? 0 : -1}
        onClick={() => { setFocused(tab.id); onChange(tab.id) }}>{tab.label}</button>)}
    </div>
    <div id={`inspector-panel-${active}`} role="tabpanel" aria-labelledby={`inspector-tab-${active}`} className="inspector-tabpanel">
      {panels[active]}
    </div>
  </>
}
