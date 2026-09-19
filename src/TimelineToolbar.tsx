import { CollapseIcon, ExpandIcon, MagnetIcon, MergeIcon, NextIcon, PlayheadIcon, PlusIcon, PrevIcon, ScissorsIcon, TrashIcon, TrimIcon, ZoomInIcon, ZoomOutIcon } from './TimelineIcons'
import type { CaptionDisplay } from './captions/wordDisplay'

export type TrackMode = CaptionDisplay

/** Editing commands stay owned by App; the toolbar only renders and disables them. */
export type TimelineActions = {
  addLine: () => void
  addWord: () => void
  merge: () => void
  previous: () => void
  next: () => void
  delete: () => void
  split: () => void
  trim: () => void
}

type TimelineToolbarProps = {
  mode: TrackMode
  onMode: (mode: TrackMode) => void
  snap: boolean
  onSnap: (snap: boolean) => void
  zoom: number
  zoomMin: number
  zoomMax: number
  onZoom: (zoom: number) => void
  expanded: boolean
  onExpand: (expanded: boolean) => void
  onCenterPlayhead: () => void
  actions: TimelineActions
  hasSelection: boolean
  canMerge: boolean
  canSplit: boolean
  canAdd: boolean
  hasCues: boolean
  hasSelectedWord: boolean
}

export function TimelineToolbar({ mode, onMode, snap, onSnap, zoom, zoomMin, zoomMax, onZoom, expanded, onExpand, onCenterPlayhead, actions, hasSelection, canMerge, canSplit, canAdd, hasCues, hasSelectedWord }: TimelineToolbarProps) {
  return <div className="timeline-toolbar" role="toolbar" aria-label="Timeline tools">
    <div className="mode-toggle" role="group" aria-label="Caption track mode">
      <button type="button" className={mode === 'word' ? 'active' : ''} aria-pressed={mode === 'word'} onClick={() => onMode('word')} title="Show one block per timed word">WORD</button>
      <button type="button" className={mode === 'line' ? 'active' : ''} aria-pressed={mode === 'line'} onClick={() => onMode('line')} title="Show one draggable block per caption line">LINE</button>
    </div>
    {mode === 'word'
      ? <button type="button" className="tool labelled" onClick={actions.addWord} disabled={!canAdd} title="Add a single-word caption at the playhead"><PlusIcon />Word</button>
      : <button type="button" className="tool labelled" onClick={actions.addLine} disabled={!canAdd} title="Add a caption line at the playhead"><PlusIcon />Line</button>}
    <span className="tool-divider" />
    <button type="button" className="tool" onClick={actions.merge} disabled={!canMerge} aria-label="Merge with next caption" title="Merge with next caption"><MergeIcon /></button>
    <button type="button" className="tool" onClick={actions.previous} disabled={!hasCues} aria-label="Previous caption" title="Previous caption (↑)"><PrevIcon /></button>
    <button type="button" className="tool" onClick={actions.next} disabled={!hasCues} aria-label="Next caption" title="Next caption (↓)"><NextIcon /></button>
    <button type="button" className="tool" onClick={onCenterPlayhead} aria-label="Scroll to playhead" title="Scroll the timeline to the playhead"><PlayheadIcon /></button>
    <button type="button" className="tool danger" onClick={actions.delete} disabled={!hasSelection && !hasSelectedWord}
      aria-label={hasSelectedWord ? 'Delete selected word' : 'Delete selected caption'}
      title={hasSelectedWord ? 'Delete selected word (Delete)' : 'Delete selected caption (Delete)'}><TrashIcon /></button>
    <span className="tool-divider" />
    <button type="button" className="tool" onClick={actions.split} disabled={!canSplit} aria-label="Split selected caption at playhead" title="Split at playhead (S)"><ScissorsIcon /></button>
    <button type="button" className="tool" onClick={actions.trim} disabled={!hasSelection} aria-label="Trim selected caption to playhead" title="Move the nearer caption boundary to the playhead"><TrimIcon /></button>
    <span className="tool-divider" />
    <button type="button" className={`tool toggle ${snap ? 'on' : ''}`} aria-pressed={snap} onClick={() => onSnap(!snap)} aria-label="Snap while dragging" title="Snap dragged edges to neighbouring captions and the playhead"><MagnetIcon /></button>
    <span className="tool-divider" />
    <div className="zoom-control">
      <button type="button" className="tool" onClick={() => onZoom(Math.max(zoomMin, zoom / 2))} disabled={zoom <= zoomMin} aria-label="Zoom out" title="Zoom out"><ZoomOutIcon /></button>
      <input aria-label="Timeline zoom" type="range" min={zoomMin} max={zoomMax} step="1" value={zoom} onChange={(event) => onZoom(Number(event.target.value))} />
      <button type="button" className="tool" onClick={() => onZoom(Math.min(zoomMax, zoom * 2))} disabled={zoom >= zoomMax} aria-label="Zoom in" title="Zoom in"><ZoomInIcon /></button>
      <output aria-label="Zoom level">{zoom}×</output>
    </div>
    <span className="toolbar-spacer" />
    <button type="button" className="tool" aria-pressed={expanded} onClick={() => onExpand(!expanded)} aria-label={expanded ? 'Collapse timeline' : 'Expand timeline'} title={expanded ? 'Collapse timeline' : 'Expand timeline'}>{expanded ? <CollapseIcon /> : <ExpandIcon />}</button>
  </div>
}
