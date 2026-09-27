import { useEffect, useRef, useState } from 'react'
import type { ResolvePluginInfo } from '../../electron/resolve/install'
import { useResolveStatus } from './useResolveStatus'

/**
 * The DaVinci Resolve connection pill shown on Home and in the editor header (03). Not connected:
 * a hint plus, if the plugin isn't installed yet, an Install button. Connected: project › timeline
 * and a Disconnect button. Shared by both places so the connection story stays consistent.
 */
export function ResolveStatusPill({ onMessage }: { onMessage(tone: 'info' | 'error', text: string): void }) {
  const status = useResolveStatus()
  const [open, setOpen] = useState(false)
  const [pluginInfo, setPluginInfo] = useState<ResolvePluginInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open || status.state === 'connected') return
    void window.captionStudio?.resolvePluginInfo().then(setPluginInfo).catch(() => {})
  }, [open, status.state])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const install = async () => {
    setBusy(true)
    try { setPluginInfo(await window.captionStudio!.installResolvePlugin()); onMessage('info', 'DaVinci Resolve plugin installed. Restart Resolve if it was already open, then Workspace → Scripts → KathaCut.') }
    catch (error) { onMessage('error', error instanceof Error ? error.message : 'Could not install the DaVinci Resolve plugin.') }
    finally { setBusy(false) }
  }

  const disconnect = async () => {
    setOpen(false)
    try { await window.captionStudio?.resolveDisconnect() }
    catch (error) { onMessage('error', error instanceof Error ? error.message : 'Could not disconnect from DaVinci Resolve.') }
  }

  const label = status.state === 'connected'
    ? `DaVinci: ${status.projectName ?? 'Untitled project'} › ${status.timelineName ?? 'Untitled timeline'}`
    : 'DaVinci: not connected'

  return <div className="resolve-status" ref={root}>
    <button type="button" className={`resolve-pill${status.state === 'connected' ? ' connected' : ''}`}
      aria-haspopup="dialog" aria-expanded={open} title={label} onClick={() => setOpen((value) => !value)}>{label}</button>
    {open && <div className="resolve-popover" role="dialog" aria-label="DaVinci Resolve connection">
      {status.state === 'connected'
        ? <>
          <p>{status.product} {status.version}</p>
          <p>{status.projectName ?? 'Untitled project'} › {status.timelineName ?? 'Untitled timeline'}</p>
          <div className="dialog-actions"><button type="button" onClick={() => void disconnect()}>Disconnect</button></div>
        </>
        : <>
          <p>In Resolve: Workspace → Scripts → KathaCut</p>
          {pluginInfo && pluginInfo.supported && !pluginInfo.installed
            && <div className="dialog-actions"><button type="button" className="accent" disabled={busy} onClick={() => void install()}>Install plugin</button></div>}
        </>}
    </div>}
  </div>
}
