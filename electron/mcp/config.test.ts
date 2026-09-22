import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { McpConfigStore, MCP_CONFIG_FILE } from './config'

let root: string
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), 'caption-mcp-config-')) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

describe('McpConfigStore', () => {
  it('loads a disabled, tokenless default when no file exists yet', async () => {
    const store = new McpConfigStore(root)
    expect(await store.load()).toEqual({ version: 1, enabled: false, port: null, token: null })
  })

  it('mints a token on first enable and keeps it on later enables', async () => {
    const store = new McpConfigStore(root)
    const first = await store.setEnabled(true)
    expect(first.enabled).toBe(true)
    expect(first.token).toMatch(/^[\w-]{32,}$/)
    const disabled = await store.setEnabled(false)
    expect(disabled.enabled).toBe(false)
    expect(disabled.token).toBe(first.token)
    const reenabled = await store.setEnabled(true)
    expect(reenabled.token).toBe(first.token)
  })

  it('records the bound port separately from enabling', async () => {
    const store = new McpConfigStore(root)
    await store.setEnabled(true)
    const withPort = await store.setPort(54321)
    expect(withPort.port).toBe(54321)
    expect(withPort.enabled).toBe(true)
  })

  it('rotateToken replaces the token and nothing else', async () => {
    const store = new McpConfigStore(root)
    const before = await store.setEnabled(true)
    await store.setPort(9000)
    const rotated = await store.rotateToken()
    expect(rotated.token).not.toBe(before.token)
    expect(rotated.token).toMatch(/^[\w-]{32,}$/)
    expect(rotated.port).toBe(9000)
    expect(rotated.enabled).toBe(true)
  })

  it('persists across store instances and writes the file at mode 0600', async () => {
    const first = new McpConfigStore(root)
    const written = await first.setEnabled(true)
    const second = new McpConfigStore(root)
    expect(await second.load()).toEqual(written)
    const info = await stat(path.join(root, MCP_CONFIG_FILE))
    expect(info.mode & 0o777).toBe(0o600)
  })

  it('never leaves a stray .tmp file behind after a write', async () => {
    const store = new McpConfigStore(root)
    await store.setEnabled(true)
    await store.setPort(1234)
    await store.rotateToken()
    const { readdir } = await import('node:fs/promises')
    expect(await readdir(root)).toEqual([MCP_CONFIG_FILE])
  })

  it('rejects a corrupt config file instead of silently resetting it', async () => {
    const { mkdir, writeFile } = await import('node:fs/promises')
    await mkdir(root, { recursive: true })
    await writeFile(path.join(root, MCP_CONFIG_FILE), '{not json')
    const store = new McpConfigStore(root)
    await expect(store.load()).rejects.toThrow()
  })

  it('round-trips through the real file contents (plain JSON, not re-encoded)', async () => {
    const store = new McpConfigStore(root)
    await store.setEnabled(true)
    const raw = JSON.parse(await readFile(path.join(root, MCP_CONFIG_FILE), 'utf8'))
    expect(raw).toMatchObject({ version: 1, enabled: true })
    expect(typeof raw.token).toBe('string')
  })
})
