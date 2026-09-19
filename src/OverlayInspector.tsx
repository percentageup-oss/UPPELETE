import { useEffect, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import type { ImageOverlay, ProjectAsset } from './core/edit'
import type { Size } from './core/composition'
import { formatTimestamp, parseEditedTimestamp } from './core/time'
import { centerRect, roundRect } from './core/overlayRect'
import { defaultOverlayRect } from './core/overlayDefaults'
import { Row, Segmented, SliderWithNumber, Toggle } from './style/controls'

const FIT_OPTIONS: { value: ImageOverlay['fit']; label: string }[] = [
  { value: 'contain', label: 'Contain' },
  { value: 'cover', label: 'Cover' },
  { value: 'stretch', label: 'Stretch' },
]

const RECT_FIELD_STEP = 1
const RECT_FIELD_STEP_LARGE = 10

/** The Edit-tab panel for a selected image overlay (V2/V4), mirroring `CueEditor`'s draft/commit
 * contract: rect and opacity fields draft into the live preview and commit one undo step per
 * finished gesture; start/end and fit commit immediately, like `CueEditor`'s own time fields.
 * Position/size can also be dragged directly on the preview (`OverlayStageEditor`) — the fields
 * here and the stage handles both draft/commit through the same `onRectDraft`/`onRectCommit`. */
export function OverlayInspector({ overlay, asset, assetIssue, composition, layerIndex, overlayCount, onUpdateTime, onRectDraft, onRectCommit, onFit, onOpacityDraft, onOpacityCommit, onReorder, onDuplicate, onAddImage, onRelink, onDelete, onInvalid }: {
  overlay: ImageOverlay
  asset: ProjectAsset | null
  assetIssue: 'missing' | 'mismatch' | null
  composition: Size
  /** This overlay's index in `project.overlays` (its paint order) and the total overlay count,
   * for the "Layer n of N" readout; the Bring forward/Send backward row only shows with 2+. */
  layerIndex: number
  overlayCount: number
  onUpdateTime: (startUs: number, endUs: number) => boolean
  onRectDraft: (rect: ImageOverlay['rect']) => void
  onRectCommit: (rect: ImageOverlay['rect']) => void
  onFit: (fit: ImageOverlay['fit']) => void
  onOpacityDraft: (opacity: number) => void
  onOpacityCommit: (opacity: number) => void
  onReorder: (direction: 'forward' | 'backward') => void
  onDuplicate: () => void
  onAddImage: () => void
  onRelink: () => void
  onDelete: () => void
  onInvalid: (message: string) => void
}) {
  const [start, setStart] = useState(formatTimestamp(overlay.startUs, ':'))
  const [end, setEnd] = useState(formatTimestamp(overlay.endUs, ':'))
  const [rect, setRect] = useState(overlay.rect)
  const [lockAspect, setLockAspect] = useState(true)
  useEffect(() => {
    setStart(formatTimestamp(overlay.startUs, ':'))
    setEnd(formatTimestamp(overlay.endUs, ':'))
    setRect(overlay.rect)
  }, [overlay.id, overlay.startUs, overlay.endUs, overlay.rect])

  const changeTime = () => {
    const startUs = parseEditedTimestamp(start, overlay.startUs)
    const endUs = parseEditedTimestamp(end, overlay.endUs)
    if (startUs === null || endUs === null) {
      onInvalid('Use HH:MM:SS:mmm timestamps.')
      setStart(formatTimestamp(overlay.startUs, ':')); setEnd(formatTimestamp(overlay.endUs, ':'))
    } else if (!onUpdateTime(startUs, endUs)) {
      setStart(formatTimestamp(overlay.startUs, ':')); setEnd(formatTimestamp(overlay.endUs, ':'))
    }
  }

  const changeRectField = (field: keyof ImageOverlay['rect']) => (event: ChangeEvent<HTMLInputElement>) => {
    const value = Number(event.target.value)
    let next = { ...rect, [field]: value }
    if (lockAspect && rect.width > 0 && rect.height > 0 && (field === 'width' || field === 'height')) {
      const aspect = rect.width / rect.height
      next = field === 'width' ? { ...next, height: value / aspect } : { ...next, width: value * aspect }
    }
    setRect(next)
    onRectDraft(next)
  }
  const commitRectField = () => onRectCommit(roundRect(rect))
  // Shift+Up/Down steps by 10 units instead of the browser's default ±1 (matches the stage
  // editor's Shift-nudge); plain arrows fall through to the number input's native stepping.
  const stepRectField = (field: keyof ImageOverlay['rect']) => (event: KeyboardEvent<HTMLInputElement>) => {
    if (!event.shiftKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
    event.preventDefault()
    const delta = (event.key === 'ArrowUp' ? 1 : -1) * RECT_FIELD_STEP_LARGE
    const value = rect[field] + delta
    let next = { ...rect, [field]: value }
    if (lockAspect && rect.width > 0 && rect.height > 0 && (field === 'width' || field === 'height')) {
      const aspect = rect.width / rect.height
      next = field === 'width' ? { ...next, height: value / aspect } : { ...next, width: value * aspect }
    }
    setRect(next)
    onRectDraft(next)
    onRectCommit(roundRect(next))
  }

  const applyRect = (next: ImageOverlay['rect']) => { setRect(next); onRectCommit(roundRect(next)) }
  const assetName = asset?.name ?? 'Unknown asset'

  return <div className="editor-form overlay-inspector">
    <div className="overlay-asset-row">
      <span className="overlay-asset-name" title={assetName}>{assetName}</span>
      {assetIssue && <span className={`asset-issue-badge ${assetIssue}`}>{assetIssue === 'missing' ? 'Missing' : 'Mismatch'}</span>}
      <button type="button" onClick={onRelink}>{assetIssue ? 'Relink…' : 'Replace…'}</button>
    </div>
    <div className="time-fields">
      <label htmlFor="overlay-start">Start<input id="overlay-start" value={start} onChange={(event) => setStart(event.target.value)} onBlur={changeTime} /></label>
      <label htmlFor="overlay-end">End<input id="overlay-end" value={end} onChange={(event) => setEnd(event.target.value)} onBlur={changeTime} /></label>
    </div>
    <Row label="Position & size" hint="Drag the image on the preview to move it; drag its handles to resize. Units: 1080-wide composition.">
      <div className="overlay-rect-fields">
        <label>X<input type="number" step={RECT_FIELD_STEP} value={Math.round(rect.x)} onChange={changeRectField('x')} onKeyDown={stepRectField('x')} onBlur={commitRectField} /></label>
        <label>Y<input type="number" step={RECT_FIELD_STEP} value={Math.round(rect.y)} onChange={changeRectField('y')} onKeyDown={stepRectField('y')} onBlur={commitRectField} /></label>
        <label>W<input type="number" step={RECT_FIELD_STEP} value={Math.round(rect.width)} onChange={changeRectField('width')} onKeyDown={stepRectField('width')} onBlur={commitRectField} /></label>
        <label>H<input type="number" step={RECT_FIELD_STEP} value={Math.round(rect.height)} onChange={changeRectField('height')} onKeyDown={stepRectField('height')} onBlur={commitRectField} /></label>
      </div>
      <div className="overlay-rect-lock">
        <Toggle id="overlay-lock-aspect" checked={lockAspect} label="Lock aspect" onChange={setLockAspect} />
      </div>
      <div className="overlay-quick-actions">
        <button type="button" onClick={() => applyRect(centerRect(rect, composition, 'both'))}>Center</button>
        <button type="button" onClick={() => applyRect(centerRect(rect, composition, 'x'))}>Center H</button>
        <button type="button" onClick={() => applyRect(centerRect(rect, composition, 'y'))}>Center V</button>
        <button type="button" onClick={() => applyRect(defaultOverlayRect(asset?.metadata ?? null, composition))}>Fit frame</button>
      </div>
    </Row>
    <Row label="Fit" htmlFor="overlay-fit">
      <Segmented id="overlay-fit" value={overlay.fit} options={FIT_OPTIONS} onChange={onFit} />
    </Row>
    <Row label="Opacity" htmlFor="overlay-opacity">
      <SliderWithNumber id="overlay-opacity" min={0} max={100} step={1} unit="%" value={Math.round(overlay.opacity * 100)}
        onDraft={(value) => onOpacityDraft(value / 100)} onCommit={(value) => onOpacityCommit(Math.max(0, Math.min(100, value)) / 100)} />
    </Row>
    {overlayCount > 1 && <Row label="Layer" hint="Later layers paint on top of earlier ones.">
      <div className="overlay-layer-row">
        <button type="button" onClick={() => onReorder('backward')} disabled={layerIndex === 0} title="Send backward">Send backward</button>
        <button type="button" onClick={() => onReorder('forward')} disabled={layerIndex === overlayCount - 1} title="Bring forward">Bring forward</button>
        <span className="overlay-layer-label">Layer {layerIndex + 1} of {overlayCount}</span>
      </div>
    </Row>}
    <div className="edit-actions">
      <button onClick={onDuplicate} title="Add a copy of this overlay">Duplicate</button>
      <button onClick={onAddImage} title="Add another image overlay">Add image…</button>
      <button className="danger" onClick={onDelete} title="Delete selected overlay (Delete or Backspace)">Delete</button>
    </div>
  </div>
}
