import { describe, expect, it } from 'vitest'
import type { Clip, Track } from '../core/edit'
import { elementKey, transportActionsAt, type ElementState } from './transport'
import { createVideoPool, type VideoLike } from './videoPool'

const US = 1_000_000
const track = (id: string, extra: Partial<Track> = {}): Track => ({ id, kind: 'video', name: '', muted: false, hidden: false, locked: false, ...extra })
const video = (id: string, trackId: string, assetId: string, timelineStartUs: number, sourceStartUs: number, sourceEndUs: number): Clip =>
  ({ kind: 'video', id, trackId, assetId, timelineStartUs, sourceStartUs, sourceEndUs, opacity: 1, fit: 'contain', gain: 1 })
const tracks = [track('V1'), track('V2')]
// A: 0-4s from source 10s; a 1s gap; B: 5-7s from source 0; a picture-in-picture of A on V2 at 1-2s.
const clips = [video('a', 'V1', 'A', 0, 10 * US, 14 * US), video('b', 'V1', 'B', 5 * US, 0, 2 * US), video('p', 'V2', 'A', 1 * US, 0, 1 * US)]
const element = (trackId: string, assetId: string, currentUs: number, extra: Partial<ElementState> = {}): ElementState =>
  ({ key: elementKey(trackId, assetId), trackId, assetId, currentUs, paused: true, seeking: false, loaded: true, ...extra })
const kinds = (actions: ReturnType<typeof transportActionsAt>) => actions.map((action) => `${action.kind}:${action.key.split('/').join('.')}${'sourceUs' in action ? `@${action.sourceUs}` : ''}`)

describe('transport actions', () => {
  it('loads, seeks and plays the element each visible track needs, one per (track, asset)', () => {
    expect(kinds(transportActionsAt(1.5 * US, tracks, clips, [], { playing: true }))).toEqual([
      'load:V1.A', 'seek:V1.A@11500000', 'play:V1.A', 'load:V2.A', 'seek:V2.A@500000', 'play:V2.A',
    ])
  })

  it('leaves an element alone while it plays within tolerance, and re-seeks one that drifted', () => {
    const playing = [element('V1', 'A', 10_600_000, { paused: false })]
    expect(transportActionsAt(0.5 * US, tracks, clips, playing, { playing: true, prerollUs: 0 })).toEqual([])
    expect(kinds(transportActionsAt(0.5 * US, tracks, clips, [element('V1', 'A', 12 * US, { paused: false })], { playing: true, prerollUs: 0 }))).toEqual(['seek:V1.A@10500000'])
  })

  it('prerolls the next clip’s element — loaded and seeked, but paused — shortly before its boundary', () => {
    const now = [element('V1', 'A', 13_700_000, { paused: false })]
    // B is still 1.3 s away: nothing to prepare yet.
    expect(kinds(transportActionsAt(3.7 * US, tracks, clips.slice(0, 2), now, { playing: true }))).toEqual([])
    // Past the end of A, in the gap, within the preroll window of B.
    expect(kinds(transportActionsAt(4.6 * US, tracks, [...clips.slice(0, 2)], [element('V1', 'A', 14 * US, { paused: false })], { playing: true }))).toEqual([
      'load:V1.B', 'seek:V1.B@0', 'pause:V1.A',
    ])
  })

  it('pauses everything in a gap: nothing is decoding, the clock free-runs', () => {
    expect(kinds(transportActionsAt(4.2 * US, [track('V1')], [clips[0], clips[1]], [element('V1', 'A', 14 * US, { paused: false })], { playing: true, prerollUs: 0 }))).toEqual(['pause:V1.A'])
  })

  it('holds paused elements exactly on the playhead while scrubbing, and never seeks one already seeking', () => {
    expect(kinds(transportActionsAt(0.5 * US, tracks, clips, [element('V1', 'A', 10_530_000)], { playing: false, prerollUs: 0 }))).toEqual(['seek:V1.A@10500000'])
    expect(transportActionsAt(0.5 * US, tracks, clips, [element('V1', 'A', 10_530_000, { seeking: true })], { playing: false, prerollUs: 0 })).toEqual([])
  })

  it('skips hidden tracks entirely', () => {
    expect(kinds(transportActionsAt(1.5 * US, [track('V1'), track('V2', { hidden: true })], clips, [], { playing: false }))).toEqual(['load:V1.A', 'seek:V1.A@11500000'])
  })
})

describe('video pool', () => {
  const fake = () => {
    const calls: string[] = []
    const element: VideoLike = {
      src: '', currentTime: 0, paused: true, seeking: false, readyState: 0, muted: false, volume: 1, playbackRate: 1, preload: '',
      play: async () => {}, pause: () => calls.push('pause'), load: () => calls.push('load'), removeAttribute: (name) => calls.push(`remove:${name}`),
      addEventListener: () => {}, removeEventListener: () => {},
    }
    return Object.assign(element, { calls })
  }

  it('reuses an element per key, repoints it on a new URL, and evicts the least recently used when full', () => {
    const created: ReturnType<typeof fake>[] = []
    const pool = createVideoPool(() => { const element = fake(); created.push(element); return element }, { capacity: 2 })
    const a = pool.acquire('a', 'V1', 'A', 'media://a')
    expect(pool.acquire('a', 'V1', 'A', 'media://a').element).toBe(a.element)
    expect(a.element.preload).toBe('auto')
    pool.acquire('b', 'V1', 'B', 'media://b')
    pool.touch(['a'])
    pool.acquire('c', 'V2', 'C', 'media://c')
    expect(pool.entries().map((entry) => entry.key).sort()).toEqual(['a', 'c'])
    expect(created[1].calls).toEqual(['pause', 'remove:src', 'load'])
    pool.acquire('a', 'V1', 'A', 'media://a-relinked')
    expect(a.element.src).toBe('media://a-relinked')
  })
})
