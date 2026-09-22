import { useEffect, useState, type DragEvent } from 'react'
import type { ProjectAsset } from './core/edit'
import { ASSET_DRAG_TYPE, clearDragPayload, dropContent, setDragPayload, type AssetDragPayload } from './core/dragPayload'
import { formatClock } from './core/time'
import { AudioIcon, VideoIcon } from './TimelineIcons'
import { OverlaysIcon } from './RailIcons'

type AssetIssue = 'missing' | 'mismatch'
type SourceThumbnail = { kind: 'idle' } | { kind: 'loading' } | { kind: 'ready'; url: string } | { kind: 'error' }

export function MediaBin({
  assets, assetUrls, assetIssues, useCountByAsset, videoReady,
  onImportFiles, onDropFiles, onAddVideo, onAddOverlayAtPlayhead, onAddSfxAtPlayhead, onRemoveAsset, onRelinkAsset,
}: {
  assets: readonly ProjectAsset[]
  assetUrls: Map<string, string>
  assetIssues: Map<string, AssetIssue>
  /** Clips playing each asset plus captions bound to it: an asset in use cannot be removed. */
  useCountByAsset: Map<string, number>
  /** Whether a video's file is available to play this session. */
  videoReady: (asset: ProjectAsset) => boolean
  onImportFiles: () => void
  onDropFiles: (files: File[]) => void
  /** Appends the video to the end of V1. */
  onAddVideo: (asset: ProjectAsset) => void
  onAddOverlayAtPlayhead: (asset: ProjectAsset) => void
  onAddSfxAtPlayhead: (asset: ProjectAsset) => void
  onRemoveAsset: (assetId: string) => void
  onRelinkAsset: (assetId: string) => void
}) {
  const [dragOver, setDragOver] = useState(false)
  const videoAssets = assets.filter((asset) => asset.kind === 'video')
  const imageAssets = assets.filter((asset) => asset.kind === 'image')
  const audioAssets = assets.filter((asset) => asset.kind === 'audio')
  const isEmpty = !assets.length
  const inUseTitle = (count: number) => count > 0 ? `In use by ${count} clip${count === 1 ? '' : 's'} or caption${count === 1 ? '' : 's'}` : 'Remove from project'

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
      {videoAssets.map((asset) => <VideoRow key={asset.id} asset={asset} ready={videoReady(asset)} inUse={useCountByAsset.get(asset.id) ?? 0}
        onDragStart={beginDrag({ source: 'bin', assetId: asset.id, kind: 'video', name: asset.name, durationUs: asset.metadata?.durationUs ?? null })}
        onAdd={() => onAddVideo(asset)} onRelink={() => onRelinkAsset(asset.id)} onRemove={() => onRemoveAsset(asset.id)} inUseTitle={inUseTitle} />)}
      {imageAssets.map((asset) => {
        const issue = assetIssues.get(asset.id) ?? null
        const inUse = useCountByAsset.get(asset.id) ?? 0
        return <div key={asset.id} className="bin-item" draggable
          onDragStart={beginDrag({ source: 'bin', assetId: asset.id, kind: 'image', name: asset.name, durationUs: null })}
          onDragEnd={() => clearDragPayload()}>
          <span className="bin-item-thumb">{assetUrls.get(asset.id) ? <img src={assetUrls.get(asset.id)} alt="" /> : <OverlaysIcon />}</span>
          <span className="bin-item-text"><strong>{asset.name}</strong>{issue && <small className="bin-item-issue">{issue === 'missing' ? 'File missing' : 'File changed'}</small>}</span>
          <span className="bin-item-actions">
            <button type="button" onClick={() => onAddOverlayAtPlayhead(asset)} title="Place this image over the video at the playhead">Add</button>
            {issue && <button type="button" onClick={() => onRelinkAsset(asset.id)}>Relink</button>}
            <button type="button" className="danger" disabled={inUse > 0} title={inUseTitle(inUse)} onClick={() => onRemoveAsset(asset.id)}>Remove</button>
          </span>
        </div>
      })}
      {audioAssets.map((asset) => {
        const issue = assetIssues.get(asset.id) ?? null
        const inUse = useCountByAsset.get(asset.id) ?? 0
        return <div key={asset.id} className="bin-item" draggable
          onDragStart={beginDrag({ source: 'bin', assetId: asset.id, kind: 'audio', name: asset.name, durationUs: asset.metadata?.durationUs ?? null })}
          onDragEnd={() => clearDragPayload()}>
          <span className="bin-item-thumb"><AudioIcon /></span>
          <span className="bin-item-text"><strong>{asset.name}</strong>
            <small>{asset.metadata?.durationUs != null ? formatClock(asset.metadata.durationUs) : 'Duration unknown'}{issue ? ` · ${issue === 'missing' ? 'File missing' : 'File changed'}` : ''}</small>
          </span>
          <span className="bin-item-actions">
            <button type="button" onClick={() => onAddSfxAtPlayhead(asset)} title="Place this sound on an audio track at the playhead">Add</button>
            {issue && <button type="button" onClick={() => onRelinkAsset(asset.id)}>Relink</button>}
            <button type="button" className="danger" disabled={inUse > 0} title={inUseTitle(inUse)} onClick={() => onRemoveAsset(asset.id)}>Remove</button>
          </span>
        </div>
      })}
    </div>
    <div className="bin-footer">
      <button type="button" className="accent" onClick={onImportFiles}>Import…</button>
    </div>
  </div>
}

/** A video in the project: a thumbnail, its length and offline state. "Add" appends it to the end of
 * V1; dragging it onto the timeline places it where it is dropped. */
function VideoRow({ asset, ready, inUse, inUseTitle, onDragStart, onAdd, onRelink, onRemove }: {
  asset: ProjectAsset; ready: boolean; inUse: number; inUseTitle: (count: number) => string
  onDragStart: (event: DragEvent) => void; onAdd: () => void; onRelink: () => void; onRemove: () => void
}) {
  const [thumbnail, setThumbnail] = useState<SourceThumbnail>({ kind: 'idle' })
  const durationUs = asset.metadata?.durationUs ?? null
  useEffect(() => {
    const api = window.captionStudio
    const fingerprint = asset.fingerprint
    if (!api || !fingerprint || !durationUs || !ready) { setThumbnail({ kind: 'idle' }); return }
    const requestId = crypto.randomUUID()
    let cancelled = false
    setThumbnail({ kind: 'loading' })
    void api.loadThumbnails({ requestId, fingerprint, timestampsUs: [Math.round(durationUs / 10)], width: 160 })
      .then((result) => { if (!cancelled && result.thumbnails[0]) setThumbnail({ kind: 'ready', url: result.thumbnails[0].dataUrl }) })
      .catch(() => { if (!cancelled) setThumbnail({ kind: 'error' }) })
    return () => { cancelled = true; void api.cancelThumbnails(requestId).catch(() => {}) }
  }, [asset.fingerprint?.value, durationUs, ready])
  return <div className="bin-item bin-item-source" draggable={ready} onDragStart={onDragStart} onDragEnd={() => clearDragPayload()}>
    <span className="bin-item-thumb">{thumbnail.kind === 'ready' ? <img src={thumbnail.url} alt="" /> : <VideoIcon />}</span>
    <span className="bin-item-text"><strong>{asset.name}</strong>
      <small>{durationUs != null ? formatClock(durationUs) : 'Duration unknown'}{ready ? '' : ' · Offline'}</small>
    </span>
    <span className="bin-item-actions">
      {ready ? <button type="button" onClick={onAdd} title="Add this video to the end of V1">Add</button> : <button type="button" onClick={onRelink}>Relink</button>}
      <button type="button" className="danger" disabled={inUse > 0} title={inUseTitle(inUse)} onClick={onRemove}>Remove</button>
    </span>
  </div>
}
