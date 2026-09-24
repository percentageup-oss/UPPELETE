import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import type { ClipSpeed } from './core/edit'
import { speedRateAt } from './core/clipTime'
import { addPoint, clampRate, editablePoints, fractionToRate, movePoint, rateToFraction, removePoint, type SourceRange, type SpeedPoint } from './core/speedCurve'

const WIDTH = 300
const HEIGHT = 120
const PAD = 10
const plotWidth = WIDTH - PAD * 2
const plotHeight = HEIGHT - PAD * 2
const xOf = (sourceUs: number, range: SourceRange) => PAD + (range.endUs > range.startUs ? (sourceUs - range.startUs) / (range.endUs - range.startUs) : 0) * plotWidth
const yOf = (rate: number) => PAD + (1 - rateToFraction(rate)) * plotHeight
const formatRate = (rate: number) => `${rate >= 10 ? rate.toFixed(0) : rate.toFixed(2).replace(/\.?0+$/, '')}×`

/**
 * The speed curve: source position across, rate up on a log axis (1× is the dashed middle line).
 * Drag a point to change it, double-click the line to add one, select a point and press Delete to
 * remove it. Arrow keys nudge a focused point. A drag is drawn live and committed once on release,
 * so a whole gesture is one undo step (the inspector's usual draft/commit contract).
 */
export function SpeedCurveEditor({ range, speed, onCommit }: { range: SourceRange; speed: ClipSpeed | undefined; onCommit: (speed: ClipSpeed) => void }) {
  const svg = useRef<SVGSVGElement>(null)
  const [draft, setDraft] = useState<SpeedPoint[] | null>(null)
  const [dragging, setDragging] = useState<number | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const points = draft ?? editablePoints(speed, range)
  const commit = (next: SpeedPoint[] | null) => { if (next) onCommit({ points: next }) }

  const localPoint = (event: { clientX: number; clientY: number }) => {
    const box = svg.current!.getBoundingClientRect()
    const x = ((event.clientX - box.left) / box.width) * WIDTH
    const y = ((event.clientY - box.top) / box.height) * HEIGHT
    const fraction = Math.min(1, Math.max(0, (x - PAD) / plotWidth))
    return { sourceUs: range.startUs + fraction * (range.endUs - range.startUs), rate: fractionToRate(1 - (y - PAD) / plotHeight) }
  }
  const onPointDown = (event: ReactPointerEvent<SVGCircleElement>, index: number) => {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(index)
    setSelected(index)
  }
  const onPointMove = (event: ReactPointerEvent<SVGCircleElement>) => {
    if (dragging === null) return
    setDraft(movePoint(points, dragging, localPoint(event), range))
  }
  const onPointUp = () => {
    if (dragging === null) return
    const finished = draft
    setDragging(null)
    setDraft(null)
    commit(finished)
  }
  const onPointKey = (event: ReactKeyboardEvent<SVGCircleElement>, index: number) => {
    const point = points[index]
    const step = (range.endUs - range.startUs) / 100
    let next: SpeedPoint[] | null = null
    if (event.key === 'ArrowLeft') next = movePoint(points, index, { sourceUs: point.sourceUs - step, rate: point.rate }, range)
    else if (event.key === 'ArrowRight') next = movePoint(points, index, { sourceUs: point.sourceUs + step, rate: point.rate }, range)
    else if (event.key === 'ArrowUp') next = movePoint(points, index, { sourceUs: point.sourceUs, rate: clampRate(point.rate * 1.1) }, range)
    else if (event.key === 'ArrowDown') next = movePoint(points, index, { sourceUs: point.sourceUs, rate: clampRate(point.rate / 1.1) }, range)
    else if (event.key === 'Delete' || event.key === 'Backspace') { next = removePoint(points, index); setSelected(null) }
    else return
    event.preventDefault()
    event.stopPropagation()
    commit(next)
  }

  // The line is sampled through the same `speedRateAt` the player uses, so a straight-in-rate segment
  // shows as the curve it really is on the log axis.
  const line = Array.from({ length: 101 }, (_, step) => {
    const sourceUs = range.startUs + (step / 100) * (range.endUs - range.startUs)
    return `${step === 0 ? 'M' : 'L'}${xOf(sourceUs, range).toFixed(2)} ${yOf(speedRateAt({ points }, sourceUs)).toFixed(2)}`
  }).join('')

  return <div className="speed-curve">
    <svg ref={svg} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="group" aria-label="Speed curve" preserveAspectRatio="none"
      onDoubleClick={(event) => { const at = localPoint(event); const next = addPoint(points, at.sourceUs, range); commit(next); if (next) setSelected(next.findIndex((point) => point.sourceUs === Math.round(at.sourceUs))) }}
      onPointerDown={() => setSelected(null)}>
      <line className="speed-curve-unity" x1={PAD} x2={WIDTH - PAD} y1={yOf(1)} y2={yOf(1)} />
      <path className="speed-curve-line" d={line} />
      {points.map((point, index) => <circle key={index} className={`speed-curve-point${selected === index ? ' selected' : ''}`} cx={xOf(point.sourceUs, range)} cy={yOf(point.rate)} r={5}
        tabIndex={0} role="slider" aria-label={`Speed point ${index + 1}`} aria-valuemin={0.1} aria-valuemax={10} aria-valuenow={Number(point.rate.toFixed(2))} aria-valuetext={formatRate(point.rate)}
        onPointerDown={(event) => onPointDown(event, index)} onPointerMove={onPointMove} onPointerUp={onPointUp} onPointerCancel={onPointUp}
        onFocus={() => setSelected(index)} onKeyDown={(event) => onPointKey(event, index)} />)}
    </svg>
    <div className="speed-curve-axis" aria-hidden="true"><span>{formatRate(10)}</span><span>1×</span><span>{formatRate(0.1)}</span></div>
    <p className="speed-curve-readout" aria-live="polite">{selected !== null && points[selected] ? `Point ${selected + 1}: ${formatRate(points[selected].rate)}` : 'Double-click the line to add a point. Drag a point to shape the ramp.'}</p>
  </div>
}
