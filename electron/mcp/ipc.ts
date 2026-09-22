import { app, BrowserWindow, ipcMain } from 'electron'
import { McpConfigStore, type McpSettingsView, type McpStatus } from './config'
import { RendererBridge } from './rendererBridge'
import { startMcpServer, type McpServerHandle } from './server'

let configStore: McpConfigStore | undefined
const getConfigStore = () => configStore ??= new McpConfigStore(app.getPath('userData'))

/** One bridge for the app's lifetime (see `rendererBridge.ts` on why); the loopback HTTP server
 * itself is recreated on every enable. */
const rendererBridge = new RendererBridge(() => (BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0])?.webContents ?? null)

let handle: McpServerHandle | undefined
let connections = 0

function broadcast(status: McpStatus): void {
  for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send('agent:status-changed', status)
}

async function currentStatus(): Promise<McpStatus> {
  const config = await getConfigStore().load()
  return { enabled: config.enabled, running: handle !== undefined, port: handle?.port ?? null, connections }
}

async function broadcastCurrentStatus(): Promise<void> { broadcast(await currentStatus()) }

async function stopAgent(): Promise<void> {
  if (!handle) return
  const closing = handle
  handle = undefined
  connections = 0
  await closing.close()
}

/** No-op when already running, disabled, or (a fresh install / first enable before any token
 * exists) tokenless — `setEnabled(true)` always mints one first, so this only guards startup. */
async function startAgent(): Promise<void> {
  if (handle) return
  const config = await getConfigStore().load()
  if (!config.enabled || !config.token) return
  const token = config.token
  handle = await startMcpServer(
    { token, onStatus: (status) => { connections = status.connections; void broadcastCurrentStatus() } },
    { askRenderer: (request) => rendererBridge.ask(request) },
  )
  await getConfigStore().setPort(handle.port)
}

export function registerMcpIpc(): void {
  ipcMain.handle('agent:status', () => currentStatus())
  ipcMain.handle('agent:settings-get', async (): Promise<McpSettingsView> => ({ ...(await currentStatus()), token: (await getConfigStore().load()).token }))
  ipcMain.handle('agent:settings-set-enabled', async (_event, value: unknown): Promise<McpSettingsView> => {
    if (typeof value !== 'boolean') throw new Error('Invalid value.')
    await getConfigStore().setEnabled(value)
    if (value) await startAgent(); else await stopAgent()
    void broadcastCurrentStatus()
    return { ...(await currentStatus()), token: (await getConfigStore().load()).token }
  })
  ipcMain.handle('agent:settings-rotate-token', async (): Promise<McpSettingsView> => {
    await getConfigStore().rotateToken()
    // A running server already handed its old token to the transport's request check; rotating it
    // only takes effect for new connections after a restart, so restart when one is live.
    if (handle) { await stopAgent(); await startAgent() }
    void broadcastCurrentStatus()
    return { ...(await currentStatus()), token: (await getConfigStore().load()).token }
  })
}

/** Called once from `app.whenReady()`: resumes agent access if it was left enabled last session. */
export async function initMcp(): Promise<void> {
  await startAgent()
}

/** Called from `before-quit`: tears down the HTTP listener and rejects any in-flight tool call
 * rather than leaving it hanging while the process exits. */
export async function closeMcp(): Promise<void> {
  rendererBridge.dispose()
  await stopAgent()
}
