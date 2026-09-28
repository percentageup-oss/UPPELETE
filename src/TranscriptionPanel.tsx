import { useEffect, useRef, useState } from 'react'
import type { JobProgressPhase, JobSnapshot } from './core/jobs'
import type { ProjectAsset } from './core/edit'
import type { Cue, TranscriptionRun } from './core/model'
import type { ManagedModelId } from './core/modelCatalog'
import type { TranslationTarget, SourceTimedTranscript } from './core/transcription'
import { TRANSLATION_TARGETS, translationTargetLabel } from './core/translationLanguages'
import { describeExistingCaptions, replaceableCaptionsInRange, type TranscriptionApplyChoice, type TranslationWithUsage } from './core/transcriptionApply'
import { MAX_TRANSLATION_TARGETS, type TranscriptionAvailability, type TranscriptionDevice, type TranscriptionEngine, type TranslationFailure } from './core/transcriptionIpc'
import { captionGaps, formatRangeTime, parseRangeInput, transcriptionRangeProblem, type SourceRange } from './core/transcriptionRange'
import { CLOUD_PROVIDERS, cloudProvider, providerLabel, type CloudLanguageChoice, type CloudProviderId, type ProviderKeyStatuses, type TranscriptionDefaults } from './core/transcriptionProviders'

/** `assetId` is the video that was transcribed, captured when the job started — the picker may have
 * moved on to another video by the time the result arrives. */
type Delivered = { transcript: SourceTimedTranscript; run: TranscriptionRun; translations: TranslationWithUsage[]; translationFailures: TranslationFailure[]; assetId: string; partial: boolean }
type Phase =
  | { kind: 'setup' }
  | { kind: 'running'; requestId: string; job: JobSnapshot | null; engine: TranscriptionEngine; translateTo: TranslationTarget[]; range: SourceRange | null }
  | { kind: 'choose'; result: Delivered }
  | { kind: 'error'; message: string; diagnostic: string | null }
  | { kind: 'cancelled' }

/** Where the picked video sits on the timeline; all times are in the video's own (source) time. */
export type TranscribeContext = {
  durationUs: number | null
  playheadSourceUs: number | null
  inOutSourceRange: SourceRange | null
}
export const NO_TRANSCRIBE_CONTEXT: TranscribeContext = { durationUs: null, playheadSourceUs: null, inOutSourceRange: null }

type Scope = 'whole' | 'inout' | 'part'
const rangeLabel = (range: SourceRange) => `${formatRangeTime(range.startUs)}–${formatRangeTime(range.endUs)}`

export type ApplyTranscript =(result: Delivered, choice: TranscriptionApplyChoice | null) => { ok: true } | { ok: false; message: string }

const deviceLabels: Record<TranscriptionDevice, string> = { cpu: 'CPU', metal: 'Metal GPU', cuda: 'CUDA GPU', vulkan: 'Vulkan GPU' }
const phaseLabels: Record<JobProgressPhase, string> = {
  'loading-model': 'Verifying the model and speech engine…',
  'extracting-audio': 'Extracting audio from the video…',
  recognizing: 'Recognizing detected speech…',
  translating: 'Translating captions with Gemini…',
  aligning: 'Aligning…',
  rendering: 'Rendering…',
  encoding: 'Encoding…',
  proxy: 'Generating a playback proxy…', // never shown here; transcription jobs never report this phase
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
type CloudLanguage = CloudLanguageChoice
const cloudLanguages: { value: CloudLanguage; label: string; hint: string }[] = [
  { value: 'auto', label: 'Automatic — mixed languages (recommended)', hint: 'Gemini detects the spoken language and handles switching mid-sentence, keeping Malayalam in Malayalam script and English in Latin script.' },
  { value: 'ml', label: 'Malayalam only', hint: 'Forces Malayalam script for everything, including spoken English words — they will be written phonetically in Malayalam, not kept in Latin script.' },
  { value: 'en', label: 'English only', hint: 'Forces English for everything, including spoken Malayalam words — they will be written phonetically in English, not kept in Malayalam script.' },
  { value: 'ta', label: 'Tamil only', hint: 'Forces Tamil script for everything, including spoken English words — they will be written phonetically in Tamil, not kept in Latin script.' },
  { value: 'hi', label: 'Hindi only', hint: 'Forces Hindi (Devanagari) script for everything, including spoken English words — they will be written phonetically in Devanagari, not kept in Latin script.' },
]
const GEMINI_LANGUAGE_STORAGE_KEY = 'caption-studio.transcription-gemini-language'
function storedCloudLanguage(): CloudLanguage {
  try {
    const value = localStorage.getItem(GEMINI_LANGUAGE_STORAGE_KEY)
    return cloudLanguages.some((entry) => entry.value === value) ? value as CloudLanguage : 'auto'
  } catch { return 'auto' }
}
const TRANSLATE_STORAGE_KEY = 'caption-studio.transcription-translate'
/** A JSON array; an older single-code value reads as a one-item array, anything absent or malformed as none. */
function storedTranslateTo(): TranslationTarget[] {
  try {
    const value = localStorage.getItem(TRANSLATE_STORAGE_KEY)
    if (!value) return []
    let parsed: unknown
    try { parsed = JSON.parse(value) } catch { parsed = value }
    const codes = Array.isArray(parsed) ? parsed : typeof parsed === 'string' ? [parsed] : []
    return [...new Set(codes)].filter((code): code is TranslationTarget => TRANSLATION_TARGETS.some((target) => target.code === code)).slice(0, MAX_TRANSLATION_TARGETS)
  } catch { return [] }
}

/** Only Gemini is documented to switch language mid-sentence; other providers get an honest, weaker hint. */
function languageHint(engine: TranscriptionEngine, value: CloudLanguage): string | undefined {
  if (engine !== 'whisper' && engine !== 'gemini' && value === 'auto') {
    return `${providerLabel(engine)} detects the spoken language itself. It may commit to one language per speech section, so mixed Malayalam/English speech can need a review pass.`
  }
  return cloudLanguages.find((entry) => entry.value === value)?.hint
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

/** A compact multi-select: the trigger summarizes the choice, the popover lists every target as a checkbox. */
function TranslateDropdown({ value, onChange }: { value: TranslationTarget[]; onChange: (next: TranslationTarget[]) => void }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', onPointer)
    return () => document.removeEventListener('pointerdown', onPointer)
  }, [open])
  const full = value.length >= MAX_TRANSLATION_TARGETS
  const summary = value.length === 0 ? 'None — keep spoken language only'
    : value.length <= 2 ? value.map(translationTargetLabel).join(', ')
    : `${translationTargetLabel(value[0])}, ${translationTargetLabel(value[1])} +${value.length - 2} more`
  return <div className="translate-dropdown" ref={root}
    onKeyDown={(event) => { if (event.key === 'Escape' && open) { event.preventDefault(); setOpen(false); root.current?.querySelector('button')?.focus() } }}>
    <button type="button" className="translate-dropdown-trigger" aria-haspopup="true" aria-expanded={open} aria-labelledby="transcription-translate-label transcription-translate-summary" onClick={() => setOpen(!open)}>
      <span id="transcription-translate-summary" className={value.length ? undefined : 'placeholder'}>{summary}</span>
      <span aria-hidden="true" className="translate-dropdown-caret">▾</span>
    </button>
    {open && <div className="translate-dropdown-menu" role="group" aria-label="Translation languages">
      <div className="translate-dropdown-head">
        <span>{value.length} of {MAX_TRANSLATION_TARGETS} selected</span>
        <button type="button" className="link-button" disabled={!value.length} onClick={() => onChange([])}>Clear</button>
      </div>
      <div className="translate-dropdown-options">
        {TRANSLATION_TARGETS.map((target) => {
          const checked = value.includes(target.code)
          return <label key={target.code} className={checked ? 'checked' : undefined}>
            <input type="checkbox" checked={checked} disabled={!checked && full}
              onChange={() => onChange(checked ? value.filter((code) => code !== target.code) : [...value, target.code])} />
            <span>{target.label}{target.hint && <small>{target.hint}</small>}</span>
          </label>
        })}
      </div>
      <p className="transcription-hint">Audio is transcribed once; each extra language is a small text call.{full && ` Limit of ${MAX_TRANSLATION_TARGETS} reached.`}</p>
    </div>}
  </div>
}

/** A request from outside the dialog (the timeline menu) to open it on `assetId` with `range` filled in. */
export type TranscribeOpenRequest = { assetId: string; range: SourceRange; nonce: number }
const MAX_GAP_ROWS = 8

export function TranscriptionPanel({ media, mediaReady, cues, runs = [], openRequest = null, onOpenRequestIgnored, onApply, primary = false, providerKeys = null, transcriptionDefaults = { provider: 'whisper', models: {} }, onNeedGeminiKey, context = NO_TRANSCRIBE_CONTEXT }: {
  media: ProjectAsset | null; mediaReady: boolean; cues: Cue[]; onApply: ApplyTranscript; primary?: boolean
  providerKeys?: ProviderKeyStatuses | null; transcriptionDefaults?: TranscriptionDefaults; onNeedGeminiKey?: () => void
  context?: TranscribeContext
  /** Earlier runs of the picked video, for the provider's uncovered stretches. */
  runs?: readonly TranscriptionRun[]
  openRequest?: TranscribeOpenRequest | null
  /** Called when `openRequest` could not open the dialog because a job or a review is in progress. */
  onOpenRequestIgnored?: () => void
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
  // The Settings default pre-selects the provider and model; choosing another here applies to this run only.
  const [engine, setEngineState] = useState<TranscriptionEngine>(transcriptionDefaults.provider)
  const [cloudModel, setCloudModel] = useState<string | undefined>(undefined)
  const cloud: CloudProviderId | null = engine === 'whisper' ? null : engine
  const effectiveModel = cloud ? cloudModel ?? transcriptionDefaults.models[cloud] ?? cloudProvider(cloud).defaultModel : null
  const keyConfigured = (provider: CloudProviderId) => Boolean(providerKeys?.[provider]?.configured)
  const geminiKeyConfigured = keyConfigured('gemini')
  const engineKeyMissing = cloud !== null && !keyConfigured(cloud)
  const [cloudLanguage, setCloudLanguageState] = useState<CloudLanguage>(storedCloudLanguage)
  const [translateTo, setTranslateToState] = useState<TranslationTarget[]>(storedTranslateTo)
  const setEngine = (next: TranscriptionEngine) => {
    setEngineState(next)
    setCloudModel(undefined)
    if (next === 'whisper' && !models.length) void refresh()
  }
  const setCloudLanguage = (next: CloudLanguage) => {
    setCloudLanguageState(next)
    try { localStorage.setItem(GEMINI_LANGUAGE_STORAGE_KEY, next) } catch { /* remembering the choice is only a convenience */ }
  }
  const setTranslateTo = (next: TranslationTarget[]) => {
    setTranslateToState(next)
    try { if (next.length) localStorage.setItem(TRANSLATE_STORAGE_KEY, JSON.stringify(next)); else localStorage.removeItem(TRANSLATE_STORAGE_KEY) } catch { /* remembering the choice is only a convenience */ }
  }
  const api = window.captionStudio
  const [scope, setScope] = useState<Scope>('whole')
  const [partStart, setPartStart] = useState('')
  const [partEnd, setPartEnd] = useState('')
  const inOut = context.inOutSourceRange
  const activeScope: Scope = scope === 'inout' && !inOut ? 'whole' : scope
  const chosenRange: SourceRange | null = activeScope === 'inout' ? inOut : activeScope === 'part' ? (() => {
    const startUs = parseRangeInput(partStart)
    const endUs = parseRangeInput(partEnd)
    return startUs === null || endUs === null ? null : { startUs, endUs }
  })() : null
  const rangeProblem = activeScope === 'whole' ? null
    : chosenRange ? transcriptionRangeProblem(chosenRange, context.durationUs)
    : 'Enter a start and end time, like 0:22.5.'
  const chooseScope = (next: Scope) => {
    setScope(next)
    if (next === 'part' && !partStart.trim() && !partEnd.trim() && inOut) { setPartStart(formatRangeTime(inOut.startUs)); setPartEnd(formatRangeTime(inOut.endUs)) }
  }

  const gapRows = (() => {
    if (!media || context.durationUs === null) return []
    const durationUs = context.durationUs
    const rows: { range: SourceRange; note: string }[] = captionGaps(cues, media.id, durationUs).map((range) => ({ range, note: 'no captions' }))
    const anyGaps = captionGaps(cues, media.id, durationUs, 1)
    for (const run of runs) {
      if (!('provider' in run) || run.mediaAssetId !== media.id) continue
      for (const range of run.uncoveredRanges ?? []) {
        const overlaps = (gap: SourceRange) => gap.startUs < range.endUs && gap.endUs > range.startUs
        if (anyGaps.some(overlaps) && !rows.some((row) => overlaps(row.range))) rows.push({ range, note: `${providerLabel(run.provider)} returned no words` })
      }
    }
    return rows
  })()
  const pickGap = (range: SourceRange) => { setScope('part'); setPartStart(formatRangeTime(range.startUs)); setPartEnd(formatRangeTime(range.endUs)) }

  const phaseRef = useRef(phase)
  phaseRef.current = phase
  const handledNonce = useRef<number | null>(null)
  useEffect(() => {
    if (!openRequest || handledNonce.current === openRequest.nonce) return
    handledNonce.current = openRequest.nonce
    const current = phaseRef.current
    if (current.kind === 'running' || current.kind === 'choose') { onOpenRequestIgnored?.(); return }
    setPhase({ kind: 'setup' })
    pickGap(openRequest.range)
    if (!dialog.current?.open) dialog.current?.showModal()
    if (engine === 'whisper') void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequest?.nonce])

  // A new Settings default re-selects the provider; a run in progress or a reviewed result is left alone.
  useEffect(() => { setEngineState(transcriptionDefaults.provider); setCloudModel(undefined) }, [transcriptionDefaults.provider])

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
    if (phase.kind === 'setup' || phase.kind === 'error' || phase.kind === 'cancelled') {
      setPhase({ kind: 'setup' })
      setScope(inOut ? 'inout' : 'whole')
      if (engine === 'whisper') void refresh()
    }
  }

  const finish = (result: Delivered, choice: TranscriptionApplyChoice | null) => {
    const applied = onApplyRef.current(result, choice)
    if (applied.ok) { setPhase({ kind: 'setup' }); dialog.current?.close() }
    else setPhase({ kind: 'error', message: applied.message, diagnostic: null })
  }

  const start = async () => {
    if (!api || !media?.fingerprint) return
    if (engine === 'whisper' && (!modelId || !availability?.available || !device)) return
    if (engineKeyMissing || (translateTo.length > 0 && !geminiKeyConfigured)) return
    if (rangeProblem) return
    const range = chosenRange
    const requestId = crypto.randomUUID()
    setPhase({ kind: 'running', requestId, job: null, engine, translateTo, range })
    try {
      const outcome = await api.startTranscription(engine !== 'whisper'
        ? { engine, requestId, fingerprint: media.fingerprint, model: effectiveModel ?? undefined, language: cloudLanguage, translateTo, ...(range ? { range } : {}) }
        : { engine, requestId, fingerprint: media.fingerprint, modelId: modelId!, language, device: device!, translateTo, ...(range ? { range } : {}) })
      if (outcome.state === 'cancelled') { setPhase({ kind: 'cancelled' }); return }
      if (outcome.state === 'failed') { setPhase({ kind: 'error', message: outcome.error.message, diagnostic: outcome.error.diagnostic ?? null }); return }
      const result = { transcript: outcome.transcript, run: outcome.run, translations: outcome.translations, translationFailures: outcome.translationFailures, assetId: media.id, partial: range !== null }
      if (replaceableCaptionsInRange(cuesRef.current, result.transcript.sourceRange, result.assetId, result.partial).length > 0) {
        setPhase({ kind: 'choose', result })
        if (!dialog.current?.open) dialog.current?.showModal()
        return
      }
      finish(result, null)
    } catch (error) { setPhase({ kind: 'error', message: errorText(error), diagnostic: null }) }
  }

  const translatePicker = <>
    <span id="transcription-translate-label">Translate to</span>
    <TranslateDropdown value={translateTo} onChange={setTranslateTo} />
  </>
  const described = phase.kind === 'running' ? describeJob(phase.job) : null
  const running = described && phase.kind === 'running' && phase.engine !== 'whisper' && phase.job?.progress?.phase === 'recognizing'
    ? { ...described, label: `Uploading speech to ${providerLabel(phase.engine)} and transcribing…` } : described
  const needsKey = engineKeyMissing || (translateTo.length > 0 && !geminiKeyConfigured)
  const needKey = () => { dialog.current?.close(); onNeedGeminiKey?.() }
  const choiceCounts = phase.kind === 'choose' ? describeExistingCaptions(replaceableCaptionsInRange(cues, phase.result.transcript.sourceRange, phase.result.assetId, phase.result.partial)) : null

  return <>
    <button ref={trigger} className={running ? 'job-pill-button' : primary && phase.kind !== 'choose' ? 'accent' : phase.kind === 'choose' ? 'attention' : undefined} onClick={openDialog} title={mediaReady ? 'Transcribe this video’s audio' : 'Open a video to transcribe its audio'}>
      {running ? `Transcribing${running.percent === null ? '…' : ` ${running.percent}%`}` : phase.kind === 'choose' ? 'Review transcript' : 'Transcribe'}
    </button>
    <dialog className="model-dialog transcription-dialog" ref={dialog} aria-labelledby="transcription-title" onClose={() => trigger.current?.focus()} onKeyDown={(event) => event.stopPropagation()}>
      <div className="model-panel-heading"><h2 id="transcription-title">Transcribe video audio</h2><button onClick={() => dialog.current?.close()}>Close</button></div>
      {(phase.kind === 'running' ? phase.engine : engine) !== 'whisper' ? <>
        <p>Uses {providerLabel(phase.kind === 'running' ? phase.engine : engine)} with your own API key. {cloudProvider((phase.kind === 'running' ? phase.engine : engine) as CloudProviderId).disclosure}</p>
        <p>Readable captions are grouped from the provider’s word timing. Original recognition is retained in the project, and every caption keeps its source-media time.</p>
      </> : <>
        <p>Readable captions are grouped after recognition. This backend supplies segment timing only: word timing is estimated, not audio-aligned, and marked Needs review. Original recognition is retained in the project.</p>
        <p>Runs whisper.cpp on this computer with a verified local model. Audio never leaves the device. Long silences are detected first and never sent to the recognizer, and every caption keeps its source-media time.</p>
      </>}
      {(phase.kind === 'running' ? phase.translateTo : translateTo).length > 0 && <p>Translation sends only the recognized caption text (never audio) to Gemini. Translated captions get estimated word timing and are marked Needs review; the original-language recognition is kept in the project.</p>}

      {phase.kind === 'setup' && <>
        {!mediaReady && <p role="alert">Open or relink a video in this session before transcribing.</p>}
        <fieldset className="transcription-scope">
          <legend>What to transcribe</legend>
          <label><input type="radio" name="transcription-scope" checked={activeScope === 'whole'} onChange={() => chooseScope('whole')} /> Whole video{context.durationUs !== null && ` — 0:00.0–${formatRangeTime(context.durationUs)}`}</label>
          {inOut && <label><input type="radio" name="transcription-scope" checked={activeScope === 'inout'} onChange={() => chooseScope('inout')} /> In–Out range — {rangeLabel(inOut)} of the video</label>}
          <label><input type="radio" name="transcription-scope" checked={activeScope === 'part'} onChange={() => chooseScope('part')} /> Part of the video</label>
          {gapRows.length > 0 && <ul className="transcription-gaps" aria-label="Stretches without captions">
            {gapRows.slice(0, MAX_GAP_ROWS).map((row) => <li key={`${row.range.startUs}-${row.range.endUs}`}>
              <button type="button" onClick={() => pickGap(row.range)}>{rangeLabel(row.range)} · {row.note}</button></li>)}
            {gapRows.length > MAX_GAP_ROWS && <li className="transcription-hint">and {gapRows.length - MAX_GAP_ROWS} more</li>}
          </ul>}
          {activeScope === 'part' && <div className="transcription-part">
            {([['Start', partStart, setPartStart], ['End', partEnd, setPartEnd]] as const).map(([label, value, setValue]) => <div key={label}>
              <label htmlFor={`transcription-part-${label}`}>{label}</label>
              <input id={`transcription-part-${label}`} inputMode="decimal" placeholder="0:00.0" value={value} onChange={(event) => setValue(event.target.value)} />
              <button type="button" disabled={context.playheadSourceUs === null} title={context.playheadSourceUs === null ? 'The playhead is not over this video' : `Use the playhead (${formatRangeTime(context.playheadSourceUs)})`}
                onClick={() => { if (context.playheadSourceUs !== null) setValue(formatRangeTime(context.playheadSourceUs)) }}>Playhead</button>
            </div>)}
          </div>}
          <p className="transcription-hint">Times are positions in this video file. Captions inside the range are handled by your choice below; captions outside it, or crossing its edge, are never changed.</p>
          {rangeProblem && <p role="alert">{rangeProblem}</p>}
        </fieldset>
        <div className="transcription-form">
          <label htmlFor="transcription-engine">Engine</label>
          <select id="transcription-engine" value={engine} onChange={(event) => setEngine(event.target.value as TranscriptionEngine)}>
            <option value="whisper">whisper.cpp — on this computer</option>
            {CLOUD_PROVIDERS.map((entry) => <option key={entry.id} value={entry.id}>{entry.label} — cloud, uses your API key</option>)}
          </select>
          {cloud && <>
            <label htmlFor="transcription-cloud-model">Model</label>
            <select id="transcription-cloud-model" value={effectiveModel!} onChange={(event) => setCloudModel(event.target.value)}>
              {!cloudProvider(cloud).models.some((model) => model.id === effectiveModel) && <option value={effectiveModel!}>{effectiveModel} (custom)</option>}
              {cloudProvider(cloud).models.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
            </select>
            <label htmlFor="transcription-cloud-language">Spoken language</label>
            <select id="transcription-cloud-language" value={cloudLanguage} onChange={(event) => setCloudLanguage(event.target.value as CloudLanguage)}>
              {cloudLanguages.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
            </select>
            <p className="style-hint">{languageHint(engine, cloudLanguage)}</p>
            {translatePicker}
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
            {translatePicker}
            <label htmlFor="transcription-device">Device</label>
            <select id="transcription-device" value={device ?? 'cpu'} onChange={(event) => setDevice(event.target.value as TranscriptionDevice)}>
              {availability.devices.map((entry) => <option key={entry} value={entry}>{deviceLabels[entry]}{entry === 'cpu' ? ' (fallback)' : ''}</option>)}
            </select>
            <span>Detected engine</span>
            <span>{availability.engine.id} {availability.engine.version} · {availability.gpuBackend ? `GPU backend ${availability.gpuBackend}` : 'no GPU backend initialized'} · CPU verified</span>
          </>}
          </>}
        </div>
        {needsKey && <p role="alert">{engineKeyMissing ? `${providerLabel(engine)} transcription needs your API key.` : 'Translating captions needs your Gemini API key.'} <button onClick={needKey}>Add API key</button></p>}
        {engine === 'whisper' && checking && <p role="status">Verifying the model file and inspecting the speech engine…</p>}
        {engine === 'whisper' && !checking && availability && !availability.available && <p role="alert">{availability.reason}</p>}
        {engine === 'whisper' && availability?.available && language === 'auto' && <p className="transcription-hint">Automatic detection identifies one language from the longest speech section and uses it for the whole video. Mixed Malayalam/English speech is recognized under that single language.</p>}
        <div className="model-actions">
          <button className="accent" disabled={!mediaReady || needsKey || rangeProblem !== null || (engine === 'whisper' && (checking || !availability?.available || !device))} onClick={() => void start()}>
            {(() => {
              const span = chosenRange && !rangeProblem ? ` ${rangeLabel(chosenRange)}` : ''
              return translateTo.length > 0 ? `Transcribe${span} and translate` : cloud ? `Transcribe${span} with ${providerLabel(cloud)}` : span ? `Transcribe${span}` : 'Start transcription'
            })()}
          </button>
          {engine === 'whisper' && <button disabled={checking} onClick={() => void refresh()}>Recheck</button>}
        </div>
      </>}

      {phase.kind === 'running' && running && <div className="transcription-progress" role="status" aria-live="polite">
        <p>{running.label}{running.percent !== null && ` ${running.percent}%`}{phase.range && ` (${rangeLabel(phase.range)})`}</p>
        {running.percent === null ? <progress aria-label="Transcription progress (not measured in this phase)" /> : <progress aria-label="Transcription progress" value={running.percent} max={100} />}
        {phase.job?.progress?.phase === 'recognizing' && running.percent !== null && <p className="transcription-hint">{phase.engine !== 'whisper' ? `Percent of speech sections ${providerLabel(phase.engine)} has returned.` : 'Percent of detected speech audio processed, as reported by whisper.cpp.'}</p>}
        {phase.job?.progress?.phase === 'translating' && phase.job.progress.detail && <p className="transcription-hint">Translating to {translationTargetLabel(phase.job.progress.detail)}…</p>}
        {phase.job?.progress?.phase === 'translating' && running.percent !== null && <p className="transcription-hint">Percent of caption batches translated across {phase.translateTo.length === 1 ? 'the target language' : `all ${phase.translateTo.length} target languages`}.</p>}
        <button disabled={phase.job?.cancelRequested} onClick={() => void api?.cancelTranscription(phase.requestId)}>Cancel transcription</button>
      </div>}

      {phase.kind === 'choose' && choiceCounts && <section className="transcription-choice" aria-labelledby="transcription-choice-title">
        <h3 id="transcription-choice-title">{phase.result.partial ? 'Existing captions in this range' : 'Existing captions overlap this transcript'}</h3>
        <p>The new transcript has {phase.result.transcript.segments.length} timed segment(s). {choiceCounts.total} existing caption(s) are {phase.result.partial ? `in ${rangeLabel(phase.result.transcript.sourceRange)}` : 'in the transcribed range'}: {choiceCounts.authored} imported or edited, {choiceCounts.untouchedModel} unedited model caption(s). Nothing has changed yet.</p>
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
