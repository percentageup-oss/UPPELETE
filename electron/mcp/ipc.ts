import { existsSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { app, BrowserWindow, clipboard, ipcMain, nativeImage } from 'electron'
import type { McpToolDeps } from './tools'
import type { InspectedFile } from '../../src/core/assetImport'
import { assertImportPath, decodeBase64Image, fetchImageBytes, MAX_IMPORT_IMAGE_BYTES, saveAgentMedia, sniffImageMime } from './importMedia'
import { assertReferencePath, assertReferenceSize, type ReferenceMime } from './referenceImage'
import { MCP_CONFIG_FILE, McpConfigStore, type McpSettingsView, type McpStatus } from './config'
import { RendererBridge } from './rendererBridge'
import { startMcpServer, type McpServerHandle } from './server'

let configStore: McpConfigStore | undefined
const getConfigStore = () => configStore ??= new McpConfigStore(app.getPath('userData'))

/** One bridge for the app's lifetime (see `rendererBridge.ts` on why); the loopback HTTP server
 * itself is recreated on every enable. */
const projectWindow = () => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null
const rendererBridge = new RendererBridge(() => projectWindow()?.webContents ?? null)

const MAX_CAPTURE_EDGE = 1024

/** A reference is only ever used to derive a grade, so it is downscaled to a small JPEG before it crosses
 * IPC. Formats Electron cannot decode (webp, gif) pass through as-is for the renderer's decoder. */
function normalizeReference(buffer: Buffer, mimeType: ReferenceMime): { imageBase64: string; mimeType: ReferenceMime } {
  const image = nativeImage.createFromBuffer(buffer)
  if (image.isEmpty()) return { imageBase64: buffer.toString('base64'), mimeType }
  const { width, height } = image.getSize()
  const scale = Math.min(1, MAX_CAPTURE_EDGE / Math.max(width, height))
  const output = scale < 1 ? image.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), quality: 'best' }) : image
  return { imageBase64: output.toJPEG(92).toString('base64'), mimeType: 'image/jpeg' }
}

/** The image currently on the clipboard, or null. Shared by `match_color_to_reference` and `import_media`. */
async function readClipboardImage(): Promise<{ bytes: Buffer; type: 'image/png' | 'image/jpeg' } | null> {
  for (const item of await clipboard.read()) {
    const type = item.types.find((candidate): candidate is 'image/png' | 'image/jpeg' => candidate === 'image/png' || candidate === 'image/jpeg')
    if (!type) continue
    const blob = await item.getType(type) as Blob
    return { bytes: Buffer.from(await blob.arrayBuffer()), type }
  }
  return null
}

const readReference: NonNullable<McpToolDeps['readReference']> = async ({ imagePath, fromClipboard }) => {
  if (fromClipboard) {
    const image = await readClipboardImage()
    if (!image) throw new Error('The clipboard has no image. Copy the reference picture, then try again.')
    assertReferenceSize(image.bytes.length)
    return normalizeReference(image.bytes, image.type)
  }
  const mimeType = assertReferencePath(imagePath ?? '')
  const info = await stat(imagePath!).catch(() => { throw new Error('That image file does not exist or cannot be read.') })
  if (!info.isFile()) throw new Error('imagePath must be a file.')
  assertReferenceSize(info.size)
  return normalizeReference(await readFile(imagePath!), mimeType)
}

/** Main's own probe/fingerprint path for a file (`inspectFileForBin`), handed in by `main.ts` so a file the agent imports is
 * registered exactly like a dragged-in one and becomes servable over the `media:` scheme. */
export type McpIpcOptions = { inspectFile: (filePath: string) => Promise<InspectedFile> }
let inspectFile: McpIpcOptions['inspectFile'] | undefined

/** Where bytes the agent hands over (clipboard, base64, https) land: the app's own folder, content-addressed, never the user's files. */
const agentMediaDirectory = () => path.join(app.getPath('userData'), 'agent-media')

const importSource: NonNullable<McpToolDeps['importSource']> = async (source) => {
  if (!inspectFile) throw new Error('Importing media is not available yet.')
  let filePath: string
  if (source.path !== undefined) {
    assertImportPath(source.path)
    const info = await stat(source.path).catch(() => { throw new Error('That file does not exist or cannot be read.') })
    if (!info.isFile()) throw new Error('path must be a file.')
    filePath = source.path
  } else {
    let image: { bytes: Buffer; mime: NonNullable<ReturnType<typeof sniffImageMime>> }
    if (source.fromClipboard) {
      const clip = await readClipboardImage()
      if (!clip) throw new Error('The clipboard has no image. Copy the picture, then try again.')
      if (clip.bytes.length > MAX_IMPORT_IMAGE_BYTES) throw new Error(`The clipboard image is larger than ${MAX_IMPORT_IMAGE_BYTES / (1024 * 1024)} MB.`)
      const mime = sniffImageMime(clip.bytes)
      if (!mime) throw new Error('The clipboard content is not a supported image.')
      image = { bytes: clip.bytes, mime }
    } else if (source.imageBase64 !== undefined) image = decodeBase64Image(source.imageBase64)
    else image = await fetchImageBytes(source.url ?? '')
    filePath = await saveAgentMedia(agentMediaDirectory(), image.bytes, image.mime)
  }
  const result = await inspectFile(filePath)
  if (!result.ok) throw new Error(result.message)
  if (result.kind === 'subtitle') throw new Error('Subtitle files cannot be imported with import_media.')
  return result
}

/** `render_frame`'s pixels: `capturePage` of the preview rect the renderer just settled, downscaled so
 * an image stays cheap in the agent's context. Rect is CSS px; Electron wants device-independent px. */
const captureRect: NonNullable<McpToolDeps['captureRect']> = async (rect) => {
  const window = projectWindow()
  if (!window || window.isDestroyed()) throw new Error('KathaCut has no open project window.')
  if (window.isMinimized()) throw new Error('The KathaCut window is minimized; restore it so the preview can be captured.')
  const zoom = window.webContents.getZoomFactor()
  const image = await window.webContents.capturePage({ x: Math.round(rect.x * zoom), y: Math.round(rect.y * zoom), width: Math.round(rect.width * zoom), height: Math.round(rect.height * zoom) })
  if (image.isEmpty()) throw new Error('The preview could not be captured. Bring the KathaCut window to the front and retry.')
  const size = image.getSize()
  const scale = Math.min(1, MAX_CAPTURE_EDGE / Math.max(size.width, size.height))
  const output = scale < 1 ? image.resize({ width: Math.round(size.width * scale), height: Math.round(size.height * scale), quality: 'best' }) : image
  const outSize = output.getSize()
  return { data: output.toJPEG(85).toString('base64'), mimeType: 'image/jpeg', width: outSize.width, height: outSize.height }
}

let handle: McpServerHandle | undefined
let connections = 0

function broadcast(status: McpStatus): void {
  for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send('agent:status-changed', status)
}

async function currentStatus(): Promise<McpStatus> {
  const config = await getConfigStore().load()
  return { enabled: config.enabled, running: handle !== undefined, port: handle?.port ?? null, connections }
}

/** The Claude Desktop entry: the app's own executable runs the bundled connector as plain Node
 * (ELECTRON_RUN_AS_NODE), so the user needs no separate Node install. Paths are the real ones for this machine. */
function desktopConfig(): string | null {
  if (typeof app.getAppPath !== 'function') return null
  const script = path.join(app.getAppPath(), 'dist-electron', 'mcp-stdio.cjs')
  if (!existsSync(script)) return null
  const entry = { command: process.execPath, args: [script, path.join(app.getPath('userData'), MCP_CONFIG_FILE)], env: { ELECTRON_RUN_AS_NODE: '1' } }
  return JSON.stringify({ mcpServers: { kathacut: entry } }, null, 2)
}

async function settingsView(): Promise<McpSettingsView> {
  return { ...(await currentStatus()), token: (await getConfigStore().load()).token, desktopConfig: desktopConfig() }
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
    { askRenderer: (request) => rendererBridge.ask(request), captureRect, readReference, importSource },
  )
  await getConfigStore().setPort(handle.port)
}

export function registerMcpIpc(options: McpIpcOptions): void {
  inspectFile = options.inspectFile
  ipcMain.handle('agent:status', () => currentStatus())
  ipcMain.handle('agent:settings-get', (): Promise<McpSettingsView> => settingsView())
  ipcMain.handle('agent:settings-set-enabled', async (_event, value: unknown): Promise<McpSettingsView> => {
    if (typeof value !== 'boolean') throw new Error('Invalid value.')
    await getConfigStore().setEnabled(value)
    if (value) await startAgent(); else await stopAgent()
    void broadcastCurrentStatus()
    return settingsView()
  })
  ipcMain.handle('agent:settings-rotate-token', async (): Promise<McpSettingsView> => {
    await getConfigStore().rotateToken()
    // A running server already handed its old token to the transport's request check; rotating it
    // only takes effect for new connections after a restart, so restart when one is live.
    if (handle) { await stopAgent(); await startAgent() }
    void broadcastCurrentStatus()
    return settingsView()
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
