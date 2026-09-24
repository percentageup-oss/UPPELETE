import { describe, expect, it } from 'vitest'
import type { CaptionTrack, Track } from './edit'
import { CAPTIONS_HEIGHT_PX, DIVIDER_HEIGHT_PX, MIN_TRACK_PX, RULER_HEIGHT_PX, TEXT_LANE_HEIGHT_PX, ZOOM_LANE_HEIGHT_PX, rowTops, timelineRows, trackAtY, trackRows } from './timelineLayout'

const track = (id: string, kind: Track['kind'], extra: Partial<Track> = {}): Track => ({ id, kind, name: '', muted: false, hidden: false, locked: false, ...extra })
const captionTrack = (id: string, extra: Partial<CaptionTrack> = {}): CaptionTrack => ({ id, name: '', locked: false, ...extra })

describe('timeline rows', () => {
  it('stacks caption tracks under the ruler, the zoom lane, video tracks top-down in reverse array order, then the divider, then audio tracks', () => {
    const rows = timelineRows([track('v1', 'video'), track('a1', 'audio'), track('v2', 'video')], [captionTrack('c1')], 400, .5)
    expect(rows.map((row) => row.kind === 'track' || row.kind === 'captionTrack' ? row.label : row.kind)).toEqual(['ruler', 'C1', 'textLane', 'zoomLane', 'V2', 'V1', 'divider', 'A1'])
  })

  it('always shows the one zoom lane, even with no caption tracks', () => {
    const rows = timelineRows([track('v1', 'video'), track('a1', 'audio')], [], 400, .5)
    expect(rows.some((row) => row.kind === 'zoomLane')).toBe(true)
  })

  it('gives every caption track its own row, at a fixed height', () => {
    const rows = timelineRows([track('v1', 'video'), track('a1', 'audio')], [captionTrack('c1'), captionTrack('c2', { name: 'Malayalam' })], 400, .5)
    expect(rows.map((row) => row.kind === 'captionTrack' ? [row.label, row.heightPx] : null).filter(Boolean))
      .toEqual([['C1', CAPTIONS_HEIGHT_PX], ['Malayalam', CAPTIONS_HEIGHT_PX]])
  })

  it('reserves no space for captions at all when the project has no caption track', () => {
    const rows = timelineRows([track('v1', 'video'), track('a1', 'audio')], [], 400, .5)
    expect(rows.some((row) => row.kind === 'captionTrack')).toBe(false)
  })

  it('splits the media area by the divider and gives every track at least the minimum', () => {
    const rows = timelineRows([track('v1', 'video'), track('v2', 'video'), track('a1', 'audio')], [captionTrack('c1')], 400, .5)
    const media = 400 - RULER_HEIGHT_PX - CAPTIONS_HEIGHT_PX - TEXT_LANE_HEIGHT_PX - ZOOM_LANE_HEIGHT_PX - DIVIDER_HEIGHT_PX
    expect(trackRows(rows)).toBe(`26px 44px ${TEXT_LANE_HEIGHT_PX}px ${ZOOM_LANE_HEIGHT_PX}px ${Math.floor(Math.round(media / 2) / 2)}px ${Math.floor(Math.round(media / 2) / 2)}px 8px ${media - Math.round(media / 2)}px`)
    expect(timelineRows([track('v1', 'video'), track('a1', 'audio')], [], 0, .5).filter((row) => row.kind === 'track').every((row) => row.heightPx >= MIN_TRACK_PX)).toBe(true)
  })

  it('honours a track’s own height', () => {
    const rows = timelineRows([track('v1', 'video', { heightPx: 120 }), track('a1', 'audio')], [], 400, .5)
    expect(rows.find((row) => row.id === 'v1')?.heightPx).toBe(120)
  })

  it('finds the track under the pointer for a cross-track drag, never a caption track or the zoom lane', () => {
    const rows = timelineRows([track('v1', 'video'), track('v2', 'video'), track('a1', 'audio')], [captionTrack('c1')], 400, .5)
    const tops = rowTops(rows)
    const v2 = rows.findIndex((row) => row.id === 'v2')
    expect(trackAtY(rows, tops[v2] + 1)?.id).toBe('v2')
    const c1 = rows.findIndex((row) => row.id === 'c1')
    expect(trackAtY(rows, tops[c1] + 1)).toBeNull()
    const zoomLane = rows.findIndex((row) => row.kind === 'zoomLane')
    expect(trackAtY(rows, tops[zoomLane] + 1)).toBeNull()
    expect(trackAtY(rows, 1)).toBeNull()
    expect(trackAtY(rows, 10_000)).toBeNull()
  })
})
