import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Timeline } from './Timeline'
import type { Cue } from './core/model'
import type { TimeRange } from './core/sequence'

const MEDIA = 10_000_000
const cue = (extra: Partial<Cue> & Pick<Cue, 'id' | 'startUs' | 'endUs'>): Cue => ({
  text: 'ഇത് React ആണ്', timingSource: 'imported', needsReview: false, textSource: 'imported', words: [], ...extra,
})

const actions = { addLine: () => {}, addWord: () => {}, merge: () => {}, previous: () => {}, next: () => {}, delete: () => {}, split: () => {}, trim: () => {} }

const render = (overrides: Partial<Parameters<typeof Timeline>[0]> = {}) => renderToStaticMarkup(
  <Timeline cues={[cue({ id: 'a', startUs: 2_000_000, endUs: 4_000_000 })]} currentUs={0} durationUs={MEDIA}
    mediaDurationUs={MEDIA} fingerprint={null} selection={null} warningCueIds={new Set()} mediaName="clip.mp4"
    waveform={null} waveformStatus={null} onSeek={() => {}} onDragPreview={() => {}} onDragCommit={() => {}}
    display="line" onDisplay={() => {}} selectedWordId={null} onSelectWord={() => {}} actions={actions}
    canSplit={false} canMerge={false} canAdd hasSelectedWord={false} {...overrides} />)

describe('dynamic track rows', () => {
  it('drives the grid from the tracks list rather than fixed CSS variables', () => {
    const html = render()
    // Both grid containers (labels and content) get the same five rows, in order.
    const rows = [...html.matchAll(/grid-template-rows:([^;"]+)/g)].map((match) => match[1].trim())
    expect(rows).toHaveLength(2)
    expect(rows[0]).toBe(rows[1])
    expect(rows[0].split(/\s+/)).toHaveLength(5)
    expect(rows[0]).toMatch(/^26px 44px /)
    // The old per-track CSS variables are gone; only the ruler offset survives, for the gridlines.
    expect(html).not.toContain('--captions-h')
    expect(html).not.toContain('--video-h')
    expect(html).toContain('--ruler-h')
  })

  it('still labels the caption, video and audio rows', () => {
    const html = render()
    expect(html).toContain('Captions')
    expect(html).toContain('Video 1')
    expect(html).toContain('Audio 1')
  })
})

describe('sequence-time geometry', () => {
  it('places a cue block by its source time when there are no cuts', () => {
    const html = render()
    expect(html).toContain('left:20%')
    expect(html).toContain('width:20%')
  })

  it('shortens the timeline and shifts blocks left once a range is removed', () => {
    // Keeping 0-1s and 5-10s removes 4s, so the 6s output timeline places the 5-6s cue at 1-2s.
    const segments: TimeRange[] = [{ startUs: 0, endUs: 1_000_000 }, { startUs: 5_000_000, endUs: 10_000_000 }]
    const html = render({ cues: [cue({ id: 'a', startUs: 5_000_000, endUs: 6_000_000 })], segments, durationUs: 6_000_000 })
    expect(html).toContain('left:16.666666666666668%')
    expect(html).toContain('width:16.666666666666668%')
  })

  it('draws a cue straddling a cut as several blocks that are still one cue', () => {
    const segments: TimeRange[] = [{ startUs: 0, endUs: 2_000_000 }, { startUs: 4_000_000, endUs: 10_000_000 }]
    const html = render({ cues: [cue({ id: 'a', startUs: 1_000_000, endUs: 5_000_000 })], segments, durationUs: 8_000_000 })
    const blocks = [...html.matchAll(/class="cue-block /g)] // a trailing space, so cue-block-text does not match
    expect(blocks).toHaveLength(2)
    expect(html).toContain('part 1 of 2')
    expect(html).toContain('part 2 of 2')
    // Exactly one start handle and one end handle, on the outer edges, so it drags as one cue.
    expect([...html.matchAll(/data-handle="start"/g)]).toHaveLength(1)
    expect([...html.matchAll(/data-handle="end"/g)]).toHaveLength(1)
  })

  it('marks the selected cue only when the selection is of kind cue', () => {
    expect(render({ selection: { kind: 'cue', id: 'a' } })).toMatch(/class="cue-block active/)
    expect(render({ selection: { kind: 'overlay', id: 'a' } })).not.toMatch(/class="cue-block active/)
  })
})

describe('waveform and cut markers', () => {
  const waveform = { range: { startUs: 0, endUs: MEDIA }, peaks: Array.from({ length: 10 }, (_, index) => index / 10) }

  it('draws one waveform svg covering the whole track when there are no cuts', () => {
    const html = render({ waveform })
    expect([...html.matchAll(/class="waveform"/g)]).toHaveLength(1)
    expect(html).toContain('viewBox="0 0 10 2"')
    expect(html).not.toContain('cut-marker')
  })

  it('splits the waveform into one svg per kept segment and marks each cut', () => {
    const segments: TimeRange[] = [{ startUs: 0, endUs: 2_000_000 }, { startUs: 5_000_000, endUs: 10_000_000 }]
    const html = render({ waveform, segments, durationUs: 7_000_000, cues: [] })
    expect([...html.matchAll(/class="waveform"/g)]).toHaveLength(2)
    expect([...html.matchAll(/class="cut-marker"/g)]).toHaveLength(1)
    expect(html).toContain('Removed 00:03')
  })
})

describe('bin/file drop', () => {
  it('draws no drop indicator until something is actually dragged over the timeline', () => {
    expect(render()).not.toContain('drop-indicator')
    expect(render({ onDropAsset: () => {}, onDropFiles: () => {} })).not.toContain('drop-indicator')
  })
})
