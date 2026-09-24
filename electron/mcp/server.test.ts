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
  it('binds to a loopback port and lists the full tool set', async () => {
    const client = await connect('secret-token', async (request) => okState(request))
    expect(handle!.port).toBeGreaterThan(0)
    const { tools } = await client.listTools()
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'add_title', 'apply_template', 'edit', 'get_captions', 'get_project', 'get_transcript', 'import_media',
      'list_creative_options', 'list_style_options', 'match_color_to_reference', 'place_at_word', 'redo', 'render_frame', 'seek', 'select', 'set_caption_style', 'undo',
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

  it('get_transcript issues a get-transcript request and reports omitted cues', async () => {
    const calls: AgentRequest[] = []
    const client = await connect('t', async (request) => {
      calls.push(request)
      return { id: request.id, ok: true, captions: [], total: 0, omitted: 2 }
    })
    const result = await client.callTool({ name: 'get_transcript', arguments: { words: true, range: { startUs: 0, endUs: 5 } } })
    expect(calls).toEqual([{ id: calls[0].id, kind: 'get-transcript', words: true, range: { startUs: 0, endUs: 5 } }])
    expect(result.content).toEqual([{ type: 'text', text: expect.stringContaining('"omitted": 2') }])
  })

  it('add_title builds one text-add command from a built-in treatment', async () => {
    const calls: AgentRequest[] = []
    const client = await connect('t', async (request) => {
      calls.push(request)
      return { id: request.id, ok: true, outcomes: [{ ok: true, warnings: [] }], failedIndex: null, state: { title: 'x' } as never }
    })
    await client.callTool({ name: 'add_title', arguments: { text: 'Hello', startUs: 1_000_000, endUs: 3_000_000, templateId: 'title-word-cascade', vertical: 0.2 } })
    const request = calls[0]
    if (request.kind !== 'run-commands') throw new Error('expected run-commands')
    const command = request.commands[0]
    if (command.type !== 'text-add') throw new Error('expected text-add')
    expect(command.overlay).toMatchObject({ text: 'Hello', startUs: 1_000_000, endUs: 3_000_000, titleMotion: { kind: 'cascade' } })
    expect(command.overlay.style.appearance.vertical).toBe(0.2)
  })

  it('add_title rejects an end before its start without asking the renderer', async () => {
    let called = false
    const client = await connect('t', async (request) => { called = true; return okState(request) })
    const result = await client.callTool({ name: 'add_title', arguments: { text: 'x', startUs: 5, endUs: 3 } })
    expect(result.isError).toBe(true)
    expect(called).toBe(false)
  })

  it('serves editing guidance as server instructions and as the auto_edit prompt', async () => {
    const client = await connect('t', async (request) => okState(request))
    expect(client.getInstructions()).toContain('get_transcript')
    const prompt = await client.getPrompt({ name: 'auto_edit', arguments: { goal: 'punchier' } })
    expect(JSON.stringify(prompt.messages)).toContain('punchier')
  })

  it('list_creative_options returns looks and background presets without asking the renderer', async () => {
    let called = false
    const client = await connect('t', async (request) => { called = true; return okState(request) })
    const result = await client.callTool({ name: 'list_creative_options', arguments: {} })
    expect(called).toBe(false)
    expect(JSON.stringify(result.content)).toContain('backgroundPresets')
  })

  it('render_frame prepares each time in the renderer and returns the captured image', async () => {
    const calls: AgentRequest[] = []
    handle = await startMcpServer({ token: 't' }, {
      askRenderer: async (request) => { calls.push(request); return { id: request.id, ok: true, rect: { x: 1, y: 2, width: 30, height: 20 } } },
      captureRect: async (rect) => ({ data: Buffer.from(`img-${rect.width}`).toString('base64'), mimeType: 'image/jpeg', width: 30, height: 20 }),
    })
    const client = new Client({ name: 'c', version: '1' })
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${handle.port}/mcp`), { requestInit: { headers: { Authorization: 'Bearer t' } } }))
    const result = await client.callTool({ name: 'render_frame', arguments: { sequenceUs: [0, 2_000_000] } })
    expect(calls.map((call) => call.kind === 'prepare-snapshot' && call.sequenceUs)).toEqual([0, 2_000_000])
    expect((result.content as { type: string }[]).filter((part) => part.type === 'image')).toHaveLength(2)
  })

  it('render_frame surfaces a renderer failure instead of returning a stale image', async () => {
    const client = await connect('t', async (request) => ({ id: request.id, ok: false, message: 'The preview did not finish drawing that frame in time.' }))
    const result = await client.callTool({ name: 'render_frame', arguments: { sequenceUs: [0] } })
    expect(result.isError).toBe(true)
  })

  const matchResult = { lutName: 'Match', lutPath: null, clipId: 'adj1', startUs: 0, endUs: 5_000_000, sourceFrameUs: 0 }
  async function connectWith(deps: Parameters<typeof startMcpServer>[1]) {
    handle = await startMcpServer({ token: 't' }, deps)
    const client = new Client({ name: 'c', version: '1' })
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${handle.port}/mcp`), { requestInit: { headers: { Authorization: 'Bearer t' } } }))
    return client
  }

  it('match_color_to_reference reads the image from the path source and forwards one match-reference request', async () => {
    const calls: AgentRequest[] = []
    const client = await connectWith({
      askRenderer: async (request) => { calls.push(request); return { id: request.id, ok: true, match: matchResult, state: { title: 'x' } as never } },
      readReference: async (source) => { expect(source).toEqual({ imagePath: '/pics/look.png', fromClipboard: undefined }); return { imageBase64: 'QUJD', mimeType: 'image/png' } },
    })
    const result = await client.callTool({ name: 'match_color_to_reference', arguments: { imagePath: '/pics/look.png', strength: 0.7, startUs: 0, endUs: 5_000_000 } })
    expect(calls).toEqual([{ id: calls[0].id, kind: 'match-reference', imageBase64: 'QUJD', mimeType: 'image/png', strength: 0.7, startUs: 0, endUs: 5_000_000 }])
    expect(JSON.stringify(result.content)).toContain('adj1')
  })

  it('match_color_to_reference requires exactly one image source', async () => {
    let called = false
    const client = await connectWith({ askRenderer: async (request) => { called = true; return okState(request) }, readReference: async () => ({ imageBase64: 'QUJD', mimeType: 'image/png' }) })
    const none = await client.callTool({ name: 'match_color_to_reference', arguments: {} })
    const two = await client.callTool({ name: 'match_color_to_reference', arguments: { imagePath: '/a.png', fromClipboard: true } })
    expect(none.isError).toBe(true)
    expect(two.isError).toBe(true)
    expect(called).toBe(false)
  })

  it('match_color_to_reference reports an unreadable reference without touching the project', async () => {
    let called = false
    const client = await connectWith({
      askRenderer: async (request) => { called = true; return okState(request) },
      readReference: async () => { throw new Error('The clipboard has no image.') },
    })
    const result = await client.callTool({ name: 'match_color_to_reference', arguments: { fromClipboard: true } })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain('clipboard has no image')
    expect(called).toBe(false)
  })

  const inspectedImage = { ok: true as const, kind: 'image' as const, url: 'media://pic', media: { name: 'pic.png', reference: { relativePath: null, absolutePath: 'C:\\pic.png' }, fingerprint: null, metadata: null } }
  const importedReply = (request: AgentRequest): AgentResponse => ({ id: request.id, ok: true, state: { title: 'x' } as never, imported: { assetId: 'a1', kind: 'image', name: 'pic.png', alreadyInProject: false, clipId: 'c1', startUs: 1_000_000, endUs: 4_000_000 } })

  it('import_media hands the source to main, then forwards one import-inspected request with the placement', async () => {
    const calls: AgentRequest[] = []
    const sources: unknown[] = []
    const client = await connectWith({
      askRenderer: async (request) => { calls.push(request); return importedReply(request) },
      importSource: async (source) => { sources.push(source); return inspectedImage },
    })
    const result = await client.callTool({ name: 'import_media', arguments: { url: 'https://example.com/a.png', placement: { sequenceUs: 1_000_000, durationUs: 3_000_000 } } })
    expect(sources).toEqual([{ path: undefined, fromClipboard: undefined, imageBase64: undefined, url: 'https://example.com/a.png' }])
    expect(calls).toEqual([{ id: calls[0].id, kind: 'import-inspected', inspected: { kind: 'image', media: inspectedImage.media, url: 'media://pic' }, placement: { startUs: 1_000_000, durationUs: 3_000_000 } }])
    expect((result.content as { text: string }[])[0].text).toContain('"assetId": "a1"')
  })

  it('import_media without a placement only adds the asset', async () => {
    const calls: AgentRequest[] = []
    const client = await connectWith({ askRenderer: async (request) => { calls.push(request); return importedReply(request) }, importSource: async () => inspectedImage })
    await client.callTool({ name: 'import_media', arguments: { fromClipboard: true } })
    expect(calls[0]).not.toHaveProperty('placement')
  })

  it('import_media requires exactly one source and reports an unreadable one without touching the project', async () => {
    let asked = false
    const client = await connectWith({
      askRenderer: async (request) => { asked = true; return okState(request) },
      importSource: async () => { throw new Error('url must use https.') },
    })
    const none = await client.callTool({ name: 'import_media', arguments: {} })
    const two = await client.callTool({ name: 'import_media', arguments: { path: 'C:\\a.png', fromClipboard: true } })
    const failed = await client.callTool({ name: 'import_media', arguments: { url: 'http://insecure.example.com/a.png' } })
    expect([none.isError, two.isError, failed.isError]).toEqual([true, true, true])
    expect(JSON.stringify(failed.content)).toContain('https')
    expect(asked).toBe(false)
  })

  const words = (texts: string[], startUs: number, source: 'aligned' | 'estimated' = 'aligned') =>
    texts.map((text, index) => ({ id: `w${startUs}-${index}`, text, startUs: startUs + index * 500_000, endUs: startUs + (index + 1) * 500_000, timingSource: source }))
  const transcript = (request: AgentRequest, source: 'aligned' | 'estimated' = 'aligned'): AgentResponse => ({
    id: request.id, ok: true, total: 1,
    captions: [{ id: 'c1', mediaAssetId: 'v', startUs: 2_000_000, endUs: 4_000_000, text: 'Apple made it', timingSource: 'aligned', needsReview: false, words: words(['Apple', 'made', 'it'], 2_000_000, source) }],
  })

  it('place_at_word resolves the spoken word in sequence time and places the image there', async () => {
    const calls: AgentRequest[] = []
    const client = await connectWith({
      askRenderer: async (request) => {
        calls.push(request)
        if (request.kind === 'get-transcript') return transcript(request)
        return { id: request.id, ok: true, state: { title: 'x' } as never, placed: { clipId: 'c9', assetId: 'a1', trackId: 't1', startUs: 1_900_000, endUs: 3_400_000 } }
      },
    })
    const result = await client.callTool({ name: 'place_at_word', arguments: { assetId: 'a1', text: 'apple', offsetUs: -100_000 } })
    expect(calls[0]).toMatchObject({ kind: 'get-transcript', words: true })
    expect(calls[1]).toMatchObject({ kind: 'place-image', assetId: 'a1', placement: { startUs: 1_900_000, durationUs: 1_500_000 } })
    expect((result.content as { text: string }[])[0].text).toContain('"timing": "aligned"')
  })

  it('place_at_word says so when the word timing is only estimated', async () => {
    const client = await connectWith({
      askRenderer: async (request) => request.kind === 'get-transcript' ? transcript(request, 'estimated')
        : { id: request.id, ok: true, state: { title: 'x' } as never, placed: { clipId: 'c9', assetId: 'a1', trackId: 't1', startUs: 2_000_000, endUs: 3_500_000 } },
    })
    const result = await client.callTool({ name: 'place_at_word', arguments: { assetId: 'a1', text: 'made' } })
    expect(JSON.stringify(result.content)).toContain('ESTIMATED')
  })

  it('place_at_word fails clearly for a word that is not in the transcript, and never places anything', async () => {
    const kinds: string[] = []
    const client = await connectWith({ askRenderer: async (request) => { kinds.push(request.kind); return transcript(request) } })
    const result = await client.callTool({ name: 'place_at_word', arguments: { assetId: 'a1', text: 'banana' } })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain('not found')
    expect(kinds).toEqual(['get-transcript'])
  })

  it('place_at_word needs exactly one way of naming the word', async () => {
    let asked = false
    const client = await connectWith({ askRenderer: async (request) => { asked = true; return okState(request) } })
    const neither = await client.callTool({ name: 'place_at_word', arguments: { assetId: 'a1' } })
    const both = await client.callTool({ name: 'place_at_word', arguments: { assetId: 'a1', text: 'apple', cueId: 'c1', wordIndex: 0 } })
    expect([neither.isError, both.isError]).toEqual([true, true])
    expect(asked).toBe(false)
  })

  it('list_creative_options carries when-to-use guidance and style recipes so the agent can choose unprompted', async () => {
    const client = await connectWith({ askRenderer: async (request) => okState(request) })
    const result = await client.callTool({ name: 'list_creative_options', arguments: {} })
    const body = JSON.stringify(result.content)
    expect(body).toContain('useWhen')
    expect(body).toContain('styleRecipes')
    expect(body).toContain('retro-nostalgia')
    expect(client.getInstructions()).toContain('render_frame')
    expect(client.getInstructions()).toContain('place_at_word')
  })
})
