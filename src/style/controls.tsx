import { useEffect, useState, type ReactNode } from 'react'
import { ChevronDownIcon, ChevronRightIcon, ChevronUpIcon, ResetIcon } from './icons'

/** A collapsible labelled group of style rows, built on native `<details>` for free keyboard
 * and screen-reader support (no custom ARIA state to keep in sync). */
export function Section({ id, title, defaultOpen = true, children }: { id: string; title: string; defaultOpen?: boolean; children: ReactNode }) {
  return <details className="style-section" data-section={id} open={defaultOpen}>
    <summary><ChevronRightIcon className="style-section-chevron" /><span>{title}</span></summary>
    <div className="style-section-body">{children}</div>
  </details>
}

/** One labelled control row with an optional reset-to-default button. The reset column is always
 * reserved (even without a reset) so every row's control lines up in the same place. */
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

/** A range slider paired with a numeric readout/input, matching the app's existing
 * draft-on-change / commit-on-release control contract. The unit renders inside the number box. */
export function SliderWithNumber({ id, min, max, step = 1, value, unit, onDraft, onCommit }: {
  id: string; min: number; max: number; step?: number; value: number; unit?: string
  onDraft: (value: number) => void; onCommit: (value: number) => void
}) {
  return <div className="slider-number">
    <input id={id} type="range" min={min} max={max} step={step} value={value}
      onChange={(event) => onDraft(Number(event.target.value))} onPointerUp={() => onCommit(value)} onKeyUp={() => onCommit(value)} />
    <span className="slider-value">
      <input id={`${id}-value`} type="number" min={min} max={max} step={step} value={value}
        onChange={(event) => onDraft(Number(event.target.value))} onBlur={() => onCommit(Math.max(min, Math.min(max, value)))} />
      {unit && <span aria-hidden="true">{unit}</span>}
    </span>
  </div>
}

/** A typed percentage as a 0–1 fraction clamped to the range, or null while the text is not a
 * number yet (empty, "-", "."), so a half-typed value never reaches the project. */
export function parsePercent(text: string): number | null {
  if (!text.trim()) return null
  const percent = Number(text)
  return Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) / 100 : null
}

/** A 0–1 fraction edited as a percentage. The typed text is held locally so intermediate input
 * ("7" on the way to "70") is never reformatted under the caret; each valid keystroke drafts to
 * the preview and the value commits once on blur or Enter. */
export function PercentField({ id, value, onDraft, onCommit }: {
  id: string; value: number; onDraft: (fraction: number) => void; onCommit: (fraction: number) => void
}) {
  const [text, setText] = useState<string | null>(null)
  const shown = text ?? String(Math.round(value * 1000) / 10)
  return <div className="unit-field">
    <input id={id} type="number" min={0} max={100} step={.1} value={shown}
      onChange={(event) => {
        setText(event.target.value)
        const fraction = parsePercent(event.target.value)
        if (fraction !== null) onDraft(fraction)
      }}
      onBlur={() => {
        const fraction = text === null ? null : parsePercent(text)
        setText(null)
        onCommit(fraction ?? value)
      }}
      onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} />
    <span aria-hidden="true">%</span>
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
