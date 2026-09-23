import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { ChevronDownIcon, ChevronRightIcon, ChevronUpIcon, ResetIcon } from './icons'

/** A collapsible labelled group of style rows, built on native `<details>` for free keyboard
 * and screen-reader support (no custom ARIA state to keep in sync). */
export function Section({ id, title, defaultOpen = true, children }: { id: string; title: string; defaultOpen?: boolean; children: ReactNode }) {
  return <details className="style-section" data-section={id} open={defaultOpen}>
    <summary><ChevronRightIcon className="style-section-chevron" /><span>{title}</span></summary>
    <div className="style-section-body">{children}</div>
  </details>
}

/** One labelled control row: label · control · a trailing column, always reserved (even with
 * nothing in it) so every row's control lines up in the same place across every inspector. Today
 * the trailing column holds only the reset-to-default button; it is reserved so a future per-
 * property keyframe toggle can drop in without reflowing every row. */
export function Row({ label, htmlFor, onReset, isDefault = true, hint, children }: {
  label: string; htmlFor?: string; onReset?: () => void; isDefault?: boolean; hint?: string; children: ReactNode
}) {
  return <div className="style-row">
    <label className="style-row-label" htmlFor={htmlFor}>{label}</label>
    <div className="style-row-control">{children}</div>
    {onReset
      ? <button type="button" className="style-reset" aria-label={`Reset ${label}`} disabled={isDefault} onClick={onReset}><ResetIcon /></button>
      : <span className="style-reset-spacer" aria-hidden="true" />}
    {hint && <p className="style-hint">{hint}</p>}
  </div>
}

/** A "stepper": a real `<select>` (the visible value box, so long lists — installed fonts, font
 * faces — stay keyboard- and screen-reader-accessible) with prev/next chevrons stacked beside it
 * for one-click cycling. */
export function Stepper<T extends string>({ id, value, options, onChange }: {
  id: string; value: T; options: readonly { value: T; label: string }[]; onChange: (value: T) => void
}) {
  const index = options.findIndex((option) => option.value === value)
  const move = (delta: number) => {
    if (!options.length) return
    const next = options[(((index < 0 ? 0 : index) + delta) % options.length + options.length) % options.length]
    onChange(next.value)
  }
  return <div className="stepper">
    <select id={id} value={value} onChange={(event) => onChange(event.target.value as T)}>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
    <span className="stepper-buttons">
      <button type="button" aria-label="Previous" onClick={() => move(-1)} disabled={options.length < 2}><ChevronUpIcon /></button>
      <button type="button" aria-label="Next" onClick={() => move(1)} disabled={options.length < 2}><ChevronDownIcon /></button>
    </span>
  </div>
}

/** A typed number, or `null` while the text is not a number yet (empty, "-", "."), so a
 * half-typed value never reaches the project. */
export function parseNumber(text: string): number | null {
  if (!text.trim()) return null
  const n = Number(text)
  return Number.isFinite(n) ? n : null
}

/** A typed percentage as a 0–1 fraction clamped to the range, or `null` while the text is not a
 * number yet. */
export function parsePercent(text: string): number | null {
  const percent = parseNumber(text)
  return percent === null ? null : Math.max(0, Math.min(100, percent)) / 100
}

function decimalsOf(step: number): number {
  const text = String(step)
  const point = text.indexOf('.')
  return point === -1 ? 0 : text.length - point - 1
}

function roundToStep(value: number, step: number): number {
  const factor = 10 ** decimalsOf(step)
  return Math.round(value * factor) / factor
}

/** A bordered numeric value box: a real `<input>` (not `type="number"`, whose browser-drawn
 * spinner arrows eat most of the box's width and were clipping values like "0.76" down to "0.7").
 * The typed text is held locally, like a normal text field, so a half-typed value ("0.", on the
 * way to "0.76") is never reformatted out from under the caret — each valid keystroke drafts to
 * the preview, and the value commits, clamped, once on blur or Enter. Arrow keys step by `step`
 * (×10 with Shift) and commit immediately, matching the paired slider's own step. */
export function NumberField({ id, value, min, max, step = 1, unit, disabled = false, ariaLabel, onDraft, onCommit }: {
  id: string; value: number; min?: number; max?: number; step?: number; unit?: string; disabled?: boolean; ariaLabel?: string
  onDraft: (value: number) => void; onCommit: (value: number) => void
}) {
  const [text, setText] = useState<string | null>(null)
  const shown = text ?? String(value)
  const clamp = (n: number) => Math.max(min ?? -Infinity, Math.min(max ?? Infinity, n))
  const step10 = (delta: 1 | -1, multiplier = 1) => {
    const next = clamp(roundToStep(value + delta * step * multiplier, step))
    setText(null)
    onDraft(next)
    onCommit(next)
  }
  return <span className="number-field">
    <input id={id} type="text" inputMode="decimal" value={shown} disabled={disabled} aria-label={ariaLabel}
      onChange={(event) => {
        setText(event.target.value)
        const parsed = parseNumber(event.target.value)
        if (parsed !== null) onDraft(parsed)
      }}
      onBlur={() => {
        const parsed = text === null ? null : parseNumber(text)
        setText(null)
        onCommit(clamp(parsed ?? value))
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') { event.currentTarget.blur(); return }
        if (event.key === 'Escape') { setText(null); event.currentTarget.blur(); return }
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
        event.preventDefault()
        step10(event.key === 'ArrowUp' ? 1 : -1, event.shiftKey ? 10 : 1)
      }} />
    {unit && <span className="number-field-unit" aria-hidden="true">{unit}</span>}
  </span>
}

/** A range slider paired with a `NumberField` readout, matching the app's existing draft-on-change
 * / commit-on-release control contract. The filled portion of the track (`--fill`) tracks the
 * value live, like the reference control system's sliders. */
export function SliderWithNumber({ id, min, max, step = 1, value, unit, disabled = false, onDraft, onCommit }: {
  id: string; min: number; max: number; step?: number; value: number; unit?: string; disabled?: boolean
  onDraft: (value: number) => void; onCommit: (value: number) => void
}) {
  const fill = max > min ? Math.max(0, Math.min(1, (value - min) / (max - min))) * 100 : 0
  return <div className="slider-number">
    <input id={id} type="range" min={min} max={max} step={step} value={value} disabled={disabled}
      style={{ '--fill': `${fill}%` } as CSSProperties}
      onChange={(event) => onDraft(Number(event.target.value))} onPointerUp={() => onCommit(value)} onKeyUp={() => onCommit(value)} />
    <NumberField id={`${id}-value`} value={value} min={min} max={max} step={step} unit={unit} disabled={disabled} onDraft={onDraft} onCommit={onCommit} />
  </div>
}

/** A 0–1 fraction edited as a percentage, built on `NumberField`. */
export function PercentField({ id, value, disabled, onDraft, onCommit }: {
  id: string; value: number; disabled?: boolean; onDraft: (fraction: number) => void; onCommit: (fraction: number) => void
}) {
  return <NumberField id={id} value={Math.round(value * 1000) / 10} min={0} max={100} step={.1} unit="%" disabled={disabled}
    onDraft={(percent) => onDraft(Math.max(0, Math.min(100, percent)) / 100)}
    onCommit={(percent) => onCommit(Math.max(0, Math.min(100, percent)) / 100)} />
}

/** A row of timecode fields (Start/Length, Start/End, …), each `HH:MM:SS:mmm` text parsed and
 * validated by the caller (`core/time.ts`'s `parseEditedTimestamp`). Shared by every inspector's
 * timing row so they all read and lay out identically. */
export function TimeFields({ fields }: {
  fields: readonly { id: string; label: string; value: string; ariaLabel?: string; onChange: (text: string) => void; onBlur: () => void }[]
}) {
  return <div className="time-fields">
    {fields.map((field) => <label key={field.id} htmlFor={field.id}>{field.label}
      <input id={field.id} aria-label={field.ariaLabel} value={field.value}
        onChange={(event) => field.onChange(event.target.value)} onBlur={field.onBlur} />
    </label>)}
  </div>
}

/** An on/off switch; commits immediately (no draft phase), like the app's other discrete controls.
 * `hideLabel` visually hides the switch's own label when the row it sits in already names it. */
export function Toggle({ id, checked, label, hideLabel = false, onChange }: { id: string; checked: boolean; label: string; hideLabel?: boolean; onChange: (checked: boolean) => void }) {
  return <button id={id} type="button" role="switch" aria-checked={checked} className={`switch ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}>
    <span className="switch-track"><span className="switch-thumb" /></span>
    <span className={hideLabel ? 'switch-label sr-only' : 'switch-label'}>{label}</span>
  </button>
}

/** A small set of mutually-exclusive buttons (Solid/Gradient, Emphasize/Spotlight, alignment, …).
 * `variant="icons"` renders a compact row of square icon buttons (Styles, Alignment) instead of the
 * default full-width text pill. */
export function Segmented<T extends string>({ id, value, options, variant = 'pill', onChange }: {
  id: string; value: T; options: readonly { value: T; label: ReactNode; title?: string; icon?: ReactNode }[]
  variant?: 'pill' | 'icons'; onChange: (value: T) => void
}) {
  return <div id={id} className={`segmented ${variant === 'icons' ? 'icons' : ''}`} role="group">
    {options.map((option) => <button key={option.value} type="button" title={option.title}
      className={value === option.value ? 'active' : ''} aria-pressed={value === option.value} onClick={() => onChange(option.value)}>
      {/* The compact icon variant shows only the icon (or a text glyph standing in for one, e.g. "Tt");
        * the full-width pill variant shows an optional leading icon alongside its text label. */}
      {variant === 'icons' ? (option.icon ?? option.label) : <>{option.icon}{option.label}</>}
    </button>)}
  </div>
}

const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/
const HEX_CHARS = /^[0-9a-fA-F]{0,6}$/

/** A color swatch plus a validated `#RRGGBB` text field (a static "#" prefix beside a 6-char
 * input), sharing one draft/commit contract. */
export function HexColorField({ id, value, onDraft, onCommit }: { id: string; value: string; onDraft: (value: string) => void; onCommit: (value: string) => void }) {
  const [text, setText] = useState(value.replace(/^#/, ''))
  useEffect(() => setText(value.replace(/^#/, '')), [value])
  return <div className="hex-field">
    <input id={id} type="color" value={value} onChange={(event) => { onDraft(event.target.value); onCommit(event.target.value) }} />
    <span className="hex-prefix" aria-hidden="true">#</span>
    <input id={`${id}-hex`} type="text" value={text} maxLength={6} aria-label="Hex color" onChange={(event) => {
      const next = event.target.value.replace(/^#/, '')
      if (!HEX_CHARS.test(next)) return
      setText(next)
      const candidate = `#${next}`
      if (HEX_PATTERN.test(candidate)) { onDraft(candidate); onCommit(candidate) }
    }} />
  </div>
}
