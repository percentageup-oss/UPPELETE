import { describe, expect, it, vi } from 'vitest'
import { dispatch, type AgentBridgeHandlers } from './useAgentBridge'
import type { CaptionProject, Cue } from '../core/model'
import { agentRequestSchema, type ProjectSummary } from '../core/agentProtocol'

const US = 1_000_000
const cue = (id: string, startUs: number, endUs: number): Cue =>
  ({ id, mediaAssetId: 'x', startUs, endUs, text: `cue ${id}`, timingSource: 'imported', needsReview: false, textSource: 'imported', words: [] })
const state = (overrides: Partial<ProjectSummary> = {}): ProjectSummary => ({
  title: 'Test', path: null, schemaVersion: 5, format: undefined, durationUs: 10 * US, playheadUs: 0,
  underPlayhead: null, selection: null, assets: [], tracks: [], clips: [], blurRegions: [], zoomRegions: [], markers: [], effects: [], textOverlays: [], captionStyle: undefined,
  cueCount: 0, warnings: [], ...overrides,
})

function fakeHandlers(overrides: Partial<AgentBridgeHandlers> = {}): AgentBridgeHandlers {
  return {
    getState: vi.fn(() => state()),
    getCaptions: vi.fn(() => ({ cues: [] as Cue[], total: 0 })),
    getTranscript: vi.fn(() => ({ cues: [] as Cue[], omitted: 0 })),
    runCommands: vi.fn(() => ({ outcomes: [], failedIndex: null, state: state() })),
    seek: vi.fn(() => state()),
    select: vi.fn(() => state()),
    undo: vi.fn(() => state()),
    redo: vi.fn(() => state()),
    matchReference: vi.fn(async () => ({ match: { lutName: 'm', lutPath: null, clipId: 'c', startUs: 0, endUs: US, sourceFrameUs: 0 }, state: state() })),
    prepareSnapshot: vi.fn(async () => ({ x: 1, y: 2, width: 300, height: 200 })),
    importInspected: vi.fn(() => ({ imported: { assetId: 'a1', kind: 'image' as const, name: 'pic.png', alreadyInProject: false, clipId: null, startUs: null, endUs: null }, state: state() })),
    placeImage: vi.fn(() => ({ placed: { clipId: 'c1', assetId: 'a1', trackId: 't1', startUs: 0, endUs: 3 * US }, state: state() })),
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

  it('get-transcript filters by sequence range, paginates and reports omitted cues', async () => {
    const cues = [cue('a', 0, US), cue('b', US, 2 * US), cue('c', 2 * US, 3 * US)]
    const handlers = fakeHandlers({ getTranscript: vi.fn(() => ({ cues, omitted: 4 })) })
    const response = await dispatch({ id: '1', kind: 'get-transcript', range: { startUs: US, endUs: 3 * US }, limit: 1 }, handlers)
    expect(response).toMatchObject({ id: '1', ok: true, total: 2, omitted: 4 })
    if (response.ok && 'captions' in response) expect(response.captions.map((c) => c.id)).toEqual(['b'])
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

  it('match-reference forwards the request and wraps the result', async () => {
    const handlers = fakeHandlers()
    const request = { id: '1', kind: 'match-reference' as const, imageBase64: 'AAAA', mimeType: 'image/png' as const, strength: 1 }
    expect(await dispatch(request, handlers)).toMatchObject({ id: '1', ok: true, match: { clipId: 'c' } })
    expect(handlers.matchReference).toHaveBeenCalledWith(request)
  })

  it('prepare-snapshot seeks via the handler and returns the frame rect', async () => {
    const handlers = fakeHandlers()
    expect(await dispatch({ id: '1', kind: 'prepare-snapshot', sequenceUs: 2 * US }, handlers)).toEqual({ id: '1', ok: true, rect: { x: 1, y: 2, width: 300, height: 200 } })
    expect(handlers.prepareSnapshot).toHaveBeenCalledWith(2 * US)
  })

  it('prepare-snapshot reports a missing preview honestly', async () => {
    const response = await dispatch({ id: '1', kind: 'prepare-snapshot', sequenceUs: 0 }, fakeHandlers({ prepareSnapshot: vi.fn(async () => null) }))
    expect(response).toMatchObject({ id: '1', ok: false, message: expect.stringContaining('no preview') })
  })
})

  it('import-inspected forwards the probed file and placement and wraps the result', async () => {
    const handlers = fakeHandlers()
    const request = {
      id: '1', kind: 'import-inspected' as const,
      inspected: { kind: 'image' as const, media: { name: 'pic.png', reference: { relativePath: null, absolutePath: 'C:\pic.png' }, fingerprint: null, metadata: null }, url: 'media://x' },
      placement: { startUs: US, durationUs: 2 * US },
    }
    expect(await dispatch(request, handlers)).toMatchObject({ id: '1', ok: true, imported: { assetId: 'a1', kind: 'image' } })
    expect(handlers.importInspected).toHaveBeenCalledWith(request)
  })

  it('place-image forwards the asset and placement and wraps the result', async () => {
    const handlers = fakeHandlers()
    const request = { id: '1', kind: 'place-image' as const, assetId: 'a1', placement: { startUs: 0 } }
    expect(await dispatch(request, handlers)).toMatchObject({ id: '1', ok: true, placed: { clipId: 'c1', trackId: 't1' } })
    expect(handlers.placeImage).toHaveBeenCalledWith(request)
  })

  it('surfaces a handler failure as a thrown error the bridge turns into a message', async () => {
    const handlers = fakeHandlers({ placeImage: vi.fn(() => { throw new Error('No asset "zzz" in the project.') }) })
    await expect(dispatch({ id: '1', kind: 'place-image', assetId: 'zzz', placement: { startUs: 0 } }, handlers)).rejects.toThrow(/No asset/)
  })

  it('the request schema accepts a valid placement and refuses nonsense', () => {
    expect(agentRequestSchema.safeParse({ id: '1', kind: 'place-image', assetId: 'a', placement: { startUs: 0, rect: { x: 0, y: 0, width: 100, height: 100 } } }).success).toBe(true)
    expect(agentRequestSchema.safeParse({ id: '1', kind: 'place-image', assetId: 'a', placement: { startUs: -1 } }).success).toBe(false)
    expect(agentRequestSchema.safeParse({ id: '1', kind: 'place-image', assetId: 'a', placement: { startUs: 0, extra: true } }).success).toBe(false)
    expect(agentRequestSchema.safeParse({ id: '1', kind: 'import-inspected', inspected: { kind: 'subtitle', media: {}, url: 'x' } }).success).toBe(false)
  })

/** `CaptionProject` import above stays honest evidence the fixtures follow the real cue shape,
 * even though `dispatch` itself never touches `CaptionProject` directly. */
const _fixtureUsesRealCueShape: Pick<CaptionProject, 'cues'> = { cues: [cue('a', 0, US)] }
void _fixtureUsesRealCueShape
