import { useState } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import type { Track } from '../core/edit'
import type { TrackFlags } from '../core/trackCommands'
import type { TimelineRow } from '../core/timelineLayout'
import { formatClock } from '../core/time'
import { AudioIcon, CaptionsIcon, GripIcon, VideoIcon } from '../TimelineIcons'

export type TrackHeaderActions = {
  onUpdate: (trackId: string, changes: TrackFlags) => void
  onReorder: (trackId: string, direction: 'forward' | 'backward') => void
  onRemove: (trackId: string) => void
  onAdd: (kind: Track['kind']) => void
}

function TrackHeader({ row, first, last, clipCount, actions }: {
  row: Extract<TimelineRow, { kind: 'track' }>; first: boolean; last: boolean; clipCount: number; actions: TrackHeaderActions
}) {
  const { track } = row
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(track.name)
  const commit = () => { setEditing(false); if (name.trim() !== track.name) actions.onUpdate(track.id, { name }) }
  const flag = (key: 'muted' | 'hidden' | 'locked', label: string, short: string) => <button type="button" className={`track-flag ${track[key] ? 'on' : ''}`}
    aria-pressed={track[key]} title={`${label} ${row.label}`} aria-label={`${label} ${row.label}`}
    onClick={() => actions.onUpdate(track.id, { [key]: !track[key] })}>{short}</button>
  // "Up" moves a track visually up: for video that is later in the array (painted on top).
  const upDirection = track.kind === 'video' ? 'forward' : 'backward'
  const downDirection = track.kind === 'video' ? 'backward' : 'forward'
  return <div className={`track-label track-header ${track.hidden ? 'is-hidden' : ''} ${track.muted ? 'is-muted' : ''}`}>
    {track.kind === 'video' ? <VideoIcon /> : <AudioIcon />}
    {editing
      ? <input className="track-name-input" aria-label="Track name" value={name} placeholder={row.label} autoFocus maxLength={120}
        onChange={(event) => setName(event.target.value)} onBlur={commit}
        onKeyDown={(event) => { if (event.key === 'Enter') commit(); if (event.key === 'Escape') { setName(track.name); setEditing(false) } }} />
      : <span className="track-name" title="Double-click to rename" onDoubleClick={() => { setName(track.name); setEditing(true) }}>{row.label}</span>}
    <span className="track-flags">
      {flag('muted', track.muted ? 'Unmute' : 'Mute', 'M')}
      {track.kind === 'video' && flag('hidden', track.hidden ? 'Show' : 'Hide', 'H')}
      {flag('locked', track.locked ? 'Unlock' : 'Lock', 'L')}
      <button type="button" className="track-flag" disabled={first} title="Move track up" aria-label={`Move ${row.label} up`} onClick={() => actions.onReorder(track.id, upDirection)}>↑</button>
      <button type="button" className="track-flag" disabled={last} title="Move track down" aria-label={`Move ${row.label} down`} onClick={() => actions.onReorder(track.id, downDirection)}>↓</button>
      <button type="button" className="track-flag danger" disabled={clipCount > 0} aria-label={`Remove ${row.label}`}
        title={clipCount > 0 ? `Move or delete its ${clipCount} clip${clipCount === 1 ? '' : 's'} first` : `Remove ${row.label}`}
        onClick={() => actions.onRemove(track.id)}>×</button>
    </span>
  </div>
}

/** The label column: one header per row, with the divider between the video and audio stacks. */
export function TimelineTrackHeaders({ rows, style, currentUs, durationUs, clipCounts, actions, dividerActive, onDividerPointerDown, onDividerPointerMove, onDividerPointerUp, onDividerKeyDown, dividerValue }: {
  rows: readonly TimelineRow[]
  style: CSSProperties
  currentUs: number
  durationUs: number
  clipCounts: Map<string, number>
  actions: TrackHeaderActions
  dividerActive: boolean
  dividerValue: number
  onDividerPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
  onDividerPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void
  onDividerPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void
  onDividerKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void
}) {
  const videoRows = rows.filter((row): row is Extract<TimelineRow, { kind: 'track' }> => row.kind === 'track' && row.track.kind === 'video')
  const audioRows = rows.filter((row): row is Extract<TimelineRow, { kind: 'track' }> => row.kind === 'track' && row.track.kind === 'audio')
  return <div className="track-labels" style={style}>
    {rows.map((row) => {
      if (row.kind === 'ruler') return <span key="ruler" className="ruler-spacer" aria-hidden="true">{formatClock(currentUs)} / {formatClock(durationUs)}</span>
      if (row.kind === 'captions') return <div key="captions" className="track-label"><CaptionsIcon /><span>Captions</span>
        <span className="track-add-buttons">
          <button type="button" className="track-flag" title="Add a video track on top" aria-label="Add video track" onClick={() => actions.onAdd('video')}>+V</button>
          <button type="button" className="track-flag" title="Add an audio track" aria-label="Add audio track" onClick={() => actions.onAdd('audio')}>+A</button>
        </span>
      </div>
      if (row.kind === 'divider') return <div key="divider" className={`track-divider ${dividerActive ? 'dragging' : ''}`} role="separator" aria-orientation="horizontal"
        aria-label="Resize video and audio tracks" aria-valuenow={dividerValue} aria-valuemin={0} aria-valuemax={100} tabIndex={0}
        onPointerDown={onDividerPointerDown} onPointerMove={onDividerPointerMove} onPointerUp={onDividerPointerUp} onPointerCancel={onDividerPointerUp} onKeyDown={onDividerKeyDown}><GripIcon /></div>
      const stack = row.track.kind === 'video' ? videoRows : audioRows
      const index = stack.indexOf(row)
      return <TrackHeader key={row.id} row={row} first={index === 0} last={index === stack.length - 1} clipCount={clipCounts.get(row.id) ?? 0} actions={actions} />
    })}
  </div>
}
