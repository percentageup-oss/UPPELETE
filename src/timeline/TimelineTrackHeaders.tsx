import { useState } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import type { Track } from '../core/edit'
import type { TrackFlags } from '../core/trackCommands'
import type { CaptionTrackFlags } from '../core/captionTrackCommands'
import type { TimelineRow } from '../core/timelineLayout'
import type { EffectRegionKind } from '../core/edit'
import { formatClock } from '../core/time'
import { AudioIcon, BlurAreaIcon, CaptionsIcon, FadeIcon, GlowIcon, GrainIcon, GripIcon, LetterboxIcon, ParticlesIcon, VhsIcon, VideoIcon, VignetteIcon, ZoomRegionIcon } from '../TimelineIcons'

const EFFECT_LANE_HEADER: Record<EffectRegionKind, { label: string; icon: typeof VignetteIcon }> = {
  vignette: { label: 'Vignette', icon: VignetteIcon },
  letterbox: { label: 'Letterbox', icon: LetterboxIcon },
  fade: { label: 'Fade', icon: FadeIcon },
  grain: { label: 'Film grain', icon: GrainIcon },
  vhs: { label: 'VHS', icon: VhsIcon },
  particles: { label: 'Light particles', icon: ParticlesIcon },
  glow: { label: 'Dreamy glow', icon: GlowIcon },
}

export type TrackHeaderActions = {
  onUpdate: (trackId: string, changes: TrackFlags) => void
  onReorder: (trackId: string, direction: 'forward' | 'backward') => void
  onRemove: (trackId: string) => void
  onAdd: (kind: Track['kind']) => void
}

export type CaptionTrackHeaderActions = {
  onUpdate: (trackId: string, changes: CaptionTrackFlags) => void
  onReorder: (trackId: string, direction: 'forward' | 'backward') => void
  onRemove: (trackId: string) => void
  onAdd: () => void
}

/** The track fader: 0–200 % of unity, shown in dB. Local while dragging so one gesture is one undo step. */
function TrackVolume({ track, label, onCommit }: { track: Track; label: string; onCommit: (volume: number) => void }) {
  const stored = Math.min(2, track.volume ?? 1)
  const [draft, setDraft] = useState<number | null>(null)
  const value = draft ?? stored
  const db = value <= 0 ? '−∞ dB' : `${(20 * Math.log10(value)).toFixed(1)} dB`
  const commit = () => { if (draft !== null && draft !== stored) onCommit(draft); setDraft(null) }
  return <input type="range" className="track-volume" min={0} max={2} step={0.01} value={value} aria-label={`${label} volume`} title={`${label} volume ${db} (double-click for 0 dB)`}
    onChange={(event) => setDraft(Number(event.target.value))} onPointerUp={commit} onKeyUp={commit} onBlur={commit}
    onDoubleClick={() => { setDraft(null); onCommit(1) }} />
}

function TrackHeader({ row, first, last, clipCount, actions }: {
  row: Extract<TimelineRow, { kind: 'track' }>; first: boolean; last: boolean; clipCount: number; actions: TrackHeaderActions
}) {
  const { track } = row
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(track.name)
  const commit = () => { setEditing(false); if (name.trim() !== track.name) actions.onUpdate(track.id, { name }) }
  const flag = (key: 'muted' | 'hidden' | 'locked' | 'solo', label: string, short: string) => <button type="button" className={`track-flag ${track[key] ? 'on' : ''}`}
    aria-pressed={Boolean(track[key])} title={`${label} ${row.label}`} aria-label={`${label} ${row.label}`}
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
    {track.kind === 'audio' && <TrackVolume track={track} label={row.label} onCommit={(volume) => actions.onUpdate(track.id, { volume })} />}
    <span className="track-flags">
      {flag('muted', track.muted ? 'Unmute' : 'Mute', 'M')}
      {track.kind === 'audio' && flag('solo', track.solo ? 'Unsolo' : 'Solo', 'S')}
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

function CaptionTrackHeader({ row, first, last, cueCount, actions }: {
  row: Extract<TimelineRow, { kind: 'captionTrack' }>; first: boolean; last: boolean; cueCount: number; actions: CaptionTrackHeaderActions
}) {
  const { track } = row
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(track.name)
  const commit = () => { setEditing(false); if (name.trim() !== track.name) actions.onUpdate(track.id, { name }) }
  return <div className={`track-label track-header caption-track-header`}>
    <CaptionsIcon />
    {editing
      ? <input className="track-name-input" aria-label="Caption track name" value={name} placeholder={row.label} autoFocus maxLength={120}
        onChange={(event) => setName(event.target.value)} onBlur={commit}
        onKeyDown={(event) => { if (event.key === 'Enter') commit(); if (event.key === 'Escape') { setName(track.name); setEditing(false) } }} />
      : <span className="track-name" title="Double-click to rename" onDoubleClick={() => { setName(track.name); setEditing(true) }}>{row.label}</span>}
    <span className="track-flags">
      <button type="button" className={`track-flag ${track.locked ? 'on' : ''}`} aria-pressed={track.locked}
        title={`${track.locked ? 'Unlock' : 'Lock'} ${row.label}`} aria-label={`${track.locked ? 'Unlock' : 'Lock'} ${row.label}`}
        onClick={() => actions.onUpdate(track.id, { locked: !track.locked })}>L</button>
      <button type="button" className="track-flag" disabled={first} title="Move caption track up" aria-label={`Move ${row.label} up`} onClick={() => actions.onReorder(track.id, 'backward')}>↑</button>
      <button type="button" className="track-flag" disabled={last} title="Move caption track down" aria-label={`Move ${row.label} down`} onClick={() => actions.onReorder(track.id, 'forward')}>↓</button>
      <button type="button" className="track-flag danger" disabled={cueCount > 0} aria-label={`Remove ${row.label}`}
        title={cueCount > 0 ? `Move or delete its ${cueCount} caption${cueCount === 1 ? '' : 's'} first` : `Remove ${row.label}`}
        onClick={() => actions.onRemove(track.id)}>×</button>
    </span>
  </div>
}

/** The label column: one header per row, with the divider between the video and audio stacks. */
export function TimelineTrackHeaders({ rows, style, currentUs, durationUs, clipCounts, captionCueCounts, actions, captionTrackActions, dividerActive, onDividerPointerDown, onDividerPointerMove, onDividerPointerUp, onDividerKeyDown, dividerValue, onAddText }: {
  rows: readonly TimelineRow[]
  style: CSSProperties
  currentUs: number
  durationUs: number
  clipCounts: Map<string, number>
  captionCueCounts: Map<string, number>
  actions: TrackHeaderActions
  captionTrackActions: CaptionTrackHeaderActions
  dividerActive: boolean
  dividerValue: number
  onDividerPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
  onDividerPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void
  onDividerPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void
  onDividerKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void
  onAddText?: () => void
}) {
  const videoRows = rows.filter((row): row is Extract<TimelineRow, { kind: 'track' }> => row.kind === 'track' && row.track.kind === 'video')
  const audioRows = rows.filter((row): row is Extract<TimelineRow, { kind: 'track' }> => row.kind === 'track' && row.track.kind === 'audio')
  const captionRows = rows.filter((row): row is Extract<TimelineRow, { kind: 'captionTrack' }> => row.kind === 'captionTrack')
  return <div className="track-labels" style={style}>
    {rows.map((row) => {
      if (row.kind === 'ruler') return <div key="ruler" className="ruler-spacer">
        <span aria-hidden="true">{formatClock(currentUs)} / {formatClock(durationUs)}</span>
        <span className="track-add-buttons">
          <button type="button" className="track-flag" title="Add a caption track" aria-label="Add caption track" onClick={captionTrackActions.onAdd}>+C</button>
          <button type="button" className="track-flag" title="Add a video track on top" aria-label="Add video track" onClick={() => actions.onAdd('video')}>+V</button>
          <button type="button" className="track-flag" title="Add an audio track" aria-label="Add audio track" onClick={() => actions.onAdd('audio')}>+A</button>
        </span>
      </div>
      if (row.kind === 'captionTrack') {
        const index = captionRows.indexOf(row)
        return <CaptionTrackHeader key={row.id} row={row} first={index === 0} last={index === captionRows.length - 1}
          cueCount={captionCueCounts.get(row.id) ?? 0} actions={captionTrackActions} />
      }
      if (row.kind === 'textLane') return <div key="textLane" className="track-label track-header text-lane-header"><span className="track-name">Text</span>
        {onAddText && <button type="button" className="track-flag" title="Add text at playhead" aria-label="Add text at playhead" onClick={onAddText}>+</button>}</div>
      if (row.kind === 'shapeLane') return <div key="shapeLane" className="track-label track-header text-lane-header"><span className="track-name">Graphics</span></div>
      if (row.kind === 'divider') return <div key="divider" className={`track-divider ${dividerActive ? 'dragging' : ''}`} role="separator" aria-orientation="horizontal"
        aria-label="Resize video and audio tracks" aria-valuenow={dividerValue} aria-valuemin={0} aria-valuemax={100} tabIndex={0}
        onPointerDown={onDividerPointerDown} onPointerMove={onDividerPointerMove} onPointerUp={onDividerPointerUp} onPointerCancel={onDividerPointerUp} onKeyDown={onDividerKeyDown}><GripIcon /></div>
      // The zoom lane: a permanent row over the whole program (schema 7), so — unlike a video or
      // caption track — there is nothing to rename, lock or remove here. It was labeled "Effects" to
      // match the left rail's Effects tab while zoom was the only effect kind with a lane; now that
      // blur has its own row too (shown only when used — `timelineLayout.ts`), each lane names its
      // own kind, the way a clip inspector names its own asset under the generic Overlays tab.
      if (row.kind === 'zoomLane') return <div key="zoomLane" className="track-label track-header zoom-lane-header">
        <ZoomRegionIcon /><span className="track-name">Zoom</span>
      </div>
      if (row.kind === 'blurLane') return <div key="blurLane" className="track-label track-header blur-lane-header">
        <BlurAreaIcon /><span className="track-name">Blur</span>
      </div>
      if (row.kind === 'effectLane') {
        const { label, icon: LaneIcon } = EFFECT_LANE_HEADER[row.effectKind]
        return <div key={row.id} className={`track-label track-header effect-lane-header ${row.effectKind}-lane-header`}>
          <LaneIcon /><span className="track-name">{label}</span>
        </div>
      }
      const stack = row.track.kind === 'video' ? videoRows : audioRows
      const index = stack.indexOf(row)
      return <TrackHeader key={row.id} row={row} first={index === 0} last={index === stack.length - 1} clipCount={clipCounts.get(row.id) ?? 0} actions={actions} />
    })}
  </div>
}
