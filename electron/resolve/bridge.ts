import { BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { z } from 'zod'
import { resolveResponseFileSchema, resolveStatusFileSchema, type ResolveStatus } from '../../src/core/resolveIpc'
import { mailboxDir } from './install'

const APP_HEARTBEAT_INTERVAL_MS = 2000
const STATUS_POLL_INTERVAL_MS = 1000
const REQUEST_POLL_INTERVAL_MS = 100
/** Matches the mailbox protocol: Lua refreshes `status.json` about every 1 s, so anything older than
 * a few missed beats is treated as disconnected rather than waiting for the 60 s Lua-side timeout. */
const CONNECTED_STALE_SECONDS = 5

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`
  await writeFile(temporaryPath, JSON.stringify(value), 'utf8')
  await rename(temporaryPath, filePath)
}

async function readJsonIfPresent(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'))
  } catch {
    // Missing file, or a torn read of a write in progress on the Lua side; the next poll retries.
    return undefined
  }
}

function nowEpochSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

function focusMainWindow(): void {
  const window = BrowserWindow.getAllWindows()[0]
  if (!window || window.isDestroyed()) return
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

function broadcastStatus(status: ResolveStatus): void {
  for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send('resolve:status-changed', status)
}

/**
 * The main-process side of the file-mailbox connection to the Lua bridge running inside DaVinci
 * Resolve (docs/plans/resolve-textplus/README.md). One instance for the app's lifetime.
 */
export class ResolveBridge {
  private readonly dir = mailboxDir()
  private appTimer: NodeJS.Timeout | undefined
  private statusTimer: NodeJS.Timeout | undefined
  private status: ResolveStatus = { state: 'disconnected' }
  private lastSessionId: string | undefined
  private seq = 0
  /** Serializes `request()` calls: KathaCut sends the next request only after the previous one's
   * response arrives or times out, since the mailbox has a single request/response slot. */
  private queue: Promise<unknown> = Promise.resolve()

  private mailboxPath(name: string): string {
    return path.join(this.dir, name)
  }

  getStatus(): ResolveStatus {
    return this.status
  }

  async start(): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    await this.writeApp(false)
    this.appTimer = setInterval(() => void this.writeApp(false), APP_HEARTBEAT_INTERVAL_MS)
    this.statusTimer = setInterval(() => void this.pollStatus(), STATUS_POLL_INTERVAL_MS)
    void this.pollStatus()
  }

  async stop(): Promise<void> {
    if (this.appTimer) clearInterval(this.appTimer)
    if (this.statusTimer) clearInterval(this.statusTimer)
    this.appTimer = undefined
    this.statusTimer = undefined
    await this.writeApp(true)
  }

  private async writeApp(quitting: boolean): Promise<void> {
    await writeJsonAtomic(this.mailboxPath('app.json'), { v: 1, pid: process.pid, heartbeatAt: nowEpochSeconds(), ...(quitting ? { quitting: true } : {}) })
  }

  private async pollStatus(): Promise<void> {
    const raw = await readJsonIfPresent(this.mailboxPath('status.json'))
    if (raw === undefined) {
      this.setStatus({ state: 'disconnected' })
      return
    }
    const parsed = resolveStatusFileSchema.safeParse(raw)
    if (!parsed.success) return
    const file = parsed.data
    const stale = nowEpochSeconds() - file.heartbeatAt > CONNECTED_STALE_SECONDS
    if (file.closed || stale) {
      this.setStatus({ state: 'disconnected' })
      return
    }
    if (file.sessionId !== this.lastSessionId) {
      this.lastSessionId = file.sessionId
      focusMainWindow()
    }
    this.setStatus({
      state: 'connected', sessionId: file.sessionId, product: file.product, version: file.version,
      projectName: file.projectName, timelineName: file.timelineName, busy: file.busy,
    })
  }

  private setStatus(next: ResolveStatus): void {
    if (JSON.stringify(next) === JSON.stringify(this.status)) return
    this.status = next
    broadcastStatus(next)
  }

  /** Sends one command and waits for its response, queued after any request already in flight.
   * Rejects if Resolve is not currently connected, or if no matching response shows up in time. */
  async request<T>(command: string, params: unknown, schema: z.ZodType<T>, timeoutMs = 10_000): Promise<T> {
    const run = (): Promise<T> => this.runRequest(command, params, schema, timeoutMs)
    const result = this.queue.then(run, run)
    this.queue = result.then(() => undefined, () => undefined)
    return result
  }

  private async runRequest<T>(command: string, params: unknown, schema: z.ZodType<T>, timeoutMs: number): Promise<T> {
    if (this.status.state !== 'connected') throw new Error('DaVinci Resolve is not connected. In Resolve: Workspace → Scripts → KathaCut.')
    const { sessionId } = this.status
    const seq = ++this.seq
    await writeJsonAtomic(this.mailboxPath('request.json'), { v: 1, sessionId, seq, command, params })
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, REQUEST_POLL_INTERVAL_MS))
      const raw = await readJsonIfPresent(this.mailboxPath('response.json'))
      if (raw === undefined) continue
      const parsed = resolveResponseFileSchema.safeParse(raw)
      if (!parsed.success) continue
      const response = parsed.data
      if (response.sessionId !== sessionId || response.seq !== seq) continue
      await rm(this.mailboxPath('response.json'), { force: true })
      if (!response.ok) throw new Error(response.error)
      return schema.parse(response.result)
    }
    throw new Error('DaVinci Resolve did not answer. Is the KathaCut script still running in Resolve?')
  }
}

let instance: ResolveBridge | undefined
export function getResolveBridge(): ResolveBridge {
  instance ??= new ResolveBridge()
  return instance
}
