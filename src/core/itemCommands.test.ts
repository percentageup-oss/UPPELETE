import { DEFAULT_CAPTION_STYLE } from '../captions/style'
import { describe, expect, it } from 'vitest'
import { applyEditCommand, isItemCommand } from './commands'
import { applyItemCommand, validateItems, type ItemCommand } from './itemCommands'
import { commitHistory, createHistory, undoHistory } from './history'
import type { CaptionProject, Cue } from './model'
import type { Clip, ProjectAsset, Track } from './edit'
import { defaultTextOverlay } from './textCommands'
import { defaultShape } from './shapeCommands'
import { MAX_BLENDING_SHAPES } from './graphicsPasses'

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
  schemaVersion: 22, id: 'project', title: 'Test', cues: [cue('cue-a')],
  assets: [asset('x', 'video'), asset('y', 'video', 10 * US), asset('img', 'image'), asset('snd', 'audio', 4 * US)],
  tracks: [track('V1', 'video'), track('V2', 'video'), track('A1', 'audio')],
  clips: [video('c1', 'V1', 0, 0, 20 * US)], captionTracks: [], blurRegions: [], zoomRegions: [], effects: [], textOverlays: [], shapes: [], markers: [], format: { width: 1920, height: 1080, frameRate: { numerator: 25, denominator: 1 } },
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
    expect(result.project.clips.find((clip) => clip.id === 'again')).toMatchObject({ assetId: 'dup' })
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

  it('trims clip edges to the playhead as one undo step, skipping locked tracks and clips not under it', () => {
    const base = project({ clips: [video('a', 'V1', 0, 0, 10 * US), image('i', 'V2', 2 * US, 6 * US), video('b', 'V1', 10 * US, 0, 5 * US)] })
    const rows = (value: typeof base) => layout(value).sort((x, y) => String(x[0]).localeCompare(String(y[0])))
    const start = run(base, { type: 'clip-trim-to', atUs: 4 * US, edge: 'start', mode: 'overwrite' })
    expect(rows(start.project)).toEqual([['a', 'V1', 4 * US, 4 * US, 10 * US], ['b', 'V1', 10 * US, 0, 5 * US], ['i', 'V2', 4 * US, 0, 4 * US]])
    const end = run(base, { type: 'clip-trim-to', atUs: 4 * US, edge: 'end', mode: 'ripple' })
    expect(rows(end.project)).toEqual([['a', 'V1', 0, 0, 4 * US], ['b', 'V1', 4 * US, 0, 5 * US], ['i', 'V2', 2 * US, 0, 2 * US]])
    expect(undoHistory(commitHistory(createHistory(base), end.project)).present).toEqual(base)
    expect(run(base, { type: 'clip-trim-to', atUs: 12 * US, edge: 'end', mode: 'overwrite', clipIds: ['a'] }).project).toEqual(base)
    expect(rows(run(base, { type: 'clip-trim-to', atUs: 4 * US, edge: 'end', mode: 'overwrite', clipIds: ['a'] }).project)[0]).toEqual(['a', 'V1', 0, 0, 4 * US])
    const locked = { ...base, tracks: [track('V1', 'video', { locked: true }), track('V2', 'video'), track('A1', 'audio')] }
    expect(rows(run(locked, { type: 'clip-trim-to', atUs: 4 * US, edge: 'end', mode: 'overwrite' }).project)).toEqual([['a', 'V1', 0, 0, 10 * US], ['b', 'V1', 10 * US, 0, 5 * US], ['i', 'V2', 2 * US, 0, 2 * US]])
    expect(refuse(locked, { type: 'clip-trim-to', atUs: 4 * US, edge: 'end', mode: 'overwrite', clipIds: ['a'] })).toMatch(/locked/)
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
    const tall = project({ clips: [{ ...image('i', 'V2', 0, US), rect: { x: 0, y: 500, width: 100, height: 400 } } as Clip] })
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

  it('adds, renames, reorders and removes caption tracks; a caption track holding captions refuses removal', () => {
    const captionTrack = (id: string, extra: Partial<{ name: string; locked: boolean }> = {}) => ({ id, name: '', locked: false, ...extra })
    const withC1 = project({ captionTracks: [captionTrack('C1')], cues: [cue('cue-a', { captionTrackId: 'C1' })] })
    expect(refuse(withC1, { type: 'caption-track-remove', trackId: 'C1' })).toMatch(/Move or delete the 1 caption on/)
    const added = run(withC1, { type: 'caption-track-add', track: captionTrack('C2', { name: 'Translation' }) })
    expect(added.project.captionTracks.map((entry) => entry.id)).toEqual(['C1', 'C2'])
    expect(run(added.project, { type: 'caption-track-reorder', trackId: 'C2', direction: 'back' }).project.captionTracks.map((entry) => entry.id)).toEqual(['C2', 'C1'])
    expect(run(added.project, { type: 'caption-track-update', trackId: 'C2', changes: { name: '  Malayalam  ', locked: true } }).project.captionTracks[1]).toMatchObject({ name: 'Malayalam', locked: true })
    expect(run(added.project, { type: 'caption-track-remove', trackId: 'C2' }).project.captionTracks.map((entry) => entry.id)).toEqual(['C1'])
  })

  it('moves a caption onto a different caption track, refusing a locked source or destination', () => {
    const captionTrack = (id: string, extra: Partial<{ name: string; locked: boolean }> = {}) => ({ id, name: '', locked: false, ...extra })
    const base = project({ captionTracks: [captionTrack('C1'), captionTrack('C2', { locked: true })], cues: [cue('cue-a', { captionTrackId: 'C1' })] })
    expect(run(base, { type: 'caption-track-move-cue', cueId: 'cue-a', trackId: 'C1' }).project.cues[0].captionTrackId).toBe('C1')
    expect(refuse(base, { type: 'caption-track-move-cue', cueId: 'cue-a', trackId: 'C2' })).toMatch(/locked/)
    const lockedSource = project({ captionTracks: [captionTrack('C1', { locked: true }), captionTrack('C2')], cues: [cue('cue-a', { captionTrackId: 'C1' })] })
    expect(refuse(lockedSource, { type: 'caption-track-move-cue', cueId: 'cue-a', trackId: 'C2' })).toMatch(/locked/)
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
    const region = { id: 'b1', startUs: 0, endUs: US, rect: { x: 0, y: 0, width: 100, height: 100 }, radius: 8, enabled: true }
    const added = run(project(), { type: 'blur-add', region })
    expect(added.selection).toEqual({ kind: 'blur', id: 'b1' })
    const moved = run(added.project, { type: 'blur-update', blurId: 'b1', changes: { startUs: US, endUs: 2 * US } })
    expect(moved.project.blurRegions[0]).toMatchObject({ startUs: US, endUs: 2 * US })
    expect(run(moved.project, { type: 'blur-delete', blurId: 'b1' }).project.blurRegions).toEqual([])
  })

  it('adds, moves, trims, updates and deletes zoom regions, keeping the one lane sorted', () => {
    const rect = { x: 100, y: 100, width: 800, height: 450 }
    const region = { id: 'z1', startUs: US, endUs: 2 * US, rect, easeInUs: 500_000, easeOutUs: 500_000, enabled: true }
    const added = run(project(), { type: 'zoom-region-add', region })
    expect(added.selection).toEqual({ kind: 'zoomRegion', id: 'z1' })
    expect(added.project.zoomRegions).toEqual([region])

    const moved = run(added.project, { type: 'zoom-region-move', zoomId: 'z1', startUs: 3 * US })
    expect(moved.project.zoomRegions[0]).toMatchObject({ startUs: 3 * US, endUs: 4 * US })

    const trimmed = run(moved.project, { type: 'zoom-region-trim', zoomId: 'z1', edge: 'end', deltaUs: US })
    expect(trimmed.project.zoomRegions[0]).toMatchObject({ startUs: 3 * US, endUs: 5 * US })

    const restyled = run(trimmed.project, { type: 'zoom-region-update', zoomId: 'z1', changes: { easeInUs: 0 } })
    expect(restyled.project.zoomRegions[0]).toMatchObject({ easeInUs: 0, easeOutUs: 500_000 })
    expect(restyled.selection).toEqual({ kind: 'zoomRegion', id: 'z1' })

    expect(run(restyled.project, { type: 'zoom-region-delete', zoomId: 'z1' }).project.zoomRegions).toEqual([])
  })

  it('sets and clears a pan start framing through zoom-region-update', () => {
    const rect = { x: 400, y: 0, width: 540, height: 303.75 }
    const added = run(project(), { type: 'zoom-region-add', region: { id: 'z1', startUs: 0, endUs: 2 * US, rect, easeInUs: 0, easeOutUs: 0, enabled: true } })
    const fromRect = { x: 0, y: 0, width: 540, height: 303.75 }
    const panned = run(added.project, { type: 'zoom-region-update', zoomId: 'z1', changes: { fromRect } })
    expect(panned.project.zoomRegions[0].fromRect).toEqual(fromRect)
    const retargeted = run(panned.project, { type: 'zoom-region-update', zoomId: 'z1', changes: { rect: { ...rect, x: 500 } } })
    expect(retargeted.project.zoomRegions[0].fromRect).toEqual(fromRect)
    const cleared = run(retargeted.project, { type: 'zoom-region-update', zoomId: 'z1', changes: { fromRect: null } })
    expect('fromRect' in cleared.project.zoomRegions[0]).toBe(false)
  })

  it('clamps a second zoom region into the gap beside the first rather than overlapping it', () => {
    const rect = { x: 0, y: 0, width: 800, height: 450 }
    const first = run(project(), { type: 'zoom-region-add', region: { id: 'z1', startUs: 0, endUs: 2 * US, rect, easeInUs: 0, easeOutUs: 0, enabled: true } })
    // Requested to start inside z1 and run past it; clamped to the free gap starting at z1's end.
    const second = run(first.project, { type: 'zoom-region-add', region: { id: 'z2', startUs: US, endUs: 3 * US, rect, easeInUs: 0, easeOutUs: 0, enabled: true } })
    expect(second.project.zoomRegions.map((region) => region.id)).toEqual(['z1', 'z2'])
    expect(second.project.zoomRegions[1].startUs).toBeGreaterThanOrEqual(2 * US)
    expect(second.project.zoomRegions[1].startUs).toBeLessThan(second.project.zoomRegions[1].endUs)
  })

  it('refuses a zoom region dropped into a gap too thin to hold the minimum region length', () => {
    const rect = { x: 0, y: 0, width: 800, height: 450 }
    const first = run(project(), { type: 'zoom-region-add', region: { id: 'z1', startUs: 0, endUs: 300_000, rect, easeInUs: 0, easeOutUs: 0, enabled: true } })
    // z1 ends at 300_000, z2 starts at 300_100: a 100µs sliver, well under MIN_ZOOM_REGION_US.
    const second = run(first.project, { type: 'zoom-region-add', region: { id: 'z2', startUs: 300_100, endUs: 600_000, rect, easeInUs: 0, easeOutUs: 0, enabled: true } })
    refuse(second.project, { type: 'zoom-region-add', region: { id: 'z3', startUs: 300_020, endUs: 300_080, rect, easeInUs: 0, easeOutUs: 0, enabled: true } })
  })

  it('adds, moves, trims, updates and deletes a frame-paint effect, one lane per kind', () => {
    const effect = { id: 'e1', kind: 'vignette' as const, startUs: US, endUs: 2 * US, enabled: true, amount: .5, softness: .5 }
    const added = run(project(), { type: 'effect-add', effect })
    expect(added.selection).toEqual({ kind: 'effect', id: 'e1' })
    expect(added.project.effects).toEqual([effect])

    const moved = run(added.project, { type: 'effect-move', effectId: 'e1', startUs: 3 * US })
    expect(moved.project.effects[0]).toMatchObject({ startUs: 3 * US, endUs: 4 * US })

    const trimmed = run(moved.project, { type: 'effect-trim', effectId: 'e1', edge: 'end', deltaUs: US })
    expect(trimmed.project.effects[0]).toMatchObject({ startUs: 3 * US, endUs: 5 * US })

    const restyled = run(trimmed.project, { type: 'effect-update', effectId: 'e1', changes: { amount: .8 } })
    expect(restyled.project.effects[0]).toMatchObject({ amount: .8, softness: .5 })
    expect(restyled.selection).toEqual({ kind: 'effect', id: 'e1' })

    expect(run(restyled.project, { type: 'effect-delete', effectId: 'e1' }).project.effects).toEqual([])
  })

  it('sets, replaces and clears a layer mask as single undoable commands', () => {
    const mask = { enabled: true, invert: false, feather: 6, density: 1, shape: { kind: 'ellipse' as const, rect: { x: 100, y: 100, width: 400, height: 300 } } }
    const withText = run(project(), { type: 'text-add', overlay: { id: 't1', text: 'Hi', startUs: 0, endUs: US, style: DEFAULT_CAPTION_STYLE, enter: { kind: 'none', durationUs: 0 }, exit: { kind: 'none', durationUs: 0 }, layerOrder: 1 } }).project
    const set = run(withText, { type: 'mask-set', target: { kind: 'text', id: 't1' }, mask })
    expect(set.project.textOverlays[0].mask).toEqual(mask)
    expect(set.selection).toEqual({ kind: 'text', id: 't1' })
    const clipMasked = run(set.project, { type: 'mask-set', target: { kind: 'clip', id: 'c1' }, mask: { ...mask, invert: true } })
    expect(clipMasked.project.clips[0]).toMatchObject({ mask: { invert: true } })
    const cleared = run(clipMasked.project, { type: 'mask-set', target: { kind: 'clip', id: 'c1' }, mask: null })
    expect('mask' in cleared.project.clips[0]).toBe(false)
    const track = run(project(), { type: 'caption-track-add', track: { id: 'ct', name: '', locked: false } }).project
    expect(run(track, { type: 'mask-set', target: { kind: 'captionTrack', id: 'ct' }, mask }).project.captionTracks[0].mask).toEqual(mask)
  })

  it('sets opacity and blend as one command, stripping default values', () => {
    const text = { id: 't1', text: 'Hi', startUs: 0, endUs: US, style: DEFAULT_CAPTION_STYLE, enter: { kind: 'none' as const, durationUs: 0 }, exit: { kind: 'none' as const, durationUs: 0 }, layerOrder: 1 }
    const base = run(run(project(), { type: 'text-add', overlay: text }).project, { type: 'caption-track-add', track: { id: 'ct', name: '', locked: false } }).project
    const clip = run(base, { type: 'layer-look-set', target: { kind: 'clip', id: 'c1' }, opacity: .6, blendMode: 'multiply' })
    expect(clip.project.clips[0]).toMatchObject({ opacity: .6, blendMode: 'multiply' })
    const reset = run(clip.project, { type: 'layer-look-set', target: { kind: 'clip', id: 'c1' }, opacity: 1, blendMode: 'normal' }).project.clips[0]
    expect(reset).toMatchObject({ opacity: 1 })
    expect('blendMode' in reset).toBe(false)
    expect('blendMode' in run(clip.project, { type: 'layer-look-set', target: { kind: 'clip', id: 'c1' }, blendMode: null }).project.clips[0]).toBe(false)
    const faded = run(base, { type: 'layer-look-set', target: { kind: 'text', id: 't1' }, opacity: .25 }).project
    expect(faded.textOverlays[0].opacity).toBe(.25)
    expect('opacity' in run(faded, { type: 'layer-look-set', target: { kind: 'text', id: 't1' }, opacity: 1 }).project.textOverlays[0]).toBe(false)
    expect(run(base, { type: 'layer-look-set', target: { kind: 'captionTrack', id: 'ct' }, opacity: .5 }).project.captionTracks[0].opacity).toBe(.5)
    const shaped = run(base, { type: 'shape-add', shape: defaultShape('box', 's1', 0, US) }).project
    expect(run(shaped, { type: 'layer-look-set', target: { kind: 'shape', id: 's1' }, opacity: .4 }).project.shapes[0].opacity).toBe(.4)
    const blendedShape = run(shaped, { type: 'layer-look-set', target: { kind: 'shape', id: 's1' }, blendMode: 'multiply' }).project
    expect(blendedShape.shapes[0]).toMatchObject({ blendMode: 'multiply' })
    expect(undoHistory(commitHistory(createHistory(shaped), blendedShape)).present).toEqual(shaped)
    const shapeReset = run(blendedShape, { type: 'layer-look-set', target: { kind: 'shape', id: 's1' }, blendMode: 'normal' }).project
    expect('blendMode' in shapeReset.shapes[0]).toBe(false)
    expect('blendMode' in run(blendedShape, { type: 'layer-look-set', target: { kind: 'shape', id: 's1' }, blendMode: null }).project.shapes[0]).toBe(false)
  })

  it('caps blending shapes at MAX_BLENDING_SHAPES, and duplicating past the cap drops the blend', () => {
    let proj = project()
    for (let index = 0; index < MAX_BLENDING_SHAPES; index += 1) {
      proj = run(proj, { type: 'shape-add', shape: defaultShape('box', `s${index}`, 0, US) }).project
      proj = run(proj, { type: 'layer-look-set', target: { kind: 'shape', id: `s${index}` }, blendMode: 'multiply' }).project
    }
    proj = run(proj, { type: 'shape-add', shape: defaultShape('box', 'extra', 0, US) }).project
    expect(refuse(proj, { type: 'layer-look-set', target: { kind: 'shape', id: 'extra' }, blendMode: 'multiply' })).toContain(`at most ${MAX_BLENDING_SHAPES}`)
    const duplicated = run(proj, { type: 'shape-duplicate', shapeId: 's0', duplicateId: 's0-copy' }).project
    expect('blendMode' in duplicated.shapes.find((shape) => shape.id === 's0-copy')!).toBe(false)
  })

  it('refuses looks on missing layers, effects, blur, audio and blend on non-clips', () => {
    const text = { id: 't1', text: 'Hi', startUs: 0, endUs: US, style: DEFAULT_CAPTION_STYLE, enter: { kind: 'none' as const, durationUs: 0 }, exit: { kind: 'none' as const, durationUs: 0 }, layerOrder: 1 }
    const base = run(project(), { type: 'text-add', overlay: text }).project
    expect(refuse(base, { type: 'layer-look-set', target: { kind: 'text', id: 'nope' }, opacity: .5 })).toContain('no longer exists')
    expect(refuse(base, { type: 'layer-look-set', target: { kind: 'effect', id: 'e' }, opacity: .5 })).toContain('no opacity')
    expect(refuse(base, { type: 'layer-look-set', target: { kind: 'blur', id: 'b' }, opacity: .5 })).toContain('no opacity')
    expect(refuse(base, { type: 'layer-look-set', target: { kind: 'text', id: 't1' }, blendMode: 'screen' })).toContain('blend')
    expect(refuse(base, { type: 'layer-look-set', target: { kind: 'clip', id: 'c1' }, opacity: 2 })).toContain('between 0 and 1')
    const withAudio = run(project(), { type: 'clip-add', clip: { kind: 'audio', id: 'a', trackId: 'A1', assetId: 'snd', timelineStartUs: 0, sourceStartUs: 0, sourceEndUs: US, gain: 1 } }).project
    expect(refuse(withAudio, { type: 'layer-look-set', target: { kind: 'clip', id: 'a' }, opacity: .5 })).toContain('picture')
  })

  it('carries a clip\'s mask along when it is moved, but not when it is resized', () => {
    const mask = { enabled: true, invert: false, feather: 0, density: 1, shape: { kind: 'ellipse' as const, rect: { x: 100, y: 100, width: 200, height: 100 } } }
    const pip = run(project({ clips: [video('c1', 'V1', 0, 0, 20 * US)] }), { type: 'clip-update', clipId: 'c1', changes: { rect: { x: 0, y: 0, width: 400, height: 225 } } }).project
    const masked = run(pip, { type: 'mask-set', target: { kind: 'clip', id: 'c1' }, mask }).project
    const moved = run(masked, { type: 'clip-update', clipId: 'c1', changes: { rect: { x: 50, y: 30, width: 400, height: 225 } } }).project.clips[0]
    expect(moved.kind !== 'audio' && moved.kind !== 'adjustment' && moved.mask?.shape).toEqual({ kind: 'ellipse', rect: { x: 150, y: 130, width: 200, height: 100 } })
    const resized = run(masked, { type: 'clip-update', clipId: 'c1', changes: { rect: { x: 0, y: 0, width: 500, height: 281 } } }).project.clips[0]
    expect(resized.kind !== 'audio' && resized.kind !== 'adjustment' && resized.mask).toEqual(mask)
  })

  it('refuses masks on missing layers, audio clips and glow', () => {
    const mask = { enabled: true, invert: false, feather: 0, density: 1, shape: { kind: 'rect' as const, rect: { x: 0, y: 0, width: 10, height: 10 }, cornerRadius: 0 } }
    expect(refuse(project(), { type: 'mask-set', target: { kind: 'text', id: 'nope' }, mask })).toContain('no longer exists')
    const withAudio = run(project(), { type: 'clip-add', clip: { kind: 'audio', id: 'a', trackId: 'A1', assetId: 'snd', timelineStartUs: 0, sourceStartUs: 0, sourceEndUs: US, gain: 1 } }).project
    expect(refuse(withAudio, { type: 'mask-set', target: { kind: 'clip', id: 'a' }, mask })).toContain('audio')
    const withGlow = run(project(), { type: 'effect-add', effect: { id: 'g', kind: 'glow', startUs: 0, endUs: US, enabled: true, amount: .5, radius: 10, threshold: .5 } }).project
    expect(refuse(withGlow, { type: 'mask-set', target: { kind: 'effect', id: 'g' }, mask })).toContain('Glow')
  })

  it('clamps a second effect of the same kind into the gap beside the first rather than overlapping it', () => {
    const first = run(project(), { type: 'effect-add', effect: { id: 'e1', kind: 'vignette', startUs: 0, endUs: 2 * US, enabled: true, amount: .5, softness: .5 } })
    // Requested to start inside e1 and run past it; clamped to the free gap starting at e1's end.
    const second = run(first.project, { type: 'effect-add', effect: { id: 'e2', kind: 'vignette', startUs: US, endUs: 3 * US, enabled: true, amount: .5, softness: .5 } })
    expect(second.project.effects.map((effect) => effect.id)).toEqual(['e1', 'e2'])
    expect(second.project.effects[1].startUs).toBeGreaterThanOrEqual(2 * US)
  })

  it('lets a different-kind effect freely overlap, since each kind has its own lane', () => {
    const withVignette = run(project(), { type: 'effect-add', effect: { id: 'e1', kind: 'vignette', startUs: 0, endUs: 2 * US, enabled: true, amount: .5, softness: .5 } })
    const withLetterbox = run(withVignette.project, { type: 'effect-add', effect: { id: 'e2', kind: 'letterbox', startUs: 0, endUs: 2 * US, enabled: true, aspect: 2.39, color: '#000000', easeInUs: 0, easeOutUs: 0 } })
    expect(withLetterbox.project.effects.map((effect) => [effect.id, effect.startUs, effect.endUs])).toEqual([['e1', 0, 2 * US], ['e2', 0, 2 * US]])
  })

  it('adds, updates and deletes ruler markers, keeping them sorted by time', () => {
    const second = run(project(), { type: 'marker-add', marker: { id: 'm2', atUs: 5 * US, text: 'second' } })
    const both = run(second.project, { type: 'marker-add', marker: { id: 'm1', atUs: US, text: 'insert logo here' } })
    expect(both.selection).toEqual({ kind: 'marker', id: 'm1' })
    expect(both.project.markers.map((marker) => marker.id)).toEqual(['m1', 'm2'])
    const renamed = run(both.project, { type: 'marker-update', markerId: 'm1', changes: { text: 'moved', color: '#ff8800' } })
    expect(renamed.project.markers[0]).toMatchObject({ text: 'moved', color: '#ff8800' })
    const deleted = run(renamed.project, { type: 'marker-delete', markerId: 'm1' })
    expect(deleted.project.markers.map((marker) => marker.id)).toEqual(['m2'])
    expect(refuse(deleted.project, { type: 'marker-delete', markerId: 'm1' })).toMatch(/no longer exists/)
  })

  it('edits authored text independently, permits overlap, clamps boundaries, and preserves selection through undoable steps', () => {
    const base = project({ textOverlays: [], shapes: [] })
    const first = run(base, { type: 'text-add', overlay: defaultTextOverlay('t1', 2 * US, 5 * US, 'Apple iPhone') })
    expect(first.selection).toEqual({ kind: 'text', id: 't1' })
    const overlapping = run(first.project, { type: 'text-add', overlay: defaultTextOverlay('t2', 3 * US, 6 * US, 'iPhone') })
    const duplicated = run(overlapping.project, { type: 'text-duplicate', textId: 't1', duplicateId: 't3' })
    expect(duplicated.project.textOverlays).toHaveLength(3)
    const styled = run(duplicated.project, { type: 'text-update', textId: 't3', changes: { text: 'White Card' } })
    expect(styled.project.cues).toEqual(base.cues)
    const deleted = run(styled.project, { type: 'text-delete', textId: 't3' })
    expect(deleted.project.textOverlays).toHaveLength(2)
    const moved = run(overlapping.project, { type: 'text-move', textId: 't1', startUs: 19 * US })
    expect(moved.project.textOverlays.find((item) => item.id === 't1')).toMatchObject({ startUs: 17 * US, endUs: 20 * US })
    const trimmed = run(moved.project, { type: 'text-trim', textId: 't1', edge: 'start', deltaUs: -100 * US })
    expect(trimmed.project.textOverlays.find((item) => item.id === 't1')?.startUs).toBe(0)
  })
})
