import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  removeHandler: vi.fn((channel: string) => mocks.handlers.delete(channel)),
}))
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => mocks.handlers.set(channel, handler),
    removeHandler: mocks.removeHandler,
  },
}))

let RendererBridge: typeof import('./rendererBridge').RendererBridge

beforeEach(async () => {
  vi.resetModules(); mocks.handlers.clear(); mocks.removeHandler.mockClear()
  ;({ RendererBridge } = await import('./rendererBridge'))
})
afterEach(() => vi.useRealTimers())

const fakeWebContents = (overrides: Partial<{ isDestroyed: () => boolean; send: (channel: string, payload: unknown) => void }> = {}) =>
  ({ isDestroyed: () => false, send: () => {}, ...overrides }) as unknown as import('electron').WebContents

describe('RendererBridge', () => {
  it('rejects immediately when there is no open project window', async () => {
    const bridge = new RendererBridge(() => null)
    await expect(bridge.ask({ id: '1', kind: 'get-state' })).rejects.toThrow('no open project window')
  })

  it('rejects when the window is destroyed', async () => {
    const bridge = new RendererBridge(() => fakeWebContents({ isDestroyed: () => true }))
    await expect(bridge.ask({ id: '1', kind: 'get-state' })).rejects.toThrow('no open project window')
  })

  it('sends the request and resolves with the matching response by id', async () => {
    const sent: unknown[] = []
    const bridge = new RendererBridge(() => fakeWebContents({ send: (_channel, payload) => sent.push(payload) }))
    const promise = bridge.ask({ id: 'abc', kind: 'get-state' })
    expect(sent).toEqual([{ id: 'abc', kind: 'get-state' }])
    mocks.handlers.get('agent:respond')!({}, { id: 'abc', ok: true, state: { title: 'x' } })
    await expect(promise).resolves.toEqual({ id: 'abc', ok: true, state: { title: 'x' } })
  })

  it('ignores a response with an id that does not match any pending request', async () => {
    const bridge = new RendererBridge(() => fakeWebContents())
    const promise = bridge.ask({ id: 'abc', kind: 'get-state' })
    mocks.handlers.get('agent:respond')!({}, { id: 'someone-else', ok: true, state: {} })
    mocks.handlers.get('agent:respond')!({}, { id: 'abc', ok: true, state: { title: 'y' } })
    await expect(promise).resolves.toMatchObject({ id: 'abc' })
  })

  it('rejects with a timeout when the renderer never answers', async () => {
    vi.useFakeTimers()
    const bridge = new RendererBridge(() => fakeWebContents())
    const promise = bridge.ask({ id: 'abc', kind: 'get-state' }, 1000)
    const assertion = expect(promise).rejects.toThrow('did not respond in time')
    await vi.advanceTimersByTimeAsync(1000)
    await assertion
  })

  it('cancelAll resolves every pending request with a failure instead of leaving it hanging', async () => {
    const bridge = new RendererBridge(() => fakeWebContents())
    const a = bridge.ask({ id: 'a', kind: 'get-state' })
    const b = bridge.ask({ id: 'b', kind: 'undo' })
    bridge.cancelAll('shutting down')
    await expect(a).resolves.toEqual({ id: 'a', ok: false, message: 'shutting down' })
    await expect(b).resolves.toEqual({ id: 'b', ok: false, message: 'shutting down' })
  })

  it('dispose cancels pending requests and removes the ipcMain handler', async () => {
    const bridge = new RendererBridge(() => fakeWebContents())
    const pending = bridge.ask({ id: 'a', kind: 'get-state' })
    bridge.dispose()
    await expect(pending).resolves.toMatchObject({ ok: false })
    expect(mocks.removeHandler).toHaveBeenCalledWith('agent:respond')
  })

  it('registers an agent:respond handler on construction', () => {
    new RendererBridge(() => null)
    expect(mocks.handlers.has('agent:respond')).toBe(true)
  })
})
