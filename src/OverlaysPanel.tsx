import type { DragEvent } from 'react'
import type { ProjectAsset } from './core/edit'
import { ASSET_DRAG_TYPE, clearDragPayload, setDragPayload, type AssetDragPayload } from './core/dragPayload'
import { OverlaysIcon } from './RailIcons'

/** Image assets as a drag-friendly grid, dedicated to overlay placement — the same assets MediaBin
 * lists, in the layout that fits picking one to drop on the stage or timeline. */
export function OverlaysPanel({ assets, assetUrls, onAddAtPlayhead, onImportAndAdd, mediaReady }: {
  assets: readonly ProjectAsset[]
  assetUrls: Map<string, string>
  onAddAtPlayhead: (asset: ProjectAsset) => void
  onImportAndAdd: () => void
  mediaReady: boolean
}) {
  const images = assets.filter((asset) => asset.kind === 'image')
  return <div className="overlays-panel">
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
