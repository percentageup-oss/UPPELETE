import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { McpSettingsView, McpStatus } from './config'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  removeHandler: vi.fn(),
  getPath: vi.fn(),
  sent: [] as { channel: string; payload: unknown }[],
  windows: [] as unknown[],
}))
vi.mock('electron', () => ({
  app: { getPath: mocks.getPath },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => mocks.handlers.set(channel, handler),
    removeHandler: mocks.removeHandler,
  },
  BrowserWindow: {
    getFocusedWindow: () => null,
    getAllWindows: () => mocks.windows,
  },
}))

let directory: string
let registerMcpIpc: () => void
let initMcp: () => Promise<void>
let closeMcp: () => Promise<void>

const invoke = <T>(channel: string, value?: unknown): Promise<T> => Promise.resolve(mocks.handlers.get(channel)!({ sender: {} }, value) as T)

beforeEach(async () => {
  vi.resetModules()
  mocks.handlers.clear(); mocks.removeHandler.mockClear(); mocks.sent = []; mocks.windows = []
  directory = await mkdtemp(path.join(tmpdir(), 'caption-mcp-ipc-'))
  mocks.getPath.mockReturnValue(directory)
  const module = await import('./ipc')
  registerMcpIpc = module.registerMcpIpc
  initMcp = module.initMcp
  closeMcp = module.closeMcp
  registerMcpIpc()
})
afterEach(async () => {
  await closeMcp()
  await rm(directory, { recursive: true, force: true })
})

describe('registerMcpIpc', () => {
  it('starts disabled with no running server', async () => {
    const status = await invoke<McpStatus>('agent:status')
    expect(status).toEqual({ enabled: false, running: false, port: null, connections: 0 })
  })

  it('initMcp does nothing when access was never enabled', async () => {
    await initMcp()
    expect(await invoke<McpStatus>('agent:status')).toMatchObject({ running: false })
  })

  it('enabling starts a real loopback server and mints a token; disabling stops it and keeps the token', async () => {
    const enabled = await invoke<McpSettingsView>('agent:settings-set-enabled', true)
    expect(enabled.enabled).toBe(true)
    expect(enabled.running).toBe(true)
    expect(enabled.port).toBeGreaterThan(0)
    expect(enabled.token).toMatch(/^[\w-]{32,}$/)

    const disabled = await invoke<McpSettingsView>('agent:settings-set-enabled', false)
    expect(disabled.enabled).toBe(false)
    expect(disabled.running).toBe(false)
    expect(disabled.token).toBe(enabled.token)
  })

  it('rejects a non-boolean enabled value', async () => {
    await expect(invoke('agent:settings-set-enabled', 'yes')).rejects.toThrow('Invalid value')
  })

  it('agent:settings-get reports the token without needing to enable first', async () => {
    const before = await invoke<McpSettingsView>('agent:settings-get')
    expect(before.token).toBeNull()
    await invoke('agent:settings-set-enabled', true)
    const after = await invoke<McpSettingsView>('agent:settings-get')
    expect(after.token).toMatch(/^[\w-]{32,}$/)
  })

  it('rotating the token while running restarts the server with a fresh token and a live port', async () => {
    const enabled = await invoke<McpSettingsView>('agent:settings-set-enabled', true)
    const rotated = await invoke<McpSettingsView>('agent:settings-rotate-token')
    expect(rotated.token).not.toBe(enabled.token)
    expect(rotated.running).toBe(true)
    expect(rotated.port).toBeGreaterThan(0)
  })

  it('rotating the token while disabled just replaces it, without starting a server', async () => {
    await invoke('agent:settings-set-enabled', true)
    await invoke('agent:settings-set-enabled', false)
    const rotated = await invoke<McpSettingsView>('agent:settings-rotate-token')
    expect(rotated.running).toBe(false)
    expect(rotated.token).toMatch(/^[\w-]{32,}$/)
  })

  it('initMcp resumes a server that was left enabled in a previous session', async () => {
    await invoke('agent:settings-set-enabled', true)
    await closeMcp()
    vi.resetModules()
    mocks.handlers.clear()
    const module = await import('./ipc')
    registerMcpIpc = module.registerMcpIpc; initMcp = module.initMcp; closeMcp = module.closeMcp
    registerMcpIpc()
    await initMcp()
    expect(await invoke<McpStatus>('agent:status')).toMatchObject({ enabled: true, running: true })
  })

  it('broadcasts agent:status-changed to every open window on enable/disable', async () => {
    const send = vi.fn()
    mocks.windows = [{ isDestroyed: () => false, webContents: { send } }]
    await invoke('agent:settings-set-enabled', true)
    // status updates are fired without being awaited by the handler; give the microtask queue a turn
    await Promise.resolve(); await Promise.resolve()
    expect(send).toHaveBeenCalledWith('agent:status-changed', expect.objectContaining({ enabled: true, running: true }))
  })
})
