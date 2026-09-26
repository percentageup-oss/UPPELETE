import { CollapseIcon, ExpandIcon, MagnetIcon, MergeIcon, NextIcon, PlayheadIcon, PlusIcon, PrevIcon, ScissorsIcon, TrashIcon, TrimEndIcon, TrimStartIcon, MarkInIcon, MarkOutIcon, ClearRangeIcon, ZoomInIcon, ZoomOutIcon } from './TimelineIcons'
import { RangeInput } from './style/controls'
import type { CaptionDisplay } from './captions/wordDisplay'
import type { EditMode } from './core/clipEdits'

export type TrackMode = CaptionDisplay

/** Editing commands stay owned by App; the toolbar only renders and disables them. */
export type TimelineActions = {
  addLine: () => void
  addWord: () => void
  merge: () => void
  previous: () => void
  next: () => void
}

/** Range marks (I / O). Not part of the project and not undoable. */
export type ClipTools = {
  markIn: () => void
  markOut: () => void
  clearRange: () => void
  hasRange: boolean
}

/** One Split / Trim / Delete set. App points it at the selected caption, or at clips otherwise. */
export type EditTools = {
  split: () => void
  canSplit: boolean
  splitLabel: string
  trimTo: (edge: 'start' | 'end') => void
  canTrim: boolean
  trimLabels: { start: string; end: string }
  remove: () => void
  canRemove: boolean
  removeLabel: string
}

type TimelineToolbarProps = {
  editMode: EditMode
  onEditMode: (mode: EditMode) => void
  clipTools: ClipTools
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
  edit: EditTools
  canMerge: boolean
  canAdd: boolean
  hasCues: boolean
}

export function TimelineToolbar({ mode, onMode, snap, onSnap, zoom, zoomMin, zoomMax, onZoom, expanded, onExpand, onCenterPlayhead, actions, edit, canMerge, canAdd, hasCues, editMode, onEditMode, clipTools }: TimelineToolbarProps) {
  return <div className="timeline-toolbar" role="toolbar" aria-label="Timeline tools">
    <div className="mode-toggle" role="group" aria-label="Caption track mode">
      <button type="button" className={mode === 'word' ? 'active' : ''} aria-pressed={mode === 'word'} onClick={() => onMode('word')} title="Show one block per timed word">WORD</button>
      <button type="button" className={mode === 'line' ? 'active' : ''} aria-pressed={mode === 'line'} onClick={() => onMode('line')} title="Show one draggable block per caption line">LINE</button>
    </div>
    {mode === 'word'
      ? <button type="button" className="tool labelled" onClick={actions.addWord} disabled={!canAdd} title="Add a single-word caption at the playhead"><PlusIcon />Word</button>
      : <button type="button" className="tool labelled" onClick={actions.addLine} disabled={!canAdd} title="Add a caption line at the playhead"><PlusIcon />Line</button>}
    <span className="tool-divider" />
    <button type="button" className="tool" onClick={actions.previous} disabled={!hasCues} aria-label="Previous caption" title="Previous caption (↑)"><PrevIcon /></button>
    <button type="button" className="tool" onClick={actions.next} disabled={!hasCues} aria-label="Next caption" title="Next caption (↓)"><NextIcon /></button>
    <button type="button" className="tool" onClick={actions.merge} disabled={!canMerge} aria-label="Merge with next caption" title="Merge with next caption"><MergeIcon /></button>
    <span className="tool-divider" />
    <button type="button" className="tool" onClick={edit.split} disabled={!edit.canSplit} aria-label={edit.splitLabel} title={edit.splitLabel}><ScissorsIcon /></button>
    <button type="button" className="tool" onClick={() => edit.trimTo('start')} disabled={!edit.canTrim} aria-label={edit.trimLabels.start} title={edit.trimLabels.start}><TrimStartIcon /></button>
    <button type="button" className="tool" onClick={() => edit.trimTo('end')} disabled={!edit.canTrim} aria-label={edit.trimLabels.end} title={edit.trimLabels.end}><TrimEndIcon /></button>
    <button type="button" className="tool danger" onClick={edit.remove} disabled={!edit.canRemove} aria-label={edit.removeLabel} title={edit.removeLabel}><TrashIcon /></button>
    <span className="tool-divider" />
    <button type="button" className={`tool toggle ${snap ? 'on' : ''}`} aria-pressed={snap} onClick={() => onSnap(!snap)} aria-label="Snap while dragging" title="Snap dragged edges to clip edges, captions and the playhead"><MagnetIcon /></button>
    {/* One visible toggle rather than a modifier key: modifiers are undiscoverable. */}
    <div className="mode-toggle" role="group" aria-label="Clip edit mode">
      <button type="button" className={editMode === 'overwrite' ? 'active' : ''} aria-pressed={editMode === 'overwrite'} onClick={() => onEditMode('overwrite')}
        title="Overwrite: moving, trimming or dropping a clip never moves other clips; it covers what it lands on">OVERWRITE</button>
      <button type="button" className={editMode === 'ripple' ? 'active' : ''} aria-pressed={editMode === 'ripple'} onClick={() => onEditMode('ripple')}
        title="Ripple: a clip's change in length pushes or pulls everything after it on the same track">RIPPLE</button>
    </div>
    <span className="tool-divider" />
    <button type="button" className="tool" onClick={clipTools.markIn} aria-label="Mark In at playhead" title="Mark In at the playhead (I)"><MarkInIcon /></button>
    <button type="button" className="tool" onClick={clipTools.markOut} aria-label="Mark Out at playhead" title="Mark Out at the playhead (O)"><MarkOutIcon /></button>
    <button type="button" className="tool" onClick={clipTools.clearRange} disabled={!clipTools.hasRange} aria-label="Clear In and Out marks" title="Clear the In/Out range (X)"><ClearRangeIcon /></button>
    <button type="button" className="tool" onClick={onCenterPlayhead} aria-label="Scroll to playhead" title="Scroll the timeline to the playhead"><PlayheadIcon /></button>
    <span className="tool-divider" />
    <div className="zoom-control">
      <button type="button" className="tool" onClick={() => onZoom(Math.max(zoomMin, zoom / 2))} disabled={zoom <= zoomMin} aria-label="Zoom out" title="Zoom out"><ZoomOutIcon /></button>
      <RangeInput ariaLabel="Timeline zoom" min={zoomMin} max={zoomMax} step={1} value={zoom} onChange={onZoom} />
      <button type="button" className="tool" onClick={() => onZoom(Math.min(zoomMax, zoom * 2))} disabled={zoom >= zoomMax} aria-label="Zoom in" title="Zoom in"><ZoomInIcon /></button>
      <output aria-label="Zoom level">{zoom}×</output>
    </div>
    <span className="toolbar-spacer" />
    <button type="button" className="tool" aria-pressed={expanded} onClick={() => onExpand(!expanded)} aria-label={expanded ? 'Collapse timeline' : 'Expand timeline'} title={expanded ? 'Collapse timeline' : 'Expand timeline'}>{expanded ? <CollapseIcon /> : <ExpandIcon />}</button>
  </div>
}
