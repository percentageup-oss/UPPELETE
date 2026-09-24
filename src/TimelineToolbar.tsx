import { CollapseIcon, ExpandIcon, MagnetIcon, MergeIcon, NextIcon, PlayheadIcon, PlusIcon, PrevIcon, ScissorsIcon, TrashIcon, TrimEndIcon, TrimIcon, TrimStartIcon, MarkInIcon, MarkOutIcon, ClearRangeIcon, ZoomInIcon, ZoomOutIcon } from './TimelineIcons'
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
  delete: () => void
  split: () => void
  trim: () => void
}

/** Clip editing on the timeline (schema 5). Owned by App like the caption actions. */
export type ClipTools = {
  /** Split at the playhead: the selected clip, or every clip under it on unlocked tracks. */
  split: () => void
  canSplit: boolean
  /** Trim the start / end of the selected clip (or every clip under the playhead) to the playhead. */
  trimTo: (edge: 'start' | 'end') => void
  canTrimTo: boolean
  /** The In/Out export range (I / O). Not part of the project and not undoable. */
  markIn: () => void
  markOut: () => void
  clearRange: () => void
  hasRange: boolean
  /** Delete the selected clip: a lift, or a ripple delete that closes the gap on its track. */
  remove: (ripple: boolean) => void
  hasClip: boolean
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
  hasSelection: boolean
  canMerge: boolean
  canSplit: boolean
  canAdd: boolean
  hasCues: boolean
  hasSelectedWord: boolean
}

export function TimelineToolbar({ mode, onMode, snap, onSnap, zoom, zoomMin, zoomMax, onZoom, expanded, onExpand, onCenterPlayhead, actions, hasSelection, canMerge, canSplit, canAdd, hasCues, hasSelectedWord, editMode, onEditMode, clipTools }: TimelineToolbarProps) {
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
    <button type="button" className={`tool toggle ${snap ? 'on' : ''}`} aria-pressed={snap} onClick={() => onSnap(!snap)} aria-label="Snap while dragging" title="Snap dragged edges to clip edges, captions and the playhead"><MagnetIcon /></button>
    <span className="tool-divider" />
    {/* One visible toggle rather than a modifier key: modifiers are undiscoverable. */}
    <div className="mode-toggle" role="group" aria-label="Clip edit mode">
      <button type="button" className={editMode === 'overwrite' ? 'active' : ''} aria-pressed={editMode === 'overwrite'} onClick={() => onEditMode('overwrite')}
        title="Overwrite: moving, trimming or dropping a clip never moves other clips; it covers what it lands on">OVERWRITE</button>
      <button type="button" className={editMode === 'ripple' ? 'active' : ''} aria-pressed={editMode === 'ripple'} onClick={() => onEditMode('ripple')}
        title="Ripple: a clip's change in length pushes or pulls everything after it on the same track">RIPPLE</button>
    </div>
    <button type="button" className="tool" onClick={clipTools.split} disabled={!clipTools.canSplit} aria-label="Split clips at playhead" title="Split clips at the playhead (⌘/Ctrl+B)"><ScissorsIcon /></button>
    <button type="button" className="tool" onClick={() => clipTools.trimTo('start')} disabled={!clipTools.canTrimTo} aria-label="Trim clip start to playhead" title="Trim start to the playhead (Q)"><TrimStartIcon /></button>
    <button type="button" className="tool" onClick={() => clipTools.trimTo('end')} disabled={!clipTools.canTrimTo} aria-label="Trim clip end to playhead" title="Trim end to the playhead (W)"><TrimEndIcon /></button>
    <button type="button" className="tool" onClick={clipTools.markIn} aria-label="Mark In at playhead" title="Mark In at the playhead (I)"><MarkInIcon /></button>
    <button type="button" className="tool" onClick={clipTools.markOut} aria-label="Mark Out at playhead" title="Mark Out at the playhead (O)"><MarkOutIcon /></button>
    <button type="button" className="tool" onClick={clipTools.clearRange} disabled={!clipTools.hasRange} aria-label="Clear In and Out marks" title="Clear the In/Out range (X)"><ClearRangeIcon /></button>
    <button type="button" className="tool danger" onClick={() => clipTools.remove(editMode === 'ripple')} disabled={!clipTools.hasClip}
      aria-label="Delete selected clip" title={editMode === 'ripple' ? 'Ripple delete the selected clip (Shift+Delete)' : 'Lift the selected clip, leaving a gap (Delete)'}><TrashIcon /></button>
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
