import { app, BrowserWindow, net, protocol } from 'electron'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { MessageDecoder } from '../workers/media/wire.ts'
import { frameRequestSchema } from '../src/export/frameRequest.ts'
import { mediaPathFromUrl } from '../electron/projectMedia.ts'
import { renderOffscreen, toPng } from './export-frame-transport.mjs'

// Must run before the app is ready, exactly like main.ts's own registration for the editor window.
protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, bypassCSP: false } },
])

// This is a separate Electron process, with the X1 GPU mode and no renderer filesystem/IPC API.
app.commandLine.appendSwitch('force-device-scale-factor', '1')
// One job-owned profile directory per export (main creates and removes it) — never the editor's
// own userData — so concurrent or crashed export hosts never collide on Local State/GPU cache.
const userDataIndex = process.argv.indexOf('--user-data')
if (userDataIndex >= 0 && process.argv[userDataIndex + 1]) app.commandLine.appendSwitch('user-data-dir', process.argv[userDataIndex + 1])
// Overlay image URLs the worker resolved from its own fingerprint registry (workers/media/export.ts)
// — the host never receives or guesses an arbitrary path, only exact `media://` URLs passed as argv.
const allowedAssetUrls = new Set()
for (let i = 0; i < process.argv.length; i++) {
  if (process.argv[i] === '--asset' && typeof process.argv[i + 1] === 'string') allowedAssetUrls.add(process.argv[i + 1])
}
let window, marker = 0, busy = false
const decoder = new MessageDecoder()
const stop = () => { window?.destroy(); app.exit(0) }
process.stdin.on('end', stop)
process.stdin.on('error', stop)
process.stdout.on('error', stop)
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
const ready = app.whenReady()
async function render(value) {
  const request = frameRequestSchema.parse(value)
  await ready
  if (!window) {
    window = new BrowserWindow({ ...request.composition, useContentSize: true, frame: false, show: false,
      enableLargerThanScreen: true, transparent: true, backgroundColor: '#00000000',
      webPreferences: { offscreen: true, nodeIntegration: false, contextIsolation: true, sandbox: true,
        backgroundThrottling: false, partition: `export-${process.pid}` } })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event) => event.preventDefault())
    window.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
    window.webContents.setFrameRate(240)
    // Serves only the exact URLs this job was launched with — never a renderer-supplied path —
    // mirroring main.ts's own `protocol.handle('media')` allow-list for the editor window.
    window.webContents.session.protocol.handle('media', async (fetchRequest) => {
      if (!allowedAssetUrls.has(fetchRequest.url)) return new Response('Forbidden', { status: 403 })
      const filePath = mediaPathFromUrl(fetchRequest.url)
      if (!filePath) return new Response('Bad Request', { status: 400 })
      return net.fetch(pathToFileURL(filePath).href)
    })
    await window.loadFile(join(dirname(process.argv[1]), 'index.html'))
  }
  const frame = await renderOffscreen(window, request, marker = marker % 0xfffffe + 1)
  const png = toPng(frame.bitmap, request.composition)
  const header = Buffer.alloc(4); header.writeUInt32BE(png.length)
  await new Promise((resolve, reject) => process.stdout.write(Buffer.concat([header, png]), (error) => error ? reject(error) : resolve()))
}
process.stdin.on('data', (chunk) => {
  try {
    decoder.push(chunk, (value) => {
      if (busy) throw new Error('Only one frame may be in flight')
      busy = true
      render(value).then(() => { busy = false }, (error) => { process.stderr.write(String(error)); app.exit(1) })
    })
  } catch (error) { process.stderr.write(String(error)); app.exit(1) }
})
