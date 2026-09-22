import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { AlignmentSettingsStatus } from './core/alignmentIpc'
import type { McpSettingsView } from '../electron/mcp/config'
import { ModelManager } from './ModelManager'

export type SettingsTab = 'models' | 'gemini' | 'agent' | 'shortcuts'
const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'models', label: 'Speech models' },
  { id: 'gemini', label: 'Gemini API key' },
  { id: 'agent', label: 'AI agents' },
  { id: 'shortcuts', label: 'Keyboard shortcuts' },
]

/** One settings surface for configuration that used to be three separate toolbar buttons. `tab === null` means closed. */
export function SettingsDialog({ tab, onTab, onClose, geminiKey, onGeminiKey, onMessage }: {
  tab: SettingsTab | null
  onTab(tab: SettingsTab): void
  onClose(): void
  geminiKey: AlignmentSettingsStatus | null
  onGeminiKey(status: AlignmentSettingsStatus): void
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
      <p className="agent-note">Claude Desktop support is not available yet.</p>
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
