import { useState, type DragEvent } from 'react'
import { AccordionSection } from './AccordionSection'
import { clearDragPayload, COLOR_DRAG_TYPE, setDragPayload, type ColorDragPayload } from './core/dragPayload'
import { NEUTRAL_GRADE } from './color/bake'
import { LOOKS } from './color/looks'
import { lookSwatchGradient } from './color/lookSwatch'
import type { LogProfile } from './color/transfer'
import type { Grade, ProjectAsset } from './core/edit'
import type { AssetIssue } from './app/useAssetUrls'

const LOG_PROFILES: { profile: LogProfile; label: string }[] = [
  { profile: 'f-log', label: 'F-Log' },
  { profile: 'f-log2', label: 'F-Log2' },
  { profile: 's-log3', label: 'S-Log3' },
  { profile: 'apple-log', label: 'Apple Log' },
  { profile: 'v-log', label: 'V-Log' },
  { profile: 'c-log3', label: 'C-Log3' },
]

/** A draggable/clickable Color tile: drag creates an adjustment clip where it lands, a click adds one
 * at the playhead on the top video track (`onAddAtPlayhead`, `docs/EDITING.md` "Color: adjustment
 * layers"). Shared by every section below — only the tile's own content and starting `grade` differ. */
function ColorTile({ grade, className, title, onAddAtPlayhead, style, children }: {
  grade: Grade
  className: string
  title: string
  onAddAtPlayhead: (grade: Grade) => void
  style?: React.CSSProperties
  children: React.ReactNode
}) {
  const payload: ColorDragPayload = { source: 'color', grade }
  const beginDrag = (event: DragEvent) => {
    setDragPayload(payload)
    event.dataTransfer.effectAllowed = 'copy'
    event.dataTransfer.setData(COLOR_DRAG_TYPE, JSON.stringify(payload))
  }
  return <button type="button" className={`overlay-tile ${className}`} style={style} draggable
    onDragStart={beginDrag} onDragEnd={() => clearDragPayload()} onClick={() => onAddAtPlayhead(grade)} title={title}>
    {children}
  </button>
}

/**
 * The left-rail Color tab: a library of adjustment-layer starting points, each a DaVinci-style
 * clip that grades every picture clip on the tracks below it for its own time range (docs/EDITING.md
 * "Color: adjustment layers") — a blank layer, the six built-in camera log profiles, the bundled film
 * looks, and any `.cube` LUT the user has imported.
 */
export function ColorPanel({ lutAssets, lutIssues, onAddAtPlayhead, onImportLut, onRelinkLut }: {
  lutAssets: readonly ProjectAsset[]
  lutIssues: ReadonlyMap<string, AssetIssue>
  onAddAtPlayhead: (grade: Grade) => void
  onImportLut: () => void
  onRelinkLut: (assetId: string) => void
}) {
  const [openId, setOpenId] = useState<string | null>('Adjustment layer')
  const toggle = (id: string) => setOpenId((current) => (current === id ? null : id))
  return <div className="overlays-panel zoom-panel">
    <div className="effects-sections">
      <AccordionSection id="Adjustment layer" title="Adjustment layer" count={1} open={openId === 'Adjustment layer'} onToggle={toggle}>
        <div className="overlays-grid">
          <ColorTile grade={NEUTRAL_GRADE} className="adjustment-tile" title="Add a blank adjustment layer at the playhead" onAddAtPlayhead={onAddAtPlayhead}>
            <span>Adjustment layer</span><small>Grades every clip below it — set it up in the Edit tab</small>
          </ColorTile>
        </div>
      </AccordionSection>
      <AccordionSection id="Camera log → Rec.709" title="Camera log → Rec.709" count={LOG_PROFILES.length} open={openId === 'Camera log → Rec.709'} onToggle={toggle}>
        <div className="overlays-grid">
          {LOG_PROFILES.map(({ profile, label }) => <ColorTile key={profile} grade={{ ...NEUTRAL_GRADE, input: { type: 'log', profile } }}
            className="log-tile" title={`Add a ${label} → Rec.709 adjustment layer at the playhead`} onAddAtPlayhead={onAddAtPlayhead}>
            <span>{label}</span><small>Decodes {label} to Rec.709 before any other grading</small>
          </ColorTile>)}
        </div>
      </AccordionSection>
      <AccordionSection id="Film looks" title="Film looks" count={LOOKS.length} open={openId === 'Film looks'} onToggle={toggle}>
        <div className="overlays-grid">
          {LOOKS.map((look) => <ColorTile key={look.id} grade={{ ...NEUTRAL_GRADE, look: { id: look.id, strength: 1 } }}
            className="film-look-tile" style={{ background: lookSwatchGradient(look.id) }}
            title={`Add ${look.name} at the playhead`} onAddAtPlayhead={onAddAtPlayhead}>
            <span>{look.name}</span><small>{look.description}</small>
          </ColorTile>)}
        </div>
      </AccordionSection>
      <AccordionSection id="My LUTs" title="My LUTs" count={lutAssets.length} open={openId === 'My LUTs'} onToggle={toggle}>
        {lutAssets.length === 0 && <p className="bin-empty">Import a .cube LUT to use it as an adjustment layer.</p>}
        {lutAssets.map((asset) => {
          const issue = lutIssues.get(asset.id) ?? null
          const grade: Grade = { ...NEUTRAL_GRADE, input: { type: 'lut', assetId: asset.id } }
          return <div key={asset.id} className="bin-item" draggable={!issue}
            onDragStart={(event) => {
              if (issue) { event.preventDefault(); return }
              const payload: ColorDragPayload = { source: 'color', grade }
              setDragPayload(payload)
              event.dataTransfer.effectAllowed = 'copy'
              event.dataTransfer.setData(COLOR_DRAG_TYPE, JSON.stringify(payload))
            }}
            onDragEnd={() => clearDragPayload()}>
            <span className="bin-item-thumb" aria-hidden="true" />
            <span className="bin-item-text"><strong>{asset.name}</strong>
              {issue && <small className="bin-item-issue">{issue === 'missing' ? 'File missing' : 'File changed'}</small>}
            </span>
            <span className="bin-item-actions">
              {issue
                ? <button type="button" onClick={() => onRelinkLut(asset.id)}>Relink</button>
                : <button type="button" onClick={() => onAddAtPlayhead(grade)} title="Add this LUT as an adjustment layer at the playhead">Add</button>}
            </span>
          </div>
        })}
        <div className="bin-footer"><button type="button" onClick={onImportLut}>Import .cube…</button></div>
      </AccordionSection>
    </div>
    <div className="bin-footer"><p>Drag a tile onto a clip to grade it, onto empty space for its own layer, or click to add it at the playhead. Select an adjustment layer on the timeline to adjust it.</p></div>
  </div>
}
