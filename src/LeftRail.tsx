import { useState } from 'react'
import { CaptionsIcon } from './TimelineIcons'
import { ColorIcon, EffectsIcon, LayersIcon, MediaBinIcon, OverlaysIcon, SettingsIcon, TitlesIcon } from './RailIcons'

export type RailTab = 'media' | 'captions' | 'overlays' | 'titles' | 'effects' | 'color' | 'layers'

const TABS: { id: RailTab; label: string; icon: (props: { className?: string }) => React.ReactNode }[] = [
  { id: 'media', label: 'Media', icon: (props) => <MediaBinIcon {...props} /> },
  { id: 'captions', label: 'Captions', icon: (props) => <CaptionsIcon {...props} /> },
  { id: 'overlays', label: 'Overlays', icon: (props) => <OverlaysIcon {...props} /> },
  { id: 'titles', label: 'Titles', icon: (props) => <TitlesIcon {...props} /> },
  { id: 'effects', label: 'Effects', icon: (props) => <EffectsIcon {...props} /> },
  { id: 'color', label: 'Color', icon: (props) => <ColorIcon {...props} /> },
  { id: 'layers', label: 'Layers', icon: (props) => <LayersIcon {...props} /> },
]

/** A vertical icon rail, CapCut-style: a roving-tabindex tablist (Up/Down/Home/End move focus and
 * selection together, same pattern as InspectorTabs.tsx) plus a Settings button that is not part of
 * the tablist — it opens a dialog rather than switching a panel. */
export function LeftRail({ active, onChange, onSettings }: { active: RailTab; onChange: (tab: RailTab) => void; onSettings: () => void }) {
  const [focused, setFocused] = useState(active)
  const move = (delta: number) => {
    const index = TABS.findIndex((tab) => tab.id === focused)
    const next = TABS[(index + delta + TABS.length) % TABS.length].id
    setFocused(next)
    onChange(next)
    document.getElementById(`rail-tab-${next}`)?.focus()
  }
  return <nav className="left-rail" aria-label="Panels">
    <div role="tablist" aria-label="Panels" aria-orientation="vertical" onKeyDown={(event) => {
      if (event.key === 'ArrowDown') { event.preventDefault(); move(1) }
      else if (event.key === 'ArrowUp') { event.preventDefault(); move(-1) }
      else if (event.key === 'Home') { event.preventDefault(); setFocused(TABS[0].id); onChange(TABS[0].id); document.getElementById(`rail-tab-${TABS[0].id}`)?.focus() }
      else if (event.key === 'End') { event.preventDefault(); setFocused(TABS.at(-1)!.id); onChange(TABS.at(-1)!.id); document.getElementById(`rail-tab-${TABS.at(-1)!.id}`)?.focus() }
    }}>
      {TABS.map((tab) => <button key={tab.id} id={`rail-tab-${tab.id}`} role="tab" type="button"
        className={`rail-tab ${active === tab.id ? 'active' : ''}`}
        aria-selected={active === tab.id} aria-controls={`rail-panel-${tab.id}`}
        tabIndex={active === tab.id ? 0 : -1}
        onClick={() => { setFocused(tab.id); onChange(tab.id) }}>
        {tab.icon({})}<span>{tab.label}</span>
      </button>)}
    </div>
    <button type="button" className="rail-settings" aria-label="Settings" title="Settings: speech models, Gemini API key, shortcuts" onClick={onSettings}>
      <SettingsIcon /><span>Settings</span>
    </button>
  </nav>
}
