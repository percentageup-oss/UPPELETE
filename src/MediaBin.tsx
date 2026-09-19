import { useEffect, useState, type DragEvent } from 'react'
import type { ProjectAsset } from './core/edit'
import type { ProjectMedia } from './core/media'
import { ASSET_DRAG_TYPE, clearDragPayload, dropContent, setDragPayload, type AssetDragPayload } from './core/dragPayload'
import { formatClock } from './core/time'
import { AudioIcon, VideoIcon } from './TimelineIcons'
import { OverlaysIcon } from './RailIcons'

type AssetIssue = 'missing' | 'mismatch'
type SourceThumbnail = { kind: 'idle' } | { kind: 'loading' } | { kind: 'ready'; url: string } | { kind: 'error' }

export function MediaBin({
  media, videoReady, mediaDurationUs, assets, assetUrls, assetIssues, overlayCountByAsset, audioCountByAsset,
  onImportFiles, onDropFiles, onAddOverlayAtPlayhead, onAddSfxAtPlayhead, onRemoveAsset, onRelinkAsset, onRelinkMedia,
}: {
  media: ProjectMedia | null
  videoReady: boolean
  mediaDurationUs: number | null
  assets: readonly ProjectAsset[]
  assetUrls: Map<string, string>
  assetIssues: Map<string, AssetIssue>
  overlayCountByAsset: Map<string, number>
  audioCountByAsset: Map<string, number>
  onImportFiles: () => void
  onDropFiles: (files: File[]) => void
  onAddOverlayAtPlayhead: (asset: ProjectAsset) => void
  onAddSfxAtPlayhead: (asset: ProjectAsset) => void
  onRemoveAsset: (assetId: string) => void
  onRelinkAsset: (assetId: string) => void
  onRelinkMedia: () => void
}) {
  const [dragOver, setDragOver] = useState(false)
  const imageAssets = assets.filter((asset) => asset.kind === 'image')
  const audioAssets = assets.filter((asset) => asset.kind === 'audio')
  const isEmpty = !media && !assets.length

  const beginDrag = (payload: AssetDragPayload) => (event: DragEvent) => {
    setDragPayload(payload)
    event.dataTransfer.effectAllowed = 'copy'
    event.dataTransfer.setData(ASSET_DRAG_TYPE, JSON.stringify(payload))
  }

  return <div className="media-bin">
    <div className={`media-bin-list ${dragOver ? 'over' : ''}`}
      onDragOver={(event) => {
        if (dropContent(event.dataTransfer)?.kind !== 'files') return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => {
        const content = dropContent(event.dataTransfer)
        if (content?.kind !== 'files') return
        event.preventDefault()
        setDragOver(false)
        if (content.files.length) onDropFiles(content.files)
      }}>
      {isEmpty && <p className="bin-empty">Import media or drop files here.</p>}
      {media && <SourceRow media={media} videoReady={videoReady} mediaDurationUs={mediaDurationUs} onRelink={onRelinkMedia} />}
      {imageAssets.map((asset) => {
        const issue = assetIssues.get(asset.id) ?? null
        const inUse = overlayCountByAsset.get(asset.id) ?? 0
        return <div key={asset.id} className="bin-item" draggable
          onDragStart={beginDrag({ source: 'bin', assetId: asset.id, kind: 'image', name: asset.name, durationUs: null })}
          onDragEnd={() => clearDragPayload()}>
          <span className="bin-item-thumb">{assetUrls.get(asset.id) ? <img src={assetUrls.get(asset.id)} alt="" /> : <OverlaysIcon />}</span>
          <span className="bin-item-text"><strong>{asset.name}</strong>{issue && <small className="bin-item-issue">{issue === 'missing' ? 'File missing' : 'File changed'}</small>}</span>
          <span className="bin-item-actions">
            <button type="button" onClick={() => onAddOverlayAtPlayhead(asset)} title="Add an overlay at the playhead">Add</button>
            {issue && <button type="button" onClick={() => onRelinkAsset(asset.id)}>Relink</button>}
            <button type="button" className="danger" disabled={inUse > 0}
              title={inUse > 0 ? `In use by ${inUse} overlay${inUse === 1 ? '' : 's'}` : 'Remove from project'}
              onClick={() => onRemoveAsset(asset.id)}>Remove</button>
          </span>
        </div>
      })}
      {audioAssets.map((asset) => {
        const issue = assetIssues.get(asset.id) ?? null
        const inUse = audioCountByAsset.get(asset.id) ?? 0
        return <div key={asset.id} className="bin-item" draggable
          onDragStart={beginDrag({ source: 'bin', assetId: asset.id, kind: 'audio', name: asset.name, durationUs: asset.metadata?.durationUs ?? null })}
          onDragEnd={() => clearDragPayload()}>
          <span className="bin-item-thumb"><AudioIcon /></span>
          <span className="bin-item-text"><strong>{asset.name}</strong>
            <small>{asset.metadata?.durationUs != null ? formatClock(asset.metadata.durationUs) : 'Duration unknown'}{issue ? ` · ${issue === 'missing' ? 'File missing' : 'File changed'}` : ''}</small>
          </span>
          <span className="bin-item-actions">
            <button type="button" onClick={() => onAddSfxAtPlayhead(asset)} title="Add a sound effect at the playhead">Add</button>
            {issue && <button type="button" onClick={() => onRelinkAsset(asset.id)}>Relink</button>}
            <button type="button" className="danger" disabled={inUse > 0}
              title={inUse > 0 ? `In use by ${inUse} sound effect${inUse === 1 ? '' : 's'}` : 'Remove from project'}
              onClick={() => onRemoveAsset(asset.id)}>Remove</button>
          </span>
        </div>
      })}
    </div>
    <div className="bin-footer">
      <button type="button" className="accent" onClick={onImportFiles}>Import…</button>
    </div>
  </div>
}

/** The project's primary video. Shown for context (thumbnail, name, offline state) but not a drag
 * source: replacing the open video with itself has no effect. It is a `video` asset in the project,
 * listed here rather than among the image/audio rows; until the multi-clip timeline lands (ticket V7)
 * a second video import goes through the replace-source flow instead of becoming a bin row. */
function SourceRow({ media, videoReady, mediaDurationUs, onRelink }: { media: ProjectMedia; videoReady: boolean; mediaDurationUs: number | null; onRelink: () => void }) {
  const [thumbnail, setThumbnail] = useState<SourceThumbnail>({ kind: 'idle' })
  useEffect(() => {
    const api = window.captionStudio
    const fingerprint = media.fingerprint
    const duration = mediaDurationUs ?? media.metadata?.durationUs ?? null
    if (!api || !fingerprint || !duration) { setThumbnail({ kind: 'idle' }); return }
    const requestId = crypto.randomUUID()
    let cancelled = false
    setThumbnail({ kind: 'loading' })
    void api.loadThumbnails({ requestId, fingerprint, timestampsUs: [Math.round(duration / 10)], width: 160 })
      .then((result) => { if (!cancelled && result.thumbnails[0]) setThumbnail({ kind: 'ready', url: result.thumbnails[0].dataUrl }) })
      .catch(() => { if (!cancelled) setThumbnail({ kind: 'error' }) })
    return () => { cancelled = true; void api.cancelThumbnails(requestId).catch(() => {}) }
  }, [media.fingerprint, mediaDurationUs, media.metadata?.durationUs])
  return <div className="bin-item bin-item-source">
    <span className="bin-item-thumb">{thumbnail.kind === 'ready' ? <img src={thumbnail.url} alt="" /> : <VideoIcon />}</span>
    <span className="bin-item-text"><strong>{media.name}</strong>
      <small>{mediaDurationUs != null ? formatClock(mediaDurationUs) : 'Duration unknown'}{videoReady ? '' : ' · Offline'}</small>
    </span>
    {!videoReady && <span className="bin-item-actions"><button type="button" onClick={onRelink}>Relink</button></span>}
  </div>
}
