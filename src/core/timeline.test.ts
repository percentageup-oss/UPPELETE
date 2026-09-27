import { describe, expect, it } from 'vitest'
import { commitHistory, createHistory, redoHistory, undoHistory } from './history'
import type { CaptionProject, Cue } from './model'
import { anchoredScrollLeft, timelineViewSpanUs, TIMELINE_TAIL_MIN_US, cueDragBounds, dragCueBy, dragRangeBy, itemDragBounds, pixelToTime, rulerStep, snapDelta, timeToPixel, trimToPlayhead } from './timeline'
import type { CueDragMode } from './timeline'
import { applyCaptionCommand } from './captionCommands'

const cue = (extra: Partial<Cue> = {}): Cue => ({
  id: 'cue-a',
  startUs: 2_000_000,
  endUs: 4_000_000,
  text: 'ഇത് React ആണ്',
  timingSource: 'imported',
  needsReview: false,
  textSource: 'imported',
  words: [],
  ...extra,
})

const project = (item: Cue): CaptionProject => ({
  schemaVersion: 26,
  tracks: [],
  clips: [],
  assets: [],
  captionTracks: [], blurRegions: [], zoomRegions: [], effects: [], textOverlays: [], shapes: [], markers: [],
  id: 'project',
  title: 'Test',
  cues: [item],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})

describe('timeline time and pixel conversion', () => {
  it.each([1, 2, 8, 32])('round-trips canonical time at %sx zoom', (zoom) => {
    const durationUs = 73_123_456
    const widthPx = 900 * zoom
    const timeUs = 17_654_321
    expect(pixelToTime(timeToPixel(timeUs, durationUs, widthPx), durationUs, widthPx)).toBe(timeUs)
  })

  it('keeps the same source time under the pointer when zoom changes', () => {
    const durationUs = 60_000_000
    const anchorUs = 24_000_000
    const oldWidth = 1_000
    const oldScroll = 250
    const screenX = timeToPixel(anchorUs, durationUs, oldWidth) - oldScroll
    const nextScroll = anchoredScrollLeft(anchorUs, durationUs, oldWidth, oldScroll, 500, 4_000)
    expect(timeToPixel(anchorUs, durationUs, 4_000) - nextScroll).toBeCloseTo(screenX)
  })
})

describe('timeline drag clamping', () => {
  it('clamps whole-cue movement to media bounds and shifts words exactly', () => {
    const original = cue({
      words: [{ id: 'word-a', startUs: 2_200_000, endUs: 3_700_000, text: 'React', timingSource: 'aligned', needsReview: false }],
    })
    expect(dragCueBy(original, 'move', -9_000_000, 5_000_000)).toMatchObject({ startUs: 0, endUs: 2_000_000, words: [{ startUs: 200_000, endUs: 1_700_000 }] })
    expect(dragCueBy(original, 'move', 9_000_000, 5_000_000)).toMatchObject({ startUs: 3_000_000, endUs: 5_000_000, words: [{ startUs: 3_200_000, endUs: 4_700_000 }] })
  })

  it('keeps edge drags positive, in bounds, and containing timed words', () => {
    const original = cue({
      words: [{ id: 'word-a', startUs: 2_300_000, endUs: 3_600_000, text: 'React', timingSource: 'aligned', needsReview: false }],
    })
    expect(dragCueBy(original, 'start', 9_000_000, 5_000_000).startUs).toBe(2_300_000)
    expect(dragCueBy(original, 'end', -9_000_000, 5_000_000).endUs).toBe(3_600_000)
    expect(dragCueBy(cue(), 'start', 9_000_000, null).startUs).toBe(3_999_999)
    expect(dragCueBy(cue(), 'end', 9_000_000, 5_000_000).endUs).toBe(5_000_000)
  })

  it('commits a completed move as one undoable and redoable command', () => {
    const original = project(cue())
    const result = applyCaptionCommand(original, { type: 'shift-time', cueId: 'cue-a', deltaUs: 750_000 }, { mediaDurationUs: 8_000_000 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const committed = commitHistory(createHistory(original), result.project)
    expect(committed.past).toHaveLength(1)
    expect(committed.present.cues[0]).toMatchObject({ startUs: 2_750_000, endUs: 4_750_000 })
    expect(undoHistory(committed).present.cues[0]).toMatchObject({ startUs: 2_000_000, endUs: 4_000_000 })
    expect(redoHistory(undoHistory(committed)).present.cues[0]).toMatchObject({ startUs: 2_750_000, endUs: 4_750_000 })
  })

  it('preserves word timing source on a moved cue, so word-motion templates stay applied', () => {
    const original = project(cue({
      words: [{ id: 'word-a', startUs: 2_200_000, endUs: 3_700_000, text: 'React', timingSource: 'estimated', needsReview: true }],
    }))
    const result = applyCaptionCommand(original, { type: 'shift-time', cueId: 'cue-a', deltaUs: 750_000 }, { mediaDurationUs: 8_000_000 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project.cues[0].words[0]).toMatchObject({ startUs: 2_950_000, endUs: 4_450_000, timingSource: 'estimated' })
  })

  it('commits a completed edge drag as one undoable command', () => {
    const original = project(cue())
    const preview = dragCueBy(original.cues[0], 'end', -500_000, 8_000_000)
    const result = applyCaptionCommand(original, { type: 'update-time', cueId: 'cue-a', startUs: preview.startUs, endUs: preview.endUs }, { mediaDurationUs: 8_000_000 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const committed = commitHistory(createHistory(original), result.project)
    expect(committed.past).toHaveLength(1)
    expect(committed.present.cues[0].endUs).toBe(3_500_000)
    expect(undoHistory(committed).present.cues[0].endUs).toBe(4_000_000)
  })

  it('warns on a dragged overlap without changing the neighboring imported cue', () => {
    const first = cue({ id: 'first', startUs: 0, endUs: 2_000_000 })
    const neighbor = cue({ id: 'neighbor', startUs: 2_500_000, endUs: 4_000_000, text: 'Imported neighbor' })
    const original = { ...project(first), cues: [first, neighbor] }
    const preview = dragCueBy(first, 'end', 1_000_000, 5_000_000)
    const result = applyCaptionCommand(original, { type: 'update-time', cueId: first.id, startUs: preview.startUs, endUs: preview.endUs }, { mediaDurationUs: 5_000_000 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings).toEqual([expect.objectContaining({ kind: 'overlap', cueIds: ['first', 'neighbor'] })])
    expect(result.project.cues[1]).toEqual(neighbor)
  })
})

describe('ruler steps', () => {
  it('coarsens as more time is visible and keeps between three and eight labels across the visible span', () => {
    expect(rulerStep(60_000_000, 1)).toBe(10_000_000)
    expect(rulerStep(60_000_000, 8)).toBe(1_000_000)
    expect(rulerStep(60_000_000, 32)).toBe(250_000)
    expect(rulerStep(3 * 3_600_000_000, 1)).toBe(5 * 60_000_000)
    for (const zoom of [1, 2, 4, 8, 16, 32]) {
      const labels = 60_000_000 / zoom / rulerStep(60_000_000, zoom)
      expect(labels).toBeGreaterThanOrEqual(3)
      expect(labels).toBeLessThanOrEqual(8)
    }
  })
})

describe('snapping', () => {
  const targets = [1_000_000, 5_000_000, 9_000_000]

  it('lands an edge drag on the nearest target inside the threshold only', () => {
    expect(snapDelta({ startUs: 1_120_000, endUs: 3_000_000 }, 'start', targets, 200_000)).toBe(-120_000)
    expect(snapDelta({ startUs: 1_120_000, endUs: 3_000_000 }, 'start', targets, 100_000)).toBe(0)
    expect(snapDelta({ startUs: 1_120_000, endUs: 4_950_000 }, 'end', targets, 200_000)).toBe(50_000)
    expect(snapDelta({ startUs: 1_120_000, endUs: 4_950_000 }, 'end', [], 200_000)).toBe(0)
  })

  it('snaps whichever edge of a moved cue is closer and preserves duration through dragCueBy', () => {
    const original = cue({ startUs: 0, endUs: 2_000_000 })
    const deltaUs = 3_100_000 // preview 3.1s–5.1s: end is 100ms from the 5s target, start 2.1s from it
    const preview = dragCueBy(original, 'move', deltaUs, null)
    const extra = snapDelta(preview, 'move', targets, 150_000)
    expect(extra).toBe(-100_000)
    const snapped = dragCueBy(original, 'move', deltaUs + extra, null)
    expect(snapped).toMatchObject({ startUs: 3_000_000, endUs: 5_000_000 })
  })

  it('still respects media bounds and word containment after snapping', () => {
    const original = cue({ words: [{ id: 'w', startUs: 2_300_000, endUs: 3_600_000, text: 'React', timingSource: 'aligned', needsReview: false }] })
    const preview = dragCueBy(original, 'start', 250_000, 5_000_000)
    const extra = snapDelta(preview, 'start', [2_400_000], 200_000)
    expect(dragCueBy(original, 'start', 250_000 + extra, 5_000_000).startUs).toBe(2_300_000)
    expect(dragCueBy(original, 'end', 900_000 + snapDelta(dragCueBy(original, 'end', 900_000, 5_000_000), 'end', [5_050_000], 200_000), 5_000_000).endUs).toBe(5_000_000)
  })
})

describe('trim to playhead', () => {
  it('moves the start when the playhead is before or in the first half of the cue', () => {
    expect(trimToPlayhead({ startUs: 2_000_000, endUs: 4_000_000 }, 1_000_000)).toEqual({ startUs: 1_000_000, endUs: 4_000_000 })
    expect(trimToPlayhead({ startUs: 2_000_000, endUs: 4_000_000 }, 2_800_000)).toEqual({ startUs: 2_800_000, endUs: 4_000_000 })
  })

  it('moves the end when the playhead is after or in the second half of the cue', () => {
    expect(trimToPlayhead({ startUs: 2_000_000, endUs: 4_000_000 }, 3_200_000)).toEqual({ startUs: 2_000_000, endUs: 3_200_000 })
    expect(trimToPlayhead({ startUs: 2_000_000, endUs: 4_000_000 }, 6_000_000)).toEqual({ startUs: 2_000_000, endUs: 6_000_000 })
  })

  it('leaves the cue unchanged when the playhead already sits on a boundary', () => {
    expect(trimToPlayhead({ startUs: 2_000_000, endUs: 4_000_000 }, 4_000_000)).toEqual({ startUs: 2_000_000, endUs: 4_000_000 })
    expect(trimToPlayhead({ startUs: 2_000_000, endUs: 4_000_000 }, 2_000_000)).toEqual({ startUs: 2_000_000, endUs: 4_000_000 })
    expect(trimToPlayhead({ startUs: 0, endUs: 1 }, -5)).toEqual({ startUs: 0, endUs: 1 })
  })
})

describe('generic range dragging', () => {
  const timed = cue({
    words: [{ id: 'word-a', startUs: 2_200_000, endUs: 3_700_000, text: 'React', timingSource: 'aligned', needsReview: false }],
  })
  const modes: CueDragMode[] = ['move', 'start', 'end']
  const deltas = [-9_000_000, -1_500_000, -1, 0, 1, 1_500_000, 9_000_000]
  const durations = [null, 5_000_000, 8_000_000]

  // dragCueBy is now a thin wrapper, so the generic primitive must agree with it on every case the
  // cue-specific tests above cover, plus the whole surrounding grid of modes/deltas/media bounds.
  it.each(durations)('reproduces every dragCueBy edge result at mediaDurationUs=%s', (mediaDurationUs) => {
    for (const original of [cue(), timed]) {
      for (const mode of modes) for (const deltaUs of deltas) {
        const wrapper = dragCueBy(original, mode, deltaUs, mediaDurationUs)
        const generic = dragRangeBy(original, mode, deltaUs, cueDragBounds(original, mediaDurationUs))
        expect(generic).toEqual({ startUs: wrapper.startUs, endUs: wrapper.endUs })
      }
    }
  })

  it('preserves duration through a clamped move and leaves the other edge alone on a resize', () => {
    const bounds = itemDragBounds({ startUs: 2_000_000, endUs: 4_000_000 }, 5_000_000)
    const moved = dragRangeBy({ startUs: 2_000_000, endUs: 4_000_000 }, 'move', 9_000_000, bounds)
    expect(moved).toEqual({ startUs: 3_000_000, endUs: 5_000_000 })
    expect(dragRangeBy({ startUs: 2_000_000, endUs: 4_000_000 }, 'start', -9_000_000, bounds)).toEqual({ startUs: 0, endUs: 4_000_000 })
    expect(dragRangeBy({ startUs: 2_000_000, endUs: 4_000_000 }, 'end', 9_000_000, bounds)).toEqual({ startUs: 2_000_000, endUs: 5_000_000 })
  })

  it('never lets a generic item collapse below its minimum duration', () => {
    const bounds = itemDragBounds({ startUs: 2_000_000, endUs: 4_000_000 }, null, 500_000)
    expect(dragRangeBy({ startUs: 2_000_000, endUs: 4_000_000 }, 'start', 9_000_000, bounds).startUs).toBe(3_500_000)
    expect(dragRangeBy({ startUs: 2_000_000, endUs: 4_000_000 }, 'end', -9_000_000, bounds).endUs).toBe(2_500_000)
  })
})

describe('timeline view span', () => {
  it('adds at least the minimum tail to a short program', () => {
    expect(timelineViewSpanUs(10_000_000)).toBe(10_000_000 + TIMELINE_TAIL_MIN_US)
  })
  it('adds a quarter of a long program', () => {
    expect(timelineViewSpanUs(400_000_000)).toBe(500_000_000)
  })
  it('never shrinks below the program', () => {
    expect(timelineViewSpanUs(0)).toBe(TIMELINE_TAIL_MIN_US)
    expect(timelineViewSpanUs(-5)).toBe(TIMELINE_TAIL_MIN_US)
  })
})
