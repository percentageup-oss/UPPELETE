import { useState, type DragEvent } from 'react'
import type { ProjectAsset } from './core/edit'
import { ASSET_DRAG_TYPE, clearDragPayload, setDragPayload, type AssetDragPayload } from './core/dragPayload'
import { OverlaysIcon } from './RailIcons'
import type { ShapePreset } from './core/shapeCommands'
import { SHAPE_PREVIEWS } from './ShapeIcons'
import { TEMPLATE_CATEGORIES, listTemplates } from './core/overlayTemplateCatalog'
import type { TemplateCategory } from './core/overlayTemplates'
import { TemplateThumbnail } from './TemplateThumbnail'

const SHAPE_TILES: { preset: ShapePreset; label: string }[] = [
  { preset: 'box', label: 'Box' }, { preset: 'circle', label: 'Circle' }, { preset: 'arrow', label: 'Arrow' },
  { preset: 'dotted-arrow', label: 'Dotted arrow' }, { preset: 'underline', label: 'Underline' }, { preset: 'highlight', label: 'Highlighter' },
]

/** Image assets as a drag-friendly grid, dedicated to overlay placement — the same assets MediaBin
 * lists, in the layout that fits picking one to drop on the stage or timeline. */
export function OverlaysPanel({ assets, assetUrls, onAddAtPlayhead, onImportAndAdd, mediaReady, onAddShape, onAddTemplate }: {
  assets: readonly ProjectAsset[]
  assetUrls: Map<string, string>
  onAddAtPlayhead: (asset: ProjectAsset) => void
  onImportAndAdd: () => void
  mediaReady: boolean
  onAddShape?: (preset: ShapePreset) => void
  /** Inserts a template as one group at the playhead; `glass` asks for the Liquid Glass look where the template supports it. */
  onAddTemplate?: (templateId: string, glass: boolean) => void
}) {
  const [category, setCategory] = useState<TemplateCategory>('chat')
  const [glass, setGlass] = useState(false)
  const images = assets.filter((asset) => asset.kind === 'image')
  return <div className="overlays-panel">
    {onAddShape && <div className="overlays-shapes" role="group" aria-label="Shapes">
      <p className="style-subgroup">Shapes</p>
      <div className="overlays-grid">
        {SHAPE_TILES.map(({ preset, label }) => <button key={preset} type="button" className="overlay-tile" onClick={() => onAddShape(preset)} title={`Add ${label.toLowerCase()} at the playhead`}>
          {SHAPE_PREVIEWS[preset]()}
          <span>{label}</span>
        </button>)}
      </div>
    </div>}
    {onAddTemplate && <div className="overlays-templates" role="group" aria-label="Templates">
      <div className="overlays-templates-head">
        <p className="style-subgroup">Templates</p>
        <label className="overlays-glass" title="Give glass-capable templates the Liquid Glass look"><input type="checkbox" checked={glass} onChange={(event) => setGlass(event.target.checked)} /> Glass</label>
      </div>
      <div className="overlays-tabs" role="tablist" aria-label="Template categories">
        {TEMPLATE_CATEGORIES.map(({ id, label }) => <button key={id} type="button" role="tab" aria-selected={category === id} className={category === id ? 'active' : ''} onClick={() => setCategory(id)}>{label}</button>)}
      </div>
      <div className="overlays-grid">
        {listTemplates().filter((template) => template.category === category).map((template) => <button key={template.id} type="button" className="overlay-tile" onClick={() => onAddTemplate(template.id, glass)}
          title={`${template.description} Adds it at the playhead as one group.`}>
          <TemplateThumbnail template={template} />
          <span>{template.name}</span>
          {template.supportsGlass && <em className="overlay-tile-tag">Liquid Glass</em>}
        </button>)}
      </div>
    </div>}
    <div className="overlays-grid">
      {!images.length && <p className="bin-empty">No image overlays yet.</p>}
      {images.map((asset) => {
        const payload: AssetDragPayload = { source: 'bin', assetId: asset.id, kind: 'image', name: asset.name, durationUs: null }
        const beginDrag = (event: DragEvent) => {
          setDragPayload(payload)
          event.dataTransfer.effectAllowed = 'copy'
          event.dataTransfer.setData(ASSET_DRAG_TYPE, JSON.stringify(payload))
        }
        return <button key={asset.id} type="button" className="overlay-tile" draggable
          onDragStart={beginDrag} onDragEnd={() => clearDragPayload()}
          onClick={() => onAddAtPlayhead(asset)} title={`Add ${asset.name} at the playhead`}>
          {assetUrls.get(asset.id) ? <img src={assetUrls.get(asset.id)} alt="" /> : <OverlaysIcon />}
          <span>{asset.name}</span>
        </button>
      })}
    </div>
    <div className="bin-footer">
      <button type="button" className="accent" onClick={onImportAndAdd} disabled={!mediaReady}
        title={mediaReady ? 'Import an image and add it at the playhead' : 'Open or relink the video first'}>Add image overlay…</button>
    </div>
  </div>
}
