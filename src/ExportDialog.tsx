import { useEffect, useRef, useState } from 'react'
import { formatSize } from './core/format'
import { formatClock } from './core/time'
import { RangeInput } from './style/controls'
import type { SequenceFormat } from './core/edit'
import { exportBitrate } from './export/plan'
import { estimateExportMs, formatEstimate } from './export/exportHistory'
import {
  DEFAULT_EXPORT_SETTINGS, EXPORT_PRESETS, estimateSizeBytes, exportSettingsSchema, exportWarnings, resolveExportFormat, resolveVideoBitrateKbps,
  settingsForPreset, type ExportFrameRate, type ExportResolution, type ExportSettings,
} from './export/settings'

const STORAGE_KEY = 'caption-studio.export-settings'

export type Stop<T> = { value: T; label: string; hint: string }
const RESOLUTIONS: Stop<ExportResolution>[] = [
  { value: 'source', label: 'Source', hint: 'Matches the project' },
  { value: 480, label: '480P', hint: 'Smallest file, lower quality' },
  { value: 720, label: '720P', hint: 'Good for quick sharing' },
  { value: 1080, label: '1080P', hint: 'High definition — the standard for most platforms' },
  { value: 1440, label: '2K', hint: 'Sharper on large screens' },
  { value: 2160, label: '4K', hint: 'Largest file and the slowest export' },
]
const FRAME_RATES: Stop<ExportFrameRate>[] = [
  { value: 'source', label: 'Source', hint: 'Same as the project' },
  { value: 24, label: '24', hint: 'Cinematic look' },
  { value: 25, label: '25', hint: 'Common in PAL regions' },
  { value: 30, label: '30', hint: 'Standard playback' },
  { value: 50, label: '50', hint: 'Smoother playback' },
  { value: 60, label: '60', hint: 'Smoothest playback' },
]
const BITRATES: Stop<number | null>[] = [
  { value: null, label: 'Auto', hint: 'Chosen for the resolution' },
  ...[2, 4, 6, 8, 12, 16, 24, 35, 53].map((mbps): Stop<number | null> => ({
    value: mbps * 1000, label: String(mbps), hint: mbps <= 4 ? 'Small file, softer detail' : mbps <= 12 ? 'Balanced quality and size' : 'High quality, large file',
  })),
]

function loadSettings(): ExportSettings {
  try {
    const parsed = exportSettingsSchema.safeParse(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'))
    if (parsed.success) return parsed.data
  } catch { /* storage unavailable: fall back to the defaults */ }
  return DEFAULT_EXPORT_SETTINGS
}
export const rateText = (rate: SequenceFormat['frameRate']) => `${Number((rate.numerator / rate.denominator).toFixed(2))} fps`
export const nearest = <T,>(stops: Stop<T>[], value: T, distance: (a: T, b: T) => number) =>
  stops.reduce((best, stop, index) => distance(stop.value, value) < distance(stops[best].value, value) ? index : best, 0)

export function StopSlider<T>({ label, stops, index, valueText, onChange }: {
  label: string; stops: Stop<T>[]; index: number; valueText: string; onChange(value: T): void
}) {
  return <section className="export-slider">
    <div className="export-slider-head"><h3>{label}</h3><span>{valueText}</span><small>{stops[index].hint}</small></div>
    <RangeInput ariaLabel={label} min={0} max={stops.length - 1} step={1} value={index}
      onChange={(i) => onChange(stops[i].value)} />
    <div className="export-slider-ticks" aria-hidden="true">{stops.map((stop, i) => <span key={i} className={i === index ? 'active' : ''}>{stop.label}</span>)}</div>
  </section>
}

/**
 * Output size, frame rate and bitrate for the MP4 export: platform chips that fill three snapping
 * sliders. Moving a slider makes the settings custom. The project's frame shape is never changed
 * here (`export/settings.ts`), so a platform that does not suit the shape only warns. Settings are
 * remembered per viewer (localStorage), never in the project.
 */
export function ExportDialog({ open, source, durationUs, range, onClose, onExport }: {
  open: boolean
  /** The project's output frame, or null before any video has been probed. */
  source: SequenceFormat | null
  durationUs: number
  /** The valid In/Out marks, or null when none are set. */
  range: { startUs: number; endUs: number } | null
  onClose(): void
  onExport(settings: ExportSettings): void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [useRange, setUseRange] = useState(false)
  const [settings, setSettings] = useState<ExportSettings>(DEFAULT_EXPORT_SETTINGS)

  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (open && !element.open) { setSettings(loadSettings()); setUseRange(range !== null); element.showModal() }
    else if (!open && element.open) element.close()
  }, [open])

  const output = source ? resolveExportFormat(source, settings) : null
  const explicitKbps = output ? resolveVideoBitrateKbps(settings, output) : null
  const autoKbps = output ? Number.parseInt(exportBitrate(output.width, output.height), 10) * 1000 : 0
  const kbps = explicitKbps ?? autoKbps
  const warnings = source ? exportWarnings(source, settings) : []
  const spanUs = useRange && range ? range.endUs - range.startUs : durationUs
  const timeMs = output && open ? estimateExportMs({ width: output.width, height: output.height, frameCount: Math.round(spanUs / 1e6 * output.frameRate.numerator / output.frameRate.denominator) }) : null
  const change = (patch: Partial<ExportSettings>) => setSettings((current) => ({ ...current, preset: 'custom', ...patch }))

  // A chip fills the sliders, including the bitrate it implies for its own output rate, so what the
  // sliders show is exactly what is exported.
  const choosePreset = (id: (typeof EXPORT_PRESETS)[number]['id']) => {
    const next = settingsForPreset(id)
    const out = source ? resolveExportFormat(source, next) : null
    setSettings({ ...next, videoBitrateKbps: out ? resolveVideoBitrateKbps(next, out) : null })
  }
  const start = () => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)) } catch { /* not remembered */ }
    onExport(useRange && range ? { ...settings, range } : settings)
  }

  const resIndex = nearest(RESOLUTIONS, settings.resolution, (a, b) => a === b ? 0 : 1)
  const rateIndex = nearest(FRAME_RATES, settings.frameRate, (a, b) => a === b ? 0 : 1)
  const bitrateIndex = nearest(BITRATES, settings.videoBitrateKbps, (a, b) => a === null || b === null ? (a === b ? 0 : Infinity) : Math.abs(a - b))

  return <dialog ref={dialog} className="model-dialog export-dialog" aria-labelledby="export-dialog-title" onClose={onClose} onKeyDown={(event) => event.stopPropagation()}>
    <div className="model-panel-heading"><h2 id="export-dialog-title">Export video</h2><button onClick={onClose}>Close</button></div>
    <div className="export-chips" role="group" aria-label="Platform presets">
      {EXPORT_PRESETS.map((preset) => <button key={preset.id} className={settings.preset === preset.id ? 'export-chip selected' : 'export-chip'}
        aria-pressed={settings.preset === preset.id} title={preset.detail} onClick={() => choosePreset(preset.id)}>{preset.label}</button>)}
    </div>
    <StopSlider label="Resolution" stops={RESOLUTIONS} index={resIndex}
      valueText={output ? `${output.width} × ${output.height}` : RESOLUTIONS[resIndex].label} onChange={(resolution) => change({ resolution })} />
    <StopSlider label="Frame rate" stops={FRAME_RATES} index={rateIndex}
      valueText={output ? rateText(output.frameRate) : FRAME_RATES[rateIndex].label} onChange={(frameRate) => change({ frameRate })} />
    <StopSlider label="Bitrate (Mbps)" stops={BITRATES} index={bitrateIndex}
      valueText={output ? `${(kbps / 1000).toFixed(kbps % 1000 ? 1 : 0)} Mbps${explicitKbps === null ? ' (auto)' : ''}` : BITRATES[bitrateIndex].label}
      onChange={(videoBitrateKbps) => change({ videoBitrateKbps })} />
    <label className="export-range"><input type="checkbox" checked={useRange && range !== null} disabled={range === null} onChange={(event) => setUseRange(event.target.checked)} />
      {range ? ` Only the In–Out range (${formatClock(range.startUs)} – ${formatClock(range.endUs)})` : ' Only the In–Out range (mark In and Out with I / O first)'}</label>
    {warnings.map((warning) => <p key={warning} className="export-warning" role="alert">{warning}</p>)}
    <div className="export-footer">
      {output ? <p className="export-summary" role="status">About {formatSize(estimateSizeBytes(spanUs, kbps))} (estimate){timeMs === null ? '' : ` · ${formatEstimate(timeMs)} on this machine (estimate)`}</p>
        : <p className="export-summary">The output size is decided when the first video is probed.</p>}
      <button onClick={onClose}>Cancel</button>
      <button className="accent" onClick={start}>Export…</button>
    </div>
  </dialog>
}
