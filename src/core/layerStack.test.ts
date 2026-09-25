import { describe, expect, it } from 'vitest'
import { createProject } from './model'
import type { CaptionProject } from './model'
import type { Clip, TextOverlay } from './edit'
import { layerStackAt } from './layerStack'
import { DEFAULT_CAPTION_STYLE } from '../captions/style'
import { defaultShape } from './shapeCommands'

const US = 1_000_000
const mask = { enabled: true, invert: false, feather: 0, density: 1, shape: { kind: 'ellipse' as const, rect: { x: 0, y: 0, width: 10, height: 10 } } }
const text = (id: string, layerOrder: number, extra: Partial<TextOverlay> = {}): TextOverlay =>
  ({ id, text: `Title ${id}`, startUs: 0, endUs: 5 * US, style: DEFAULT_CAPTION_STYLE, enter: { kind: 'none', durationUs: 0 }, exit: { kind: 'none', durationUs: 0 }, layerOrder, ...extra })

const shared = createProject()
function project(extra: Partial<CaptionProject> = {}): CaptionProject {
  const base = shared
  const [v1] = base.tracks
  const v2 = { ...v1, id: 'V2' }
  const video = (id: string, trackId: string): Clip => ({ kind: 'video', id, trackId, assetId: 'a', timelineStartUs: 0, sourceStartUs: 0, sourceEndUs: 5 * US, opacity: 1, fit: 'contain', gain: 1 })
  return { ...base, tracks: [v1, v2, ...base.tracks.slice(1)],
    assets: [{ id: 'a', kind: 'video', name: 'beach.mp4', reference: { relativePath: null, absolutePath: '/m/a' }, fingerprint: null, metadata: null }],
    clips: [video('bottom', v1.id), { ...video('top', 'V2'), mask } as Clip], ...extra }
}

describe('layer stack at the playhead', () => {
  it('lists layers front to back in the same order the stage paints them', () => {
    const p = project({
      textOverlays: [text('above', 2), text('below', -1)],
      effects: [
        { id: 'fade', kind: 'fade', startUs: 0, endUs: 5 * US, enabled: true, shape: 'dip', color: '#000000', easeInUs: 0, easeOutUs: 0 },
        { id: 'vig', kind: 'vignette', startUs: 0, endUs: 5 * US, enabled: true, amount: .5, softness: .5 },
        { id: 'glow', kind: 'glow', startUs: 0, endUs: 5 * US, enabled: true, amount: .5, radius: 10, threshold: .5 },
      ],
      blurRegions: [{ id: 'blur', startUs: 0, endUs: 5 * US, enabled: true, radius: 8, rect: { x: 0, y: 0, width: 100, height: 100 } }],
    })
    expect(layerStackAt(p, US).map((row) => row.key)).toEqual(['fade', 'above', 'below', 'vig', 'blur', 'top', 'bottom'])
  })

  it('reports opacity and blend per layer kind', () => {
    const p = project({
      textOverlays: [text('t', 1, { opacity: .5 })],
      effects: [{ id: 'vig', kind: 'vignette', startUs: 0, endUs: 5 * US, enabled: true, amount: .5, softness: .5 }],
      blurRegions: [{ id: 'blur', startUs: 0, endUs: 5 * US, enabled: true, radius: 8, rect: { x: 0, y: 0, width: 100, height: 100 } }],
      clips: [{ kind: 'video', id: 'v', trackId: shared.tracks[0].id, assetId: 'a', timelineStartUs: 0, sourceStartUs: 0, sourceEndUs: 5 * US, opacity: .7, blendMode: 'screen', fit: 'contain', gain: 1 }],
      shapes: [{ ...defaultShape('box', 's', 0, 5 * US), blendMode: 'multiply' }],
    })
    const look = Object.fromEntries(layerStackAt(p, US).map((row) => [row.key, [row.opacity, row.blendMode]]))
    expect(look).toEqual({ t: [.5, null], vig: [null, null], blur: [null, null], v: [.7, 'screen'], s: [1, 'multiply'] })
    expect(layerStackAt(project(), US).find((row) => row.key === 'bottom')).toMatchObject({ opacity: 1, blendMode: 'normal' })
    const plainShape = project({ shapes: [defaultShape('box', 's2', 0, 5 * US)] })
    expect(layerStackAt(plainShape, US).find((row) => row.key === 's2')).toMatchObject({ blendMode: 'normal' })
  })

  it('carries each item\'s mask and what clicking selects', () => {
    const rows = layerStackAt(project(), US)
    const top = rows.find((row) => row.key === 'top')!
    expect(top).toMatchObject({ kind: 'video', label: 'beach.mp4', mask, selection: { kind: 'clip', id: 'top' }, target: { kind: 'clip', id: 'top' } })
    expect(rows.find((row) => row.key === 'bottom')!.mask).toBeNull()
  })

  it('leaves out what is not showing: items outside their time, bypassed effects, hidden tracks, glow', () => {
    const p = project({ textOverlays: [text('later', 1, { startUs: 3 * US })],
      effects: [{ id: 'off', kind: 'vignette', startUs: 0, endUs: 5 * US, enabled: false, amount: .5, softness: .5 }], tracks: project().tracks.map((track) => track.id === 'V2' ? { ...track, hidden: true } : track) })
    expect(layerStackAt(p, US).map((row) => row.key)).toEqual(['bottom'])
    expect(layerStackAt(p, 4 * US).map((row) => row.key)).toEqual(['later', 'bottom'])
  })

  it('shows the caption plane of the track whose caption is on screen, else every caption track as inactive', () => {
    const base = project()
    const [track] = base.captionTracks
    const cue = { id: 'cue', mediaAssetId: 'a', captionTrackId: track.id, startUs: 0, endUs: 2 * US, text: 'hi', timingSource: 'manual' as const, needsReview: false, textSource: 'user' as const, words: [] }
    const p = { ...base, cues: [cue], captionTracks: [{ ...track, mask }] }
    const rows = layerStackAt(p, US).filter((row) => row.kind === 'captions')
    expect(rows).toEqual([expect.objectContaining({ key: `captions:${track.id}`, mask, active: true, selection: { kind: 'cue', id: 'cue' }, target: { kind: 'captionTrack', id: track.id } })])
    const idle = layerStackAt(p, 4 * US).filter((row) => row.kind === 'captions')
    expect(idle).toEqual([expect.objectContaining({ active: false, selection: null })])
  })
})
