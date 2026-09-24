import { useEffect, useRef, useState } from 'react'
import type { SequenceFormat } from './core/edit'
import { nearest, rateText, StopSlider, type Stop } from './ExportDialog'
import { resolveExportFormat, type ExportFrameRate, type ExportResolution } from './export/settings'

const RESOLUTIONS: Stop<ExportResolution>[] = [
  { value: 'source', label: 'Current', hint: 'Keep this size' },
  { value: 480, label: '480P', hint: 'Lightest to play back and edit' },
  { value: 720, label: '720P', hint: 'Good balance while editing' },
  { value: 1080, label: '1080P', hint: 'Full HD — the usual delivery size' },
  { value: 1440, label: '2K', hint: 'Sharper on large screens' },
  { value: 2160, label: '4K', hint: 'Matches most 4K source video' },
]
const FRAME_RATES: Stop<ExportFrameRate>[] = [
  { value: 'source', label: 'Current', hint: 'Keep this rate' },
  { value: 24, label: '24', hint: 'Cinematic look' },
  { value: 25, label: '25', hint: 'Common in PAL regions' },
  { value: 30, label: '30', hint: 'Standard playback' },
  { value: 50, label: '50', hint: 'Smoother playback' },
  { value: 60, label: '60', hint: 'Smoothest playback' },
]

/**
 * Lets the user resize `project.format` — the output frame every clip, caption and effect is
 * composited into (docs/EDITING.md) — after it has already been seeded from the first video. A 4K
 * import otherwise pins the sequence at 4K for its whole life even when only a 1080p/2K delivery is
 * wanted. Reuses `resolveExportFormat`'s short-edge scaling (`src/export/settings.ts`), the same math
 * export already uses to fit a platform preset, so this dialog and export presets never compute two
 * different answers for "scale to 1080p". Applying goes through the undoable `format-set` command
 * (`src/core/clipCommands.ts`), so Undo restores the previous frame exactly.
 *
 * v1 keeps the current aspect ratio: resolution presets scale the short edge only. The composition
 * captions/effects lay out in is fixed-width and aspect-driven (`src/core/format.ts`
 * `formatAspect`/`compositionFor`), so a resolution-only change never reflows a caption or text
 * layer's placement; an aspect change would, and needs its own design.
 *
 * This does not change what preview decodes: playback proxies (`src/core/proxy.ts`) make preview of
 * large sources lighter, while this dialog sets what gets rendered into (captions, effects, export
 * default). Reachable from the View menu and the transport-bar preview chip.
 */
export function SequenceSettingsDialog({ open, format, onClose, onApply }: {
  open: boolean
  /** Null before any video has set the sequence's frame; the caller should not open the dialog then. */
  format: SequenceFormat | null
  onClose(): void
  onApply(format: SequenceFormat): void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [resolution, setResolution] = useState<ExportResolution>('source')
  const [frameRate, setFrameRate] = useState<ExportFrameRate>('source')

  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (open && !element.open) { setResolution('source'); setFrameRate('source'); element.showModal() }
    else if (!open && element.open) element.close()
  }, [open])

  const output = format ? resolveExportFormat(format, { preset: 'custom', resolution, frameRate, videoBitrateKbps: null }) : null
  const changed = output !== null && format !== null && output !== format
  const resIndex = nearest(RESOLUTIONS, resolution, (a, b) => a === b ? 0 : 1)
  const rateIndex = nearest(FRAME_RATES, frameRate, (a, b) => a === b ? 0 : 1)

  const apply = () => {
    if (output && changed) onApply(output)
    onClose()
  }

  return <dialog ref={dialog} className="model-dialog export-dialog" aria-labelledby="sequence-settings-title" onClose={onClose} onKeyDown={(event) => event.stopPropagation()}>
    <div className="model-panel-heading"><h2 id="sequence-settings-title">Sequence settings</h2><button onClick={onClose}>Close</button></div>
    <p>The output frame every clip, caption and effect is composited into. Export can still target a different size on top of this.</p>
    <StopSlider label="Resolution" stops={RESOLUTIONS} index={resIndex}
      valueText={output ? `${output.width} × ${output.height}` : RESOLUTIONS[resIndex].label} onChange={setResolution} />
    <StopSlider label="Frame rate" stops={FRAME_RATES} index={rateIndex}
      valueText={output ? rateText(output.frameRate) : FRAME_RATES[rateIndex].label} onChange={setFrameRate} />
    <div className="export-footer">
      <p className="export-summary" role="status">{format && <>Currently {format.width} × {format.height} · {rateText(format.frameRate)}</>}</p>
      <button onClick={onClose}>Cancel</button>
      <button className="accent" onClick={apply} disabled={!changed}>Apply</button>
    </div>
  </dialog>
}
