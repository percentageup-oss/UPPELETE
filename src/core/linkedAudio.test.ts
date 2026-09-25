import { describe, expect, it } from 'vitest'
import { applyItemCommand, type ItemCommand } from './itemCommands'
import { loadProject, projectSchema } from './model'
import type { CaptionProject } from './model'
import type { Clip, ProjectAsset, Track } from './edit'
import { effectiveGain, trackAudible } from './clipLinks'

const US = 1_000_000
const dates = { createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }
const audioStream = { index: 1, kind: 'audio' as const, codec: { name: 'aac', longName: null, profile: null, level: null, tag: null }, timeBase: null, startUs: 0, durationUs: null, width: null, height: null, averageFrameRate: null, nominalFrameRate: null, rotationDegrees: null, sampleRate: 48000, channels: 2 }
const meta = (durationUs: number, withAudio: boolean) => ({ durationUs, width: 1920, height: 1080, rotationDegrees: 0, frameRate: { numerator: 25, denominator: 1 }, nominalFrameRate: null, streams: withAudio ? [audioStream] : [] }) as ProjectAsset['metadata']
const asset = (id: string, withAudio = true): ProjectAsset => ({ id, kind: 'video', name: `${id}.mp4`, reference: { relativePath: null, absolutePath: `/m/${id}` }, fingerprint: null, metadata: meta(20 * US, withAudio) })
const track = (id: string, kind: Track['kind'], extra: Partial<Track> = {}): Track => ({ id, kind, name: '', muted: false, hidden: false, locked: false, ...extra })
const video = (id: string, trackId: string, start: number, s0: number, s1: number, assetId = 'x', extra: object = {}): Clip =>
  ({ kind: 'video', id, trackId, assetId, timelineStartUs: start, sourceStartUs: s0, sourceEndUs: s1, opacity: 1, fit: 'contain', gain: 1, ...extra }) as Clip
const audio = (id: string, trackId: string, start: number, s0: number, s1: number, linkId?: string, assetId = 'x'): Clip =>
  ({ kind: 'audio', id, trackId, assetId, timelineStartUs: start, sourceStartUs: s0, sourceEndUs: s1, gain: 1, ...(linkId ? { linkId } : {}) }) as Clip
const base = (extra: Partial<CaptionProject> = {}): CaptionProject => ({
  schemaVersion: 23, id: 'p', title: 'T', cues: [], assets: [asset('x'), asset('y'), asset('mute', false)],
  tracks: [track('V1', 'video'), track('V2', 'video'), track('A1', 'audio')], clips: [], captionTracks: [], blurRegions: [], zoomRegions: [], effects: [], textOverlays: [], shapes: [], markers: [], ...dates, ...extra,
})
const run = (project: CaptionProject, command: ItemCommand) => {
  const result = applyItemCommand(project, command, {})
  if (!result.ok) throw new Error(result.errors.map((e) => e.message).join(' '))
  expect(projectSchema.safeParse(result.project).success).toBe(true)
  return result.project
}
const refuse = (project: CaptionProject, command: ItemCommand) => {
  const result = applyItemCommand(project, command, {})
  if (result.ok) throw new Error('expected refusal')
  return result.errors.map((e) => e.message).join(' ')
}
const layout = (p: CaptionProject) => p.clips.map((c) => `${c.id}@${c.trackId}:${c.timelineStartUs / US}[${c.sourceStartUs / US}-${c.sourceEndUs / US}]${(c as { linkId?: string }).linkId ? '~' + (c as { linkId?: string }).linkId : ''}`).sort()

/** V1 video c1 (0–10 s) with linked audio a1 on A1. */
const pair = () => base({ clips: [video('c1', 'V1', 0, 0, 10 * US, 'x', { detachedAudio: true, linkId: 'L' }), audio('a1', 'A1', 0, 0, 10 * US, 'L')] })

describe('schema 15 migration', () => {
  it('loads a schema-14 project unchanged apart from the version, keeping embedded audio', () => {
    const v14 = { ...base({ clips: [video('c1', 'V1', 0, 0, 10 * US)] }), schemaVersion: 14 }
    const loaded = loadProject(v14)
    expect(loaded.migratedFrom).toBe(14)
    expect(loaded.project.schemaVersion).toBe(20)
    expect(loaded.project.clips[0]).toEqual(video('c1', 'V1', 0, 0, 10 * US))
  })
  it('rejects two videos in one link group', () => {
    const bad = base({ clips: [video('c1', 'V1', 0, 0, US, 'x', { linkId: 'L' }), video('c2', 'V2', 0, 0, US, 'x', { linkId: 'L' })] })
    expect(projectSchema.safeParse(bad).success).toBe(false)
  })
})

describe('placing a video', () => {
  it('adds a linked audio clip on the paired audio lane and silences the video', () => {
    const next = run(base(), { type: 'clip-add', clip: video('c1', 'V1', 0, 0, 10 * US), idPrefix: 'n' })
    expect(next.clips.find((c) => c.id === 'c1')).toMatchObject({ detachedAudio: true, linkId: 'n-audio-2' })
    expect(next.clips.find((c) => c.kind === 'audio')).toMatchObject({ trackId: 'A1', assetId: 'x', linkId: 'n-audio-2', timelineStartUs: 0, sourceEndUs: 10 * US })
  })
  it('creates a second audio lane when a video is stacked over the first', () => {
    const first = run(base(), { type: 'clip-add', clip: video('c1', 'V1', 0, 0, 10 * US), idPrefix: 'n' })
    const second = run(first, { type: 'clip-add', clip: video('c2', 'V2', 0, 0, 10 * US, 'y'), idPrefix: 'm' })
    const lanes = second.tracks.filter((t) => t.kind === 'audio')
    expect(lanes).toHaveLength(2)
    expect(second.clips.filter((c) => c.kind === 'audio').map((c) => c.trackId).sort()).toEqual(lanes.map((t) => t.id).sort())
  })
  it('places a video with no audio stream alone, and honours detachedAudio: false', () => {
    expect(run(base(), { type: 'clip-add', clip: video('c1', 'V1', 0, 0, US, 'mute'), idPrefix: 'n' }).clips).toHaveLength(1)
    const legacy = run(base(), { type: 'clip-add', clip: video('c1', 'V1', 0, 0, US, 'x', { detachedAudio: false }), idPrefix: 'n' })
    expect(legacy.clips).toHaveLength(1)
  })
})

describe('linked editing', () => {
  it('an overwrite trim carries only in-sync partners, so audio cut by an overlap drags back under a full-length video', () => {
    let p = base({ clips: [video('c1', 'V1', 0, 0, 20 * US, 'x', { detachedAudio: true, linkId: 'L' }), audio('a1', 'A1', 0, 0, 20 * US, 'L'), audio('s', 'A1', 40 * US, 0, 2 * US, undefined, 'y')] })
    p = run(p, { type: 'clip-move', clipId: 's', trackId: 'A1', startUs: 17 * US, mode: 'overwrite', idPrefix: 'm' })
    p = run(p, { type: 'clip-move', clipId: 's', trackId: 'A1', startUs: 40 * US, mode: 'overwrite', idPrefix: 'n' })
    expect(layout(p)).toEqual(['a1@A1:0[0-17]~L', 'c1@V1:0[0-20]~L', 'm-1@A1:19[19-20]~L', 's@A1:40[0-2]'])
    // The video's end is not where the audio's is, so it does not hold the audio back.
    expect(layout(run(p, { type: 'clip-trim', clipId: 'a1', edge: 'end', deltaUs: 3 * US, mode: 'overwrite' }))).toEqual(['a1@A1:0[0-20]~L', 'c1@V1:0[0-20]~L', 's@A1:40[0-2]'])
    // Grabbing the video's end leaves the out-of-sync audio alone; the in-sync leftover piece follows.
    expect(layout(run(p, { type: 'clip-trim', clipId: 'c1', edge: 'end', deltaUs: -US / 2, mode: 'overwrite' }))).toEqual(['a1@A1:0[0-17]~L', 'c1@V1:0[0-19.5]~L', 'm-1@A1:19[19-19.5]~L', 's@A1:40[0-2]'])
  })
  it('dropping a pair inside a pair splits it into two valid pairs, and trimming back heals both', () => {
    const withOther = run(pair(), { type: 'clip-add', clip: video('c2', 'V1', 30 * US, 0, 2 * US, 'y'), idPrefix: 'n' })
    const dropped = run(withOther, { type: 'clip-move', clipId: 'c2', trackId: 'V1', startUs: 4 * US, mode: 'overwrite', idPrefix: 'm' })
    expect(layout(dropped).filter((entry) => entry.includes(':6['))).toEqual(['m-1@V1:6[6-10]~m-link-1', 'm-2@A1:6[6-10]~m-link-1'])
    const removed = run(dropped, { type: 'clip-delete', clipId: 'c2', mode: 'overwrite' })
    const healed = run(removed, { type: 'clip-trim', clipId: 'c1', edge: 'end', deltaUs: 6 * US, mode: 'overwrite' })
    expect(layout(healed)).toEqual(['a1@A1:0[0-10]~L', 'c1@V1:0[0-10]~L'])
  })
  it('moves both members by the same delta', () => {
    const next = run(pair(), { type: 'clip-move', clipId: 'c1', trackId: 'V1', startUs: 4 * US, mode: 'overwrite', idPrefix: 'm' })
    expect(layout(next)).toEqual(['a1@A1:4[0-10]~L', 'c1@V1:4[0-10]~L'])
  })
  it('sends a layered video\'s audio to a new lane instead of carving the audio it lands on', () => {
    const two = base({ tracks: [track('V1', 'video'), track('A1', 'audio')], clips: [
      video('c1', 'V1', 0, 0, 10 * US, 'x', { detachedAudio: true, linkId: 'L' }), audio('a1', 'A1', 0, 0, 10 * US, 'L'),
      video('c2', 'V1', 10 * US, 0, 10 * US, 'y', { detachedAudio: true, linkId: 'M' }), audio('a2', 'A1', 10 * US, 0, 10 * US, 'M'),
    ] })
    const next = run(two, { type: 'clip-move', clipId: 'c2', trackId: 'V2', startUs: 0, mode: 'overwrite', idPrefix: 'm', track: track('V2', 'video') })
    expect(next.tracks.filter((t) => t.kind === 'audio')).toHaveLength(2)
    const a1 = next.clips.find((c) => c.id === 'a1')!
    const a2 = next.clips.find((c) => c.id === 'a2')!
    expect(a1).toMatchObject({ trackId: 'A1', timelineStartUs: 0, sourceEndUs: 10 * US })
    expect(a2.trackId).not.toBe('A1')
    expect(a2.timelineStartUs).toBe(0)
  })
  it('follows a video to V2 by moving its audio to the paired A2 lane', () => {
    const two = base({ tracks: [track('V1', 'video'), track('V2', 'video'), track('A1', 'audio'), track('A2', 'audio')], clips: [
      video('c1', 'V1', 0, 0, 10 * US, 'x', { detachedAudio: true, linkId: 'L' }), audio('a1', 'A1', 0, 0, 10 * US, 'L'),
    ] })
    const next = run(two, { type: 'clip-move', clipId: 'c1', trackId: 'V2', startUs: 0, mode: 'overwrite', idPrefix: 'm' })
    expect(next.clips.find((c) => c.id === 'c1')?.trackId).toBe('V2')
    expect(next.clips.find((c) => c.id === 'a1')?.trackId).toBe('A2')
  })
  it('creates the paired audio lane when the video moves to a lane with no counterpart', () => {
    const one = base({ tracks: [track('V1', 'video'), track('V2', 'video'), track('A1', 'audio')], clips: [
      video('c1', 'V1', 0, 0, 10 * US, 'x', { detachedAudio: true, linkId: 'L' }), audio('a1', 'A1', 0, 0, 10 * US, 'L'),
    ] })
    const next = run(one, { type: 'clip-move', clipId: 'c1', trackId: 'V2', startUs: 0, mode: 'overwrite', idPrefix: 'm' })
    const audioTracks = next.tracks.filter((t) => t.kind === 'audio')
    expect(audioTracks).toHaveLength(2)
    expect(next.clips.find((c) => c.id === 'a1')?.trackId).toBe(audioTracks[1].id)
  })
  it('moves only the grabbed clip when unlinked', () => {
    const next = run(pair(), { type: 'clip-move', clipId: 'a1', trackId: 'A1', startUs: 3 * US, mode: 'overwrite', idPrefix: 'm', unlinked: true })
    expect(layout(next)).toEqual(['a1@A1:3[0-10]~L', 'c1@V1:0[0-10]~L'])
  })
  it('clamps a move so neither member goes before zero', () => {
    const shifted = base({ clips: [video('c1', 'V1', US, 0, 10 * US, 'x', { detachedAudio: true, linkId: 'L' }), audio('a1', 'A1', 2 * US, 0, 8 * US, 'L')] })
    const next = run(shifted, { type: 'clip-move', clipId: 'a1', trackId: 'A1', startUs: 0, mode: 'overwrite', idPrefix: 'm' })
    expect(next.clips.map((c) => c.timelineStartUs).sort()).toEqual([0, US])
  })
  it('splits both and links the right-hand halves as a new pair', () => {
    const next = run(pair(), { type: 'clip-split', atUs: 4 * US, idPrefix: 's' })
    expect(layout(next)).toEqual(['a1@A1:0[0-4]~L', 'c1@V1:0[0-4]~L', 's-1@V1:4[4-10]~s-link-1', 's-2@A1:4[4-10]~s-link-1'])
  })
  it('splits only one side when unlinked, leaving the right half out of any group', () => {
    const next = run(pair(), { type: 'clip-split', atUs: 4 * US, clipIds: ['c1'], idPrefix: 's', unlinked: true })
    expect(layout(next)).toEqual(['a1@A1:0[0-10]~L', 'c1@V1:0[0-4]~L', 's-1@V1:4[4-10]'])
  })
  it('splitting a selection of one clip still cuts its partner', () => {
    const next = run(pair(), { type: 'clip-split', atUs: 4 * US, clipIds: ['c1'], idPrefix: 's' })
    expect(next.clips).toHaveLength(4)
  })
  it('trims both edges together, clamped to the tighter member', () => {
    const tight = base({ clips: [video('c1', 'V1', 0, 0, 10 * US, 'x', { detachedAudio: true, linkId: 'L' }), audio('a1', 'A1', 0, 0, 10 * US, 'L'), audio('next', 'A1', 12 * US, 0, 2 * US)] })
    // The video could grow by 10 s (asset is 20 s) but the audio lane's neighbour stops it at 2 s.
    const next = run(tight, { type: 'clip-trim', clipId: 'c1', edge: 'end', deltaUs: 8 * US, mode: 'overwrite' })
    expect(next.clips.find((c) => c.id === 'c1')!.sourceEndUs).toBe(12 * US)
    expect(next.clips.find((c) => c.id === 'a1')!.sourceEndUs).toBe(12 * US)
    const start = run(pair(), { type: 'clip-trim', clipId: 'a1', edge: 'start', deltaUs: 3 * US, mode: 'overwrite' })
    expect(layout(start)).toEqual(['a1@A1:3[3-10]~L', 'c1@V1:3[3-10]~L'])
  })
  it('trims one side alone when unlinked', () => {
    const next = run(pair(), { type: 'clip-trim', clipId: 'a1', edge: 'end', deltaUs: -2 * US, mode: 'overwrite', unlinked: true })
    expect(layout(next)).toEqual(['a1@A1:0[0-8]~L', 'c1@V1:0[0-10]~L'])
  })
  it('deletes both, or one when unlinked', () => {
    expect(run(pair(), { type: 'clip-delete', clipId: 'c1', mode: 'overwrite' }).clips).toEqual([])
    const one = run(pair(), { type: 'clip-delete', clipId: 'c1', mode: 'overwrite', unlinked: true })
    expect(one.clips.map((c) => c.id)).toEqual(['a1'])
  })
  it('refuses a linked edit when a partner sits on a locked track', () => {
    const locked = { ...pair(), tracks: [track('V1', 'video'), track('V2', 'video'), track('A1', 'audio', { locked: true })] }
    expect(refuse(locked, { type: 'clip-move', clipId: 'c1', trackId: 'V1', startUs: US, mode: 'overwrite', idPrefix: 'm' })).toMatch(/locked/)
  })
  it('shares enabled and speed across the pair but keeps gain per clip', () => {
    const disabled = run(pair(), { type: 'clip-update', clipId: 'c1', changes: { enabled: false } })
    expect(disabled.clips.every((c) => c.enabled === false)).toBe(true)
    const gained = run(pair(), { type: 'clip-update', clipId: 'a1', changes: { gain: 0.5 } })
    expect(gained.clips.find((c) => c.id === 'c1')).toMatchObject({ gain: 1 })
    const reenabled = run(disabled, { type: 'clip-update', clipId: 'a1', changes: { enabled: true } })
    expect(reenabled.clips.some((c) => 'enabled' in c)).toBe(false)
  })
})

describe('link, unlink and detach', () => {
  it('unlinks a pair and relinks it', () => {
    const unlinked = run(pair(), { type: 'clips-unlink', clipIds: ['a1'] })
    expect(unlinked.clips.some((c) => 'linkId' in c && c.linkId)).toBe(false)
    const relinked = run(unlinked, { type: 'clips-link', clipIds: ['c1', 'a1'], linkId: 'K' })
    expect(layout(relinked)).toEqual(['a1@A1:0[0-10]~K', 'c1@V1:0[0-10]~K'])
  })
  it('refuses to link two videos', () => {
    const two = base({ clips: [video('c1', 'V1', 0, 0, US), video('c2', 'V2', 0, 0, US)] })
    expect(refuse(two, { type: 'clips-link', clipIds: ['c1', 'c2'], linkId: 'K' })).toMatch(/at most one video/)
  })
  it('detaches a legacy video’s sound into a linked audio clip', () => {
    const legacy = base({ clips: [video('c1', 'V1', 0, 0, 10 * US)] })
    const next = run(legacy, { type: 'clip-detach-audio', clipId: 'c1', audioClipId: 'a9', linkId: 'K', trackId: 'A1' })
    expect(layout(next)).toEqual(['a9@A1:0[0-10]~K', 'c1@V1:0[0-10]~K'])
    expect(next.clips.find((c) => c.id === 'c1')).toMatchObject({ detachedAudio: true })
    expect(refuse(next, { type: 'clip-detach-audio', clipId: 'c1', audioClipId: 'a8', linkId: 'J', trackId: 'A1' })).toMatch(/already separate/)
  })
})

describe('silence removal keeps pairs in step', () => {
  it('cuts the audio with its video and regroups each piece as its own pair', () => {
    const next = run(pair(), { type: 'clips-set', keptByAsset: [{ assetId: 'x', ranges: [{ startUs: 1 * US, endUs: 3 * US }, { startUs: 5 * US, endUs: 8 * US }] }], idPrefix: 'k' })
    const videos = next.clips.filter((c) => c.kind === 'video')
    const audios = next.clips.filter((c) => c.kind === 'audio')
    expect(videos.map((c) => [c.timelineStartUs, c.sourceStartUs])).toEqual(audios.map((c) => [c.timelineStartUs, c.sourceStartUs]))
    for (const v of videos) expect(audios.filter((a) => a.linkId === (v as { linkId?: string }).linkId)).toHaveLength(1)
  })
  it('restores the whole pair', () => {
    const cut = run(pair(), { type: 'clips-set', keptByAsset: [{ assetId: 'x', ranges: [{ startUs: 1 * US, endUs: 3 * US }, { startUs: 5 * US, endUs: 8 * US }] }], idPrefix: 'k' })
    const restored = run(cut, { type: 'clips-restore' })
    expect(restored.clips.map((c) => [c.kind, c.timelineStartUs, c.sourceStartUs, c.sourceEndUs])).toEqual([['video', 0, 0, 20 * US], ['audio', 0, 0, 20 * US]])
  })
})

describe('mute, solo, volume and disable', () => {
  const tracks = [track('V1', 'video'), track('A1', 'audio'), track('A2', 'audio')]
  const a = audio('a', 'A1', 0, 0, US) as Extract<Clip, { kind: 'audio' }>
  it('is audible unless muted, and only soloed tracks are heard once one is soloed', () => {
    expect(trackAudible(tracks[1], tracks)).toBe(true)
    expect(trackAudible({ ...tracks[1], muted: true }, tracks)).toBe(false)
    const soloed = [tracks[0], { ...tracks[1], solo: true }, tracks[2]]
    expect(trackAudible(soloed[1], soloed)).toBe(true)
    expect(trackAudible(soloed[2], soloed)).toBe(false)
    expect(trackAudible(soloed[0], soloed)).toBe(false)
  })
  it('multiplies clip gain by the track fader and zeroes disabled or detached clips', () => {
    const faded = [tracks[0], { ...tracks[1], volume: 0.5 }, tracks[2]]
    expect(effectiveGain({ ...a, gain: 2 }, faded)).toBe(1)
    expect(effectiveGain({ ...a, enabled: false }, faded)).toBe(0)
    expect(effectiveGain(video('v', 'V1', 0, 0, US, 'x', { detachedAudio: true }), faded)).toBe(0)
    expect(effectiveGain(video('v', 'V1', 0, 0, US), faded)).toBe(1)
  })
  it('sets solo and volume through track-update', () => {
    const next = run(base(), { type: 'track-update', trackId: 'A1', changes: { solo: true, volume: 0.5 } })
    expect(next.tracks.find((t) => t.id === 'A1')).toMatchObject({ solo: true, volume: 0.5 })
  })
})
