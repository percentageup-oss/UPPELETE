import { ipcMain, type WebContents } from 'electron'
import type { AgentRequest, AgentResponse } from '../../src/core/agentProtocol'

const DEFAULT_TIMEOUT_MS = 15_000

type Pending = { resolve: (response: AgentResponse) => void; timer: ReturnType<typeof setTimeout> }

/**
 * The one request/response channel between the MCP server (`electron/mcp/tools.ts`, running in
 * main) and the renderer's project state (`src/agent/useAgentBridge.ts`). Project state lives only
 * in `App.tsx`'s history — main never keeps a copy (docs/ARCHITECTURE.md) — so every tool call
 * round-trips through here: `send('agent:request', ...)` to the renderer, matched back by request
 * id on the single shared `agent:respond` handler.
 *
 * One instance lives for the app's lifetime, independent of whether the MCP HTTP listener is
 * currently running, because `ipcMain.handle` can only be registered once per channel — starting
 * and stopping the loopback server on a Settings toggle must not re-register it.
 */
export class RendererBridge {
  private pending = new Map<string, Pending>()

  constructor(private readonly getWebContents: () => WebContents | null) {
    ipcMain.handle('agent:respond', (_event, value: unknown) => {
      const response = value as AgentResponse
      const id = response && typeof response === 'object' ? (response as { id?: unknown }).id : undefined
      if (typeof id !== 'string') return
      const pending = this.pending.get(id)
      if (!pending) return
      clearTimeout(pending.timer)
      this.pending.delete(id)
      pending.resolve(response)
    })
  }

  /** Sends one request and resolves with its matching response, or rejects if no project window is
   * open or the renderer never answers (a hung project, a closed window mid-flight). */
  ask(request: AgentRequest, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<AgentResponse> {
    const webContents = this.getWebContents()
    if (!webContents || webContents.isDestroyed()) return Promise.reject(new Error('Caption Studio has no open project window.'))
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(request.id)
        reject(new Error('Caption Studio did not respond in time.'))
      }, timeoutMs)
      this.pending.set(request.id, { resolve, timer })
      webContents.send('agent:request', request)
    })
  }

  /** Rejects every in-flight request (the window closed or the app is quitting) instead of leaving
   * an MCP tool call hanging forever. */
  cancelAll(reason: string): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer)
      this.pending.delete(id)
      pending.resolve({ id, ok: false, message: reason })
    }
  }

  dispose(): void {
    this.cancelAll('Caption Studio is shutting down.')
    ipcMain.removeHandler('agent:respond')
  }
}
