import type { BackgroundMotion, Fill } from './core/edit'
import { DEFAULT_MOTION_PERIOD_US, motionApplies } from './core/fill'
import { gridHorizon } from './core/gridFill'
import { HexColorField, Row, Segmented, SliderWithNumber } from './style/controls'
import { DropIcon, GridIcon, PaletteIcon } from './style/icons'

const DEFAULT_GRADIENT_TO = '#1e3a8a'
const DEFAULT_GRID_LINE = '#4f8cff'
const DEFAULT_GRID_SCROLL_PERIOD_US = 2_000_000

type GridFill = Extract<Fill, { type: 'grid' }>

/** A fill's leading color: what the other fill types keep when you switch to them. */
const leadColor = (fill: Fill): string => fill.type === 'solid' ? fill.color : fill.type === 'gradient' ? fill.from : fill.background

/** A grid over `background`; the line color contrasts with it so a new grid is never invisible. */
export function defaultGrid(background: string, pattern: GridFill['pattern'] = 'lines'): GridFill {
  const line = background.toLowerCase() === DEFAULT_GRID_LINE ? '#ffffff' : DEFAULT_GRID_LINE
  return { type: 'grid', pattern, background, line, cell: 80, thickness: pattern === 'dots' ? 10 : 2 }
}

/** Switching keeps the leading color: it becomes the first gradient stop, or the grid's background. */
export function switchFillType(fill: Fill, type: Fill['type']): Fill {
  if (fill.type === type) return fill
  if (type === 'solid') return { type: 'solid', color: leadColor(fill) }
  if (type === 'grid') return defaultGrid(fill.type === 'solid' ? fill.color : leadColor(fill))
  return { type: 'gradient', from: leadColor(fill), to: fill.type === 'grid' ? fill.line : DEFAULT_GRADIENT_TO, angle: 135 }
}

/** Switching pattern re-picks a sensible line width, since a dot's size and a line's thickness are
 * different scales of the same field. */
const withPattern = (grid: GridFill, pattern: GridFill['pattern']): GridFill => ({
  ...grid, pattern, thickness: pattern === 'dots' ? Math.max(grid.thickness, 8) : Math.min(grid.thickness, 6),
})

function GridEditor({ idPrefix, grid, onDraft, onCommit }: { idPrefix: string; grid: GridFill; onDraft: (fill: Fill) => void; onCommit: (fill: Fill) => void }) {
  const setColor = (key: 'background' | 'line') => (value: string) => onDraft({ ...grid, [key]: value })
  const commitColor = (key: 'background' | 'line') => (value: string) => onCommit({ ...grid, [key]: value })
  const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value))
  const maxThickness = Math.min(48, Math.floor(grid.cell) - 1)
  return <>
    <Row label="Pattern">
      <Segmented id={`${idPrefix}-grid-pattern`} value={grid.pattern}
        options={[{ value: 'lines', label: 'Lines' }, { value: 'dots', label: 'Dots' }, { value: 'perspective', label: 'Floor', title: 'A receding perspective floor' }]}
        onChange={(pattern) => onCommit(withPattern(grid, pattern))} />
    </Row>
    <Row label="Background" htmlFor={`${idPrefix}-grid-background`}>
      <HexColorField id={`${idPrefix}-grid-background`} value={grid.background} onDraft={setColor('background')} onCommit={commitColor('background')} />
    </Row>
    <Row label={grid.pattern === 'dots' ? 'Dots' : 'Lines'} htmlFor={`${idPrefix}-grid-line`}>
      <HexColorField id={`${idPrefix}-grid-line`} value={grid.line} onDraft={setColor('line')} onCommit={commitColor('line')} />
    </Row>
    <Row label="Cell size" htmlFor={`${idPrefix}-grid-cell`} hint={grid.pattern === 'perspective' ? 'Measured along the bottom edge; cells shrink toward the horizon.' : undefined}>
      <SliderWithNumber id={`${idPrefix}-grid-cell`} min={8} max={400} value={Math.round(grid.cell)}
        onDraft={(cell) => onDraft({ ...grid, cell, thickness: Math.min(grid.thickness, Math.max(1, cell - 1)) })}
        onCommit={(cell) => { const next = clamp(cell, 8, 400); onCommit({ ...grid, cell: next, thickness: Math.min(grid.thickness, next - 1) }) }} />
    </Row>
    <Row label={grid.pattern === 'dots' ? 'Dot size' : 'Thickness'} htmlFor={`${idPrefix}-grid-thickness`}>
      <SliderWithNumber id={`${idPrefix}-grid-thickness`} min={1} max={maxThickness} value={Math.min(maxThickness, Math.round(grid.thickness))}
        onDraft={(thickness) => onDraft({ ...grid, thickness })} onCommit={(thickness) => onCommit({ ...grid, thickness: clamp(thickness, 1, maxThickness) })} />
    </Row>
    {grid.pattern === 'perspective' && <Row label="Horizon" htmlFor={`${idPrefix}-grid-horizon`}>
      <SliderWithNumber id={`${idPrefix}-grid-horizon`} min={10} max={80} unit="%" value={Math.round(gridHorizon(grid) * 100)}
        onDraft={(value) => onDraft({ ...grid, horizon: value / 100 })} onCommit={(value) => onCommit({ ...grid, horizon: clamp(value, 10, 80) / 100 })} />
    </Row>}
  </>
}

/**
 * Solid/Gradient picker for a background fill, using the same controls as the caption text fill
 * (`StylePanel`). `onDraft` previews while a slider drags; `onCommit` is one finished change.
 */
export function FillEditor({ idPrefix, fill, onDraft, onCommit }: {
  idPrefix: string
  fill: Fill
  onDraft: (fill: Fill) => void
  onCommit: (fill: Fill) => void
}) {
  const setStop = (key: 'color' | 'from' | 'to') => (value: string) => onDraft({ ...fill, [key]: value } as Fill)
  const commitStop = (key: 'color' | 'from' | 'to') => (value: string) => onCommit({ ...fill, [key]: value } as Fill)
  return <>
    <Row label="Fill">
      <Segmented id={`${idPrefix}-fill-type`} value={fill.type}
        options={[{ value: 'solid', label: 'Solid', icon: <DropIcon /> }, { value: 'gradient', label: 'Gradient', icon: <PaletteIcon /> }, { value: 'grid', label: 'Grid', icon: <GridIcon /> }]}
        onChange={(type) => onCommit(switchFillType(fill, type))} />
    </Row>
    {fill.type === 'grid' && <GridEditor idPrefix={idPrefix} grid={fill} onDraft={onDraft} onCommit={onCommit} />}
    {fill.type === 'solid' && <Row label="Color" htmlFor={`${idPrefix}-color`}>
      <HexColorField id={`${idPrefix}-color`} value={fill.color} onDraft={setStop('color')} onCommit={commitStop('color')} />
    </Row>}
    {fill.type === 'gradient' && <>
      <Row label="From" htmlFor={`${idPrefix}-from`}>
        <HexColorField id={`${idPrefix}-from`} value={fill.from} onDraft={setStop('from')} onCommit={commitStop('from')} />
      </Row>
      <Row label="To" htmlFor={`${idPrefix}-to`}>
        <HexColorField id={`${idPrefix}-to`} value={fill.to} onDraft={setStop('to')} onCommit={commitStop('to')} />
      </Row>
      <Row label="Angle" htmlFor={`${idPrefix}-angle`}>
        <SliderWithNumber id={`${idPrefix}-angle`} min={0} max={360} unit="°" value={Math.round(fill.angle)}
          onDraft={(angle) => onDraft({ ...fill, angle })} onCommit={(angle) => onCommit({ ...fill, angle: Math.max(0, Math.min(360, angle)) })} />
      </Row>
    </>}
  </>
}

type MotionType = BackgroundMotion['type'] | 'none'

/** The motion a type starts with; `shift` moves toward a contrasting second fill. */
export function defaultMotion(type: BackgroundMotion['type'], fill: Fill): BackgroundMotion {
  if (type === 'shift') return { type, to: shiftTarget(fill), periodUs: DEFAULT_MOTION_PERIOD_US }
  if (type === 'pulse') return { type, toward: 'black', depth: 0.4, periodUs: DEFAULT_MOTION_PERIOD_US }
  // A floor scrolls toward the viewer (180°); a flat grid glides sideways.
  if (type === 'scroll') return { type, direction: fill.type === 'grid' && fill.pattern === 'perspective' ? 180 : 90, periodUs: DEFAULT_GRID_SCROLL_PERIOD_US }
  return { type, direction: 90, periodUs: DEFAULT_MOTION_PERIOD_US }
}

/** A grid shifts to itself with its two colors traded, so the picture recolors without moving. */
function shiftTarget(fill: Fill): Fill {
  if (fill.type === 'solid') return { type: 'solid', color: DEFAULT_GRADIENT_TO }
  if (fill.type === 'grid') return { ...fill, background: fill.line, line: fill.background }
  return { type: 'gradient', from: fill.to, to: fill.from, angle: fill.angle }
}

const SCROLL_PERIOD_RANGE = { min: 0.25, max: 20, step: 0.25 }
const LOOP_PERIOD_RANGE = { min: 1, max: 20, step: 0.5 }

/** Preset motion for a background: color shift, pulse, drift (gradients) or scroll (grids). */
export function MotionEditor({ idPrefix, fill, motion, onDraft, onCommit }: {
  idPrefix: string
  fill: Fill
  motion: BackgroundMotion | null
  onDraft: (motion: BackgroundMotion) => void
  onCommit: (motion: BackgroundMotion | null) => void
}) {
  // A motion the fill cannot show (drift on a solid, scroll on a gradient) paints as a still, so it reads as None.
  const active = motion && motionApplies(fill, motion) ? motion : null
  const type: MotionType = active?.type ?? 'none'
  const isGrid = fill.type === 'grid'
  const options: { value: MotionType; label: string }[] = [{ value: 'none', label: 'None' }, { value: 'shift', label: 'Shift' }, { value: 'pulse', label: 'Pulse' },
    isGrid ? { value: 'scroll', label: 'Scroll' } : { value: 'drift', label: 'Drift' }]
  const range = active?.type === 'scroll' ? SCROLL_PERIOD_RANGE : LOOP_PERIOD_RANGE
  const hint = active?.type === 'scroll' ? 'Keeps moving without a loop point; the slider is the time one cell takes to pass.'
    : motion && !active ? `${motion.type === 'drift' ? 'Drift' : 'Scroll'} needs a ${motion.type === 'drift' ? 'gradient' : 'grid'}; this fill has nothing to ${motion.type === 'drift' ? 'pan' : 'scroll'}.`
      : 'Loops smoothly: it eases in and out, so it never jumps.'
  return <>
    <Row label="Motion" hint={hint}>
      <Segmented id={`${idPrefix}-motion`} value={type} options={options}
        onChange={(next) => onCommit(next === 'none' ? null : defaultMotion(next, fill))} />
    </Row>
    {active?.type === 'shift' && <FillEditor idPrefix={`${idPrefix}-shift`} fill={active.to}
      onDraft={(to) => onDraft({ ...active, to })} onCommit={(to) => onCommit({ ...active, to })} />}
    {active?.type === 'pulse' && <>
      <Row label="Toward">
        <Segmented id={`${idPrefix}-pulse-toward`} value={active.toward} options={[{ value: 'black', label: 'Darker' }, { value: 'white', label: 'Lighter' }]}
          onChange={(toward) => onCommit({ ...active, toward })} />
      </Row>
      <Row label="Depth" htmlFor={`${idPrefix}-pulse-depth`}>
        <SliderWithNumber id={`${idPrefix}-pulse-depth`} min={0} max={100} unit="%" value={Math.round(active.depth * 100)}
          onDraft={(value) => onDraft({ ...active, depth: value / 100 })} onCommit={(value) => onCommit({ ...active, depth: Math.max(0, Math.min(100, value)) / 100 })} />
      </Row>
    </>}
    {active?.type === 'scroll' && fill.type === 'grid' && fill.pattern === 'perspective' && <Row label="Direction">
      <Segmented id={`${idPrefix}-scroll-direction`} value={active.direction >= 90 && active.direction <= 270 ? 'toward' : 'away'}
        options={[{ value: 'toward', label: 'Toward you' }, { value: 'away', label: 'Away' }]}
        onChange={(next) => onCommit({ ...active, direction: next === 'toward' ? 180 : 0 })} />
    </Row>}
    {(active?.type === 'drift' || (active?.type === 'scroll' && !(fill.type === 'grid' && fill.pattern === 'perspective'))) && <Row label="Direction" htmlFor={`${idPrefix}-motion-direction`}>
      <SliderWithNumber id={`${idPrefix}-motion-direction`} min={0} max={360} unit="°" value={Math.round(active.direction)}
        onDraft={(direction) => onDraft({ ...active, direction })} onCommit={(direction) => onCommit({ ...active, direction: Math.max(0, Math.min(360, direction)) })} />
    </Row>}
    {active && <Row label={active.type === 'scroll' ? 'Seconds per cell' : 'Loop length'} htmlFor={`${idPrefix}-period`}>
      <SliderWithNumber id={`${idPrefix}-period`} min={range.min} max={range.max} step={range.step} unit=" s" value={active.periodUs / 1_000_000}
        onDraft={(seconds) => onDraft({ ...active, periodUs: Math.round(seconds * 1_000_000) })}
        onCommit={(seconds) => onCommit({ ...active, periodUs: Math.round(Math.max(range.min, Math.min(range.max, seconds)) * 1_000_000) })} />
    </Row>}
  </>
}
