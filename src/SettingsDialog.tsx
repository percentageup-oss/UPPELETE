import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { AlignmentSettingsStatus } from './core/alignmentIpc'
import type { McpSettingsView } from '../electron/mcp/config'
import type { PlaybackProxyMode } from './core/proxy'
import { ModelManager } from './ModelManager'

export type SettingsTab = 'models' | 'gemini' | 'agent' | 'playback' | 'shortcuts'
const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'models', label: 'Speech models' },
  { id: 'gemini', label: 'Gemini API key' },
  { id: 'agent', label: 'AI agents' },
  { id: 'playback', label: 'Playback' },
  { id: 'shortcuts', label: 'Keyboard shortcuts' },
]

/** One settings surface for configuration that used to be three separate toolbar buttons. `tab === null` means closed. */
export function SettingsDialog({ tab, onTab, onClose, geminiKey, onGeminiKey, playbackProxyMode, onPlaybackProxyMode, onMessage }: {
  tab: SettingsTab | null
  onTab(tab: SettingsTab): void
  onClose(): void
  geminiKey: AlignmentSettingsStatus | null
  onGeminiKey(status: AlignmentSettingsStatus): void
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
        {tab === 'gemini' && <GeminiKeySettings status={geminiKey} onStatus={onGeminiKey} onMessage={onMessage} />}
        {tab === 'agent' && <AgentSettings onMessage={onMessage} />}
        {tab === 'playback' && <PlaybackProxySettings mode={playbackProxyMode} onMode={onPlaybackProxyMode} />}
        {tab === 'shortcuts' && <ShortcutReference />}
      </div>
    </>}
  </dialog>
}

export function GeminiKeySettings({ status, onStatus, onMessage }: {
  status: AlignmentSettingsStatus | null
  onStatus(status: AlignmentSettingsStatus): void
  onMessage(tone: 'info' | 'error', text: string): void
}) {
  const [apiKey, setApiKey] = useState('')
  const save = async () => {
    try { onStatus(await window.captionStudio!.saveGeminiApiKey(apiKey)); setApiKey(''); onMessage('info', 'Gemini API key saved securely.') }
    catch (error) { onMessage('error', error instanceof Error ? error.message : 'Could not save the API key.') }
  }
  const remove = async () => {
    try { onStatus(await window.captionStudio!.removeGeminiApiKey()); onMessage('info', 'Gemini API key removed.') }
    catch (error) { onMessage('error', error instanceof Error ? error.message : 'Could not remove the API key.') }
  }
  return <section className="alignment-settings" aria-labelledby="gemini-key-heading">
    <h3 id="gemini-key-heading">Gemini API key</h3>
    <p>Optional. Your key is encrypted with the operating system’s credential store and never leaves this computer except in requests you start. It enables two cloud actions: <strong>Transcribe with Gemini</strong> uploads detected speech audio, and <strong>Align audio</strong> uploads only padded audio ranges covered by captions without replacing their text. Local transcription and editing work without it.</p>
    <p role="status">{status?.configured ? status.source === 'environment' ? 'A key is supplied by the GEMINI_API_KEY environment variable.' : 'A key is saved.' : 'No key is saved.'}</p>
    <label>Gemini API key<input type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={status?.configured ? 'Replace the saved key' : 'Paste API key'} /></label>
    <div className="dialog-actions">
      <button className="accent" onClick={() => void save()} disabled={!apiKey.trim()}>Save key</button>
      {status?.configured && status.source !== 'environment' && <button onClick={() => void remove()}>Remove key</button>}
    </div>
  </section>
}

const PLAYBACK_PROXY_MODES: { id: PlaybackProxyMode; label: string; hint: string }[] = [
  { id: 'off', label: 'Off', hint: 'Preview always plays the original file, whatever its size.' },
  { id: 'auto', label: 'Auto (recommended)', hint: 'A lighter local copy is generated in the background for video above 1080p or that the player cannot decode (e.g. iPhone ProRes), and used for preview once ready.' },
  { id: 'always', label: 'Always', hint: 'A lighter local copy is generated in the background for every video, however small.' },
]

/**
 * Large source video (a 4K import edited for a 1080p delivery) decodes at full size in preview even
 * though the sequence and export target something smaller — this is the setting for the fix: a
 * background-generated, disk-cached proxy that preview plays instead. It never touches export,
 * transcription, waveform extraction, thumbnails or export parity, which always use the original
 * file; the per-clip "Preview: proxy/original quality" toggle over the video preview overrides this
 * per session to check full-quality framing.
 */
export function PlaybackProxySettings({ mode, onMode }: { mode: PlaybackProxyMode; onMode(mode: PlaybackProxyMode): void }) {
  return <section className="alignment-settings" aria-labelledby="playback-proxy-heading">
    <h3 id="playback-proxy-heading">Playback proxies</h3>
    <p>Large source video (e.g. a 4K import) can be sluggish to scrub and play back in preview even when the sequence and export target something smaller. This generates a lighter local copy in the background and plays that in preview only — export, transcription and waveform extraction always use the original file, and nothing is uploaded or sent anywhere.</p>
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
    <p>Optional and off by default. Enabling this lets a Claude client (Claude Code or Claude Desktop) on this computer read and edit the open project through the same commands the editor itself uses — undoable, and visible here as it happens. Nothing leaves this computer: the server only listens on 127.0.0.1 and requires the token below.</p>
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
