import { describe, expect, it } from 'vitest'
import { applyEditCommand, isItemCommand } from './commands'
import { applyItemCommand, validateItems, type ItemCommand } from './itemCommands'
import { commitHistory, createHistory, undoHistory } from './history'
import type { CaptionProject, Cue } from './model'
import type { Clip, ProjectAsset, Track } from './edit'

const US = 1_000_000
const dates = { createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }
const FINGERPRINT = { algorithm: 'sha256-sampled-v1' as const, value: 'a'.repeat(64), sizeBytes: 1, sampledBytes: 1 }
const meta = (durationUs: number | null, width: number | null = 1920, height: number | null = 1080) =>
  ({ durationUs, width, height, rotationDegrees: 0, frameRate: { numerator: 25, denominator: 1 }, nominalFrameRate: null, streams: [] })
const asset = (id: string, kind: ProjectAsset['kind'], durationUs: number | null = 20 * US, fingerprint: ProjectAsset['fingerprint'] = null): ProjectAsset => ({
  id, kind, name: `${id}.bin`, reference: { relativePath: null, absolutePath: `/media/${id}` }, fingerprint,
  metadata: kind === 'image' ? meta(null, 400, 200) : meta(durationUs),
})
const track = (id: string, kind: Track['kind'], extra: Partial<Track> = {}): Track => ({ id, kind, name: '', muted: false, hidden: false, locked: false, ...extra })
const video = (id: string, trackId: string, timelineStartUs: number, sourceStartUs: number, sourceEndUs: number, assetId = 'x'): Clip =>
  ({ kind: 'video', id, trackId, assetId, timelineStartUs, sourceStartUs, sourceEndUs, opacity: 1, fit: 'contain', gain: 1 })
const image = (id: string, trackId: string, timelineStartUs: number, lengthUs: number): Clip =>
  ({ kind: 'image', id, trackId, assetId: 'img', timelineStartUs, sourceStartUs: 0, sourceEndUs: lengthUs, opacity: 1, fit: 'contain' })
const cue = (id: string, extra: Partial<Cue> = {}): Cue =>
  ({ id, mediaAssetId: 'x', startUs: 0, endUs: 2 * US, text: 'ഇത് React ആണ്', timingSource: 'imported', needsReview: false, textSource: 'imported', words: [], ...extra })

const project = (extra: Partial<CaptionProject> = {}): CaptionProject => ({
  schemaVersion: 5, id: 'project', title: 'Test', cues: [cue('cue-a')],
  assets: [asset('x', 'video'), asset('y', 'video', 10 * US), asset('img', 'image'), asset('snd', 'audio', 4 * US)],
  tracks: [track('V1', 'video'), track('V2', 'video'), track('A1', 'audio')],
  clips: [video('c1', 'V1', 0, 0, 20 * US)], blurRegions: [], format: { width: 1920, height: 1080, frameRate: { numerator: 25, denominator: 1 } },
  ...dates, ...extra,
})
const context = { compositionHeight: 607.5 }
const run = (base: CaptionProject, command: ItemCommand) => {
  const result = applyItemCommand(base, command, context)
  if (!result.ok) throw new Error(`command failed: ${result.errors.map((error) => error.message).join(' ')}`)
  return result
}
const refuse = (base: CaptionProject, command: ItemCommand) => {
  const result = applyItemCommand(base, command, context)
  if (result.ok) throw new Error('expected the command to be refused')
  return result.errors.map((error) => error.message).join(' ')
}
const layout = (value: CaptionProject) => value.clips.map((clip) => [clip.id, clip.trackId, clip.timelineStartUs, clip.sourceStartUs, clip.sourceEndUs])

describe('item commands', () => {
  it('dispatches item commands beside caption commands through one entry point', () => {
    const command: ItemCommand = { type: 'clip-delete', clipId: 'c1', mode: 'overwrite' }
    expect(isItemCommand(command)).toBe(true)
    expect(isItemCommand({ type: 'delete', cueId: 'cue-a' })).toBe(false)
    const result = applyEditCommand(project(), command, context)
    expect(result.ok && result.project.clips).toEqual([])
  })

  it('places the first video on an empty sequence, seeding the format and binding existing captions', () => {
    const empty = project({ assets: [], clips: [], format: undefined, cues: [cue('srt', { mediaAssetId: undefined })] })
    const clip = video('first', 'V1', 0, 0, 10 * US, 'new-video')
    const result = run(empty, { type: 'clip-add', clip, asset: { ...asset('new-video', 'video', 10 * US), metadata: meta(10 * US, 1280, 720) } })
    expect(result.project.format).toEqual({ width: 1280, height: 720, frameRate: { numerator: 25, denominator: 1 } })
    expect(result.project.cues[0].mediaAssetId).toBe('new-video')
    expect(result.selection).toEqual({ kind: 'clip', id: 'first' })
  })

  it('reuses an asset imported twice (by fingerprint) instead of growing the bin', () => {
    const base = project({ assets: [...project().assets, asset('dup', 'video', 10 * US, FINGERPRINT)] })
    const result = run(base, { type: 'clip-add', clip: video('again', 'V1', 20 * US, 0, 5 * US, 'fresh'), asset: asset('fresh', 'video', 10 * US, FINGERPRINT) })
    expect(result.project.assets).toHaveLength(base.assets.length)
    expect(result.project.clips.find((clip) => clip.id === 'again')?.assetId).toBe('dup')
  })

  it('appends a second video to V1 rather than replacing the first', () => {
    const result = run(project(), { type: 'clip-add', clip: video('second', 'V1', 20 * US, 0, 10 * US, 'y') })
    expect(layout(result.project)).toEqual([['c1', 'V1', 0, 0, 20 * US], ['second', 'V1', 20 * US, 0, 10 * US]])
    // The first video's captions are untouched and still bound to it.
    expect(result.project.cues).toEqual(project().cues)
  })

  it('refuses a video whose duration was never read, and creates a track in the same step when asked', () => {
    expect(refuse(project(), { type: 'clip-add', clip: video('n', 'V1', 30 * US, 0, US, 'nodur'), asset: asset('nodur', 'video', null) })).toMatch(/duration could not be read/)
    const result = run(project(), { type: 'clip-add', clip: image('title', 'V3', 0, 3 * US), track: track('V3', 'video') })
    expect(result.project.tracks.map((entry) => entry.id)).toEqual(['V1', 'V2', 'V3', 'A1'])
  })

  it('moves clips across tracks of one kind only, and trims/splits/deletes with undo restoring exactly', () => {
    const base = project({ clips: [video('c1', 'V1', 0, 0, 20 * US), image('i', 'V2', US, 2 * US)] })
    expect(layout(run(base, { type: 'clip-move', clipId: 'i', trackId: 'V1', startUs: 4 * US, mode: 'overwrite', idPrefix: 'm' }).project)).toEqual([
      ['c1', 'V1', 0, 0, 4 * US], ['i', 'V1', 4 * US, 0, 2 * US], ['m-1', 'V1', 6 * US, 6 * US, 20 * US],
    ])
    expect(refuse(base, { type: 'clip-move', clipId: 'i', trackId: 'A1', startUs: 0, mode: 'overwrite', idPrefix: 'm' })).toMatch(/audio track/)
    let history = createHistory(base)
    const split = run(base, { type: 'clip-split', atUs: 5 * US, idPrefix: 's' })
    history = commitHistory(history, split.project)
    const deleted = run(split.project, { type: 'clip-delete', clipId: 's-1', mode: 'ripple' })
    history = commitHistory(history, deleted.project)
    expect(layout(deleted.project)).toEqual([['c1', 'V1', 0, 0, 5 * US], ['i', 'V2', US, 0, 2 * US]])
    expect(undoHistory(undoHistory(history)).present).toEqual(base)
  })

  it('trims in ripple mode, and refuses edits on a locked track', () => {
    const base = project({ clips: [video('a', 'V1', 0, 0, 5 * US), video('b', 'V1', 5 * US, 10 * US, 15 * US)] })
    expect(layout(run(base, { type: 'clip-trim', clipId: 'a', edge: 'end', deltaUs: -2 * US, mode: 'ripple' }).project)).toEqual([
      ['a', 'V1', 0, 0, 3 * US], ['b', 'V1', 3 * US, 10 * US, 15 * US],
    ])
    const locked = { ...base, tracks: [track('V1', 'video', { locked: true }), track('V2', 'video'), track('A1', 'audio')] }
    expect(refuse(locked, { type: 'clip-delete', clipId: 'a', mode: 'overwrite' })).toMatch(/locked/)
  })

  it('edits a clip’s picture or sound in the inspector, refusing what its kind does not have', () => {
    const base = project({ clips: [video('c1', 'V1', 0, 0, 20 * US), image('i', 'V2', 0, 2 * US)] })
    const rect = { x: 540, y: 0, width: 540, height: 304 }
    const pip = run(base, { type: 'clip-update', clipId: 'c1', changes: { rect, gain: 2 } }).project.clips[0]
    expect(pip).toMatchObject({ rect, gain: 2 })
    const back = run({ ...base, clips: [pip, base.clips[1]] }, { type: 'clip-update', clipId: 'c1', changes: { rect: null } }).project.clips[0]
    expect(back).not.toHaveProperty('rect')
    expect(refuse(base, { type: 'clip-update', clipId: 'i', changes: { gain: 2 } })).toMatch(/no sound/)
  })

  it('warns (never errors) when a picture-in-picture rect runs below the frame', () => {
    const tall = project({ clips: [{ ...image('i', 'V2', 0, US), rect: { x: 0, y: 500, width: 100, height: 400 } }] })
    const validation = validateItems(tall, context)
    expect(validation.errors).toEqual([])
    expect(validation.warnings.map((warning) => warning.kind)).toEqual(['rect-bounds'])
  })

  it('removes an asset only once nothing uses it', () => {
    expect(refuse(project(), { type: 'asset-remove', assetId: 'x' })).toMatch(/Remove the 2 clips and captions/)
    expect(run(project(), { type: 'asset-remove', assetId: 'snd' }).project.assets.map((entry) => entry.id)).toEqual(['x', 'y', 'img'])
  })

  it('refits clips when a relink changes a file’s length, never overlapping the next clip', () => {
    const base = project({ clips: [video('a', 'V1', 0, 0, 20 * US), video('b', 'V1', 25 * US, 0, 5 * US, 'y')] })
    const longer = run(base, { type: 'asset-update', assetId: 'x', changes: { metadata: meta(40 * US) } })
    expect(layout(longer.project)[0]).toEqual(['a', 'V1', 0, 0, 25 * US])
    const shorter = run(base, { type: 'asset-update', assetId: 'x', changes: { metadata: meta(12 * US) } })
    expect(layout(shorter.project)[0]).toEqual(['a', 'V1', 0, 0, 12 * US])
  })

  it('gives a never-probed video its whole clip on the first relink that reports a duration', () => {
    const base = project({ clips: [], cues: [cue('c', { mediaAssetId: undefined })], assets: [asset('x', 'video', null)], format: undefined })
    const result = run(base, { type: 'asset-update', assetId: 'x', changes: { metadata: meta(8 * US) } })
    expect(layout(result.project)).toEqual([['x-clip', 'V1', 0, 0, 8 * US]])
    expect(result.project.cues[0].mediaAssetId).toBe('x')
    expect(result.project.format?.width).toBe(1920)
  })

  it('removes a track only when it is empty, and reorders tracks within their kind', () => {
    expect(refuse(project(), { type: 'track-remove', trackId: 'V1' })).toMatch(/Move or delete the 1 clip on V1/)
    expect(run(project(), { type: 'track-remove', trackId: 'V2' }).project.tracks.map((entry) => entry.id)).toEqual(['V1', 'A1'])
    const base = project({ tracks: [track('V1', 'video'), track('A1', 'audio'), track('V2', 'video')] })
    expect(run(base, { type: 'track-reorder', trackId: 'V2', direction: 'back' }).project.tracks.map((entry) => entry.id)).toEqual(['V2', 'A1', 'V1'])
    expect(run(base, { type: 'track-update', trackId: 'A1', changes: { name: '  Music  ', muted: true } }).project.tracks[1]).toMatchObject({ name: 'Music', muted: true })
  })

  it('removes silence per video, rippling only the tracks that play it, and restores it back', () => {
    const base = project({ clips: [video('a', 'V1', 0, 0, 20 * US), video('b', 'V1', 20 * US, 0, 10 * US, 'y'), image('i', 'V2', 12 * US, US)] })
    const trimmed = run(base, { type: 'clips-set', keptByAsset: [{ assetId: 'x', ranges: [{ startUs: 0, endUs: 2 * US }, { startUs: 5 * US, endUs: 8 * US }] }], idPrefix: 'k' })
    expect(layout(trimmed.project)).toEqual([
      ['a', 'V1', 0, 0, 2 * US], ['k-1-1', 'V1', 2 * US, 5 * US, 8 * US], ['b', 'V1', 5 * US, 0, 10 * US], ['i', 'V2', 12 * US, 0, US],
    ])
    const restored = run(trimmed.project, { type: 'clips-restore' })
    expect(layout(restored.project)).toEqual(layout(base))
  })

  it('adds, updates and deletes sequence-timed blur regions', () => {
    const region = { id: 'b1', startUs: 0, endUs: US, rect: { x: 0, y: 0, width: 100, height: 100 }, radius: 8 }
    const added = run(project(), { type: 'blur-add', region })
    expect(added.selection).toEqual({ kind: 'blur', id: 'b1' })
    const moved = run(added.project, { type: 'blur-update', blurId: 'b1', changes: { startUs: US, endUs: 2 * US } })
    expect(moved.project.blurRegions[0]).toMatchObject({ startUs: US, endUs: 2 * US })
    expect(run(moved.project, { type: 'blur-delete', blurId: 'b1' }).project.blurRegions).toEqual([])
  })
})
