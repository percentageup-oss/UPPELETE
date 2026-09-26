import { useEffect, useState } from 'react'
import { type ManagedModelId, type ModelArtifact, type ModelState } from './core/modelCatalog'
import { formatSize } from './core/format'

const busy = (state: ModelState) => ['checking', 'downloading', 'verifying', 'removing'].includes(state.status)
/** Only states the user needs to act on or wait for; "installed" and "absent" are shown by the badge and the button. */
const statusText: Partial<Record<ModelState['status'], string>> = {
  checking: 'Checking local files…', downloading: 'Downloading…', verifying: 'Verifying download…', removing: 'Removing…',
  interrupted: 'Download interrupted — resume to continue.', cancelled: 'Download cancelled.', failed: 'Download failed.',
}
/** Multilingual models first, smallest to largest; English-only last so the Malayalam-capable path reads first. */
const byTier = (a: ModelArtifact, b: ModelArtifact) => Number(b.multilingual) - Number(a.multilingual) || a.sizeBytes - b.sizeBytes

/** Model catalog, download and verification controls. Rendered inside the Settings dialog's Speech models tab. */
export function ModelManager() {
  const [catalog, setCatalog] = useState<readonly ModelArtifact[]>([])
  const [states, setStates] = useState<ModelState[]>([])
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<ManagedModelId | 'refresh' | null>(null)
  const [backendAvailable, setBackendAvailable] = useState(false)
  const update = (state: ModelState) => setStates((current) => [...current.filter((entry) => entry.id !== state.id), state])
  useEffect(() => window.captionStudio?.onModelState(update), [])
  useEffect(() => { void refresh() }, [])
  const refresh = async () => {
    if (!window.captionStudio) { setError('Model management requires the desktop app.'); return }
    setPending('refresh'); setError(null)
    try {
      const listing = await window.captionStudio.listModels()
      setCatalog(listing.catalog); setStates(listing.states); setBackendAvailable(listing.backendAvailable)
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not inspect models.') }
    finally { setPending(null) }
  }
  const action = async (id: ManagedModelId, operation: 'downloadModel' | 'removeModel' | 'cancelModelDownload') => {
    if (!window.captionStudio) return
    if (operation !== 'cancelModelDownload') setPending(id)
    setError(null)
    try {
      const state = await window.captionStudio[operation](id)
      if (state) update(state)
    } catch (error) { setError(error instanceof Error ? error.message : 'Model operation failed.') }
    finally { if (operation !== 'cancelModelDownload') setPending(null) }
  }
  return <section aria-labelledby="models-heading">
    <div className="settings-heading-row">
      <h3 id="models-heading">Speech models</h3>
      <button disabled={pending !== null || states.some(busy)} onClick={() => void refresh()}>Recheck files</button>
    </div>
    <p className="settings-lead">Download a model to transcribe offline. Larger models are more accurate, especially for Malayalam, but slower.</p>
    {!backendAvailable && catalog.length > 0 && <p role="alert">Local transcription engine not found; downloaded models can’t be used yet.</p>}
    {error && <p role="alert">{error}</p>}
    {[...catalog].sort(byTier).map((model) => {
      const state = states.find((entry) => entry.id === model.id)
      if (!state) return null
      const blocked = busy(state) || pending !== null
      const hasPartial = state.partialPresent
      const status = statusText[state.status]
      return <article className="model-card" key={model.id} aria-labelledby={`model-${model.id}`}>
        <div className="model-card-main">
          <h4 id={`model-${model.id}`}>{model.name}
            {model.recommended && <span className="settings-badge accent">Recommended</span>}
            {state.installed && <span className="settings-badge ok">Installed</span>}
          </h4>
          <p className="model-summary">{model.summary}</p>
        </div>
        <div className="model-card-side">
          <span className="model-size">{formatSize(model.sizeBytes)}</span>
          <div className="model-actions">
            {!state.installed && !['checking', 'downloading', 'verifying'].includes(state.status) && <button className="accent" disabled={blocked} onClick={() => void action(model.id, 'downloadModel')}>{hasPartial ? 'Resume' : `Download`}</button>}
            {['checking', 'downloading', 'verifying'].includes(state.status) && <button disabled={state.cancelRequested} onClick={() => void action(model.id, 'cancelModelDownload')}>{state.cancelRequested ? 'Cancelling…' : 'Cancel'}</button>}
            {(state.installed || hasPartial) && !['checking', 'downloading', 'verifying'].includes(state.status) && <button disabled={blocked} onClick={() => void action(model.id, 'removeModel')}>{state.installed ? 'Remove' : 'Discard partial'}</button>}
          </div>
        </div>
        {state.status === 'downloading' && <progress aria-label={`Downloaded bytes for ${model.name}`} value={state.downloadedBytes} max={model.sizeBytes} />}
        {(status || (!state.installed && hasPartial)) && <p className="model-status" role="status">{status}{!state.installed && state.downloadedBytes > 0 && ` ${formatSize(state.downloadedBytes)} of ${formatSize(model.sizeBytes)} saved.`}</p>}
        {state.error && <p role="alert">{state.error.message}</p>}
        <details className="model-details">
          <summary>Details</summary>
          <dl>
            <dt>Languages</dt><dd>{model.languageCapability}</dd>
            <dt>File</dt><dd><code>{model.fileName}</code></dd>
            <dt>Location</dt><dd><code>{state.location}</code></dd>
            <dt>SHA-256</dt><dd><code>{model.sha256}</code></dd>
          </dl>
        </details>
      </article>
    })}
  </section>
}
