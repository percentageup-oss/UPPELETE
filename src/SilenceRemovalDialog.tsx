import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Row, SliderWithNumber } from './style/controls'
import { formatClock, US_PER_SECOND } from './core/time'
import { keptRangesFromSilences, SILENCE_DETECTION_DEFAULTS, summarizeSilenceRemoval, type SilenceDetectionOptions } from './core/silenceRemoval'
import type { TimeRange } from './core/timelineModel'

type DetectionState =
  | { kind: 'idle' }
  | { kind: 'detecting'; requestId: string; percent: number | null }
  | { kind: 'ready'; silences: TimeRange[]; durationUs: number; forOptions: SilenceDetectionOptions }
  | { kind: 'error'; message: string }

/**
 * DaVinci-Resolve-style "remove silence": pick a dB range (plus how long a pause has to be, and
 * how much of it to keep as breathing room), detect, review a summary, then apply. Modeled on
 * `SettingsDialog.tsx`'s native `<dialog>` pattern. Detection results are tied to the exact
 * threshold/minimum-silence they were produced with (`forOptions`); changing either invalidates
 * them and Apply is disabled until Detect runs again — padding alone re-summarises instantly
 * since it never needs another pass over the audio.
 */
export function SilenceRemovalDialog({ open, mediaReady, onClose, onDetect, onCancelDetect, onApply, hasExistingCuts, videoName = null, picker = null }: {
  open: boolean
  mediaReady: boolean
  /** The video silence is detected in (the picked one, else the one under the playhead). */
  videoName?: string | null
  /** A video picker, shown when the timeline has several videos. */
  picker?: ReactNode
  onClose(): void
  onDetect(requestId: string, options: SilenceDetectionOptions, onProgress: (percent: number | null) => void): Promise<{ durationUs: number; silences: TimeRange[] }>
  onCancelDetect(requestId: string): void
  onApply(ranges: TimeRange[]): void
  hasExistingCuts: boolean
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [options, setOptions] = useState<SilenceDetectionOptions>(SILENCE_DETECTION_DEFAULTS)
  const [state, setState] = useState<DetectionState>({ kind: 'idle' })

  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (open && !element.open) element.showModal()
    else if (!open && element.open) element.close()
    if (open) setState({ kind: 'idle' })
  }, [open])

  const detect = async () => {
    const requestId = crypto.randomUUID()
    setState({ kind: 'detecting', requestId, percent: null })
    try {
      const result = await onDetect(requestId, options, (percent) => setState((current) => current.kind === 'detecting' && current.requestId === requestId ? { ...current, percent } : current))
      setState({ kind: 'ready', silences: result.silences, durationUs: result.durationUs, forOptions: options })
    } catch (error) {
      setState({ kind: 'error', message: error instanceof Error ? error.message : 'Silence detection failed.' })
    }
  }
  const cancel = () => { if (state.kind === 'detecting') onCancelDetect(state.requestId); setState({ kind: 'idle' }) }

  // Padding changes the kept ranges without another pass over the audio; threshold and minimum
  // silence need a fresh Detect, since they change which spans count as silence at all.
  const stale = state.kind === 'ready' && (state.forOptions.thresholdDbfs !== options.thresholdDbfs || state.forOptions.minSilenceMs !== options.minSilenceMs)
  const kept = state.kind === 'ready' ? keptRangesFromSilences(state.silences, state.durationUs, options.padMs * (US_PER_SECOND / 1000)) : null
  const summary = kept && state.kind === 'ready' ? summarizeSilenceRemoval(kept, state.durationUs) : null

  return <dialog ref={dialog} className="model-dialog silence-removal-dialog" aria-labelledby="silence-removal-title" onClose={onClose} onKeyDown={(event) => event.stopPropagation()}>
    <div className="model-panel-heading"><h2 id="silence-removal-title">Remove Silence</h2><button onClick={onClose}>Close</button></div>
    {picker}
    {!mediaReady ? <p>Open or relink the video before detecting silence.</p> : <>
      <p>Detects long quiet spans below a dB threshold in {videoName ? <strong>{videoName}</strong> : 'the video'} and cuts them out of every clip of it —
        preview, exported video and exported SRT. Later clips on the same track close up; other tracks do not move.
        {hasExistingCuts && ' Clips already trimmed stay trimmed: silence is removed from what they still play.'}</p>
      <Row label="Silence threshold" htmlFor="silence-threshold" hint="Audio quieter than this, for at least the minimum duration below, counts as silence.">
        <SliderWithNumber id="silence-threshold" min={-80} max={0} step={1} unit="dB" value={options.thresholdDbfs}
          onDraft={(value) => setOptions((current) => ({ ...current, thresholdDbfs: value }))}
          onCommit={(value) => setOptions((current) => ({ ...current, thresholdDbfs: value }))} />
      </Row>
      <Row label="Minimum silence" htmlFor="silence-min-duration" hint="Pauses shorter than this are left alone.">
        <SliderWithNumber id="silence-min-duration" min={100} max={5000} step={50} unit="ms" value={options.minSilenceMs}
          onDraft={(value) => setOptions((current) => ({ ...current, minSilenceMs: value }))}
          onCommit={(value) => setOptions((current) => ({ ...current, minSilenceMs: value }))} />
      </Row>
      <Row label="Padding" htmlFor="silence-pad" hint="How much of each detected silence to keep, right up against the speech on either side.">
        <SliderWithNumber id="silence-pad" min={0} max={500} step={10} unit="ms" value={options.padMs}
          onDraft={(value) => setOptions((current) => ({ ...current, padMs: value }))}
          onCommit={(value) => setOptions((current) => ({ ...current, padMs: value }))} />
      </Row>
      <div className="silence-removal-actions">
        {state.kind === 'detecting'
          ? <span className="job-pill" role="status"><span>Detecting{state.percent === null ? '…' : ` ${state.percent}%`}</span><button onClick={cancel}>Cancel</button></span>
          : <button className="accent" onClick={() => void detect()}>Detect</button>}
      </div>
      {state.kind === 'error' && <p className="silence-removal-summary error" role="alert">{state.message}</p>}
      {summary && !stale && (summary.isNoOp
        ? <p className="silence-removal-summary" role="status">No silence found at this threshold.</p>
        : <p className="silence-removal-summary" role="status">
          {summary.cutCount} cut{summary.cutCount === 1 ? '' : 's'} · {formatClock(summary.removedUs)} removed ·
          new length {formatClock(summary.sequenceDurationUs)}
        </p>)}
      {summary && stale && <p className="silence-removal-summary" role="status">Threshold or minimum silence changed — Detect again to update.</p>}
      <div className="model-panel-heading">
        <button className="accent" disabled={!kept || stale} onClick={() => { if (kept) { onApply(kept); onClose() } }}>Apply</button>
        <button onClick={onClose}>Cancel</button>
      </div>
    </>}
  </dialog>
}
