import { ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import type { MediaFingerprint, ProjectMedia } from '../../src/core/media'
import {
  resolveEmptyResultSchema, resolveJumpRequestSchema, resolvePushTimelineRequestSchema, resolveSyncApplyRequestSchema, resolveSyncPreviewRequestSchema, resolveTimelineInfoSchema,
} from '../../src/core/resolveIpc'
import { getResolveBridge } from './bridge'
import { importTimelineEdit } from './importEdit'
import { installPlugin, pluginInfo, uninstallPlugin } from './install'
import { pushTimeline } from './push'
import { renderTimelineProxy, type RenderTimelineProxyDeps } from './proxy'
import { applySync, jumpToFrame, previewSync } from './sync'

export type ResolveIpcDeps = {
  /** The same probe main.ts uses for `dialog:open-video` (`inspectMedia`). */
  inspect: RenderTimelineProxyDeps['inspect']
  /** main.ts's fingerprint registry, the same one `registerExportIpc` resolves assets from (12). */
  lookupMedia(fingerprint: MediaFingerprint): { path: string; media: ProjectMedia } | undefined
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

  // Sync to Resolve (06). Payloads are validated here; the apply recomputes the diff from a fresh read of the
  // Resolve track, and the template path is resolved in main, never taken from the renderer.
  let syncRunning = false
  ipcMain.handle('resolve:sync-preview', (_event, payload: unknown) => previewSync(getResolveBridge(), resolveSyncPreviewRequestSchema.parse(payload)))
  ipcMain.handle('resolve:sync-apply', async (event, payload: unknown) => {
    const request = resolveSyncApplyRequestSchema.parse(payload)
    if (syncRunning) throw new Error('A sync to DaVinci Resolve is already running.')
    syncRunning = true
    try {
      return await applySync(getResolveBridge(), request, (progress) => { if (!event.sender.isDestroyed()) event.sender.send('resolve:sync-progress', progress) })
    } finally { syncRunning = false }
  })
  // Import the timeline edit (11): paths come from Resolve inside main; the renderer sends no payload.
  let importRunning = false
  ipcMain.handle('resolve:import-edit', async (event) => {
    if (importRunning) throw new Error('A DaVinci timeline import is already running.')
    importRunning = true
    try {
      return await importTimelineEdit({ bridge: getResolveBridge(), inspect: deps.inspect },
        (progress) => { if (!event.sender.isDestroyed()) event.sender.send('resolve:import-edit-progress', progress) })
    } finally { importRunning = false }
  })
  ipcMain.handle('resolve:jump-to',(_event, payload: unknown) => {
    const { timelineId, frame } = resolveJumpRequestSchema.parse(payload)
    return jumpToFrame(getResolveBridge(), timelineId, frame)
  })

  // Create in DaVinci (12): a new timeline in the open project. Payloads are validated here; media paths are
  // resolved only from this session's fingerprint registry, never from the renderer.
  let pushRunning = false
  ipcMain.handle('resolve:push-timeline', async (event, payload: unknown) => {
    const request = resolvePushTimelineRequestSchema.parse(payload)
    if (pushRunning) throw new Error('A DaVinci timeline is already being created.')
    pushRunning = true
    try {
      return await pushTimeline({ bridge: getResolveBridge(), lookupMedia: deps.lookupMedia }, request,
        (progress) => { if (!event.sender.isDestroyed()) event.sender.send('resolve:push-progress', progress) })
    } finally { pushRunning = false }
  })

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
