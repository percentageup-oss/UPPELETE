import { afterEach, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { startMcpServer, type McpServerHandle } from './server'
import type { AgentRequest, AgentResponse } from '../../src/core/agentProtocol'

/**
 * A real HTTP client (the MCP SDK's own) against a real `startMcpServer` instance on a loopback
 * port — no Electron involved (`server.ts` imports none), so this exercises the actual transport,
 * auth check and tool registration end to end rather than mocking any of it.
 */

let handle: McpServerHandle | undefined
afterEach(async () => {
  await handle?.close()
  handle = undefined
})

async function connect(token: string, askRenderer: (request: AgentRequest) => Promise<AgentResponse>) {
  handle = await startMcpServer({ token }, { askRenderer })
  const client = new Client({ name: 'test-client', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${handle.port}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  })
  await client.connect(transport)
  return client
}

const okState = (request: AgentRequest): AgentResponse => ({ id: request.id, ok: true, state: { title: 'placeholder' } as never })

describe('MCP server', () => {
  it('binds to a loopback port and lists the full slice-2 tool set', async () => {
    const client = await connect('secret-token', async (request) => okState(request))
    expect(handle!.port).toBeGreaterThan(0)
    const { tools } = await client.listTools()
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'apply_template', 'edit', 'get_captions', 'get_project', 'list_style_options',
      'redo', 'seek', 'select', 'set_caption_style', 'undo',
    ])
  })

  it('rejects a request with a missing or wrong Bearer token before it reaches MCP handling', async () => {
    handle = await startMcpServer({ token: 'right-token' }, { askRenderer: async (request) => okState(request) })
    const wrongToken = await fetch(`http://127.0.0.1:${handle.port}/mcp`, {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: 'Bearer wrong-token' }, body: '{}',
    })
    expect(wrongToken.status).toBe(401)
    const noToken = await fetch(`http://127.0.0.1:${handle.port}/mcp`, {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: '{}',
    })
    expect(noToken.status).toBe(401)
  })

  it('get_project issues a get-state request and returns the project summary as tool content', async () => {
    const calls: AgentRequest[] = []
    const client = await connect('t', async (request) => {
      calls.push(request)
      return { id: request.id, ok: true, state: { title: 'My project' } as never }
    })
    const result = await client.callTool({ name: 'get_project', arguments: {} })
    expect(calls).toEqual([{ id: calls[0].id, kind: 'get-state' }])
    expect(result.content).toEqual([{ type: 'text', text: expect.stringContaining('My project') }])
  })

  it('edit forwards its commands as one run-commands request', async () => {
    const calls: AgentRequest[] = []
    const client = await connect('t', async (request) => {
      calls.push(request)
      return { id: request.id, ok: true, outcomes: [{ ok: true, warnings: [] }], failedIndex: null, state: { title: 'x' } as never }
    })
    await client.callTool({ name: 'edit', arguments: { commands: [{ type: 'merge-next', cueId: 'c1' }] } })
    expect(calls).toEqual([{ id: calls[0].id, kind: 'run-commands', commands: [{ type: 'merge-next', cueId: 'c1' }] }])
  })

  it('edit rejects a malformed command at the protocol level before it ever reaches askRenderer', async () => {
    let called = false
    const client = await connect('t', async (request) => { called = true; return okState(request) })
    // Input-schema validation failures are JSON-RPC "Invalid params" errors under the hood; the
    // client SDK surfaces them as an error tool result rather than a rejected call.
    const result = await client.callTool({ name: 'edit', arguments: { commands: [{ type: 'not-a-real-command' }] } })
    expect(result.isError).toBe(true)
    expect(called).toBe(false)
  })

  it('seek and select translate their arguments into the matching request kind', async () => {
    const calls: AgentRequest[] = []
    const client = await connect('t', async (request) => {
      calls.push(request)
      return okState(request)
    })
    await client.callTool({ name: 'seek', arguments: { sequenceUs: 5_000_000 } })
    await client.callTool({ name: 'select', arguments: { kind: 'clip', id: 'c1' } })
    await client.callTool({ name: 'select', arguments: { kind: null, id: null } })
    expect(calls[0]).toMatchObject({ kind: 'seek', sequenceUs: 5_000_000 })
    expect(calls[1]).toMatchObject({ kind: 'select', selection: { kind: 'clip', id: 'c1' } })
    expect(calls[2]).toMatchObject({ kind: 'select', selection: null })
  })

  it('undo and redo need no arguments', async () => {
    const client = await connect('t', async (request) => okState(request))
    expect((await client.callTool({ name: 'undo', arguments: {} })).isError).toBeFalsy()
    expect((await client.callTool({ name: 'redo', arguments: {} })).isError).toBeFalsy()
  })

  it('surfaces a renderer-reported failure as a tool error rather than throwing', async () => {
    const client = await connect('t', async (request) => ({ id: request.id, ok: false, message: 'That caption no longer exists.' }))
    const result = await client.callTool({ name: 'undo', arguments: {} })
    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: 'That caption no longer exists.' }])
  })

  it('list_style_options needs no renderer round trip and lists built-in templates', async () => {
    let called = false
    const client = await connect('t', async (request) => { called = true; return okState(request) })
    const result = await client.callTool({ name: 'list_style_options', arguments: {} })
    const content = result.content as { type: string; text: string }[]
    expect(called).toBe(false)
    expect(content[0]).toMatchObject({ type: 'text' })
    const parsed = JSON.parse(content[0].text)
    expect(parsed.templates.length).toBeGreaterThan(0)
    expect(parsed.appearanceFieldRanges.fontSize).toEqual({ kind: 'number', min: 20, max: 120 })
  })

  it('set_caption_style reads the current style first, then applies the merged style as one run-commands call', async () => {
    const calls: AgentRequest[] = []
    const client = await connect('t', async (request) => {
      calls.push(request)
      if (request.kind === 'get-state') {
        return { id: request.id, ok: true, state: { captionStyle: { motion: 'static-clean', motionSpeed: 1, appearance: { fontSize: 40 } } } as never }
      }
      return okState(request)
    })
    await client.callTool({ name: 'set_caption_style', arguments: { appearance: { fontSize: 80 } } })
    expect(calls[0]).toMatchObject({ kind: 'get-state' })
    expect(calls[1]).toMatchObject({ kind: 'run-commands' })
    if (calls[1].kind !== 'run-commands') throw new Error('expected run-commands')
    const command = calls[1].commands[0]
    if (command.type !== 'apply-template') throw new Error('expected apply-template')
    expect(command.style.motion).toBe('static-clean')
    expect(command.style.appearance.fontSize).toBe(80)
  })

  it('apply_template looks up a built-in template id and applies its style', async () => {
    const calls: AgentRequest[] = []
    const client = await connect('t', async (request) => {
      calls.push(request)
      return okState(request)
    })
    await client.callTool({ name: 'apply_template', arguments: { templateId: 'neon-punch' } })
    expect(calls[0].kind).toBe('run-commands')
    if (calls[0].kind !== 'run-commands') throw new Error('expected run-commands')
    const command = calls[0].commands[0]
    if (command.type !== 'apply-template') throw new Error('expected apply-template')
    expect(command.style.motion).toBe('word-pop')
  })

  it('apply_template rejects an unknown template id at the protocol level before calling askRenderer', async () => {
    let called = false
    const client = await connect('t', async (request) => { called = true; return okState(request) })
    const result = await client.callTool({ name: 'apply_template', arguments: { templateId: 'not-a-real-template' } })
    expect(result.isError).toBe(true)
    expect(called).toBe(false)
  })
})
