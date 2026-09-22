import { useEffect, useRef, useState } from 'react'
import type { JobProgressPhase, JobSnapshot } from './core/jobs'
import type { ProjectAsset } from './core/edit'
import type { Cue, TranscriptionRun } from './core/model'
import type { ManagedModelId } from './core/modelCatalog'
import type { SourceTimedTranscript, TranslatedTranscript } from './core/transcription'
import { TRANSLATION_TARGETS, translationTargetLabel } from './core/translationLanguages'
import { captionsOverlappingRange, describeExistingCaptions, type TranscriptionApplyChoice } from './core/transcriptionApply'
import type { TranscriptionAvailability, TranscriptionDevice, TranscriptionEngine } from './core/transcriptionIpc'

/** `assetId` is the video that was transcribed, captured when the job started — the picker may have
 * moved on to another video by the time the result arrives. */
type Delivered = { transcript: SourceTimedTranscript; run: TranscriptionRun; translation: TranslatedTranscript | null; assetId: string }
type Phase =
  | { kind: 'setup' }
  | { kind: 'running'; requestId: string; job: JobSnapshot | null; engine: TranscriptionEngine; translateTo: string | null }
  | { kind: 'choose'; result: Delivered }
  | { kind: 'error'; message: string; diagnostic: string | null }
  | { kind: 'cancelled' }

export type ApplyTranscript = (result: Delivered, choice: TranscriptionApplyChoice | null) => { ok: true } | { ok: false; message: string }

const deviceLabels: Record<TranscriptionDevice, string> = { cpu: 'CPU', metal: 'Metal GPU', cuda: 'CUDA GPU', vulkan: 'Vulkan GPU' }
const phaseLabels: Record<JobProgressPhase, string> = {
  'loading-model': 'Verifying the model and speech engine…',
  'extracting-audio': 'Extracting audio from the video…',
  recognizing: 'Recognizing detected speech…',
  translating: 'Translating captions with Gemini…',
  aligning: 'Aligning…',
  rendering: 'Rendering…',
  encoding: 'Encoding…',
}

const displayNames = (() => { try { return new Intl.DisplayNames(['en'], { type: 'language' }) } catch { return null } })()
function languageLabel(code: string): string {
  let name: string | undefined
  try { name = displayNames?.of(code) } catch { name = undefined }
  return name && name !== code ? `${name} (${code})` : code
}
function sortedLanguages(codes: string[]): string[] {
  const preferred = ['ml', 'en'].filter((code) => codes.includes(code))
  return [...preferred, ...codes.filter((code) => !preferred.includes(code)).sort((a, b) => languageLabel(a).localeCompare(languageLabel(b)))]
}
type GeminiLanguage = 'auto' | 'ml' | 'en'
const geminiLanguages: { value: GeminiLanguage; label: string }[] = [
  { value: 'auto', label: 'Malayalam + English (mixed)' },
  { value: 'ml', label: 'Malayalam only' },
  { value: 'en', label: 'English only' },
]
const ENGINE_STORAGE_KEY = 'caption-studio.transcription-engine'
function storedEngine(): TranscriptionEngine {
  try { return localStorage.getItem(ENGINE_STORAGE_KEY) === 'gemini' ? 'gemini' : 'whisper' } catch { return 'whisper' }
}
const TRANSLATE_STORAGE_KEY = 'caption-studio.transcription-translate'
function storedTranslateTo(): string | null {
  try {
    const value = localStorage.getItem(TRANSLATE_STORAGE_KEY)
    return value && TRANSLATION_TARGETS.some((target) => target.code === value) ? value : null
  } catch { return null }
}

const errorText = (error: unknown) => error instanceof Error ? error.message : 'The operation failed.'

/** Honest status: a percentage only when the backend measured one, otherwise an indeterminate bar. */
export function describeJob(job: JobSnapshot | null): { label: string; percent: number | null } {
  if (!job) return { label: 'Starting…', percent: null }
  if (job.state === 'queued') return { label: 'Waiting for another heavy job to finish…', percent: null }
  if (job.cancelRequested) return { label: 'Cancelling and cleaning up…', percent: null }
  if (!job.progress) return { label: 'Starting…', percent: null }
  const label = phaseLabels[job.progress.phase]
  return job.progress.kind === 'measured' ? { label, percent: Math.floor(job.progress.completed * 100 / job.progress.total) } : { label, percent: null }
}

export function TranscriptionPanel({ media, mediaReady, cues, onApply, primary = false, geminiKeyConfigured = false, onNeedGeminiKey }: {
  media: ProjectAsset | null; mediaReady: boolean; cues: Cue[]; onApply: ApplyTranscript; primary?: boolean
  geminiKeyConfigured?: boolean; onNeedGeminiKey?: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  // A transcription can outlast many edits; always decide and apply against the latest captions.
  const cuesRef = useRef(cues)
  cuesRef.current = cues
  const onApplyRef = useRef(onApply)
  onApplyRef.current = onApply
  const [models, setModels] = useState<{ id: ManagedModelId; name: string; installed: boolean }[]>([])
  const [modelId, setModelId] = useState<ManagedModelId | null>(null)
  const [availability, setAvailability] = useState<TranscriptionAvailability | null>(null)
  const [checking, setChecking] = useState(false)
  const [language, setLanguage] = useState('auto')
  const [device, setDevice] = useState<TranscriptionDevice | null>(null)
  const [phase, setPhase] = useState<Phase>({ kind: 'setup' })
  const [engine, setEngineState] = useState<TranscriptionEngine>(storedEngine)
  const [geminiLanguage, setGeminiLanguage] = useState<GeminiLanguage>('auto')
  const [translateTo, setTranslateToState] = useState<string | null>(storedTranslateTo)
  const setEngine = (next: TranscriptionEngine) => {
    setEngineState(next)
    try { localStorage.setItem(ENGINE_STORAGE_KEY, next) } catch { /* remembering the choice is only a convenience */ }
    if (next === 'whisper' && !models.length) void refresh()
  }
  const setTranslateTo = (next: string | null) => {
    setTranslateToState(next)
    try { if (next) localStorage.setItem(TRANSLATE_STORAGE_KEY, next); else localStorage.removeItem(TRANSLATE_STORAGE_KEY) } catch { /* remembering the choice is only a convenience */ }
  }
  const api = window.captionStudio

  useEffect(() => api?.onTranscriptionProgress((message) => {
    setPhase((current) => current.kind === 'running' && current.requestId === message.requestId ? { ...current, job: message.job } : current)
  }), [api])

  const checkModel = async (id: ManagedModelId) => {
    if (!api) return
    setModelId(id)
    setChecking(true)
    setAvailability(null)
    try {
      const result = await api.transcriptionAvailability(id)
      setAvailability(result)
      if (result.available) {
        const fallbackLanguage = result.autoDetectLanguage ? 'auto' : result.languages[0]
        setLanguage((current) => current === 'auto' ? fallbackLanguage : result.languages.includes(current) ? current : fallbackLanguage)
        setDevice((current) => current && result.devices.includes(current) ? current : result.devices.find((entry) => entry !== 'cpu') ?? 'cpu')
      }
    } catch (error) { setAvailability({ available: false, reason: errorText(error) }) }
    finally { setChecking(false) }
  }

  // Sequential on purpose: listing re-verifies model files, and a model busy being verified cannot be resolved.
  const refresh = async () => {
    if (!api) { setAvailability({ available: false, reason: 'Transcription requires the desktop app.' }); return }
    setChecking(true)
    try {
      const listing = await api.listModels()
      const entries = listing.catalog.map((model) => ({ id: model.id, name: model.name, installed: listing.states.find((state) => state.id === model.id)?.installed ?? false }))
      setModels(entries)
      const chosen = entries.find((entry) => entry.id === modelId && entry.installed)?.id ?? entries.find((entry) => entry.installed)?.id ?? null
      if (chosen) await checkModel(chosen)
      else { setModelId(null); setAvailability({ available: false, reason: 'No verified speech model is installed. Download one in Models first.' }) }
    } catch (error) { setAvailability({ available: false, reason: errorText(error) }) }
    finally { setChecking(false) }
  }

  const openDialog = () => {
    if (!dialog.current?.open) dialog.current?.showModal()
    if (phase.kind === 'setup' || phase.kind === 'error' || phase.kind === 'cancelled') { setPhase({ kind: 'setup' }); if (engine === 'whisper') void refresh() }
  }

  const finish = (result: Delivered, choice: TranscriptionApplyChoice | null) => {
    const applied = onApplyRef.current(result, choice)
    if (applied.ok) { setPhase({ kind: 'setup' }); dialog.current?.close() }
    else setPhase({ kind: 'error', message: applied.message, diagnostic: null })
  }

  const start = async () => {
    if (!api || !media?.fingerprint) return
    if (engine === 'whisper' && (!modelId || !availability?.available || !device)) return
    if ((engine === 'gemini' || translateTo !== null) && !geminiKeyConfigured) return
    const requestId = crypto.randomUUID()
    setPhase({ kind: 'running', requestId, job: null, engine, translateTo })
    try {
      const outcome = await api.startTranscription(engine === 'gemini'
        ? { engine, requestId, fingerprint: media.fingerprint, language: geminiLanguage, translateTo }
        : { engine, requestId, fingerprint: media.fingerprint, modelId: modelId!, language, device: device!, translateTo })
      if (outcome.state === 'cancelled') { setPhase({ kind: 'cancelled' }); return }
      if (outcome.state === 'failed') { setPhase({ kind: 'error', message: outcome.error.message, diagnostic: outcome.error.diagnostic ?? null }); return }
      const result = { transcript: outcome.transcript, run: outcome.run, translation: outcome.translation, assetId: media.id }
      if (captionsOverlappingRange(cuesRef.current, result.transcript.sourceRange, result.assetId).length > 0) {
        setPhase({ kind: 'choose', result })
        if (!dialog.current?.open) dialog.current?.showModal()
        return
      }
      finish(result, null)
    } catch (error) { setPhase({ kind: 'error', message: errorText(error), diagnostic: null }) }
  }

  const described = phase.kind === 'running' ? describeJob(phase.job) : null
  const running = described && phase.kind === 'running' && phase.engine === 'gemini' && phase.job?.progress?.phase === 'recognizing'
    ? { ...described, label: 'Uploading speech to Gemini and transcribing…' } : described
  const needsKey = engine === 'gemini' || translateTo !== null
  const needKey = () => { dialog.current?.close(); onNeedGeminiKey?.() }
  const choiceCounts = phase.kind === 'choose' ? describeExistingCaptions(captionsOverlappingRange(cues, phase.result.transcript.sourceRange, phase.result.assetId)) : null

  return <>
    <button ref={trigger} className={running ? 'job-pill-button' : primary && phase.kind !== 'choose' ? 'accent' : phase.kind === 'choose' ? 'attention' : undefined} onClick={openDialog} title={mediaReady ? 'Transcribe this video’s audio' : 'Open a video to transcribe its audio'}>
      {running ? `Transcribing${running.percent === null ? '…' : ` ${running.percent}%`}` : phase.kind === 'choose' ? 'Review transcript' : 'Transcribe'}
    </button>
    <dialog className="model-dialog transcription-dialog" ref={dialog} aria-labelledby="transcription-title" onClose={() => trigger.current?.focus()} onKeyDown={(event) => event.stopPropagation()}>
      <div className="model-panel-heading"><h2 id="transcription-title">Transcribe video audio</h2><button onClick={() => dialog.current?.close()}>Close</button></div>
      {(phase.kind === 'running' ? phase.engine : engine) === 'gemini' ? <>
        <p>Uses Gemini with your own API key. Long silences are detected on this computer and never uploaded; each speech section is uploaded to Google, transcribed with word timestamps and response storage disabled, then deleted (best-effort). Provider charges may apply.</p>
        <p>Readable captions are grouped from Gemini’s word timing. Original recognition is retained in the project, and every caption keeps its source-media time.</p>
      </> : <>
        <p>Readable captions are grouped after recognition. This backend supplies segment timing only: word timing is estimated, not audio-aligned, and marked Needs review. Original recognition is retained in the project.</p>
        <p>Runs whisper.cpp on this computer with a verified local model. Audio never leaves the device. Long silences are detected first and never sent to the recognizer, and every caption keeps its source-media time.</p>
      </>}
      {(phase.kind === 'running' ? phase.translateTo : translateTo) !== null && <p>Translation sends only the recognized caption text (never audio) to Gemini. Translated captions get estimated word timing and are marked Needs review; the original-language recognition is kept in the project.</p>}

      {phase.kind === 'setup' && <>
        {!mediaReady && <p role="alert">Open or relink a video in this session before transcribing.</p>}
        <div className="transcription-form">
          <label htmlFor="transcription-engine">Engine</label>
          <select id="transcription-engine" value={engine} onChange={(event) => setEngine(event.target.value as TranscriptionEngine)}>
            <option value="whisper">whisper.cpp — on this computer</option>
            <option value="gemini">Gemini — cloud, uses your API key</option>
          </select>
          {engine === 'gemini' && <>
            <label htmlFor="transcription-gemini-language">Spoken language</label>
            <select id="transcription-gemini-language" value={geminiLanguage} onChange={(event) => setGeminiLanguage(event.target.value as GeminiLanguage)}>
              {geminiLanguages.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
            </select>
            <label htmlFor="transcription-translate-gemini">Translate to</label>
            <select id="transcription-translate-gemini" value={translateTo ?? ''} onChange={(event) => setTranslateTo(event.target.value || null)}>
              <option value="">None — keep spoken language</option>
              {TRANSLATION_TARGETS.map((target) => <option key={target.code} value={target.code}>{target.label}</option>)}
            </select>
          </>}
          {engine === 'whisper' && <>
          <label htmlFor="transcription-model">Model</label>
          <select id="transcription-model" value={modelId ?? ''} disabled={checking || !models.some((model) => model.installed)} onChange={(event) => void checkModel(event.target.value as ManagedModelId)}>
            {!modelId && <option value="">No installed model</option>}
            {models.map((model) => <option key={model.id} value={model.id} disabled={!model.installed}>{model.name}{model.installed ? '' : ' — not installed'}</option>)}
          </select>
          {availability?.available && <>
            <label htmlFor="transcription-language">Spoken language</label>
            <select id="transcription-language" value={language} onChange={(event) => setLanguage(event.target.value)}>
              {availability.autoDetectLanguage && <option value="auto">Detect automatically</option>}
              {sortedLanguages(availability.languages).map((code) => <option key={code} value={code}>{languageLabel(code)}</option>)}
            </select>
            <label htmlFor="transcription-translate-whisper">Translate to</label>
            <select id="transcription-translate-whisper" value={translateTo ?? ''} onChange={(event) => setTranslateTo(event.target.value || null)}>
              <option value="">None — keep spoken language</option>
              {TRANSLATION_TARGETS.map((target) => <option key={target.code} value={target.code}>{target.label}</option>)}
            </select>
            <label htmlFor="transcription-device">Device</label>
            <select id="transcription-device" value={device ?? 'cpu'} onChange={(event) => setDevice(event.target.value as TranscriptionDevice)}>
              {availability.devices.map((entry) => <option key={entry} value={entry}>{deviceLabels[entry]}{entry === 'cpu' ? ' (fallback)' : ''}</option>)}
            </select>
            <span>Detected engine</span>
            <span>{availability.engine.id} {availability.engine.version} · {availability.gpuBackend ? `GPU backend ${availability.gpuBackend}` : 'no GPU backend initialized'} · CPU verified</span>
          </>}
          </>}
        </div>
        {needsKey && !geminiKeyConfigured && <p role="alert">{engine === 'gemini' ? 'Gemini transcription needs your API key.' : 'Translating captions needs your Gemini API key.'} <button onClick={needKey}>Add Gemini API key</button></p>}
        {engine === 'whisper' && checking && <p role="status">Verifying the model file and inspecting the speech engine…</p>}
        {engine === 'whisper' && !checking && availability && !availability.available && <p role="alert">{availability.reason}</p>}
        {engine === 'whisper' && availability?.available && language === 'auto' && <p className="transcription-hint">Automatic detection identifies one language from the longest speech section and uses it for the whole video. Mixed Malayalam/English speech is recognized under that single language.</p>}
        <div className="model-actions">
          <button className="accent" disabled={!mediaReady || (needsKey && !geminiKeyConfigured) || (engine === 'whisper' && (checking || !availability?.available || !device))} onClick={() => void start()}>
            {translateTo !== null ? 'Transcribe and translate' : engine === 'gemini' ? 'Transcribe with Gemini' : 'Start transcription'}
          </button>
          {engine === 'whisper' && <button disabled={checking} onClick={() => void refresh()}>Recheck</button>}
        </div>
      </>}

      {phase.kind === 'running' && running && <div className="transcription-progress" role="status" aria-live="polite">
        <p>{running.label}{running.percent !== null && ` ${running.percent}%`}</p>
        {running.percent === null ? <progress aria-label="Transcription progress (not measured in this phase)" /> : <progress aria-label="Transcription progress" value={running.percent} max={100} />}
        {phase.job?.progress?.phase === 'recognizing' && running.percent !== null && <p className="transcription-hint">{phase.engine === 'gemini' ? 'Percent of speech sections Gemini has returned.' : 'Percent of detected speech audio processed, as reported by whisper.cpp.'}</p>}
        {phase.job?.progress?.phase === 'translating' && running.percent !== null && <p className="transcription-hint">Percent of caption batches translated to {translationTargetLabel(phase.translateTo ?? '')}.</p>}
        <button disabled={phase.job?.cancelRequested} onClick={() => void api?.cancelTranscription(phase.requestId)}>Cancel transcription</button>
      </div>}

      {phase.kind === 'choose' && choiceCounts && <section className="transcription-choice" aria-labelledby="transcription-choice-title">
        <h3 id="transcription-choice-title">Existing captions overlap this transcript</h3>
        <p>The new transcript has {phase.result.transcript.segments.length} timed segment(s). {choiceCounts.total} existing caption(s) are in the transcribed range: {choiceCounts.authored} imported or edited, {choiceCounts.untouchedModel} unedited model caption(s). Nothing has changed yet.</p>
        <button className="accent" onClick={() => finish(phase.result, 'keep-authored')}>Keep imported and edited captions; replace only unedited model captions</button>
        <p className="transcription-hint">New segments that overlap a kept caption are skipped, never merged into its text.</p>
        <button className="danger" onClick={() => finish(phase.result, 'replace-all')}>Replace all {choiceCounts.total} caption(s) in range, including edits</button>
        <button onClick={() => setPhase({ kind: 'setup' })}>Discard this transcript</button>
      </section>}

      {phase.kind === 'cancelled' && <div role="status"><p>Transcription cancelled. No captions were changed and temporary audio was removed.</p><button onClick={openDialog}>Back</button></div>}

      {phase.kind === 'error' && <div role="alert">
        <p>{phase.message}</p>
        {phase.diagnostic && <details><summary>Diagnostic output</summary><pre className="transcription-diagnostic">{phase.diagnostic}</pre></details>}
        <button onClick={openDialog}>Back</button>
      </div>}
    </dialog>
  </>
}
