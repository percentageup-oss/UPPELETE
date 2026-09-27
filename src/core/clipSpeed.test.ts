import { describe, expect, it } from 'vitest'
import { applyItemCommand, type ItemCommand } from './itemCommands'
import { loadProject, projectSchema } from './model'
import type { CaptionProject, Cue } from './model'
import type { Clip, ClipSpeed, ProjectAsset, Track } from './edit'
import { clipEndUs, activeClipsAt, activeCueAt } from './timelineModel'
import { timelineLengthUs } from './clipTime'
import { keepRangesOfAsset, splitClip, trimClip } from './clipEdits'
import { presetSpeed, SPEED_PRESETS } from './speedPresets'
import { elementRateFor, silentForSpeed } from '../playback/transport'
import { clipPeaks } from './waveformSlice'
import { stripTimestamps } from '../timeline/thumbnailQueue'

const US = 1_000_000
const dates = { createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }
const meta = { durationUs: 20 * US, width: 1920, height: 1080, rotationDegrees: 0, frameRate: { numerator: 25, denominator: 1 }, nominalFrameRate: null, streams: [] }
const asset = (id: string, kind: ProjectAsset['kind']): ProjectAsset =>
  ({ id, kind, name: id, reference: { relativePath: null, absolutePath: `/m/${id}` }, fingerprint: null, metadata: meta })
const track = (id: string, kind: Track['kind'], locked = false): Track => ({ id, kind, name: '', muted: false, hidden: false, locked })
const constant = (rate: number): ClipSpeed => ({ points: [{ sourceUs: 0, rate }] })
const ramp: ClipSpeed = { points: [{ sourceUs: 0, rate: 1 }, { sourceUs: 4 * US, rate: 4 }, { sourceUs: 8 * US, rate: 0.5 }] }
const video = (id: string, start: number, s0: number, s1: number, speed?: ClipSpeed): Clip =>
  ({ kind: 'video', id, trackId: 'V1', assetId: 'x', timelineStartUs: start, sourceStartUs: s0, sourceEndUs: s1, opacity: 1, fit: 'contain', gain: 1, ...(speed ? { speed } : {}) })
const cue = (extra: Partial<Cue> = {}): Cue =>
  ({ id: 'cue', mediaAssetId: 'x', startUs: 2 * US, endUs: 4 * US, text: 'hi', timingSource: 'imported', needsReview: false, textSource: 'imported', words: [], ...extra })
const project = (clips: Clip[], tracks: Track[] = [track('V1', 'video')]): CaptionProject => ({
  schemaVersion: 26, id: 'p', title: 'P', cues: [cue()], assets: [asset('x', 'video')], tracks, clips, captionTracks: [],
  blurRegions: [], zoomRegions: [], effects: [], textOverlays: [], shapes: [], markers: [], format: { width: 1920, height: 1080, frameRate: { numerator: 25, denominator: 1 } }, ...dates,
})
const context = { compositionHeight: 607.5 }
const run = (base: CaptionProject, command: ItemCommand) => {
  const result = applyItemCommand(base, command, context)
  if (!result.ok) throw new Error(result.errors.map((error) => error.message).join(' '))
  return result.project
}

describe('schema 14', () => {
  it('migrates a schema-13 project unchanged apart from the version', () => {
    const v13 = { ...project([video('a', 0, 0, 10 * US)]), schemaVersion: 13 }
    const loaded = loadProject(v13)
    expect(loaded.migratedFrom).toBe(13)
    expect(loaded.project).toEqual({ ...v13, schemaVersion: 21 })
  })

  it('validates speed points: strictly increasing source order and bounded rates', () => {
    const parse = (speed: unknown) => projectSchema.safeParse({ ...project([]), clips: [{ ...video('a', 0, 0, US), speed }] }).success
    expect(parse(constant(2))).toBe(true)
    expect(parse(ramp)).toBe(true)
    expect(parse({ points: [] })).toBe(false)
    expect(parse({ points: [{ sourceUs: 5, rate: 1 }, { sourceUs: 5, rate: 2 }] })).toBe(false)
    expect(parse({ points: [{ sourceUs: 0, rate: 0.05 }] })).toBe(false)
    expect(parse({ points: [{ sourceUs: 0, rate: 11 }] })).toBe(false)
  })
})

describe('clip-update speed', () => {
  it('shortens a clip at 2× and ripples later clips on its track; undo-able as one project step', () => {
    const base = project([video('a', 0, 0, 10 * US), video('b', 10 * US, 0, 4 * US)])
    const next = run(base, { type: 'clip-update', clipId: 'a', changes: { speed: constant(2) } })
    expect(next.clips.map((clip) => [clip.id, clip.timelineStartUs, clipEndUs(clip)])).toEqual([['a', 0, 5 * US], ['b', 5 * US, 9 * US]])
    const back = run(next, { type: 'clip-update', clipId: 'a', changes: { speed: null } })
    expect(back.clips).toEqual(base.clips)
  })

  it('lengthens a clip at 0.5× without overlapping the next one', () => {
    const next = run(project([video('a', 0, 0, 10 * US), video('b', 10 * US, 0, 4 * US)]), { type: 'clip-update', clipId: 'a', changes: { speed: constant(0.5) } })
    expect(next.clips.map((clip) => [clip.id, clip.timelineStartUs, clipEndUs(clip)])).toEqual([['a', 0, 20 * US], ['b', 20 * US, 24 * US]])
  })

  it('refuses invalid points, image clips and locked tracks', () => {
    const base = project([video('a', 0, 0, 10 * US)])
    expect(applyItemCommand(base, { type: 'clip-update', clipId: 'a', changes: { speed: { points: [{ sourceUs: 0, rate: 50 }] } } }, context).ok).toBe(false)
    const locked = project([video('a', 0, 0, 10 * US)], [track('V1', 'video', true)])
    expect(applyItemCommand(locked, { type: 'clip-update', clipId: 'a', changes: { speed: constant(2) } }, context).ok).toBe(false)
  })
})

describe('edits on retimed clips', () => {
  const tracks = [track('V1', 'video')]
  it('splits at a timeline point without moving the curve, keeping total length', () => {
    const clips = [video('a', 0, 0, 10 * US, ramp)]
    const split = splitClip(tracks, clips, 'a', 3 * US, 'b')
    expect(split).toHaveLength(2)
    expect(split[0].sourceEndUs).toBe(split[1].sourceStartUs)
    expect((split[0] as Extract<Clip, { kind: 'video' }>).speed).toEqual(ramp)
    expect(Math.abs(timelineLengthUs(split[0]) + timelineLengthUs(split[1]) - timelineLengthUs(clips[0]))).toBeLessThanOrEqual(1)
    expect(split[1].timelineStartUs).toBe(3 * US)
  })

  it('trims the start edge by a timeline delta, mapping to the right source time', () => {
    const [trimmed] = trimClip(tracks, [video('a', 0, 0, 10 * US, constant(2))], 'a', 'start', 2 * US, 'overwrite', 20 * US)
    expect(trimmed.sourceStartUs).toBe(4 * US)
    expect(trimmed.timelineStartUs).toBe(2 * US)
    expect(clipEndUs(trimmed)).toBe(5 * US)
  })

  it('trims the end edge by a timeline delta and stops at the file end', () => {
    const [shorter] = trimClip(tracks, [video('a', 0, 0, 10 * US, constant(2))], 'a', 'end', -1 * US, 'overwrite', 20 * US)
    expect(shorter.sourceEndUs).toBe(8 * US)
    const [longer] = trimClip(tracks, [video('a', 0, 0, 10 * US, constant(2))], 'a', 'end', 100 * US, 'overwrite', 14 * US)
    expect(longer.sourceEndUs).toBe(14 * US)
  })

  it('ripple-trims by the retimed length change', () => {
    const clips = [video('a', 0, 0, 10 * US, constant(2)), video('b', 5 * US, 0, 4 * US)]
    const result = trimClip(tracks, clips, 'a', 'end', -1 * US, 'ripple', 20 * US)
    expect(result.find((clip) => clip.id === 'b')!.timelineStartUs).toBe(4 * US)
  })

  it('keeps kept ranges laid end to end at their retimed length', () => {
    const kept = keepRangesOfAsset(tracks, [video('a', 0, 0, 10 * US, constant(2))], 'x', [{ startUs: 0, endUs: 2 * US }, { startUs: 4 * US, endUs: 8 * US }], (() => { let n = 0; return () => `n${++n}` })())
    expect(kept.map((clip) => [clip.timelineStartUs, clipEndUs(clip)])).toEqual([[0, 1 * US], [1 * US, 3 * US]])
  })
})

describe('playback mapping', () => {
  it('shows the retimed source time under the playhead and the cue at the matching moment', () => {
    const base = project([video('a', 5 * US, 0, 10 * US, constant(2))])
    const [active] = activeClipsAt(7 * US, base.tracks, base.clips)
    expect(active.sourceUs).toBe(4 * US)
    // Cue 2–4 s of source plays at 2–4 s of source = sequence 6–7 s at 2×.
    expect(activeCueAt(6.5 * US, base.tracks, base.clips, base.cues)?.sourceUs).toBe(3 * US)
    expect(activeCueAt(7.5 * US, base.tracks, base.clips, base.cues)).toBeNull()
    expect(activeClipsAt(10 * US, base.tracks, base.clips)).toEqual([])
  })

  it('drives the element rate from the curve and mutes ramps only', () => {
    const steady = video('a', 0, 0, 10 * US, constant(2))
    const curved = video('b', 0, 0, 10 * US, ramp)
    expect(elementRateFor(steady, 5 * US, 1)).toBe(2)
    expect(elementRateFor(steady, 5 * US, 2)).toBe(4)
    expect(elementRateFor(curved, 2 * US, 1)).toBeCloseTo(2.5)
    expect(elementRateFor(video('c', 0, 0, US, constant(10)), 0, 3)).toBe(16)
    expect(silentForSpeed(steady)).toBe(false)
    expect(silentForSpeed(curved)).toBe(true)
    expect(silentForSpeed(video('d', 0, 0, US))).toBe(false)
  })
})

describe('presets', () => {
  it('lays every preset over a clip as a valid, ordered curve inside its range', () => {
    for (const preset of SPEED_PRESETS) {
      const speed = presetSpeed(preset, 3 * US, 13 * US)
      const parsed = projectSchema.safeParse({ ...project([]), clips: [{ ...video('a', 0, 3 * US, 13 * US), speed }] })
      expect(parsed.success, preset.id).toBe(true)
      expect(speed.points[0].sourceUs).toBe(3 * US)
      expect(speed.points[speed.points.length - 1].sourceUs).toBe(13 * US)
    }
  })
})

describe('timeline drawing', () => {
  it('samples ramp thumbnails evenly along the timeline, not the source', () => {
    const even = stripTimestamps(0, 10 * US, 4)
    const ramped = stripTimestamps(0, 10 * US, 4, ramp)
    expect(even).toHaveLength(4)
    expect(ramped).not.toEqual(even)
    expect(stripTimestamps(0, 10 * US, 4, constant(2))).toEqual(even)
  })

  it('resamples ramp peaks per timeline column and slices constant speed plainly', () => {
    const waveform = { range: { startUs: 0, endUs: 10 * US }, peaks: Array.from({ length: 100 }, (_, index) => index / 100) }
    expect(clipPeaks(waveform, { sourceStartUs: 0, sourceEndUs: 10 * US })).toHaveLength(100)
    expect(clipPeaks(waveform, { sourceStartUs: 0, sourceEndUs: 10 * US, speed: constant(2) })).toHaveLength(100)
    expect(clipPeaks(waveform, { sourceStartUs: 0, sourceEndUs: 10 * US, speed: ramp }).length).toBe(320)
  })
})
