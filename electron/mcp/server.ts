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
 * The loopback MCP endpoint (docs/MCP.md): every initialized client gets its own `McpServer` and
 * `StreamableHTTPServerTransport`, routed by `Mcp-Session-Id`. A crashed client can therefore leave
 * only its own abandoned session behind; it cannot wedge the endpoint or prevent a tunnel/agent
 * from reconnecting. Every request needs the Bearer token before it ever reaches a transport — an
 * unauthenticated request gets a 401 and never touches MCP protocol handling.
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

  type Session = { server: McpServer; transport: StreamableHTTPServerTransport }
  const sessions = new Map<string, Session>()
  const notify = () => options.onStatus?.({ connections: sessions.size })

  const createSession = async (): Promise<Session> => {
    const server = new McpServer({ name: 'caption-studio', version: '1.0.0' }, { instructions: EDITING_GUIDE })
    registerTools(server, deps)
    let session: Session
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      allowedHosts: [`${LOOPBACK_HOST}:${port}`, `localhost:${port}`],
      enableDnsRebindingProtection: true,
      onsessioninitialized: (sessionId) => {
        sessions.set(sessionId, session)
        notify()
      },
    })
    session = { server, transport }
    transport.onclose = () => {
      const sessionId = transport.sessionId
      if (sessionId && sessions.get(sessionId) === session) {
        sessions.delete(sessionId)
        notify()
      }
    }
    await server.connect(transport)
    return session
  }

  const errorResponse = (res: ServerResponse, status: number, code: number, message: string) => {
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null }))
  }

  handleRequest = (req, res) => {
    if (!tokenMatches(req.headers.authorization, options.token)) {
      res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'Missing or invalid Bearer token.' }))
      return
    }
    const sessionId = req.headers['mcp-session-id']
    if (Array.isArray(sessionId)) {
      errorResponse(res, 400, -32000, 'Bad Request: Multiple Mcp-Session-Id headers provided')
      return
    }
    const existing = sessionId ? sessions.get(sessionId) : undefined
    if (sessionId && !existing) {
      errorResponse(res, 404, -32001, 'Session not found')
      return
    }
    if (!existing && req.method !== 'POST') {
      errorResponse(res, 400, -32000, 'Bad Request: Mcp-Session-Id header is required')
      return
    }
    void (async () => {
      const session = existing ?? await createSession()
      try {
        await session.transport.handleRequest(req, res)
      } finally {
        // A headerless request that was not a valid initialize request never enters the session
        // map. Close its temporary protocol/transport pair instead of leaking it.
        if (!existing && !session.transport.sessionId) await session.server.close()
      }
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500).end()
    })
  }

  return {
    port,
    async close() {
      await Promise.allSettled([...sessions.values()].map(({ server }) => server.close()))
      sessions.clear()
      notify()
      await new Promise<void>((resolve) => httpServer.close(() => resolve()))
    },
  }
}
