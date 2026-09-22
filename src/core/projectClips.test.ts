import { describe, expect, it } from 'vitest'
import type { CaptionProject } from './model'
import type { Clip, ProjectAsset } from './edit'
import { assetUsers, bindUnboundItems, clipCountByAsset, defaultBindingAssetId, hasTrimmedClips, primaryVideoAsset, sequenceAssetIds, videoAssets } from './projectClips'

const US = 1_000_000
const asset = (id: string, kind: ProjectAsset['kind'], durationUs: number | null = 10 * US): ProjectAsset => ({
  id, kind, name: `${id}.bin`, reference: { relativePath: null, absolutePath: `/m/${id}` }, fingerprint: null,
  metadata: { durationUs, width: 1920, height: 1080, rotationDegrees: 0, frameRate: null, nominalFrameRate: null, streams: [] },
})
const video = (id: string, assetId: string, timelineStartUs: number, sourceStartUs = 0, sourceEndUs = 10 * US): Clip =>
  ({ kind: 'video', id, trackId: 'V1', assetId, timelineStartUs, sourceStartUs, sourceEndUs, opacity: 1, fit: 'contain', gain: 1 })
const project = (extra: Partial<CaptionProject> = {}): CaptionProject => ({
  schemaVersion: 5, id: 'p', title: 'P', cues: [], assets: [asset('x', 'video'), asset('y', 'video'), asset('img', 'image')],
  tracks: [{ id: 'V1', kind: 'video', name: '', muted: false, hidden: false, locked: false }], clips: [], blurRegions: [], markers: [],
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...extra,
})
const cue = (id: string, mediaAssetId?: string) => ({ id, mediaAssetId, startUs: 0, endUs: US, text: id, timingSource: 'imported' as const, needsReview: false, textSource: 'imported' as const, words: [] })

describe('project clip helpers', () => {
  it('lists the videos in order of first appearance on the timeline, and picks the first as primary', () => {
    const value = project({ clips: [video('b', 'y', 10 * US), video('a', 'x', 0)].sort((a, b) => a.timelineStartUs - b.timelineStartUs) })
    expect(sequenceAssetIds(value)).toEqual(['x', 'y'])
    expect(primaryVideoAsset(value)?.id).toBe('x')
    expect(primaryVideoAsset(project())?.id).toBe('x') // no clips yet: the first video asset
    expect(videoAssets(value).map((entry) => entry.id)).toEqual(['x', 'y'])
  })

  it('says when any video clip plays less than its whole file', () => {
    expect(hasTrimmedClips(project({ clips: [video('a', 'x', 0)] }))).toBe(false)
    expect(hasTrimmedClips(project({ clips: [video('a', 'x', 0, 0, 5 * US)] }))).toBe(true)
  })

  it('binds unbound captions only once the timeline has video, and returns the same object when nothing changes', () => {
    const noVideo = project({ cues: [cue('c')] })
    expect(bindUnboundItems(noVideo, 'x')).toBe(noVideo)
    const withVideo = project({ cues: [cue('c'), cue('d', 'y')], clips: [video('a', 'x', 0)] })
    expect(bindUnboundItems(withVideo, 'x').cues.map((entry) => entry.mediaAssetId)).toEqual(['x', 'y'])
    const bound = project({ cues: [cue('d', 'y')], clips: [video('a', 'x', 0)] })
    expect(bindUnboundItems(bound, 'x')).toBe(bound)
  })

  it('binds new captions to the explicit video, else the sequence’s only one, else nothing', () => {
    expect(defaultBindingAssetId(project({ clips: [video('a', 'x', 0)] }))).toBe('x')
    expect(defaultBindingAssetId(project({ clips: [video('a', 'x', 0), video('b', 'y', 10 * US)] }))).toBeNull()
    expect(defaultBindingAssetId(project(), 'y')).toBe('y')
  })

  it('finds every clip and caption using an asset, and counts clips per asset', () => {
    const value = project({ clips: [video('a', 'x', 0), video('b', 'x', 10 * US)], cues: [cue('c', 'x'), cue('d', 'y')] })
    expect(assetUsers(value, 'x')).toEqual(['a', 'b', 'c'])
    expect(clipCountByAsset(value.clips)).toEqual(new Map([['x', 2]]))
  })
})
