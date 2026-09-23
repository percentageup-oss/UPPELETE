import { useEffect, useState } from 'react'
import type { EffectRegion } from './core/edit'
import type { EffectChanges } from './core/effectCommands'
import { formatTimestamp, parseEditedTimestamp } from './core/time'
import { Row, SliderWithNumber, Segmented, TimeFields, Toggle, HexColorField } from './style/controls'

const KIND_LABEL: Record<EffectRegion['kind'], string> = { vignette: 'Vignette', letterbox: 'Letterbox', fade: 'Fade' }

/**
 * The Edit-tab panel for a selected frame-paint effect (docs/EDITING.md "Frame-paint effects") —
 * the same settings-view shape `ZoomInspector`/`BlurInspector` established: enable/bypass, timing,
 * the effect's own knobs and Delete. One shell for all three kinds, since they share the same
 * timing/bypass chrome and differ only in their own section below it.
 */
export function EffectInspector({ effect, onMove, onLength, onEnabledChange, onDraft, onCommit, onDelete, onInvalid }: {
  effect: EffectRegion
  /** Moves the region to a new timeline start, clamped into the free gap around others of its kind. */
  onMove: (startUs: number) => boolean
  /** Changes the region's length by trimming its end. */
  onLength: (lengthUs: number) => boolean
  onEnabledChange: (enabled: boolean) => void
  onDraft: (changes: EffectChanges) => void
  onCommit: (changes: EffectChanges) => void
  onDelete: () => void
  onInvalid: (message: string) => void
}) {
  const [start, setStart] = useState(formatTimestamp(effect.startUs, ':'))
  const [length, setLength] = useState(formatTimestamp(effect.endUs - effect.startUs, ':'))
  useEffect(() => {
    setStart(formatTimestamp(effect.startUs, ':'))
    setLength(formatTimestamp(effect.endUs - effect.startUs, ':'))
  }, [effect.id, effect.startUs, effect.endUs])

  const revertTiming = () => { setStart(formatTimestamp(effect.startUs, ':')); setLength(formatTimestamp(effect.endUs - effect.startUs, ':')) }
  const changeStart = () => {
    const startUs = parseEditedTimestamp(start, effect.startUs)
    if (startUs === null) { onInvalid('Use HH:MM:SS:mmm timestamps.'); revertTiming() }
    else if (startUs !== effect.startUs && !onMove(startUs)) revertTiming()
  }
  const changeLength = () => {
    const lengthUs = parseEditedTimestamp(length, effect.endUs - effect.startUs)
    if (lengthUs === null || lengthUs <= 0) { onInvalid('Use a positive HH:MM:SS:mmm length.'); revertTiming() }
    else if (lengthUs !== effect.endUs - effect.startUs && !onLength(lengthUs)) revertTiming()
  }
  const easeRow = (edge: 'easeInUs' | 'easeOutUs', label: string, id: string, currentUs: number, set: (us: number) => EffectChanges) =>
    <Row label={label} htmlFor={id}>
      <SliderWithNumber id={id} min={0} max={5000} step={50} unit="ms" value={Math.round(currentUs / 1000)}
        onDraft={(ms) => onDraft(set(Math.round(ms) * 1000))}
        onCommit={(ms) => onCommit(set(Math.max(0, Math.min(5000, Math.round(ms))) * 1000))} />
    </Row>

  return <div className="editor-form effect-inspector">
    <p className="clip-inspector-meta">{KIND_LABEL[effect.kind]} effect · ends {formatTimestamp(effect.endUs, ':')}</p>
    <Row label="Enabled" hint={effect.enabled ? undefined : 'Bypassed: the picture stays as-is in preview and export, but the region keeps its place on the timeline.'}>
      <Toggle id="effect-enabled" checked={effect.enabled} label={effect.enabled ? 'On' : 'Bypassed'} onChange={onEnabledChange} />
    </Row>
    <TimeFields fields={[
      { id: 'effect-start', label: 'Start', value: start, onChange: setStart, onBlur: changeStart },
      { id: 'effect-length', label: 'Length', value: length, onChange: setLength, onBlur: changeLength },
    ]} />
    {effect.kind === 'vignette' && <>
      <Row label="Amount" htmlFor="vignette-amount">
        <SliderWithNumber id="vignette-amount" min={0} max={100} step={1} unit="%" value={Math.round(effect.amount * 100)}
          onDraft={(percent) => onDraft({ amount: percent / 100 })} onCommit={(percent) => onCommit({ amount: Math.max(0, Math.min(1, percent / 100)) })} />
      </Row>
      <Row label="Softness" htmlFor="vignette-softness">
        <SliderWithNumber id="vignette-softness" min={0} max={100} step={1} unit="%" value={Math.round(effect.softness * 100)}
          onDraft={(percent) => onDraft({ softness: percent / 100 })} onCommit={(percent) => onCommit({ softness: Math.max(0, Math.min(1, percent / 100)) })} />
      </Row>
    </>}
    {effect.kind === 'letterbox' && <>
      <Row label="Target aspect" htmlFor="letterbox-aspect" hint="e.g. 2.39 (cinemascope) or 1.85 (widescreen). Bars land top/bottom or left/right, whichever the output's own aspect calls for.">
        <SliderWithNumber id="letterbox-aspect" min={0.2} max={5} step={0.01} unit=":1" value={Math.round(effect.aspect * 100) / 100}
          onDraft={(aspect) => onDraft({ aspect })} onCommit={(aspect) => onCommit({ aspect: Math.max(0.2, Math.min(5, aspect)) })} />
      </Row>
      <Row label="Bar color" htmlFor="letterbox-color"><HexColorField id="letterbox-color" value={effect.color}
        onDraft={(color) => onDraft({ color })} onCommit={(color) => onCommit({ color })} /></Row>
      {easeRow('easeInUs', 'Slide in', 'letterbox-ease-in', effect.easeInUs, (us) => ({ easeInUs: us }))}
      {easeRow('easeOutUs', 'Slide out', 'letterbox-ease-out', effect.easeOutUs, (us) => ({ easeOutUs: us }))}
    </>}
    {effect.kind === 'fade' && <>
      <Row label="Shape" htmlFor="fade-shape">
        <Segmented id="fade-shape" value={effect.shape} onChange={(shape) => onCommit({ shape })}
          options={[{ value: 'in', label: 'Fade in' }, { value: 'out', label: 'Fade out' }, { value: 'dip', label: 'Dip' }]} />
      </Row>
      <Row label="Color" htmlFor="fade-color"><HexColorField id="fade-color" value={effect.color}
        onDraft={(color) => onDraft({ color })} onCommit={(color) => onCommit({ color })} /></Row>
      {effect.shape === 'dip' && <>
        {easeRow('easeInUs', 'Ease in', 'fade-ease-in', effect.easeInUs, (us) => ({ easeInUs: us }))}
        {easeRow('easeOutUs', 'Ease out', 'fade-ease-out', effect.easeOutUs, (us) => ({ easeOutUs: us }))}
      </>}
    </>}
    <div className="edit-actions">
      <button className="danger" onClick={onDelete} title="Delete this effect">Delete</button>
    </div>
  </div>
}
