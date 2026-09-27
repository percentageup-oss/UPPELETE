import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { McpSettingsView } from '../electron/mcp/config'
import type { ResolvePluginInfo } from '../electron/resolve/install'
import type { PlaybackProxyMode } from './core/proxy'
import { ModelManager } from './ModelManager'
import { cloudModelIdSchema, CLOUD_PROVIDERS, cloudProvider, providerLabel, type CloudProviderEntry, type CloudProviderId, type ProviderKeyStatus, type ProviderKeyStatuses, type TranscriptionDefaults, type TranscriptionProviderId } from './core/transcriptionProviders'

export type SettingsTab = 'models' | 'transcription' | 'agent' | 'resolve' | 'playback' | 'shortcuts'
const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'models', label: 'Speech models' },
  { id: 'transcription', label: 'Transcription' },
  { id: 'agent', label: 'AI agents' },
  { id: 'resolve', label: 'DaVinci Resolve' },
  { id: 'playback', label: 'Playback' },
  { id: 'shortcuts', label: 'Keyboard shortcuts' },
]

/** One settings surface for configuration that used to be three separate toolbar buttons. `tab === null` means closed. */
export function SettingsDialog({ tab, onTab, onClose, providerKeys, onProviderKeys, transcriptionDefaults, onTranscriptionDefaults, playbackProxyMode, onPlaybackProxyMode, onMessage }: {
  tab: SettingsTab | null
  onTab(tab: SettingsTab): void
  onClose(): void
  providerKeys: ProviderKeyStatuses | null
  onProviderKeys(statuses: ProviderKeyStatuses): void
  transcriptionDefaults: TranscriptionDefaults
  onTranscriptionDefaults(value: TranscriptionDefaults): void
  playbackProxyMode: PlaybackProxyMode
  onPlaybackProxyMode(mode: PlaybackProxyMode): void
  onMessage(tone: 'info' | 'error', text: string): void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const tabs = useRef(new Map<SettingsTab, HTMLButtonElement>())
  const open = tab !== null
  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (open && !element.open) element.showModal()
    else if (!open && element.open) element.close()
  }, [open])

  const onTabKey = (event: ReactKeyboardEvent) => {
    if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const index = TABS.findIndex((entry) => entry.id === tab)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length
    onTab(TABS[next].id)
    tabs.current.get(TABS[next].id)?.focus()
  }

  return <dialog ref={dialog} className="model-dialog settings-dialog" aria-labelledby="settings-title" onClose={onClose} onKeyDown={(event) => event.stopPropagation()}>
    <div className="model-panel-heading"><h2 id="settings-title">Settings</h2><button onClick={onClose}>Close</button></div>
    {open && <>
      <div className="settings-tabs" role="tablist" aria-label="Settings sections" onKeyDown={onTabKey}>
        {TABS.map((entry) => <button key={entry.id} id={`settings-tab-${entry.id}`} role="tab" aria-selected={entry.id === tab} aria-controls={`settings-panel-${entry.id}`}
          tabIndex={entry.id === tab ? 0 : -1} ref={(element) => { if (element) tabs.current.set(entry.id, element); else tabs.current.delete(entry.id) }}
          onClick={() => onTab(entry.id)}>{entry.label}</button>)}
      </div>
      <div role="tabpanel" id={`settings-panel-${tab}`} aria-labelledby={`settings-tab-${tab}`} className="settings-panel">
        {tab === 'models' && <ModelManager />}
        {tab === 'transcription' && <TranscriptionSettings keys={providerKeys} onKeys={onProviderKeys} defaults={transcriptionDefaults} onDefaults={onTranscriptionDefaults} onMessage={onMessage} />}
        {tab === 'agent' && <AgentSettings onMessage={onMessage} />}
        {tab === 'resolve' && <ResolveSettings onMessage={onMessage} />}
        {tab === 'playback' && <PlaybackProxySettings mode={playbackProxyMode} onMode={onPlaybackProxyMode} />}
        {tab === 'shortcuts' && <ShortcutReference />}
      </div>
    </>}
  </dialog>
}

const CUSTOM_MODEL = '__custom__'

/** Curated models plus a validated free-text ID, so a newly released model works without an app update. */
export function ModelPicker({ provider, value, onChange }: { provider: CloudProviderEntry; value: string | undefined; onChange(model: string | undefined): void }) {
  const current = value ?? provider.defaultModel
  const curated = provider.models.some((model) => model.id === current)
  const [custom, setCustom] = useState(!curated)
  const [draft, setDraft] = useState(curated ? '' : current)
  const draftValid = cloudModelIdSchema.safeParse(draft.trim()).success
  const selected = custom ? CUSTOM_MODEL : current
  const note = provider.models.find((model) => model.id === selected)?.note
  return <div className="provider-model">
    <label>Model
      <select value={selected} onChange={(event) => {
        if (event.target.value === CUSTOM_MODEL) { setCustom(true); return }
        setCustom(false); onChange(event.target.value === provider.defaultModel ? undefined : event.target.value)
      }}>
        {provider.models.map((model) => <option key={model.id} value={model.id}>{model.label}{model.id === provider.defaultModel ? ' (default)' : ''}</option>)}
        <option value={CUSTOM_MODEL}>Custom model ID…</option>
      </select>
    </label>
    {note && <p className="style-hint">{note}</p>}
    {custom && <>
      <label>Model ID<input type="text" autoComplete="off" spellCheck={false} value={draft} placeholder="Model ID from the provider’s documentation"
        onChange={(event) => { setDraft(event.target.value); const id = event.target.value.trim(); if (cloudModelIdSchema.safeParse(id).success) onChange(id) }} /></label>
      <p className="style-hint" role={draft && !draftValid ? 'alert' : undefined}>{draft && !draftValid ? 'Use letters, digits and . _ : / - only.' : 'The model must return word timestamps, or the request fails instead of producing untimed captions.'}</p>
    </>}
  </div>
}

export function ProviderKeySettings({ provider, status, onStatuses, onMessage }: {
  provider: CloudProviderId
  status: ProviderKeyStatus | null
  onStatuses(statuses: ProviderKeyStatuses): void
  onMessage(tone: 'info' | 'error', text: string): void
}) {
  const entry = cloudProvider(provider)
  const [apiKey, setApiKey] = useState('')
  const save = async () => {
    try { onStatuses(await window.captionStudio!.saveProviderApiKey(provider, apiKey)); setApiKey(''); onMessage('info', `${entry.label} API key saved securely.`) }
    catch (error) { onMessage('error', error instanceof Error ? error.message : 'Could not save the API key.') }
  }
  const remove = async () => {
    try { onStatuses(await window.captionStudio!.removeProviderApiKey(provider)); onMessage('info', `${entry.label} API key removed.`) }
    catch (error) { onMessage('error', error instanceof Error ? error.message : 'Could not remove the API key.') }
  }
  const fromEnvironment = status?.configured && status.source === 'environment'
  return <section className="settings-row" aria-labelledby={`${provider}-key-heading`}>
    <div className="settings-subheading">
      <h4 id={`${provider}-key-heading`} style={{ margin: 0, fontSize: 'inherit' }}>{entry.label} API key</h4>
      <span className={`settings-badge ${status?.configured ? 'ok' : 'warn'}`} role="status">{fromEnvironment ? `From ${entry.envVar}` : status?.configured ? 'Key saved' : 'No key'}</span>
    </div>
    <p className="style-hint">{provider === 'gemini'
      ? <>Used for <strong>Transcribe with Gemini</strong>, Translate to and <strong>Align audio</strong>. </>
      : <>Used for cloud transcription with {entry.label}. </>}Stored encrypted on this computer.{' '}
      <a href={entry.keyHelpUrl} target="_blank" rel="noreferrer">Get a key</a></p>
    <div className="settings-key-row">
      <input type="password" autoComplete="off" aria-label={`${entry.label} API key`} value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={status?.configured ? 'Replace the saved key' : 'Paste API key'} />
      <button className="accent" onClick={() => void save()} disabled={!apiKey.trim()}>Save key</button>
      {status?.configured && status.source !== 'environment' && <button onClick={() => void remove()}>Remove key</button>}
    </div>
  </section>
}

/** Default provider, then one cloud provider at a time (chosen from a dropdown) with its key and model. Defaults only pre-select the Transcribe dialog. */
export function TranscriptionSettings({ keys, onKeys, defaults, onDefaults, onMessage }: {
  keys: ProviderKeyStatuses | null
  onKeys(statuses: ProviderKeyStatuses): void
  defaults: TranscriptionDefaults
  onDefaults(value: TranscriptionDefaults): void
  onMessage(tone: 'info' | 'error', text: string): void
}) {
  const setModel = (provider: TranscriptionProviderId, model: string | undefined) => {
    const models = { ...defaults.models }
    if (model) models[provider] = model; else delete models[provider]
    onDefaults({ ...defaults, models })
  }
  const providers: TranscriptionProviderId[] = ['whisper', ...CLOUD_PROVIDERS.map((entry) => entry.id)]
  const [selected, setSelected] = useState<CloudProviderId>(defaults.provider !== 'whisper' ? defaults.provider : CLOUD_PROVIDERS[0].id)
  const entry = cloudProvider(selected)
  return <section aria-labelledby="transcription-defaults-heading">
    <h3 id="transcription-defaults-heading">Transcription</h3>
    <p className="settings-lead">Choose what Transcribe uses by default. whisper.cpp runs on this computer; cloud providers need your own API key.</p>
    <div className="settings-row">
      <label htmlFor="transcription-default-provider">Default provider</label>
      <select id="transcription-default-provider" value={defaults.provider} onChange={(event) => onDefaults({ ...defaults, provider: event.target.value as TranscriptionProviderId })}>
        {providers.map((id) => <option key={id} value={id}>{providerLabel(id)}{id !== 'whisper' && !keys?.[id]?.configured ? ' — no API key yet' : ''}</option>)}
      </select>
    </div>
    <h3 className="settings-subheading">Cloud provider keys</h3>
    <div className="settings-row">
      <label htmlFor="transcription-key-provider">Provider</label>
      <select id="transcription-key-provider" value={selected} onChange={(event) => setSelected(event.target.value as CloudProviderId)}>
        {CLOUD_PROVIDERS.map((provider) => <option key={provider.id} value={provider.id}>{provider.label} — {keys?.[provider.id]?.configured ? 'key saved' : 'no key'}</option>)}
      </select>
    </div>
    <div className="provider-settings" key={entry.id}>
      <ProviderKeySettings provider={entry.id} status={keys?.[entry.id] ?? null} onStatuses={onKeys} onMessage={onMessage} />
      <ModelPicker provider={entry} value={defaults.models[entry.id]} onChange={(model) => setModel(entry.id, model)} />
    </div>
  </section>
}

const PLAYBACK_PROXY_MODES: { id: PlaybackProxyMode; label: string; hint: string }[] = [
  { id: 'off', label: 'Off', hint: 'Always play the original file.' },
  { id: 'auto', label: 'Auto (recommended)', hint: 'Only for video above 1080p or that the player can’t decode (e.g. iPhone ProRes).' },
  { id: 'always', label: 'Always', hint: 'For every video.' },
]

/**
 * A background-generated, disk-cached lighter copy that preview plays instead of large source video.
 * Export, transcription, waveform extraction and thumbnails always use the original file; the per-clip
 * "Preview: proxy/original quality" toggle overrides this per session.
 */
export function PlaybackProxySettings({ mode, onMode }: { mode: PlaybackProxyMode; onMode(mode: PlaybackProxyMode): void }) {
  return <section aria-labelledby="playback-proxy-heading">
    <h3 id="playback-proxy-heading">Playback proxies</h3>
    <p className="settings-lead">Play a lighter local copy of large videos in the preview. Export always uses the original.</p>
    <div role="radiogroup" aria-labelledby="playback-proxy-heading" className="playback-proxy-modes">
      {PLAYBACK_PROXY_MODES.map((entry) => <label key={entry.id}>
        <input type="radio" name="playback-proxy-mode" checked={mode === entry.id} onChange={() => onMode(entry.id)} />
        <span><strong>{entry.label}</strong> — {entry.hint}</span>
      </label>)}
    </div>
  </section>
}

/**
 * Local agent control (docs/MCP.md): off by default. Enabling starts a loopback-only MCP server a
 * Claude client can connect to; the token shown here is the one credential that grants it, so it
 * loads its own copy on open rather than reusing the top bar's connections-only status broadcast,
 * which deliberately never carries the token (`electron/mcp/config.ts`).
 */
export function AgentSettings({ onMessage }: { onMessage(tone: 'info' | 'error', text: string): void }) {
  const [settings, setSettings] = useState<McpSettingsView | null>(null)
  const [revealed, setRevealed] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void window.captionStudio?.agentSettings().then(setSettings).catch(() => {})
    return window.captionStudio?.onAgentStatus((status) => setSettings((current) => current && { ...current, ...status }))
  }, [])

  const setEnabled = async (enabled: boolean) => {
    setBusy(true)
    try { setSettings(await window.captionStudio!.setAgentEnabled(enabled)); onMessage('info', enabled ? 'Agent access turned on.' : 'Agent access turned off.') }
    catch (error) { onMessage('error', error instanceof Error ? error.message : 'Could not change agent access.') }
    finally { setBusy(false) }
  }
  const rotate = async () => {
    setBusy(true)
    try { setSettings(await window.captionStudio!.rotateAgentToken()); setRevealed(true); onMessage('info', 'Token rotated. Update any connected client with the new token.') }
    catch (error) { onMessage('error', error instanceof Error ? error.message : 'Could not rotate the token.') }
    finally { setBusy(false) }
  }
  const copy = (value: string) => { void navigator.clipboard?.writeText(value).then(() => onMessage('info', 'Copied.')).catch(() => onMessage('error', 'Could not copy to the clipboard.')) }

  const endpoint = settings?.port ? `http://127.0.0.1:${settings.port}/mcp` : null
  const claudeCodeCommand = endpoint && settings?.token
    ? `claude mcp add --transport http caption-studio ${endpoint} --header "Authorization: Bearer ${settings.token}"` : null

  return <section className="agent-settings" aria-labelledby="agent-settings-heading">
    <h3 id="agent-settings-heading">AI agents</h3>
    <p className="settings-lead">Let Claude Code or Claude Desktop on this computer edit the open project. Off by default; local only, and a token is required.</p>
    <label className="agent-enable"><input type="checkbox" checked={settings?.enabled ?? false} disabled={busy || !settings} onChange={(event) => void setEnabled(event.target.checked)} /> Allow agent access</label>
    {settings?.enabled && <>
      <p role="status">{settings.running
        ? `Listening on 127.0.0.1:${settings.port}${settings.connections ? ` · ${settings.connections} client${settings.connections === 1 ? '' : 's'} connected` : ' · no client connected yet'}`
        : 'Turned on, but not currently listening — reopen this tab in a moment.'}</p>
      <label>Token
        <div className="agent-token-row">
          <input type={revealed ? 'text' : 'password'} readOnly value={settings.token ?? ''} aria-label="Agent access token" />
          <button type="button" onClick={() => setRevealed((value) => !value)}>{revealed ? 'Hide' : 'Show'}</button>
          <button type="button" onClick={() => settings.token && copy(settings.token)} disabled={!settings.token}>Copy</button>
        </div>
      </label>
      <div className="dialog-actions">
        <button onClick={() => void rotate()} disabled={busy}>Rotate token</button>
      </div>
      {claudeCodeCommand && <div className="agent-snippet">
        <p>Connect from Claude Code:</p>
        <pre><code>{claudeCodeCommand}</code></pre>
        <button type="button" onClick={() => copy(claudeCodeCommand)}>Copy command</button>
      </div>}
      {settings.desktopConfig
        ? <div className="agent-snippet">
          <p>Connect from Claude Desktop — add this to <code>claude_desktop_config.json</code> (Settings → Developer → Edit Config), merge it with any existing <code>mcpServers</code>, then restart Claude Desktop. KathaCut must be open with agent access on:</p>
          <pre><code>{settings.desktopConfig}</code></pre>
          <button type="button" onClick={() => copy(settings.desktopConfig!)}>Copy config</button>
        </div>
        : <p className="agent-note">The Claude Desktop connector is not built yet — run <code>npm run build:electron</code>.</p>}
    </>}
  </section>
}

/**
 * DaVinci Resolve plugin install (03): installs, reinstalls or removes the generated `KathaCut.lua`
 * launcher in Resolve's Scripts folder. Connecting itself happens from inside Resolve (Workspace →
 * Scripts → KathaCut) — this tab only manages the one file that makes that menu entry exist.
 */
export function ResolveSettings({ onMessage }: { onMessage(tone: 'info' | 'error', text: string): void }) {
  const [info, setInfo] = useState<ResolvePluginInfo | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => { void window.captionStudio?.resolvePluginInfo().then(setInfo).catch(() => {}) }, [])

  const install = async () => {
    setBusy(true)
    try { setInfo(await window.captionStudio!.installResolvePlugin()); onMessage('info', 'DaVinci Resolve plugin installed.') }
    catch (error) { onMessage('error', error instanceof Error ? error.message : 'Could not install the plugin.') }
    finally { setBusy(false) }
  }
  const uninstall = async () => {
    setBusy(true)
    try { setInfo(await window.captionStudio!.uninstallResolvePlugin()); onMessage('info', 'DaVinci Resolve plugin removed.') }
    catch (error) { onMessage('error', error instanceof Error ? error.message : 'Could not remove the plugin.') }
    finally { setBusy(false) }
  }

  return <section className="resolve-settings" aria-labelledby="resolve-settings-heading">
    <h3 id="resolve-settings-heading">DaVinci Resolve</h3>
    <p className="settings-lead">Send captions to a DaVinci Resolve timeline as native, editable Text+ clips. Works with both DaVinci Resolve Free and Studio.</p>
    {!info ? <p>Checking…</p> : !info.supported ? <p role="status">DaVinci Resolve scripting is only supported on Windows and macOS.</p> : <>
      <div className="settings-row">
        <span className={`settings-badge ${info.installed ? (info.upToDate ? 'ok' : 'warn') : 'warn'}`} role="status">
          {!info.installed ? 'Not installed' : info.upToDate ? 'Installed' : 'Installed (outdated)'}
        </span>
        {info.scriptPath && <code className="resolve-script-path">{info.scriptPath}</code>}
      </div>
      <div className="dialog-actions">
        <button className="accent" disabled={busy} onClick={() => void install()}>{info.installed ? 'Reinstall' : 'Install'}</button>
        {info.installed && <button disabled={busy} onClick={() => void uninstall()}>Remove</button>}
      </div>
      <ol className="resolve-steps">
        <li>Install the plugin above.</li>
        <li>Restart DaVinci Resolve if it was already open.</li>
        <li>In Resolve: Workspace → Scripts → KathaCut.</li>
      </ol>
    </>}
  </section>
}

export function ShortcutReference() {
  return <section className="shortcut-reference-content" aria-labelledby="shortcuts-heading">
    <h3 id="shortcuts-heading">Keyboard shortcuts</h3>
    <dl>
      <div><dt>Space</dt><dd>Play or pause video</dd></div>
      <div><dt>← / →</dt><dd>Seek one second</dd></div>
      <div><dt>↑ / ↓</dt><dd>Previous / next cue</dd></div>
      <div><dt>S</dt><dd>Split selected cue at playhead</dd></div>
      <div><dt>Delete / Backspace</dt><dd>Delete selected cue (or word in WORD mode); a selected clip is lifted, leaving a gap</dd></div>
      <div><dt>Shift+Delete</dt><dd>Ripple delete the selected clip: later clips on its track close up</dd></div>
      <div><dt>⌘/Ctrl+B</dt><dd>Split clips at the playhead (the selected clip, or every clip under it on unlocked tracks)</dd></div>
      <div><dt>D</dt><dd>Disable / enable the selected clip (a linked video and audio together)</dd></div>
      <div><dt>⌘/Ctrl+Alt+L</dt><dd>Link or unlink the selected video and its audio</dd></div>
      <div><dt>Alt+click</dt><dd>Select one side of a linked pair; edits then affect only that clip</dd></div>
      <div><dt>Ctrl/Shift+click</dt><dd>Add shapes and titles to a pending selection; then ⌘/Ctrl+G groups them, ⌘/Ctrl+Shift+G ungroups</dd></div>
      <div><dt>Alt+click / double-click</dt><dd>Select one part of a group instead of the whole group</dd></div>
      <div><dt>Q / W</dt><dd>Trim the start / end of the selected clip (or every clip under the playhead) to the playhead; ripple or overwrite follows the toolbar toggle</dd></div>
      <div><dt>I / O</dt><dd>Mark the In / Out of the export range at the playhead; Shift+I / Shift+O jump to them, X clears the range. Playback stops at Out</dd></div>
      <div><dt>⌘/Ctrl+C, ⌘/Ctrl+V</dt><dd>Copy the selected caption, clip, text or zoom region, then paste a clone of it</dd></div>
      <div><dt>Alt+drag (Option+drag on Mac)</dt><dd>On the timeline, drag a clip or zoom region to clone it; the original stays put</dd></div>
      <div><dt>⌘/Ctrl+Z</dt><dd>Undo</dd></div>
      <div><dt>⌘/Ctrl+Shift+Z or Ctrl+Y</dt><dd>Redo</dd></div>
      <div><dt>⌘/Ctrl+O</dt><dd>Open project</dd></div>
      <div><dt>⌘/Ctrl+S</dt><dd>Save project (autosaves afterwards)</dd></div>
      <div><dt>⌘/Ctrl+Shift+S</dt><dd>Save project as…</dd></div>
      <div><dt>?</dt><dd>Show these shortcuts</dd></div>
    </dl>
    <p>Editing shortcuts do not run while typing in text or timestamp fields; there, Undo and Redo act on the field. Open and Save work everywhere.</p>
    <h3>Images and picture-in-picture</h3>
    <dl>
      <div><dt>Drag on the preview</dt><dd>Move the selected image or picture-in-picture video</dd></div>
      <div><dt>Drag a handle</dt><dd>Resize; corners keep aspect, edges resize one axis</dd></div>
      <div><dt>Shift+drag a corner handle</dt><dd>Resize freely, ignoring aspect</dd></div>
      <div><dt>Alt+drag (preview or timeline)</dt><dd>Clone the clip and place the copy</dd></div>
      <div><dt>Arrow keys</dt><dd>Nudge the selected clip by 1 unit</dd></div>
      <div><dt>Shift+Arrow keys</dt><dd>Nudge the selected clip by 10 units</dd></div>
      <div><dt>Escape (mid-drag)</dt><dd>Cancel the drag or clone</dd></div>
    </dl>
  </section>
}
