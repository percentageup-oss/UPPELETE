import { ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { resolveEmptyResultSchema, resolveTimelineInfoSchema } from '../../src/core/resolveIpc'
import { getResolveBridge } from './bridge'
import { installPlugin, pluginInfo, uninstallPlugin } from './install'
import { renderTimelineProxy, type RenderTimelineProxyDeps } from './proxy'

export type ResolveIpcDeps = {
  /** The same probe main.ts uses for `dialog:open-video` (`inspectMedia`). */
  inspect: RenderTimelineProxyDeps['inspect']
}

/** Registered once at startup, alongside `registerMcpIpc` (`electron/main.ts`). The bridge itself is
 * started/stopped separately from `app.whenReady()`/`before-quit`. */
export function registerResolveIpc(deps: ResolveIpcDeps): void {
  ipcMain.handle('resolve:status', () => getResolveBridge().getStatus())
  ipcMain.handle('resolve:plugin-info', () => pluginInfo())
  ipcMain.handle('resolve:install-plugin', () => installPlugin())
  ipcMain.handle('resolve:uninstall-plugin', () => uninstallPlugin())
  ipcMain.handle('resolve:timeline-info', () => getResolveBridge().request('timelineInfo', {}, resolveTimelineInfoSchema))
  ipcMain.handle('resolve:disconnect', () => getResolveBridge().request('disconnect', {}, resolveEmptyResultSchema))

  // Create-project-from-timeline (04): the render can take a while, so `resolve:create-proxy-start`
  // returns a `requestId` immediately and the render runs in the background; its progress and final
  // result arrive over `resolve:proxy-progress` / `resolve:proxy-done`, matched by that id.
  const activeProxyRenders = new Map<string, { cancelled: boolean; controller: AbortController }>()

  ipcMain.handle('resolve:create-proxy-start', (event) => {
    const requestId = randomUUID()
    const controller = new AbortController()
    const active = { cancelled: false, controller }
    activeProxyRenders.set(requestId, active)
    const send = (channel: string, payload: unknown) => { if (!event.sender.isDestroyed()) event.sender.send(channel, payload) }
    const cancelForDestroyedRenderer = () => { active.cancelled = true; active.controller.abort() }
    event.sender.once('destroyed', cancelForDestroyedRenderer)
    renderTimelineProxy({ bridge: getResolveBridge(), inspect: deps.inspect },
      (percent) => send('resolve:proxy-progress', { requestId, percent }),
      controller.signal)
      .then((result) => send('resolve:proxy-done', { requestId, ok: true, result }))
      .catch((error: unknown) => send('resolve:proxy-done', { requestId, ok: false, message: error instanceof Error ? error.message : 'The DaVinci Resolve render failed.' }))
      .finally(() => {
        event.sender.removeListener('destroyed', cancelForDestroyedRenderer)
        activeProxyRenders.delete(requestId)
      })
    return { requestId }
  })

  ipcMain.handle('resolve:create-proxy-cancel', (_event, requestId: unknown) => {
    if (typeof requestId !== 'string') return
    const active = activeProxyRenders.get(requestId)
    if (active) { active.cancelled = true; active.controller.abort() }
  })
}
