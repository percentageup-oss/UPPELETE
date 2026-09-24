import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDownIcon, ChevronRightIcon, EyedropperIcon, ResetIcon } from './icons'

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
export function Row({ label, htmlFor, onReset, isDefault = true, hint, labelHidden = false, children }: {
  label: string; htmlFor?: string; onReset?: () => void; isDefault?: boolean; hint?: string; labelHidden?: boolean; children: ReactNode
}) {
  return <div className="style-row">
    <label className={labelHidden ? 'style-row-label sr-only' : 'style-row-label'} htmlFor={htmlFor}>{label}</label>
    {labelHidden && <span className="style-row-label" aria-hidden="true" />}
    <div className="style-row-control">{children}</div>
    {onReset
      ? <button type="button" className="style-reset" aria-label={`Reset ${label}`} disabled={isDefault} onClick={onReset}><ResetIcon /></button>
      : <span className="style-reset-spacer" aria-hidden="true" />}
    {hint && <p className="style-hint">{hint}</p>}
  </div>
}

/** A dropdown: a real `<select>` (long lists like installed fonts stay keyboard- and screen-reader-
 * accessible) drawn with a trailing chevron, like the reference's Font / Direction rows. */
export type SelectOption<T extends string> = { value: T; label: string; group?: string }

export function Select<T extends string>({ id, value, options, ariaLabel, onChange, onOpen, searchable }: {
  id: string; value: T; options: readonly SelectOption<T>[]; ariaLabel?: string; onChange: (value: T) => void; onOpen?: () => void
  /** Always use the in-window searchable popover (font menus, whose list grows after they mount). */
  searchable?: boolean
}) {
  if (searchable || options.length > LONG_LIST) return <PopoverSelect id={id} value={value} options={options} ariaLabel={ariaLabel} onChange={onChange} onOpen={onOpen} />
  return <div className="ins-select">
    <select id={id} value={value} aria-label={ariaLabel} onChange={(event) => onChange(event.target.value as T)}>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
    <ChevronDownIcon className="ins-select-chevron" />
  </div>
}

/** Above this many options the native `<select>` popup (which macOS draws as an unconstrained menu
 * that spills past the window edges) is replaced by an in-window popover. */
const LONG_LIST = 25

function PopoverSelect<T extends string>({ id, value, options, ariaLabel, onChange, onOpen }: {
  id: string; value: T; options: readonly SelectOption<T>[]; ariaLabel?: string; onChange: (value: T) => void; onOpen?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [box, setBox] = useState<{ left: number; width: number; top?: number; bottom?: number; maxHeight: number } | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const selected = options.find((option) => option.value === value)
  const needle = query.trim().toLowerCase()
  const shown = needle ? options.filter((option) => option.label.toLowerCase().includes(needle)) : options

  const show = () => {
    const rect = trigger.current?.getBoundingClientRect()
    if (!rect) return
    const margin = 8
    const below = window.innerHeight - rect.bottom - margin
    const above = rect.top - margin
    const openBelow = below >= 220 || below >= above
    const width = Math.min(Math.max(rect.width, 220), window.innerWidth - margin * 2)
    const left = Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin))
    setBox(openBelow
      ? { left, width, top: rect.bottom + 2, maxHeight: Math.max(120, below) }
      : { left, width, bottom: window.innerHeight - rect.top + 2, maxHeight: Math.max(120, above) })
    setQuery('')
    setActive(Math.max(0, options.findIndex((option) => option.value === value)))
    setOpen(true)
    onOpen?.()
  }

  useEffect(() => {
    if (!open) return
    pop.current?.querySelector('input')?.focus()
    const close = (event: Event) => { if (!(event.target instanceof Node && pop.current?.contains(event.target))) setOpen(false) }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); trigger.current?.focus() }
    }
    window.addEventListener('pointerdown', close, true)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointerdown', close, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  useEffect(() => {
    if (open) list.current?.children[active]?.scrollIntoView({ block: 'nearest' })
  }, [open, active, needle])

  const pick = (next: T) => { setOpen(false); trigger.current?.focus(); if (next !== value) onChange(next) }
  const move = (delta: number) => {
    const index = options.findIndex((option) => option.value === value)
    const next = options[Math.max(0, Math.min(options.length - 1, index + delta))]
    if (next) onChange(next.value)
  }

  return <div className="ins-select">
    <button ref={trigger} id={id} type="button" className="ins-select-trigger" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open}
      onClick={() => (open ? setOpen(false) : show())}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown' && !open) { event.preventDefault(); move(1) }
        else if (event.key === 'ArrowUp' && !open) { event.preventDefault(); move(-1) }
        else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open ? setOpen(false) : show() }
      }}>
      <span>{selected?.label ?? value}</span>
    </button>
    <ChevronDownIcon className="ins-select-chevron" />
    {open && box && createPortal(
      <div ref={pop} className="ins-select-popover" style={{ left: box.left, width: box.width, top: box.top, bottom: box.bottom, maxHeight: box.maxHeight }}>
        <input type="search" className="ins-select-search" placeholder="Search…" aria-label={`Search ${ariaLabel ?? 'options'}`} value={query} autoComplete="off" spellCheck={false}
          onChange={(event) => { setQuery(event.target.value); setActive(0) }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') { event.preventDefault(); setActive((index) => Math.min(shown.length - 1, index + 1)) }
            else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => Math.max(0, index - 1)) }
            else if (event.key === 'Enter') { event.preventDefault(); const choice = shown[active]; if (choice) pick(choice.value) }
          }} />
        <ul ref={list} role="listbox" aria-label={ariaLabel}>
          {shown.flatMap((option, index) => {
            const heading = option.group && option.group !== shown[index - 1]?.group
              ? [<li key={`group:${option.group}`} className="group" role="presentation">{option.group}</li>] : []
            return [...heading, <li key={option.value} role="option" aria-selected={option.value === value}
              className={[option.value === value ? 'selected' : '', index === active ? 'active' : ''].join(' ').trim() || undefined}
              onMouseMove={() => index !== active && setActive(index)} onClick={() => pick(option.value)}>{option.label}</li>]
          })}
          {shown.length === 0 && <li className="empty" role="presentation">No matching fonts</li>}
        </ul>
      </div>, document.body)}
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

/** The app's one slider: thin neutral track with a live filled portion (`--fill`) and a round thumb.
 * Every range input in the app goes through this so they all share `input[type="range"].ins-range`. */
export function RangeInput({ id, ariaLabel, min, max, step = 1, value, disabled = false, onChange, onCommit }: {
  id?: string; ariaLabel?: string; min: number; max: number; step?: number; value: number; disabled?: boolean
  onChange: (value: number) => void; onCommit?: () => void
}) {
  const fill = max > min ? Math.max(0, Math.min(1, (value - min) / (max - min))) * 100 : 0
  return <input id={id} className="ins-range" type="range" aria-label={ariaLabel} min={min} max={max} step={step} value={value} disabled={disabled}
    style={{ '--fill': `${fill}%` } as CSSProperties}
    onChange={(event) => onChange(Number(event.target.value))} onPointerUp={onCommit} onKeyUp={onCommit} />
}

/** A range slider paired with a `NumberField` readout, matching the app's existing draft-on-change
 * / commit-on-release control contract. The filled portion of the track (`--fill`) tracks the
 * value live, like the reference control system's sliders. */
export function SliderWithNumber({ id, min, max, step = 1, value, unit, disabled = false, endLabels, onDraft, onCommit }: {
  id: string; min: number; max: number; step?: number; value: number; unit?: string; disabled?: boolean; endLabels?: readonly [string, string]
  onDraft: (value: number) => void; onCommit: (value: number) => void
}) {
  return <div className={endLabels ? 'slider-number with-end-labels' : 'slider-number'}>
    <RangeInput id={id} min={min} max={max} step={step} value={value} disabled={disabled}
      onChange={onDraft} onCommit={() => onCommit(value)} />
    {endLabels && <span className="slider-end-labels" aria-hidden="true"><span>{endLabels[0]}</span><span>{endLabels[1]}</span></span>}
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

type EyeDropperCtor = new () => { open: () => Promise<{ sRGBHex: string }> }
function eyeDropperApi(): EyeDropperCtor | null {
  return typeof window === 'undefined' ? null : ((window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper ?? null)
}

/** A wide color swatch (a native color input drawn over it), an eyedropper where Chromium's local
 * `EyeDropper` API exists, and a validated `#RRGGBB` text field, sharing one draft/commit contract. */
export function HexColorField({ id, value, onDraft, onCommit }: { id: string; value: string; onDraft: (value: string) => void; onCommit: (value: string) => void }) {
  const [text, setText] = useState(value.replace(/^#/, ''))
  useEffect(() => setText(value.replace(/^#/, '')), [value])
  const EyeDropper = eyeDropperApi()
  const pick = async () => {
    if (!EyeDropper) return
    try {
      const { sRGBHex } = await new EyeDropper().open()
      if (HEX_PATTERN.test(sRGBHex)) { onDraft(sRGBHex.toLowerCase()); onCommit(sRGBHex.toLowerCase()) }
    } catch { /* Escape / dismissed: nothing to change */ }
  }
  return <div className="color-field">
    <input id={id} className="color-swatch" type="color" value={value} onChange={(event) => { onDraft(event.target.value); onCommit(event.target.value) }} />
    {EyeDropper && <button type="button" className="color-eyedropper" aria-label="Pick color from screen" title="Pick color from screen" onClick={pick}><EyedropperIcon /></button>}
    <span className="hex-field">
      <span className="hex-prefix" aria-hidden="true">#</span>
      <input id={`${id}-hex`} type="text" value={text} maxLength={6} aria-label="Hex color" onChange={(event) => {
        const next = event.target.value.replace(/^#/, '')
        if (!HEX_CHARS.test(next)) return
        setText(next)
        const candidate = `#${next}`
        if (HEX_PATTERN.test(candidate)) { onDraft(candidate); onCommit(candidate) }
      }} />
    </span>
  </div>
}

/** A styled single-line text input for names and short text (replaces bare `.editor-form` inputs). */
export function TextField({ id, value, ariaLabel, invalid, describedBy, onChange, onBlur }: {
  id: string; value: string; ariaLabel?: string; invalid?: boolean; describedBy?: string; onChange: (value: string) => void; onBlur?: () => void
}) {
  return <input id={id} className="ins-input" type="text" value={value} aria-label={ariaLabel} aria-invalid={invalid} aria-describedby={describedBy}
    onChange={(event) => onChange(event.target.value)} onBlur={onBlur} />
}

/** The secondary/danger action row at the bottom of an inspector. */
export function ActionBar({ children }: { children: ReactNode }) { return <div className="edit-actions ins-actions">{children}</div> }
