import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { startMcpServer, type McpServerHandle } from './server'
import { BridgeSetupError, pipeTransports, readBridgeTarget } from './stdioBridge'
import type { AgentRequest, AgentResponse } from '../../src/core/agentProtocol'

let handle: McpServerHandle | undefined
let directory: string | undefined
afterEach(async () => {
  await handle?.close(); handle = undefined
  if (directory) await rm(directory, { recursive: true, force: true }); directory = undefined
})

const config = async (value: unknown) => {
  directory = await mkdtemp(path.join(tmpdir(), 'kathacut-bridge-'))
  const file = path.join(directory, 'mcp.json')
  await writeFile(file, JSON.stringify(value))
  return file
}

describe('readBridgeTarget', () => {
  it('returns the loopback endpoint and token of an enabled config', async () => {
    const file = await config({ version: 1, enabled: true, port: 43210, token: 'secret' })
    expect(await readBridgeTarget(file)).toEqual({ url: new URL('http://127.0.0.1:43210/mcp'), token: 'secret' })
  })

  it('explains what to do when agent access is off, unset or the file is missing', async () => {
    await expect(readBridgeTarget(await config({ version: 1, enabled: false, port: null, token: null }))).rejects.toThrow(BridgeSetupError)
    await expect(readBridgeTarget(path.join(tmpdir(), 'kathacut-does-not-exist', 'mcp.json'))).rejects.toThrow(/Allow agent access/)
    await expect(readBridgeTarget(await config({ nonsense: true }))).rejects.toThrow(/unreadable/)
  })
})

describe('pipeTransports', () => {
  it('lets a stdio-side client use the real app server through the HTTP transport', async () => {
    const calls: AgentRequest[] = []
    handle = await startMcpServer({ token: 'tok' }, { askRenderer: async (request): Promise<AgentResponse> => { calls.push(request); return { id: request.id, ok: true, state: { title: 'Bridged project' } as never } } })
    const [clientSide, bridgeSide] = InMemoryTransport.createLinkedPair()
    const remote = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${handle.port}/mcp`), { requestInit: { headers: { Authorization: 'Bearer tok' } } })
    pipeTransports(bridgeSide, remote)
    await remote.start()
    await bridgeSide.start()

    const client = new Client({ name: 'desktop', version: '1' })
    await client.connect(clientSide)
    expect((await client.listTools()).tools.map((tool) => tool.name)).toContain('get_project')
    const result = await client.callTool({ name: 'get_project', arguments: {} })
    expect(JSON.stringify(result.content)).toContain('Bridged project')
    expect(calls).toHaveLength(1)
    await client.close()
  })

  it('answers a request with an error when the app is not reachable', async () => {
    const [clientSide, bridgeSide] = InMemoryTransport.createLinkedPair()
    const remote = new StreamableHTTPClientTransport(new URL('http://127.0.0.1:9/mcp'), { requestInit: { headers: { Authorization: 'Bearer x' } } })
    pipeTransports(bridgeSide, remote)
    await remote.start()
    await bridgeSide.start()
    const client = new Client({ name: 'desktop', version: '1' })
    await expect(client.connect(clientSide)).rejects.toThrow(/not reachable/)
  })
})
