import { useEffect, useState } from 'react'
import type { ZoomRegion } from './core/edit'
import type { Size } from './core/composition'
import { formatTimestamp, parseEditedTimestamp } from './core/time'
import { MAX_ZOOM_FACTOR, rectAtZoomFactor, zoomFactorOf } from './core/zoomRegion'
import type { ZoomRegionChanges } from './core/zoomRegionCommands'
import { Row, SliderWithNumber, Segmented, TimeFields, Toggle } from './style/controls'

/** Half the region's own length — `zoomRectAt` clamps `easeInUs`/`easeOutUs` to this, so a short
 * region never gets a double-ease. Mirrors the clamp in `zoomRegion.ts`. */
function effectiveEaseUs(region: ZoomRegion, edge: 'easeInUs' | 'easeOutUs'): number {
  return Math.min(region[edge], (region.endUs - region.startUs) / 2)
}

/**
 * The Edit-tab panel for a selected zoom region — the settings view every future effect
 * (`docs/EDITING.md` "Zoom regions") will follow: enable/bypass, timing, the effect's own knobs
 * (here: ease and zoom amount) and Delete. Mirrors `ClipInspector`'s draft/commit contract: the
 * zoom-amount slider and ease sliders draft into the live preview and commit one undo step per
 * finished gesture; enable, start and duration commit immediately.
 */
export function ZoomInspector({ region, composition, framing, onFramingChange, onMove, onLength, onEnabledChange, onDraft, onCommit, onReset, onDelete, onInvalid }: {
  region: ZoomRegion
  composition: Size
  /** Pan regions only: which framing the zoom amount and the stage gizmo edit. */
  framing: 'start' | 'end'
  onFramingChange: (framing: 'start' | 'end') => void
  /** Moves the region to a new timeline start, clamped into the free gap around every other region. */
  onMove: (startUs: number) => boolean
  /** Changes the region's length by trimming its end. */
  onLength: (lengthUs: number) => boolean
  onEnabledChange: (enabled: boolean) => void
  onDraft: (changes: ZoomRegionChanges) => void
  onCommit: (changes: ZoomRegionChanges) => void
  /** Returns the target rect to the default centered framing. */
  onReset: () => void
  onDelete: () => void
  onInvalid: (message: string) => void
}) {
  const [start, setStart] = useState(formatTimestamp(region.startUs, ':'))
  const [length, setLength] = useState(formatTimestamp(region.endUs - region.startUs, ':'))
  useEffect(() => {
    setStart(formatTimestamp(region.startUs, ':'))
    setLength(formatTimestamp(region.endUs - region.startUs, ':'))
  }, [region.id, region.startUs, region.endUs])

  const revertTiming = () => { setStart(formatTimestamp(region.startUs, ':')); setLength(formatTimestamp(region.endUs - region.startUs, ':')) }
  const changeStart = () => {
    const startUs = parseEditedTimestamp(start, region.startUs)
    if (startUs === null) { onInvalid('Use HH:MM:SS:mmm timestamps.'); revertTiming() }
    else if (startUs !== region.startUs && !onMove(startUs)) revertTiming()
  }
  const changeLength = () => {
    const lengthUs = parseEditedTimestamp(length, region.endUs - region.startUs)
    if (lengthUs === null || lengthUs <= 0) { onInvalid('Use a positive HH:MM:SS:mmm length.'); revertTiming() }
    else if (lengthUs !== region.endUs - region.startUs && !onLength(lengthUs)) revertTiming()
  }

  const isPan = region.fromRect !== undefined
  const key = isPan && framing === 'start' ? 'fromRect' : 'rect'
  const editedRect = key === 'fromRect' ? region.fromRect! : region.rect
  const zoomFactor = zoomFactorOf(editedRect)
  const draftZoomFactor = (factor: number) => onDraft({ [key]: rectAtZoomFactor(editedRect, factor, composition) })
  const commitZoomFactor = (factor: number) => onCommit({ [key]: rectAtZoomFactor(editedRect, Math.max(1, Math.min(MAX_ZOOM_FACTOR, factor)), composition) })

  const easeRow = (edge: 'easeInUs' | 'easeOutUs', label: string, id: string, set: (us: number) => ZoomRegionChanges) => {
    const effectiveUs = effectiveEaseUs(region, edge)
    const clamped = effectiveUs < region[edge]
    return <Row label={label} htmlFor={id} hint={clamped ? `Clamped to ${Math.round(effectiveUs / 1000)}ms — the region is too short for the full ramp.` : undefined}>
      <SliderWithNumber id={id} min={0} max={5000} step={50} unit="ms" value={Math.round(region[edge] / 1000)}
        onDraft={(ms) => onDraft(set(Math.round(ms) * 1000))}
        onCommit={(ms) => onCommit(set(Math.max(0, Math.min(5000, Math.round(ms))) * 1000))} />
    </Row>
  }

  return <div className="editor-form zoom-inspector">
    <p className="clip-inspector-meta">{isPan ? 'Pan effect' : 'Zoom effect'} · ends {formatTimestamp(region.endUs, ':')}</p>
    <Row label="Enabled" hint={region.enabled ? undefined : 'Bypassed: the picture stays full-frame in preview and export, but the region keeps its place on the timeline.'}>
      <Toggle id="zoom-enabled" checked={region.enabled} label={region.enabled ? 'On' : 'Bypassed'} onChange={onEnabledChange} />
    </Row>
    <TimeFields fields={[
      { id: 'zoom-start', label: 'Start', value: start, onChange: setStart, onBlur: changeStart },
      { id: 'zoom-length', label: 'Length', value: length, onChange: setLength, onBlur: changeLength },
    ]} />
    {isPan && <Row label="Framing" htmlFor="pan-framing" hint="The picture moves from the start framing to the end framing across the whole region. Choose which one to edit; the stage and the amount below follow it.">
      <Segmented id="pan-framing" value={framing} onChange={onFramingChange} options={[{ value: 'start', label: 'Start' }, { value: 'end', label: 'End' }]} />
    </Row>}
    <Row label="Zoom amount" htmlFor="zoom-amount" hint="Drag it on the preview to move or resize the target instead; this keeps its center and the frame's aspect ratio.">
      <SliderWithNumber id="zoom-amount" min={1} max={MAX_ZOOM_FACTOR} step={0.1} unit="x" value={Math.round(zoomFactor * 10) / 10}
        onDraft={draftZoomFactor} onCommit={commitZoomFactor} />
    </Row>
    {!isPan && easeRow('easeInUs', 'Ease in', 'zoom-ease-in', (us) => ({ easeInUs: us }))}
    {!isPan && easeRow('easeOutUs', 'Ease out', 'zoom-ease-out', (us) => ({ easeOutUs: us }))}
    <div className="edit-actions">
      {isPan && <>
        <button type="button" onClick={() => onCommit({ fromRect: region.rect, rect: region.fromRect })} title="Swap the start and end framing">Swap</button>
        <button type="button" onClick={() => onCommit({ fromRect: null })} title="Keep the end framing as a plain zoom">Remove pan</button>
      </>}
      <button type="button" onClick={onReset} title="Return the target to the default centered framing">Reset framing</button>
      <button className="danger" onClick={onDelete} title="Delete this zoom region">Delete</button>
    </div>
  </div>
}
