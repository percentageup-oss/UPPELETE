import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Timeline } from './Timeline'
import type { Cue } from './core/model'
import type { CaptionTrack, Clip, Marker, ProjectAsset, Track } from './core/edit'
import { defaultTextOverlay } from './core/textCommands'
import { defaultShape } from './core/shapeCommands'

const US = 1_000_000
const cue = (extra: Partial<Cue> & Pick<Cue, 'id' | 'startUs' | 'endUs'>): Cue => ({
  mediaAssetId: 'x', captionTrackId: 'C1', text: 'ഇത് React ആണ്', timingSource: 'imported', needsReview: false, textSource: 'imported', words: [], ...extra,
})
const track = (id: string, kind: Track['kind'], extra: Partial<Track> = {}): Track => ({ id, kind, name: '', muted: false, hidden: false, locked: false, ...extra })
const captionTrack = (id: string, extra: Partial<CaptionTrack> = {}): CaptionTrack => ({ id, name: '', locked: false, ...extra })
const video = (id: string, timelineStartUs: number, sourceStartUs: number, sourceEndUs: number): Clip =>
  ({ kind: 'video', id, trackId: 'V1', assetId: 'x', timelineStartUs, sourceStartUs, sourceEndUs, opacity: 1, fit: 'contain', gain: 1 })
const asset = (id: string, kind: ProjectAsset['kind']): ProjectAsset =>
  ({ id, kind, name: `${id}.mp4`, reference: { relativePath: null, absolutePath: `/m/${id}` }, fingerprint: null, metadata: null })

const actions = { addLine: () => {}, addWord: () => {}, merge: () => {}, previous: () => {}, next: () => {}, delete: () => {}, split: () => {}, trim: () => {} }
const clipTools = { split: () => {}, canSplit: false, trimTo: () => {}, canTrimTo: false, markIn: () => {}, markOut: () => {}, clearRange: () => {}, hasRange: false, remove: () => {}, hasClip: false }
const trackActions = { onUpdate: () => {}, onReorder: () => {}, onRemove: () => {}, onAdd: () => {} }
const captionTrackActions = { onUpdate: () => {}, onReorder: () => {}, onRemove: () => {}, onAdd: () => {} }

const render = (overrides: Partial<Parameters<typeof Timeline>[0]> = {}) => renderToStaticMarkup(
  <Timeline cues={[cue({ id: 'a', startUs: 2 * US, endUs: 4 * US })]} tracks={[track('V1', 'video'), track('A1', 'audio')]}
    captionTracks={[captionTrack('C1')]}
    clips={[video('c1', 0, 0, 10 * US)]} assets={[asset('x', 'video'), asset('s', 'audio')]} currentUs={0} durationUs={10 * US}
    selection={null} warningCueIds={new Set()} waveforms={new Map()} waveformStatus={null}
    onSeek={() => {}} onDragPreview={() => {}} onDragCommit={() => {}} editMode="overwrite" onEditMode={() => {}}
    onSelectClip={() => {}} onClipMove={() => {}} onClipClone={() => {}} onClipTrim={() => {}} onCloseGap={() => {}}
    trackActions={trackActions} captionTrackActions={captionTrackActions} assetDurationUs={() => null}
    display="line" onDisplay={() => {}} selectedWordId={null} onSelectWord={() => {}} actions={actions} clipTools={clipTools}
    canSplit={false} canMerge={false} canAdd hasSelectedWord={false} {...overrides} />)

const marker = (id: string, atUs: number, extra: Partial<Marker> = {}): Marker => ({ id, atUs, text: '', ...extra })

describe('authored text lane', () => {
  it('keeps the text lane add action visible and accessible', () => {
    const html = render({ onAddText: () => {}, textOverlays: [defaultTextOverlay('title', 0, 3 * US)] })
    expect(html).toMatch(/aria-label="Add text at playhead"/)
    expect(html).toContain('class="track text-lane"')
  })
})

describe('graphics lane', () => {
  it('shows no lane without shapes and a labelled, selectable one with them', () => {
    expect(render()).not.toContain('Graphics timeline')
    const html = render({ shapes: [defaultShape('arrow', 'a1', 0, 3 * US), defaultShape('box', 'b1', US, 2 * US)], selection: { kind: 'shape', id: 'a1' } })
    expect(html).toContain('aria-label="Graphics timeline"')
    expect(html).toContain('data-item-kind="shape"')
    expect(html).toMatch(/aria-pressed="true"[^>]*aria-label="Shape Arrow/)
    // The two overlap in time, so they stack on separate rows.
    expect(html).toContain('top:2px')
    expect(html).toContain('top:20px')
  })
})

describe('ruler markers', () => {
  it('renders a marker diamond positioned at its sequence time, with its text as the title', () => {
    const html = render({ markers: [marker('m1', 5 * US, { text: 'insert logo here' })], durationUs: 10 * US })
    expect(html).toContain('class="ruler-marker"')
    expect(html).toContain('title="insert logo here"')
    expect(html).toMatch(/class="ruler-marker" aria-label="Marker: insert logo here" aria-pressed="false" title="insert logo here" style="left:50%/)
  })

  it('marks the selected marker as pressed and falls back to the timestamp as the title when text is empty', () => {
    const html = render({ markers: [marker('m1', 0)], selection: { kind: 'marker', id: 'm1' } })
    expect(html).toMatch(/aria-label="Marker" aria-pressed="true"/)
    expect(html).toContain('title="00:00.000"')
  })

  it('renders no markers by default', () => {
    expect(render()).not.toContain('ruler-marker')
  })
})

describe('track rows from project.tracks', () => {
  it('drives the label and content grids from the same rows: ruler, captions, video tracks, divider, audio tracks', () => {
    const html = render({ tracks: [track('V1', 'video'), track('V2', 'video'), track('A1', 'audio')] })
    const rows = [...html.matchAll(/grid-template-rows:([^;"]+)/g)].map((match) => match[1].trim())
    expect(rows).toHaveLength(2)
    expect(rows[0]).toBe(rows[1])
    expect(rows[0].split(/\s+/)).toHaveLength(8)
    expect(rows[0]).toMatch(/^26px 44px /)
    expect(html).toContain('--ruler-h')
  })

  it('labels the rows V2 above V1, then A1, with the add-track controls', () => {
    const html = render({ tracks: [track('V1', 'video'), track('V2', 'video'), track('A1', 'audio', { name: 'Music' })] })
    expect(html.indexOf('>V2<')).toBeLessThan(html.indexOf('>V1<'))
    expect(html).toContain('Music')
    expect(html).toContain('Add video track')
    expect(html).toContain('Add audio track')
  })
})

describe('caption tracks on the timeline', () => {
  it('draws one row per caption track, routing each cue only into its own track’s row', () => {
    const html = render({
      captionTracks: [captionTrack('C1'), captionTrack('C2', { name: 'Malayalam' })],
      cues: [
        cue({ id: 'a', startUs: 2 * US, endUs: 4 * US, captionTrackId: 'C1', text: 'English line' }),
        cue({ id: 'b', startUs: 5 * US, endUs: 6 * US, captionTrackId: 'C2', text: 'മലയാളം വരി' }),
      ],
    })
    const rows = [...html.matchAll(/grid-template-rows:([^;"]+)/g)].map((match) => match[1].trim())
    expect(rows[0].split(/\s+/)).toHaveLength(8) // ruler, C1, C2, text, zoom, V1, divider, A1
    expect(html).toContain('Malayalam')
    expect([...html.matchAll(/class="cue-block /g)]).toHaveLength(2)
    const c1Start = html.indexOf('track captions')
    const c2Start = html.indexOf('track captions', c1Start + 1)
    const c1Row = html.slice(c1Start, c2Start)
    const c2Row = html.slice(c2Start, html.indexOf('track video'))
    expect(c1Row).toContain('English line')
    expect(c1Row).not.toContain('മലയാളം വരി')
    expect(c2Row).toContain('മലയാളം വരി')
    expect(c2Row).not.toContain('English line')
  })

  it('reserves no row at all when the project has no caption track', () => {
    const html = render({ captionTracks: [], cues: [] })
    expect(html).not.toContain('track captions')
  })

  it('locks a caption track’s cues against dragging: no handles, a locked class, disabled remove while it holds captions', () => {
    const html = render({ captionTracks: [captionTrack('C1', { locked: true })] })
    expect(html).toMatch(/class="track captions line locked"/)
    // Scoped to the captions row: the video clip below has its own (unrelated) trim handles.
    const captionsRow = html.slice(html.indexOf('track captions'), html.indexOf('track video'))
    expect(captionsRow).not.toContain('data-handle')
  })
})

describe('zoom lane', () => {
  it('renders the permanent lane and a selected sequence-timed region', () => {
    const html = render({ zoomRegions: [{ id: 'z1', startUs: US, endUs: 3 * US, rect: { x: 0, y: 0, width: 540, height: 303.75 }, easeInUs: 500_000, easeOutUs: 500_000, enabled: true }], selection: { kind: 'zoomRegion', id: 'z1' } })
    expect(html).toContain('class="track zoom-lane"')
    expect(html).toContain('class="zoom-block active')
    expect(html).toContain('aria-label="Effect region, 00:01 to 00:03"')
  })

  it('marks a bypassed region as disabled, in its class and its accessible name', () => {
    const html = render({ zoomRegions: [{ id: 'z1', startUs: US, endUs: 3 * US, rect: { x: 0, y: 0, width: 540, height: 303.75 }, easeInUs: 500_000, easeOutUs: 500_000, enabled: false }] })
    expect(html).toMatch(/class="zoom-block[^"]*\bdisabled\b/)
    expect(html).toContain('aria-label="Effect region, 00:01 to 00:03, bypassed"')
  })

  it('labels the timeline track header "Zoom", now that blur has its own lane too', () => {
    const html = render({ zoomRegions: [] })
    expect(html).toMatch(/class="track-label track-header zoom-lane-header">.*?<span class="track-name">Zoom<\/span>/)
  })
})

describe('blur lane', () => {
  it('is absent from the timeline when the project has no blur region', () => {
    const html = render({ blurRegions: [] })
    expect(html).not.toContain('blur-lane-header')
    expect(html).not.toContain('class="track blur-lane"')
  })

  it('appears, labeled "Blur", only once the project has a blur region', () => {
    const html = render({ blurRegions: [{ id: 'b1', startUs: US, endUs: 3 * US, rect: { x: 0, y: 0, width: 360, height: 202.5 }, radius: 24, enabled: true }] })
    expect(html).toMatch(/class="track-label track-header blur-lane-header">.*?<span class="track-name">Blur<\/span>/)
    expect(html).toContain('class="track blur-lane"')
    expect(html).toContain('aria-label="Blur region, 00:01 to 00:03"')
  })

  it('marks a bypassed blur region as disabled, in its class and its accessible name', () => {
    const html = render({ blurRegions: [{ id: 'b1', startUs: US, endUs: 3 * US, rect: { x: 0, y: 0, width: 360, height: 202.5 }, radius: 24, enabled: false }] })
    expect(html).toMatch(/class="zoom-block blur-block[^"]*\bdisabled\b/)
    expect(html).toContain('aria-label="Blur region, 00:01 to 00:03, bypassed"')
  })
})

describe('captions seen through clips', () => {
  it('places a caption by where its clip plays it', () => {
    const html = render()
    expect(html).toContain('left:20%')
    expect(html).toContain('width:20%')
  })

  it('shifts captions with a cut: kept 0-1s then 5-10s puts source 5-6s at 1-2s of a 6s sequence', () => {
    const html = render({ cues: [cue({ id: 'a', startUs: 5 * US, endUs: 6 * US })], clips: [video('c1', 0, 0, US), video('c2', US, 5 * US, 10 * US)], durationUs: 6 * US })
    expect(html).toContain('left:16.666666666666668%')
    expect(html).toContain('width:16.666666666666668%')
  })

  it('draws a caption straddling a cut as several blocks that are still one caption', () => {
    const html = render({ cues: [cue({ id: 'a', startUs: 1 * US, endUs: 5 * US })], clips: [video('c1', 0, 0, 2 * US), video('c2', 2 * US, 4 * US, 10 * US)], durationUs: 8 * US })
    expect([...html.matchAll(/class="cue-block /g)]).toHaveLength(2)
    expect(html).toContain('part 1 of 2')
    expect(html).toContain('part 2 of 2')
    const captionRow = html.slice(html.indexOf('track captions'), html.indexOf('track video'))
    expect([...captionRow.matchAll(/data-handle="start"/g)]).toHaveLength(1)
    expect([...captionRow.matchAll(/data-handle="end"/g)]).toHaveLength(1)
  })

  it('hides captions of a hidden track’s video, and marks the selected caption only for a cue selection', () => {
    expect(render({ tracks: [track('V1', 'video', { hidden: true }), track('A1', 'audio')] })).not.toContain('class="cue-block')
    expect(render({ selection: { kind: 'cue', id: 'a' } })).toMatch(/class="cue-block active/)
    expect(render({ selection: { kind: 'clip', id: 'a' } })).not.toMatch(/class="cue-block active/)
  })
})

describe('clips', () => {
  const waveform = { range: { startUs: 0, endUs: 10 * US }, peaks: Array.from({ length: 10 }, (_, index) => index / 10) }

  it('draws each clip with its label, selection and its own slice of the waveform', () => {
    const html = render({ clips: [video('c1', 0, 0, 4 * US), video('c2', 6 * US, 6 * US, 10 * US)], waveforms: new Map([['x', waveform]]), selection: { kind: 'clip', id: 'c2' } })
    expect([...html.matchAll(/class="clip-block video/g)]).toHaveLength(2)
    expect(html).toMatch(/class="clip-block video active/)
    expect([...html.matchAll(/viewBox="0 0 4 2"/g)]).toHaveLength(2)
    expect(html).toContain('x.mp4')
  })

  it('offers to close a gap, but not on a locked track', () => {
    const clips = [video('c1', 0, 0, 4 * US), video('c2', 6 * US, 6 * US, 10 * US)]
    expect(render({ clips })).toContain('Close gap')
    expect(render({ clips, tracks: [track('V1', 'video', { locked: true }), track('A1', 'audio')] })).not.toContain('Close gap')
  })

  it('draws no drop indicator until something is dragged over the timeline', () => {
    expect(render({ onDropAsset: () => {}, onDropFiles: () => {} })).not.toContain('drop-indicator')
  })
})
