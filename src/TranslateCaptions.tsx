import { useEffect, useState } from 'react'
import { MAX_TRANSLATE_LINE_LENGTH, MAX_TRANSLATE_LINES, MAX_TRANSLATE_TARGETS, type CaptionTranslationResult } from './core/captionTranslationIpc'
import { describeTranslationLayer, type TranslatedLayerResult } from './core/captionLanguages'
import type { Cue } from './core/model'
import type { TranslationTarget } from './core/transcription'
import type { ProviderKeyStatuses } from './core/transcriptionProviders'
import { TRANSLATION_TARGETS, translationTargetLabel } from './core/translationLanguages'

export type TranslationFailure = { target: TranslationTarget; message: string }

/** "+ Translate…": translates the picked video's current original captions (edits included) into more languages. Text only, never audio. */
export function TranslateCaptions({ originals, assetId, allCues, originalLanguage, translations, providerKeys, onNeedGeminiKey, onTranslated }: {
  /** The picked video's original-language cues: the source text, so user corrections are what gets translated. */
  originals: readonly Cue[]
  assetId: string | null
  allCues: readonly Cue[]
  originalLanguage: string | null
  translations: readonly TranslationTarget[]
  providerKeys: ProviderKeyStatuses | null
  onNeedGeminiKey: () => void
  onTranslated: (done: { assetId: string; sourceLanguage: string | null; originals: Cue[]; results: TranslatedLayerResult[]; failures: TranslationFailure[] }) => void
}) {
  const [picked, setPicked] = useState<TranslationTarget[]>([])
  const [running, setRunning] = useState<{ requestId: string; completed: number; total: number; target: TranslationTarget | null } | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const api = window.captionStudio
  const keyConfigured = Boolean(providerKeys?.gemini?.configured)

  useEffect(() => api?.onCaptionTranslationProgress((progress) => {
    setRunning((current) => current && current.requestId === progress.requestId ? { ...current, completed: progress.completed, total: progress.total, target: progress.target } : current)
  }), [api])

  const sendable = originals.filter((cue) => cue.text.trim())
  const sourceLanguage = originalLanguage && /^[a-z]{2,3}$/.test(originalLanguage) ? originalLanguage : null
  const options = TRANSLATION_TARGETS.filter((entry) => entry.code !== originalLanguage)
  const blocker = !api ? 'Translation needs the desktop app.'
    : !assetId ? 'Pick a video first.'
    : !sendable.length ? 'This video has no original captions to translate.'
    : sendable.length > MAX_TRANSLATE_LINES ? `Too many captions to translate at once (limit ${MAX_TRANSLATE_LINES}).`
    : sendable.some((cue) => cue.text.length > MAX_TRANSLATE_LINE_LENGTH) ? `A caption is longer than ${MAX_TRANSLATE_LINE_LENGTH} characters. Split it first.`
    : null

  const toggle = (code: TranslationTarget) => setPicked((current) => current.includes(code) ? current.filter((entry) => entry !== code) : current.length < MAX_TRANSLATE_TARGETS ? [...current, code] : current)

  const start = async () => {
    if (!api || !assetId || blocker || !picked.length || running) return
    const redo = picked.map((code) => ({ code, ...describeTranslationLayer(allCues, assetId, code) })).filter((entry) => entry.total > 0)
    if (redo.length) {
      const lines = redo.map((entry) => `${translationTargetLabel(entry.code)}: replaces ${entry.total - entry.edited} unedited caption${entry.total - entry.edited === 1 ? '' : 's'}, keeps ${entry.edited} you edited`)
      if (!window.confirm(`Translate again?\n\n${lines.join('\n')}`)) return
    }
    const requestId = crypto.randomUUID()
    const targets = [...picked]
    setMessage(null)
    setRunning({ requestId, completed: 0, total: 1, target: null })
    try {
      const outcome = await api.translateCaptions({ requestId, sourceLanguage, targets, lines: sendable.map((cue) => cue.text) })
      if (outcome.state === 'cancelled') { setMessage('Translation cancelled. Nothing was added.'); return }
      if (outcome.state === 'failed') { setMessage(outcome.error.message); return }
      const ok = outcome.results.filter((result): result is Extract<CaptionTranslationResult, { ok: true }> => result.ok)
      const failures = outcome.results.flatMap((result) => result.ok ? [] : [{ target: result.target, message: result.error.message }])
      onTranslated({ assetId, sourceLanguage: originalLanguage, originals: sendable, failures,
        results: ok.map(({ target, texts, model, inputTokens, outputTokens }) => ({ target, texts, model, inputTokens, outputTokens })) })
      setPicked(failures.map((failure) => failure.target))
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
    finally { setRunning(null) }
  }

  const percent = running && running.total > 0 ? Math.round(running.completed / running.total * 100) : 0
  return <details className="caption-translate">
    <summary>{running ? `Translating ${percent}%` : '+ Translate…'}</summary>
    <div className="caption-translate-popover">
      <p className="style-hint">Sends only the caption text (never audio) to Gemini. Translated captions get estimated word timing and are marked Needs review.</p>
      {!keyConfigured && <p role="alert" className="style-hint">Add a Gemini API key to translate captions. <button type="button" onClick={onNeedGeminiKey}>Open settings</button></p>}
      {blocker && <p role="alert" className="style-hint">{blocker}</p>}
      <div className="caption-translate-options" role="group" aria-label="Translate to">
        {options.map((entry) => {
          const exists = translations.includes(entry.code)
          return <label key={entry.code} title={entry.hint}>
            <input type="checkbox" checked={picked.includes(entry.code)} disabled={Boolean(running) || (!picked.includes(entry.code) && picked.length >= MAX_TRANSLATE_TARGETS)} onChange={() => toggle(entry.code)} />
            {entry.label}{exists ? ' (redo)' : ''}{entry.hint && <small className="style-hint"> {entry.hint}</small>}
          </label>
        })}
      </div>
      <p className="style-hint">Pick up to {MAX_TRANSLATE_TARGETS} languages.</p>
      {running && <div className="caption-translate-progress"><progress max={100} value={percent} aria-label="Translation progress" /> <span>{running.target ? translationTargetLabel(running.target) : 'Starting'} · {percent}%</span></div>}
      {message && <p role="status" className="style-hint">{message}</p>}
      <div className="caption-tools-row">
        {running
          ? <button type="button" onClick={() => void api?.cancelCaptionTranslation(running.requestId)}>Cancel</button>
          : <button type="button" className="accent" disabled={!keyConfigured || Boolean(blocker) || !picked.length} onClick={() => void start()}>Translate{picked.length ? ` (${picked.length})` : ''}</button>}
      </div>
    </div>
  </details>
}
