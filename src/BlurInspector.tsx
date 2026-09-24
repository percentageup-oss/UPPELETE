import { useEffect, useState } from 'react'
import type { BlurRegion } from './core/edit'
import { formatTimestamp, parseEditedTimestamp } from './core/time'
import { Row, SliderWithNumber, TimeFields, Toggle } from './style/controls'

/**
 * The Edit-tab panel for a selected blur region — the same settings-view shape `ZoomInspector`
 * established (docs/EDITING.md "Zoom regions"): enable/bypass, timing, the effect's own knob (here,
 * radius) and Delete. Blur has no ease or target-aspect lock, so it is the smaller of the two.
 */
export function BlurInspector({ region, onMove, onLength, onEnabledChange, onRadiusDraft, onRadiusCommit, onDelete, onInvalid }: {
  region: BlurRegion
  /** Moves the region to a new timeline start, clamped to stay within the timeline. */
  onMove: (startUs: number) => boolean
  /** Changes the region's length by trimming its end. */
  onLength: (lengthUs: number) => boolean
  onEnabledChange: (enabled: boolean) => void
  onRadiusDraft: (radius: number) => void
  onRadiusCommit: (radius: number) => void
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

  return <div className="editor-form blur-inspector">
    <p className="clip-inspector-meta">Blur effect · ends {formatTimestamp(region.endUs, ':')}</p>
    <Row label="Enabled" hint={region.enabled ? undefined : 'Bypassed: the picture stays sharp in preview and export, but the region keeps its place on the timeline.'}>
      <Toggle id="blur-enabled" checked={region.enabled} label={region.enabled ? 'On' : 'Bypassed'} onChange={onEnabledChange} />
    </Row>
    <TimeFields fields={[
      { id: 'blur-start', label: 'Start', value: start, onChange: setStart, onBlur: changeStart },
      { id: 'blur-length', label: 'Length', value: length, onChange: setLength, onBlur: changeLength },
    ]} />
    <Row label="Blur radius" htmlFor="blur-radius" hint="Drag the area on the preview to move or resize it instead.">
      <SliderWithNumber id="blur-radius" min={1} max={100} step={1} unit="px" value={Math.round(region.radius)}
        onDraft={onRadiusDraft} onCommit={(value) => onRadiusCommit(Math.max(1, Math.min(100, Math.round(value))))} />
    </Row>
    <div className="edit-actions">
      <button className="danger" onClick={onDelete} title="Delete this blur region">Delete</button>
    </div>
  </div>
}
