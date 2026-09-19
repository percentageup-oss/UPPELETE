import { useEffect, useState } from 'react'
import { type ManagedModelId, type ModelArtifact, type ModelState } from './core/modelCatalog'

const busy = (state: ModelState) => ['checking', 'downloading', 'verifying', 'removing'].includes(state.status)
const labels: Record<ModelState['status'], string> = {
  absent: 'Not installed', checking: 'Checking local files…', downloading: 'Downloading — inactive', verifying: 'Verifying SHA-256 — inactive', installed: 'Installed — checksum verified',
  interrupted: 'Interrupted download — inactive', cancelled: 'Cancelled — inactive', failed: 'Failed — inactive', removing: 'Removing…',
}
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
        <h3 id="models-heading">Local speech models</h3>
        <p>Downloads start only when you choose Download or Resume. Verified models remain on this computer and can be used offline. {backendAvailable ? 'A local whisper-cli executable is configured; use Transcribe to run it.' : 'No local whisper-cli executable is configured, so transcription is unavailable.'}</p>
        <p>Device modes below describe upstream support and build requirements. Devices actually initialized by the configured engine are shown in the Transcribe dialog. Only these exact GGML artifacts are managed; language support is not a quality or alignment guarantee.</p>
        <button disabled={pending !== null || states.some(busy)} onClick={() => void refresh()}>Recheck local files</button>
        {error && <p role="alert">{error}</p>}
        {catalog.map((model) => {
          const state = states.find((entry) => entry.id === model.id)
          if (!state) return null
          const blocked = busy(state) || pending !== null
          const hasPartial = state.partialPresent
          return <article className="model-card" key={model.id} aria-labelledby={`model-${model.id}`}>
            <h3 id={`model-${model.id}`}>{model.name}</h3>
            <dl>
              <dt>Backend / format</dt><dd>{model.backend} / {model.format}</dd>
              <dt>Languages</dt><dd>{model.languageCapability}</dd>
              <dt>Download / installed size</dt><dd>{model.sizeBytes.toLocaleString()} bytes ({(model.sizeBytes / 1024 / 1024).toFixed(2)} MiB)</dd>
              <dt>Disk location</dt><dd><code>{state.location}</code></dd>
              <dt>Partial download</dt><dd><code>{state.partialLocation}</code></dd>
              <dt>Trusted SHA-256</dt><dd><code>{model.sha256}</code></dd>
              <dt>Supported device modes</dt><dd>{model.deviceModes.join('; ')}</dd>
              <dt>State</dt><dd role="status">{labels[state.status]}{state.cancelRequested && ' — cancelling…'}</dd>
            </dl>
            {state.status === 'downloading' && <progress aria-label={`Downloaded bytes for ${model.name}`} value={state.downloadedBytes} max={model.sizeBytes} />}
            {!state.installed && <p>{state.downloadedBytes.toLocaleString()} of {model.sizeBytes.toLocaleString()} bytes saved{hasPartial && '; Resume uses a byte range if supported, otherwise restarts.'}</p>}
            {state.error && <p role="alert">{state.error.code}: {state.error.message}</p>}
            <div className="model-actions">
              {!state.installed && <button disabled={blocked} onClick={() => void action(model.id, 'downloadModel')}>{hasPartial ? 'Resume / retry download' : `Download (${(model.sizeBytes / 1024 / 1024).toFixed(2)} MiB)`}</button>}
              {['checking', 'downloading', 'verifying'].includes(state.status) && <button disabled={state.cancelRequested} onClick={() => void action(model.id, 'cancelModelDownload')}>Cancel download / verification</button>}
              <button disabled={blocked || (state.status === 'absent')} onClick={() => void action(model.id, 'removeModel')}>Remove model / partial…</button>
            </div>
          </article>
        })}
  </section>
}
