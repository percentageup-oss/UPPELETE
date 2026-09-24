import { readFile } from 'node:fs/promises'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

/**
 * The Claude Desktop connector (docs/MCP.md). Claude Desktop launches local MCP servers as stdio
 * child processes, but KathaCut's server lives inside the running app on a loopback HTTP port. This
 * tiny process is the adapter: it reads the app's own `mcp.json` (port + Bearer token) and forwards
 * every JSON-RPC message between its stdio and the app's `/mcp` endpoint, unchanged. It holds no
 * project state and adds no tools — the app remains the single source of truth and the single place
 * that enforces the token, the origin checks and the tool set.
 */

const bridgeConfigSchema = z.object({
  enabled: z.boolean(),
  port: z.number().int().min(1024).max(65535).nullable(),
  token: z.string().min(1).nullable(),
})

export class BridgeSetupError extends Error {}

/** Reads the app's `mcp.json` and returns the endpoint and token, or explains what the user must do. */
export async function readBridgeTarget(configPath: string): Promise<{ url: URL; token: string }> {
  let raw: string
  try { raw = await readFile(configPath, 'utf8') }
  catch { throw new BridgeSetupError('KathaCut has not enabled agent access yet. Open KathaCut → Settings → AI agents and turn on "Allow agent access", then restart Claude Desktop.') }
  let config: z.infer<typeof bridgeConfigSchema>
  try { config = bridgeConfigSchema.parse(JSON.parse(raw)) }
  catch { throw new BridgeSetupError('KathaCut\'s agent settings file is unreadable. Turn agent access off and on again in Settings → AI agents.') }
  if (!config.enabled || !config.port || !config.token) throw new BridgeSetupError('Agent access is off in KathaCut. Turn on "Allow agent access" in Settings → AI agents, then restart Claude Desktop.')
  return { url: new URL(`http://127.0.0.1:${config.port}/mcp`), token: config.token }
}

const isRequest = (message: JSONRPCMessage): message is JSONRPCMessage & { id: string | number; method: string } => 'method' in message && 'id' in message

/** Pipes two transports into each other. A failed forward to the app answers the pending request with
 * a JSON-RPC error instead of leaving the client waiting, e.g. when KathaCut was closed mid-session. */
export function pipeTransports(local: Transport, remote: Transport): void {
  local.onmessage = (message) => {
    void remote.send(message).catch((error) => {
      if (isRequest(message)) void local.send({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: `KathaCut is not reachable: ${error instanceof Error ? error.message : String(error)}. Is the app open with agent access on?` } }).catch(() => {})
    })
  }
  remote.onmessage = (message) => { void local.send(message).catch(() => {}) }
  // Closing either side closes the other exactly once; without the guard each close re-triggers the other.
  let closing = false
  const closeBoth = () => {
    if (closing) return
    closing = true
    void Promise.allSettled([local.close(), remote.close()])
  }
  local.onclose = closeBoth
  remote.onclose = closeBoth
}

export async function runStdioBridge(configPath: string): Promise<void> {
  const { url, token } = await readBridgeTarget(configPath)
  const remote = new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${token}` } } })
  const local = new StdioServerTransport()
  pipeTransports(local, remote)
  await remote.start()
  await local.start()
}
