import { describe, expect, it } from 'vitest'
import type { Clip, ProjectAsset } from './edit'
import { createProject, type CaptionProject, type Cue } from './model'
import {
  assetDurations, bindUnboundItems, defaultBindingAssetId, hasCuts, legacySegmentsOf, primaryVideoAsset, sequenceAssetIds, videoAssetUsers, videoAssets,
} from './projectClips'

const video = (id: string, durationUs: number | null = 10_000_000): ProjectAsset => ({
  id, kind: 'video', name: `${id}.mp4`, reference: { relativePath: null, absolutePath: `/${id}.mp4` }, fingerprint: null,
  metadata: { durationUs, width: 1920, height: 1080, rotationDegrees: 0, frameRate: null, nominalFrameRate: null, streams: [] },
})
const image = (id: string): ProjectAsset => ({ id, kind: 'image', name: id, reference: { relativePath: null, absolutePath: `/${id}.png` }, fingerprint: null, metadata: null })
const clip = (id: string, assetId: string, startUs: number, endUs: number): Clip => ({ id, assetId, startUs, endUs })
const cue = (id: string, mediaAssetId?: string): Cue =>
  ({ id, startUs: 0, endUs: 1_000_000, text: 'x', timingSource: 'imported', needsReview: false, textSource: 'imported', words: [], ...(mediaAssetId ? { mediaAssetId } : {}) })
const projectOf = (extra: Partial<CaptionProject> = {}): CaptionProject => ({ ...createProject(), ...extra })

describe('project video helpers', () => {
  it('lists video assets and known durations, ignoring other kinds and unprobed files', () => {
    const project = projectOf({ assets: [video('v1'), image('i1'), video('v2', null)] })
    expect(videoAssets(project).map((asset) => asset.id)).toEqual(['v1', 'v2'])
    expect([...assetDurations(project)]).toEqual([['v1', 10_000_000]])
  })

  it('lists the videos in the sequence once each, in order of first appearance', () => {
    const project = projectOf({ clips: [clip('a', 'v2', 0, 1), clip('b', 'v1', 0, 1), clip('c', 'v2', 1, 2)] })
    expect(sequenceAssetIds(project)).toEqual(['v2', 'v1'])
  })

  it('picks the first clip’s video as primary, else the first video asset, else nothing', () => {
    expect(primaryVideoAsset(projectOf({ assets: [video('v1'), video('v2')], clips: [clip('a', 'v2', 0, 1)] }))?.id).toBe('v2')
    expect(primaryVideoAsset(projectOf({ assets: [image('i1'), video('v1')] }))?.id).toBe('v1')
    expect(primaryVideoAsset(projectOf({ assets: [image('i1')] }))).toBeNull()
    expect(primaryVideoAsset(projectOf())).toBeNull()
  })
})

describe('the schema-3 view of clips', () => {
  const base = { assets: [video('v1'), video('v2', 5_000_000)] }

  it('reports the identity edit — no segments — for one clip over the whole video, and for no clips at all', () => {
    expect(legacySegmentsOf(projectOf({ ...base, clips: [clip('a', 'v1', 0, 10_000_000)] }))).toBeUndefined()
    expect(legacySegmentsOf(projectOf({ ...base, clips: [] }))).toBeUndefined()
    expect(legacySegmentsOf(projectOf())).toBeUndefined()
    expect(hasCuts(projectOf({ ...base, clips: [clip('a', 'v1', 0, 10_000_000)] }))).toBe(false)
  })

  it('reports a trimmed or split video as kept ranges', () => {
    expect(legacySegmentsOf(projectOf({ ...base, clips: [clip('a', 'v1', 2_000_000, 10_000_000)] }))).toEqual([{ id: 'a', startUs: 2_000_000, endUs: 10_000_000 }])
    const split = projectOf({ ...base, clips: [clip('a', 'v1', 0, 4_000_000), clip('b', 'v1', 4_000_000, 10_000_000)] })
    expect(legacySegmentsOf(split)).toHaveLength(2)
    expect(hasCuts(split)).toBe(true)
  })

  it('only sees the primary video’s clips', () => {
    const mixed = projectOf({ ...base, clips: [clip('a', 'v1', 0, 3_000_000), clip('b', 'v2', 0, 5_000_000), clip('c', 'v1', 5_000_000, 10_000_000)] })
    expect(legacySegmentsOf(mixed)?.map((segment) => segment.id)).toEqual(['a', 'c'])
  })
})

describe('binding unbound items', () => {
  it('stamps every unbound cue and item, and leaves already-bound ones alone', () => {
    const project = projectOf({ assets: [video('v1'), video('v2')], clips: [clip('k', 'v1', 0, 1)], cues: [cue('a'), cue('b', 'v2')] })
    expect(bindUnboundItems(project, 'v1').cues.map((item) => item.mediaAssetId)).toEqual(['v1', 'v2'])
  })

  it('returns the same object when nothing needs stamping, so history records no change', () => {
    const bound = projectOf({ assets: [video('v1')], clips: [clip('k', 'v1', 0, 1)], cues: [cue('a', 'v1')] })
    expect(bindUnboundItems(bound, 'v1')).toBe(bound)
  })

  it('does nothing while there are no clips, or with no asset to bind to', () => {
    const noClips = projectOf({ cues: [cue('a')] })
    expect(bindUnboundItems(noClips, 'v1')).toBe(noClips)
    const withClips = projectOf({ assets: [video('v1')], clips: [clip('k', 'v1', 0, 1)], cues: [cue('a')] })
    expect(bindUnboundItems(withClips, null)).toBe(withClips)
  })

  it('chooses the explicit video, else the only video in the sequence, else none', () => {
    expect(defaultBindingAssetId(projectOf({ clips: [clip('a', 'v1', 0, 1), clip('b', 'v1', 1, 2)] }))).toBe('v1')
    expect(defaultBindingAssetId(projectOf({ clips: [clip('a', 'v1', 0, 1), clip('b', 'v2', 0, 1)] }))).toBeNull()
    expect(defaultBindingAssetId(projectOf({ clips: [clip('a', 'v1', 0, 1), clip('b', 'v2', 0, 1)] }), 'v2')).toBe('v2')
    expect(defaultBindingAssetId(projectOf())).toBeNull()
  })
})

describe('what a video asset is used by', () => {
  it('lists its clips and every caption and item bound to it', () => {
    const project = projectOf({
      assets: [video('v1'), video('v2')], clips: [clip('k1', 'v1', 0, 1), clip('k2', 'v2', 0, 1)],
      cues: [cue('a', 'v1'), cue('b', 'v2')],
    })
    expect(videoAssetUsers(project, 'v1')).toEqual(['k1', 'a'])
    expect(videoAssetUsers(project, 'v3')).toEqual([])
  })
})
