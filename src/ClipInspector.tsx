import { useEffect, useState } from 'react'
import type { Clip, ClipFit, CompositionRect, ProjectAsset, Track } from './core/edit'
import type { Size } from './core/composition'
import { formatTimestamp, parseEditedTimestamp } from './core/time'
import { centerRect, roundRect } from './core/overlayRect'
import { defaultOverlayRect } from './core/overlayDefaults'
import { clipEndUs, clipLengthUs } from './core/timelineModel'
import { NumberField, Row, Segmented, SliderWithNumber, TimeFields, Toggle } from './style/controls'

const FIT_OPTIONS: { value: ClipFit; label: string }[] = [
  { value: 'contain', label: 'Contain' },
  { value: 'cover', label: 'Cover' },
  { value: 'stretch', label: 'Stretch' },
]

const KIND_LABEL: Record<Clip['kind'], string> = { video: 'Video clip', image: 'Image', audio: 'Audio clip' }

/** A picture-in-picture rect: the top-right quarter of the frame, keeping the frame's aspect. */
export function defaultPipRect(composition: Size): CompositionRect {
  const width = composition.width / 2
  return { x: composition.width - width - 24, y: 24, width, height: composition.height / 2 }
}

/**
 * The Edit-tab panel for a selected clip of any kind, mirroring `CueEditor`'s draft/commit
 * contract: rect, opacity and gain draft into the live preview and commit one undo step per
 * finished gesture; timing and fit commit immediately. Position/size can also be dragged directly
 * on the preview (`ClipStageEditor`) once the clip has a rect.
 */
export function ClipInspector({ clip, asset, assetIssue, track, trackLabel, composition, onMove, onLength, onRectDraft, onRectCommit, onFit, onOpacityDraft, onOpacityCommit,
  onGainDraft, onGainCommit, onDuplicate, onDelete, onRelink, onInvalid }: {
  clip: Clip
  asset: ProjectAsset | null
  assetIssue: 'missing' | 'mismatch' | null
  track: Track | null
  trackLabel: string
  composition: Size
  /** Moves the clip to a new timeline start on its own track. */
  onMove: (startUs: number) => boolean
  /** Changes the clip's length by trimming its end. */
  onLength: (lengthUs: number) => boolean
  onRectDraft: (rect: CompositionRect) => void
  /** `null` returns a picture-in-picture clip to filling the frame. */
  onRectCommit: (rect: CompositionRect | null) => void
  onFit: (fit: ClipFit) => void
  onOpacityDraft: (opacity: number) => void
  onOpacityCommit: (opacity: number) => void
  onGainDraft: (gain: number) => void
  onGainCommit: (gain: number) => void
  onDuplicate: () => void
  onDelete: (ripple: boolean) => void
  onRelink: () => void
  onInvalid: (message: string) => void
}) {
  const [start, setStart] = useState(formatTimestamp(clip.timelineStartUs, ':'))
  const [length, setLength] = useState(formatTimestamp(clipLengthUs(clip), ':'))
  const pictureRect = clip.kind !== 'audio' ? clip.rect ?? null : null
  const [rect, setRect] = useState<CompositionRect | null>(pictureRect)
  const [lockAspect, setLockAspect] = useState(true)
  useEffect(() => {
    setStart(formatTimestamp(clip.timelineStartUs, ':'))
    setLength(formatTimestamp(clipLengthUs(clip), ':'))
    setRect(pictureRect)
  }, [clip.id, clip.timelineStartUs, clip.sourceStartUs, clip.sourceEndUs, pictureRect])

  const revertTiming = () => { setStart(formatTimestamp(clip.timelineStartUs, ':')); setLength(formatTimestamp(clipLengthUs(clip), ':')) }
  const changeStart = () => {
    const startUs = parseEditedTimestamp(start, clip.timelineStartUs)
    if (startUs === null) { onInvalid('Use HH:MM:SS:mmm timestamps.'); revertTiming() }
    else if (startUs !== clip.timelineStartUs && !onMove(startUs)) revertTiming()
  }
  const changeLength = () => {
    const lengthUs = parseEditedTimestamp(length, clipLengthUs(clip))
    if (lengthUs === null || lengthUs <= 0) { onInvalid('Use a positive HH:MM:SS:mmm length.'); revertTiming() }
    else if (lengthUs !== clipLengthUs(clip) && !onLength(lengthUs)) revertTiming()
  }

  const withAspect = (current: CompositionRect, field: keyof CompositionRect, value: number): CompositionRect => {
    let next = { ...current, [field]: value }
    if (lockAspect && current.width > 0 && current.height > 0 && (field === 'width' || field === 'height')) {
      const aspect = current.width / current.height
      next = field === 'width' ? { ...next, height: value / aspect } : { ...next, width: value * aspect }
    }
    return next
  }
  // NumberField steps by its own `step` on plain arrows and ×10 on Shift+arrow (matching the
  // stage editor's Shift-nudge), so typing and arrow-stepping both funnel through these two.
  const draftRectField = (field: keyof CompositionRect) => (raw: number) => {
    if (!rect) return
    const next = withAspect(rect, field, raw)
    setRect(next)
    onRectDraft(next)
  }
  const commitRectField = (field: keyof CompositionRect) => (raw: number) => {
    if (!rect) return
    const next = withAspect(rect, field, raw)
    setRect(next)
    onRectCommit(roundRect(next))
  }
  const applyRect = (next: CompositionRect | null) => { setRect(next); onRectCommit(next && roundRect(next)) }
  const assetName = asset?.name ?? 'Missing file'
  const hasPicture = clip.kind !== 'audio'
  const hasSound = clip.kind !== 'image'

  return <div className="editor-form clip-inspector">
    <div className="overlay-asset-row">
      <span className="overlay-asset-name" title={assetName}>{KIND_LABEL[clip.kind]} · {assetName}</span>
      {assetIssue && <span className={`asset-issue-badge ${assetIssue}`}>{assetIssue === 'missing' ? 'Missing' : 'Mismatch'}</span>}
      <button type="button" onClick={onRelink}>{assetIssue ? 'Relink…' : 'Replace…'}</button>
    </div>
    <p className="clip-inspector-meta">On {trackLabel}{track?.locked ? ' (locked)' : ''} · ends {formatTimestamp(clipEndUs(clip), ':')}
      {clip.kind !== 'image' && <> · plays {formatTimestamp(clip.sourceStartUs, ':')}–{formatTimestamp(clip.sourceEndUs, ':')} of the file</>}</p>
    <TimeFields fields={[
      { id: 'clip-start', label: 'Start', value: start, onChange: setStart, onBlur: changeStart },
      { id: 'clip-length', label: 'Length', value: length, onChange: setLength, onBlur: changeLength },
    ]} />
    {hasPicture && <>
      <Row label="Placement" hint={rect ? 'Drag it on the preview to move it; drag its handles to resize. Units: 1080-wide composition.' : 'Fills the frame. Give it a position and size to show it picture-in-picture.'}>
        <Toggle id="clip-pip" checked={rect !== null} label={clip.kind === 'video' ? 'Picture-in-picture' : 'Position and size'}
          onChange={(on) => applyRect(on ? (clip.kind === 'image' ? defaultOverlayRect(asset?.metadata ?? null, composition) : defaultPipRect(composition)) : null)} />
        {rect && <>
          <div className="overlay-rect-fields">
            <label>X<NumberField id="clip-rect-x" step={1} value={Math.round(rect.x)} onDraft={draftRectField('x')} onCommit={commitRectField('x')} /></label>
            <label>Y<NumberField id="clip-rect-y" step={1} value={Math.round(rect.y)} onDraft={draftRectField('y')} onCommit={commitRectField('y')} /></label>
            <label>W<NumberField id="clip-rect-width" step={1} value={Math.round(rect.width)} onDraft={draftRectField('width')} onCommit={commitRectField('width')} /></label>
            <label>H<NumberField id="clip-rect-height" step={1} value={Math.round(rect.height)} onDraft={draftRectField('height')} onCommit={commitRectField('height')} /></label>
          </div>
          <div className="overlay-rect-lock"><Toggle id="clip-lock-aspect" checked={lockAspect} label="Lock aspect" onChange={setLockAspect} /></div>
          <div className="overlay-quick-actions">
            <button type="button" onClick={() => applyRect(centerRect(rect, composition, 'both'))}>Center</button>
            <button type="button" onClick={() => applyRect(centerRect(rect, composition, 'x'))}>Center H</button>
            <button type="button" onClick={() => applyRect(centerRect(rect, composition, 'y'))}>Center V</button>
          </div>
        </>}
      </Row>
      <Row label="Fit" htmlFor="clip-fit">
        <Segmented id="clip-fit" value={clip.fit} options={FIT_OPTIONS} onChange={onFit} />
      </Row>
      <Row label="Opacity" htmlFor="clip-opacity">
        <SliderWithNumber id="clip-opacity" min={0} max={100} step={1} unit="%" value={Math.round(clip.opacity * 100)}
          onDraft={(value) => onOpacityDraft(value / 100)} onCommit={(value) => onOpacityCommit(Math.max(0, Math.min(100, value)) / 100)} />
      </Row>
    </>}
    {hasSound && <Row label={clip.kind === 'video' ? 'Volume' : 'Gain'} htmlFor="clip-gain"
      hint={clip.gain > 1 ? 'The preview plays at most 100%; the exported video uses the full gain.' : undefined}>
      <SliderWithNumber id="clip-gain" min={0} max={400} step={1} unit="%" value={Math.round(clip.gain * 100)}
        onDraft={(value) => onGainDraft(value / 100)} onCommit={(value) => onGainCommit(Math.max(0, Math.min(400, value)) / 100)} />
    </Row>}
    <div className="edit-actions">
      <button onClick={onDuplicate} title="Add a copy of this clip on a free track">Duplicate</button>
      <button className="danger" onClick={() => onDelete(false)} title="Delete, leaving a gap (Delete)">Delete</button>
      <button className="danger" onClick={() => onDelete(true)} title="Delete and close the gap on this track (Shift+Delete)">Ripple delete</button>
    </div>
  </div>
}
