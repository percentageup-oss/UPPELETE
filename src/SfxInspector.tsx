import { useEffect, useState } from 'react'
import type { AudioClip, ProjectAsset } from './core/edit'
import { formatTimestamp, parseEditedTimestamp } from './core/time'
import { Row, SliderWithNumber } from './style/controls'

/** The Edit-tab panel for a selected sound effect (V3), mirroring `OverlayInspector`'s draft/commit
 * contract: gain drafts into the live preview through the scheduler and commits one undo step per
 * finished gesture; at/in-point/duration commit immediately, like the overlay's start/end fields. */
export function SfxInspector({ clip, asset, assetIssue, onUpdateAnchor, onUpdateRange, onGainDraft, onGainCommit, onAddSoundEffect, onRelink, onDelete, onInvalid }: {
  clip: AudioClip
  asset: ProjectAsset | null
  assetIssue: 'missing' | 'mismatch' | null
  onUpdateAnchor: (atUs: number) => boolean
  onUpdateRange: (inPointUs: number, durationUs: number | null) => boolean
  onGainDraft: (gain: number) => void
  onGainCommit: (gain: number) => void
  onAddSoundEffect: () => void
  onRelink: () => void
  onDelete: () => void
  onInvalid: (message: string) => void
}) {
  const [at, setAt] = useState(formatTimestamp(clip.atUs, ':'))
  const [inPoint, setInPoint] = useState(formatTimestamp(clip.inPointUs, ':'))
  const [duration, setDuration] = useState(clip.durationUs === null ? '' : formatTimestamp(clip.durationUs, ':'))
  useEffect(() => {
    setAt(formatTimestamp(clip.atUs, ':'))
    setInPoint(formatTimestamp(clip.inPointUs, ':'))
    setDuration(clip.durationUs === null ? '' : formatTimestamp(clip.durationUs, ':'))
  }, [clip.id, clip.atUs, clip.inPointUs, clip.durationUs])

  const revert = () => {
    setAt(formatTimestamp(clip.atUs, ':')); setInPoint(formatTimestamp(clip.inPointUs, ':'))
    setDuration(clip.durationUs === null ? '' : formatTimestamp(clip.durationUs, ':'))
  }
  const changeAt = () => {
    const atUs = parseEditedTimestamp(at, clip.atUs)
    if (atUs === null) { onInvalid('Use HH:MM:SS:mmm timestamps.'); revert() }
    else if (!onUpdateAnchor(atUs)) revert()
  }
  const changeRange = () => {
    const inPointUs = parseEditedTimestamp(inPoint, clip.inPointUs)
    const durationUs = duration.trim() === '' ? null : parseEditedTimestamp(duration, clip.durationUs ?? 0)
    if (inPointUs === null || (duration.trim() !== '' && durationUs === null)) { onInvalid('Use HH:MM:SS:mmm timestamps.'); revert() }
    else if (!onUpdateRange(inPointUs, durationUs)) revert()
  }

  const assetName = asset?.name ?? 'Unknown asset'

  return <div className="editor-form sfx-inspector">
    <div className="overlay-asset-row">
      <span className="overlay-asset-name" title={assetName}>{assetName}</span>
      {assetIssue && <span className={`asset-issue-badge ${assetIssue}`}>{assetIssue === 'missing' ? 'Missing' : 'Mismatch'}</span>}
      <button type="button" onClick={onRelink}>{assetIssue ? 'Relink…' : 'Replace…'}</button>
    </div>
    <div className="time-fields">
      <label htmlFor="sfx-at">At<input id="sfx-at" value={at} onChange={(event) => setAt(event.target.value)} onBlur={changeAt} /></label>
    </div>
    <div className="time-fields">
      <label htmlFor="sfx-in">In point<input id="sfx-in" value={inPoint} onChange={(event) => setInPoint(event.target.value)} onBlur={changeRange} /></label>
      <label htmlFor="sfx-duration">Duration<input id="sfx-duration" placeholder="Whole clip" value={duration} onChange={(event) => setDuration(event.target.value)} onBlur={changeRange} /></label>
    </div>
    <Row label="Gain" htmlFor="sfx-gain">
      <SliderWithNumber id="sfx-gain" min={0} max={400} step={1} unit="%" value={Math.round(clip.gain * 100)}
        onDraft={(value) => onGainDraft(value / 100)} onCommit={(value) => onGainCommit(Math.max(0, Math.min(400, value)) / 100)} />
    </Row>
    <div className="edit-actions">
      <button onClick={onAddSoundEffect} title="Add another sound effect">Add sound effect…</button>
      <button className="danger" onClick={onDelete} title="Delete selected sound effect (Delete or Backspace)">Delete</button>
    </div>
  </div>
}
