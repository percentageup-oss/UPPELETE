import { ipcMain } from 'electron'
import { resolveEmptyResultSchema, resolveTimelineInfoSchema } from '../../src/core/resolveIpc'
import { getResolveBridge } from './bridge'
import { installPlugin, pluginInfo, uninstallPlugin } from './install'

/** Registered once at startup, alongside `registerMcpIpc` (`electron/main.ts`). The bridge itself is
 * started/stopped separately from `app.whenReady()`/`before-quit`. */
export function registerResolveIpc(): void {
  ipcMain.handle('resolve:status', () => getResolveBridge().getStatus())
  ipcMain.handle('resolve:plugin-info', () => pluginInfo())
  ipcMain.handle('resolve:install-plugin', () => installPlugin())
  ipcMain.handle('resolve:uninstall-plugin', () => uninstallPlugin())
  ipcMain.handle('resolve:timeline-info', () => getResolveBridge().request('timelineInfo', {}, resolveTimelineInfoSchema))
  ipcMain.handle('resolve:disconnect', () => getResolveBridge().request('disconnect', {}, resolveEmptyResultSchema))
}
