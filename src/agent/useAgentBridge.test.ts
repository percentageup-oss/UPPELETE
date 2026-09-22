import { describe, expect, it, vi } from 'vitest'
import { dispatch, type AgentBridgeHandlers } from './useAgentBridge'
import type { CaptionProject, Cue } from '../core/model'
import type { ProjectSummary } from '../core/agentProtocol'

const US = 1_000_000
const cue = (id: string, startUs: number, endUs: number): Cue =>
  ({ id, mediaAssetId: 'x', startUs, endUs, text: `cue ${id}`, timingSource: 'imported', needsReview: false, textSource: 'imported', words: [] })
const state = (overrides: Partial<ProjectSummary> = {}): ProjectSummary => ({
  title: 'Test', path: null, schemaVersion: 5, format: undefined, durationUs: 10 * US, playheadUs: 0,
  underPlayhead: null, selection: null, assets: [], tracks: [], clips: [], blurRegions: [], captionStyle: undefined,
  cueCount: 0, warnings: [], ...overrides,
})

function fakeHandlers(overrides: Partial<AgentBridgeHandlers> = {}): AgentBridgeHandlers {
  return {
    getState: vi.fn(() => state()),
    getCaptions: vi.fn(() => ({ cues: [] as Cue[], total: 0 })),
    runCommands: vi.fn(() => ({ outcomes: [], failedIndex: null, state: state() })),
    seek: vi.fn(() => state()),
    select: vi.fn(() => state()),
    undo: vi.fn(() => state()),
    redo: vi.fn(() => state()),
    ...overrides,
  }
}

describe('dispatch', () => {
  it('get-state calls getState and wraps it', async () => {
    const summary = state({ title: 'my project' })
    const handlers = fakeHandlers({ getState: vi.fn(() => summary) })
    expect(await dispatch({ id: '1', kind: 'get-state' }, handlers)).toEqual({ id: '1', ok: true, state: summary })
  })

  it('get-captions forwards range/cueIds/words, paginates and summarizes', async () => {
    const cues = [cue('a', 0, US), cue('b', US, 2 * US), cue('c', 2 * US, 3 * US)]
    const handlers = fakeHandlers({ getCaptions: vi.fn(() => ({ cues, total: cues.length })) })
    const response = await dispatch({ id: '1', kind: 'get-captions', range: { startUs: 0, endUs: US }, words: false, limit: 2, offset: 1 }, handlers)
    expect(handlers.getCaptions).toHaveBeenCalledWith({ id: '1', kind: 'get-captions', range: { startUs: 0, endUs: US }, words: false, limit: 2, offset: 1 })
    expect(response).toMatchObject({ id: '1', ok: true, total: 3 })
    if (response.ok && 'captions' in response) {
      expect(response.captions.map((c) => c.id)).toEqual(['b', 'c'])
      expect(response.captions[0].words).toBeUndefined()
    } else throw new Error('expected a captions response')
  })

  it('get-captions includes words when asked', async () => {
    const withWords = { ...cue('a', 0, US), words: [{ id: 'w1', text: 'x', startUs: 0, endUs: 100, timingSource: 'model' as const, needsReview: false }] }
    const handlers = fakeHandlers({ getCaptions: vi.fn(() => ({ cues: [withWords], total: 1 })) })
    const response = await dispatch({ id: '1', kind: 'get-captions', words: true }, handlers)
    if (response.ok && 'captions' in response) expect(response.captions[0].words).toHaveLength(1)
    else throw new Error('expected a captions response')
  })

  it('run-commands forwards the command array and returns outcomes/failedIndex/state', async () => {
    const commands = [{ type: 'merge-next' as const, cueId: 'c1' }]
    const result = { outcomes: [{ ok: true as const, warnings: [] }], failedIndex: null, state: state() }
    const handlers = fakeHandlers({ runCommands: vi.fn(() => result) })
    const response = await dispatch({ id: '1', kind: 'run-commands', commands }, handlers)
    expect(handlers.runCommands).toHaveBeenCalledWith(commands)
    expect(response).toEqual({ id: '1', ok: true, ...result })
  })

  it('seek passes sequenceUs through and returns the resulting state', async () => {
    const handlers = fakeHandlers({ seek: vi.fn(() => state({ playheadUs: 5 * US })) })
    const response = await dispatch({ id: '1', kind: 'seek', sequenceUs: 5 * US }, handlers)
    expect(handlers.seek).toHaveBeenCalledWith(5 * US)
    expect(response).toEqual({ id: '1', ok: true, state: state({ playheadUs: 5 * US }) })
  })

  it('select passes the selection through, including null (clearing selection)', async () => {
    const handlers = fakeHandlers()
    await dispatch({ id: '1', kind: 'select', selection: { kind: 'cue', id: 'c1' } }, handlers)
    expect(handlers.select).toHaveBeenCalledWith({ kind: 'cue', id: 'c1' })
    await dispatch({ id: '2', kind: 'select', selection: null }, handlers)
    expect(handlers.select).toHaveBeenCalledWith(null)
  })

  it('undo and redo call their handlers with no arguments', async () => {
    const handlers = fakeHandlers()
    await dispatch({ id: '1', kind: 'undo' }, handlers)
    await dispatch({ id: '2', kind: 'redo' }, handlers)
    expect(handlers.undo).toHaveBeenCalledWith()
    expect(handlers.redo).toHaveBeenCalledWith()
  })

  it('prepare-snapshot reports it is not implemented yet rather than silently no-op-ing', async () => {
    const response = await dispatch({ id: '1', kind: 'prepare-snapshot', sequenceUs: 0 }, fakeHandlers())
    expect(response).toEqual({ id: '1', ok: false, message: 'render_frame is not available yet.' })
  })
})

/** `CaptionProject` import above stays honest evidence the fixtures follow the real cue shape,
 * even though `dispatch` itself never touches `CaptionProject` directly. */
const _fixtureUsesRealCueShape: Pick<CaptionProject, 'cues'> = { cues: [cue('a', 0, US)] }
void _fixtureUsesRealCueShape
