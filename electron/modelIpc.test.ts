import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile, rm, lstat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { MODEL_CATALOG } from '../src/core/modelCatalog'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  showMessageBox: vi.fn(),
  getPath: vi.fn(),
  owner: { webContents: { isDestroyed: () => false, send: vi.fn() } },
  fromWebContents: vi.fn(),
}))
vi.mock('electron', () => ({
  app: { isReady: () => true, getPath: mocks.getPath },
  BrowserWindow: { getAllWindows: () => [mocks.owner], fromWebContents: mocks.fromWebContents },
  dialog: { showMessageBox: mocks.showMessageBox },
  ipcMain: { handle: (channel: string, handler: (...args: any[]) => any) => mocks.handlers.set(channel, handler) },
}))
// Keep this disk-only fixture independent of the developer's local tool configuration.
vi.mock('./mediaWorker', () => ({ whisperCliConfigured: () => false }))
let directory: string
let closeManager: () => Promise<void>
let selected: string
const event = { sender: {} }
const invoke = (channel: string, value?: unknown) => mocks.handlers.get(channel)!(event, value)
beforeEach(async () => {
  vi.resetModules(); mocks.handlers.clear(); vi.clearAllMocks()
  directory = await mkdtemp(path.join(tmpdir(), 'caption-model-ipc-'))
  mocks.getPath.mockReturnValue(directory); mocks.fromWebContents.mockReturnValue(mocks.owner)
  mocks.showMessageBox.mockResolvedValue({ response: 0 })
  const module = await import('./modelIpc')
  module.registerModelIpc(); closeManager = module.closeModelManager
  selected = path.join(directory, 'Models', 'whisper.cpp', MODEL_CATALOG[0].fileName)
})
afterEach(async () => { await closeManager(); await rm(directory, { recursive: true, force: true }) })

it('exposes only four ID-only model operations, rejecting arbitrary paths/URLs/objects', async () => {
  expect([...mocks.handlers.keys()]).toEqual(['models:list', 'models:download', 'models:cancel', 'models:remove'])
  for (const channel of ['models:download', 'models:cancel', 'models:remove']) {
    for (const value of ['../../source.mp4', 'https://other.invalid/model', { id: 'whisper-base', path: '/source' }, null]) {
      await expect(Promise.resolve().then(() => invoke(channel, value))).rejects.toThrow()
    }
  }
  expect(mocks.showMessageBox).not.toHaveBeenCalled()
})
it('lists only local state and refuses to present a corrupt final as installed', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unexpected network'))
  await mkdir(path.dirname(selected), { recursive: true }); await writeFile(selected, 'local tiny corrupt fixture')
  const listing = await invoke('models:list')
  expect(listing.backendAvailable).toBe(false)
  expect(listing.states[0]).toMatchObject({ status: 'failed', installed: false, error: { code: 'CHECKSUM' } })
  expect(listing.catalog[0].sha256).toBe(MODEL_CATALOG[0].sha256)
  expect(fetch).not.toHaveBeenCalled(); fetch.mockRestore()
})
it('requires the explicit native removal choice and names only the selected owned paths', async () => {
  await mkdir(path.dirname(selected), { recursive: true }); await writeFile(selected, 'selected fixture')
  await writeFile(`${selected}.part`, 'partial fixture')
  const neighbor = path.join(path.dirname(selected), MODEL_CATALOG[1].fileName)
  await writeFile(neighbor, 'other selected model')
  await invoke('models:remove', MODEL_CATALOG[0].id)
  expect(await readFile(selected, 'utf8')).toBe('selected fixture')
  const options = mocks.showMessageBox.mock.calls[0][1]
  expect(options.defaultId).toBe(0); expect(options.cancelId).toBe(0)
  expect(options.message).toContain(MODEL_CATALOG[0].name)
  expect(options.detail).toContain(selected); expect(options.detail).toContain(`${selected}.part`)
  expect(options.detail).not.toContain(neighbor)
  mocks.showMessageBox.mockResolvedValue({ response: 1 })
  expect((await invoke('models:remove', MODEL_CATALOG[0].id)).status).toBe('absent')
  await expect(lstat(selected)).rejects.toMatchObject({ code: 'ENOENT' })
  await expect(lstat(`${selected}.part`)).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await readFile(neighbor, 'utf8')).toBe('other selected model')
})
it('rejects removal without an active owning window', async () => {
  mocks.fromWebContents.mockReturnValue(null)
  await expect(invoke('models:remove', MODEL_CATALOG[0].id)).rejects.toThrow('active app window')
  expect(mocks.showMessageBox).not.toHaveBeenCalled()
})
