import { useEffect, useState } from 'react'
import type { AudioClip, ClipSpeed, VideoClip } from './core/edit'
import { isConstantSpeed, constantRate } from './core/clipTime'
import { SPEED_PRESETS, presetSpeed, constantSpeed } from './core/speedPresets'
import { clipLengthUs } from './core/timelineModel'
import { NumberField, RangeInput, Row, Segmented } from './style/controls'
import { SpeedCurveEditor } from './SpeedCurveEditor'

const QUICK_RATES = [0.25, 0.5, 1, 2, 4] as const
const seconds = (us: number) => `${(us / 1_000_000).toFixed(2)} s`
/** The slider is logarithmic: −100…100 ↔ 0.1×…10×, so 0.5× and 2× sit either side of 1× evenly. */
const rateOfSlider = (value: number) => Math.round(Math.pow(10, value / 100) * 100) / 100
const sliderOfRate = (rate: number) => Math.round(Math.log10(rate) * 100)

/**
 * A video or audio clip's speed: a steady rate (slider, chips, exact field) or a curve (ramp presets
 * and an editable curve). Changes commit through `onCommit` — `null` returns the clip to normal
 * speed — and the clip's length, and the clips after it, follow (`clip-update`).
 */
export function SpeedControls({ clip, onCommit }: { clip: VideoClip | AudioClip; onCommit: (speed: ClipSpeed | null) => void }) {
  const curved = clip.speed !== undefined && !isConstantSpeed(clip)
  const [pickedCurve, setPickedCurve] = useState(false)
  useEffect(() => setPickedCurve(false), [clip.id])
  const showCurve = curved || pickedCurve
  const rate = constantRate(clip)
  const [draftRate, setDraftRate] = useState<number | null>(null)
  const commitRate = (next: number) => { setDraftRate(null); onCommit(next === 1 ? null : constantSpeed(next)) }
  const shownRate = draftRate ?? rate
  const range = { startUs: clip.sourceStartUs, endUs: clip.sourceEndUs }
  const sourceLengthUs = clip.sourceEndUs - clip.sourceStartUs
  const lengthUs = clipLengthUs(clip)

  return <Row label="Speed" hint={showCurve ? 'Audio is muted while a speed curve is applied.' : shownRate !== 1 ? 'Audio keeps its pitch.' : undefined}>
    <Segmented id="clip-speed-mode" value={showCurve ? 'curve' : 'constant'} options={[{ value: 'constant', label: 'Constant' }, { value: 'curve', label: 'Curve' }]}
      onChange={(mode) => {
        if (mode === 'curve') setPickedCurve(true)
        else { setPickedCurve(false); if (curved) onCommit(null) }
      }} />
    {!showCurve && <>
      <div className="speed-quick">
        {QUICK_RATES.map((quick) => <button key={quick} type="button" className={rate === quick ? 'active' : ''} aria-pressed={rate === quick} onClick={() => commitRate(quick)}>{quick}×</button>)}
      </div>
      <div className="slider-number">
        <RangeInput id="clip-speed" ariaLabel="Speed" min={-100} max={100} value={sliderOfRate(shownRate)}
          onChange={(value) => setDraftRate(rateOfSlider(value))} onCommit={() => { if (draftRate !== null) commitRate(draftRate) }} />
        <NumberField id="clip-speed-value" ariaLabel="Speed multiplier" value={shownRate} min={0.1} max={10} step={0.05} unit="×"
          onDraft={() => {}} onCommit={commitRate} />
      </div>
    </>}
    {showCurve && <>
      <div className="speed-presets">
        {SPEED_PRESETS.map((preset) => <button key={preset.id} type="button" title={preset.hint} onClick={() => onCommit(presetSpeed(preset, clip.sourceStartUs, clip.sourceEndUs))}>{preset.name}</button>)}
      </div>
      <SpeedCurveEditor range={range} speed={clip.speed} onCommit={onCommit} />
    </>}
    <p className="speed-duration">Plays in {seconds(lengthUs)}{lengthUs !== sourceLengthUs ? ` (source ${seconds(sourceLengthUs)})` : ''}</p>
    {clip.speed && <div className="overlay-quick-actions"><button type="button" onClick={() => { setPickedCurve(false); onCommit(null) }}>Reset speed</button></div>}
  </Row>
}
