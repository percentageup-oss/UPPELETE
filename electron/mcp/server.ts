import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import type { McpStatus } from './config'
import { EDITING_GUIDE, registerTools, type McpToolDeps } from './tools'

const LOOPBACK_HOST = '127.0.0.1'

function tokenMatches(header: string | undefined, token: string): boolean {
  if (!header?.startsWith('Bearer ')) return false
  const presented = Buffer.from(header.slice('Bearer '.length))
  const expected = Buffer.from(token)
  // Equal-length compare guards the common case; a length mismatch is not a token a real client
  // would ever send, so leaking that much through timing is not a meaningful loss here.
  return presented.length === expected.length && timingSafeEqual(presented, expected)
}

export type McpServerHandle = {
  port: number
  close(): Promise<void>
}

/**
 * The loopback MCP endpoint (docs/MCP.md): one `McpServer` and one `StreamableHTTPServerTransport`
 * per start, torn down completely on stop rather than reused, so a Settings toggle can never leave
 * half-initialized state behind. Every request needs the Bearer token before it ever reaches the
 * transport — an unauthenticated request gets a 401 and never touches MCP protocol handling.
 */
export async function startMcpServer(options: { token: string; port?: number; onStatus?: (status: Pick<McpStatus, 'connections'>) => void }, deps: McpToolDeps): Promise<McpServerHandle> {
  // The DNS-rebinding check matches the `Host` header byte-for-byte, port included, so
  // `allowedHosts` can only be set once the actual bound port is known — the http server binds
  // first (to a placeholder handler), then the transport and its host allow-list are built for
  // that exact port, and only then does the real handler start accepting requests.
  let handleRequest: ((req: IncomingMessage, res: ServerResponse) => void) | null = null
  const httpServer: Server = createServer((req, res) => {
    if (!handleRequest) { res.writeHead(503).end(); return }
    handleRequest(req, res)
  })
  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject)
    httpServer.listen(options.port ?? 0, LOOPBACK_HOST, () => resolve())
  })
  const address = httpServer.address()
  const port = typeof address === 'object' && address ? address.port : 0

  const mcpServer = new McpServer({ name: 'caption-studio', version: '1.0.0' }, { instructions: EDITING_GUIDE })
  registerTools(mcpServer, deps)

  let connections = 0
  const notify = () => options.onStatus?.({ connections })
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    allowedHosts: [`${LOOPBACK_HOST}:${port}`, `localhost:${port}`],
    enableDnsRebindingProtection: true,
    onsessioninitialized: () => { connections += 1; notify() },
    onsessionclosed: () => { connections = Math.max(0, connections - 1); notify() },
  })
  await mcpServer.connect(transport)

  handleRequest = (req, res) => {
    if (!tokenMatches(req.headers.authorization, options.token)) {
      res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'Missing or invalid Bearer token.' }))
      return
    }
    void transport.handleRequest(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500).end()
    })
  }

  return {
    port,
    async close() {
      await mcpServer.close()
      await new Promise<void>((resolve) => httpServer.close(() => resolve()))
    },
  }
}
