import { describe, expect, it } from 'vitest'
import type { LegacyClip } from './edit'
import { loadProject, projectSchemaV4, type CaptionProjectV4, type Cue } from './model'
import { clipsContainingSource, cuesInSequence, sequenceDurationUs, sequenceUsOf } from './timelineModel'

// ---- Oracle: schema 4's own mapping, copied verbatim from the retired `sequence.ts` so these tests
// keep pinning "the migration does not move a single frame" after that module is gone. ----
type Span = { startUs: number; endUs: number; sourceStartUs: number; sourceEndUs: number }
const lengthOf = (range: { startUs: number; endUs: number }) => range.endUs - range.startUs
function v4Spans(range: { startUs: number; endUs: number }, assetId: string, clips: readonly LegacyClip[]): Span[] {
  const spans: Span[] = []
  let elapsed = 0
  for (const clip of clips) {
    if (clip.assetId === assetId) {
      const startUs = Math.max(range.startUs, clip.startUs)
      const endUs = Math.min(range.endUs, clip.endUs)
      if (endUs > startUs) spans.push({ startUs: elapsed + (startUs - clip.startUs), endUs: elapsed + (endUs - clip.startUs), sourceStartUs: startUs, sourceEndUs: endUs })
    }
    elapsed += lengthOf(clip)
  }
  return spans
}
function v4SourceToSequence(assetId: string, sourceUs: number, clips: readonly LegacyClip[]): { sequenceUs: number; kept: boolean } {
  let elapsed = 0
  for (const clip of clips) {
    if (clip.assetId === assetId && sourceUs >= clip.startUs && sourceUs < clip.endUs) return { sequenceUs: elapsed + (sourceUs - clip.startUs), kept: true }
    elapsed += lengthOf(clip)
  }
  return { sequenceUs: -1, kept: false }
}
function v4CuesInSequence(cues: readonly Cue[], clips: readonly LegacyClip[]): Cue[] {
  const result: Cue[] = []
  for (const cue of cues) {
    if (!cue.mediaAssetId) { result.push(cue); continue }
    const runs: Span[][] = []
    for (const span of v4Spans(cue, cue.mediaAssetId, clips)) {
      const run = runs[runs.length - 1]
      if (run && run[run.length - 1].endUs === span.startUs) run.push(span)
      else runs.push([span])
    }
    runs.forEach((run, runIndex) => {
      const startUs = run[0].startUs
      const endUs = run[run.length - 1].endUs
      const words = cue.words.flatMap((word) => {
        const inRun = v4Spans(word, cue.mediaAssetId!, clips).filter((span) => span.startUs >= startUs && span.endUs <= endUs)
        return inRun.length ? [{ ...word, startUs: inRun[0].startUs, endUs: inRun[inRun.length - 1].endUs }] : []
      })
      result.push({ ...cue, id: runIndex === 0 ? cue.id : `${cue.id}:${runIndex + 1}`, startUs, endUs, words })
    })
  }
  return result.sort((a, b) => a.startUs - b.startUs || a.endUs - b.endUs)
}

const dates = { createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }
const US = 1_000_000
const meta = (durationUs: number | null) => ({ durationUs, width: 1280, height: 720, rotationDegrees: 0, frameRate: { numerator: 25, denominator: 1 }, nominalFrameRate: null, streams: [] })
const asset = (id: string, kind: 'video' | 'image' | 'audio', durationUs: number | null = 60 * US) =>
  ({ id, kind, name: `${id}.bin`, reference: { relativePath: null, absolutePath: `/m/${id}` }, fingerprint: null, metadata: kind === 'image' ? null : meta(durationUs) })
const word = (id: string, startUs: number, endUs: number, text: string) => ({ id, startUs, endUs, text, timingSource: 'model' as const, needsReview: false })
const cue = (id: string, mediaAssetId: string, startUs: number, endUs: number, words: ReturnType<typeof word>[] = []): Cue =>
  ({ id, mediaAssetId, startUs, endUs, text: words.map((entry) => entry.text).join(' ') || id, timingSource: 'model', needsReview: false, textSource: 'model', words })
const rect = { x: 0, y: 0, width: 200, height: 100 }
const ids = () => { let serial = 0; return () => `m${++serial}` }

/** Two videos, cut, reordered and repeated: every awkward thing schema 4's flat list allowed. */
const fixture = (extra: Partial<CaptionProjectV4> = {}): CaptionProjectV4 => projectSchemaV4.parse({
  schemaVersion: 4, id: 'p', title: 'P', ...dates,
  assets: [asset('x', 'video'), asset('y', 'video', 20 * US), asset('img', 'image'), asset('snd', 'audio', 5 * US), asset('snd2', 'audio', null)],
  clips: [
    { id: 'c1', assetId: 'x', startUs: 0, endUs: 4 * US },
    { id: 'c2', assetId: 'x', startUs: 6 * US, endUs: 10 * US },
    { id: 'c3', assetId: 'y', startUs: 2 * US, endUs: 8 * US },
    { id: 'c4', assetId: 'x', startUs: 2 * US, endUs: 7 * US },
  ],
  cues: [
    cue('k1', 'x', 1 * US, 3 * US, [word('w1', 1 * US, 2 * US, 'ഒന്ന്'), word('w2', 2 * US, 3 * US, 'two')]),
    cue('k2', 'x', 3 * US, 7 * US), cue('k3', 'y', 1 * US, 5 * US), cue('k4', 'x', 12 * US, 13 * US),
  ],
  overlays: [], blurRegions: [], audioClips: [],
  ...extra,
})

describe('migrateV4', () => {
  it('lays schema 4 clips on V1 at their prefix sums: gapless, same order, same total length', () => {
    const v4 = fixture()
    const { project } = loadProject(v4, ids())
    const v1 = project.tracks[0]
    expect(project.clips.filter((clip) => clip.trackId === v1.id).map((clip) => [clip.id, clip.timelineStartUs, clip.sourceStartUs, clip.sourceEndUs]))
      .toEqual([['c1', 0, 0, 4 * US], ['c2', 4 * US, 6 * US, 10 * US], ['c3', 8 * US, 2 * US, 8 * US], ['c4', 14 * US, 2 * US, 7 * US]])
    expect(sequenceDurationUs(project.clips)).toBe(v4.clips.reduce((total, clip) => total + lengthOf(clip), 0))
  })

  it('does not move a single frame: captions render identically and every kept source time maps to the same sequence time', () => {
    const v4 = fixture()
    const { project } = loadProject(v4, ids())
    // `captionTrackId` (schema 6) is stamped by the 5 → 6 migration on top of this — irrelevant to
    // the timing fidelity this test checks, and the schema-4 oracle above knows nothing about it.
    const withoutCaptionTrack = (cues: readonly Cue[]) => cues.map(({ captionTrackId: _captionTrackId, ...rest }) => rest)
    expect(withoutCaptionTrack(cuesInSequence(project.cues, project.clips))).toEqual(v4CuesInSequence(v4.cues, v4.clips))
    for (const assetId of ['x', 'y']) {
      for (let sourceUs = 0; sourceUs < 12 * US; sourceUs += 250_000) {
        const before = v4SourceToSequence(assetId, sourceUs, v4.clips)
        const containing = clipsContainingSource(assetId, sourceUs, project.clips)
        expect(containing.length > 0).toBe(before.kept)
        if (!before.kept) continue
        // Schema 4 took the first clip in sequence order; schema 5 lists them all — the earliest is the same one.
        expect(Math.min(...containing.map((clip) => sequenceUsOf(clip, sourceUs)))).toBe(before.sequenceUs)
      }
    }
  })

  it('merges an overlay straddling a cut into one image clip and splits one across a reorder, saying so', () => {
    const v4 = fixture({ overlays: [
      { id: 'across-cut', mediaAssetId: 'x', startUs: 3 * US, endUs: 7 * US, assetId: 'img', rect, opacity: 1, fit: 'contain' },
    ] })
    const { project, migrationNotes } = loadProject(v4, ids())
    const images = project.clips.filter((clip) => clip.kind === 'image')
    // Source 3-4 plays at 3-4 and source 6-7 at 4-5: contiguous, so one clip. It also plays again in c4 (2-7 at 14-19): 15-19.
    expect(images.map((clip) => [clip.id, clip.timelineStartUs, clip.sourceEndUs - clip.sourceStartUs])).toEqual([['across-cut', 3 * US, 2 * US], ['m2', 15 * US, 4 * US]])
    expect(new Set(images.map((clip) => clip.trackId)).size).toBe(1)
    expect(migrationNotes).toEqual([expect.objectContaining({ kind: 'split', itemId: 'across-cut' })])
  })

  it('stacks time-overlapping overlays on separate tracks, later array entries on top', () => {
    const overlay = (id: string, startUs: number, endUs: number) => ({ id, mediaAssetId: 'x', startUs, endUs, assetId: 'img', rect, opacity: 1, fit: 'contain' as const })
    const { project } = loadProject(fixture({ overlays: [overlay('bottom', 0, 3 * US), overlay('top', 1 * US, 2 * US), overlay('apart', 3 * US, 4 * US)] }), ids())
    const trackIndex = (id: string) => project.tracks.findIndex((track) => track.id === project.clips.find((clip) => clip.id === id)!.trackId)
    expect(trackIndex('top')).toBeGreaterThan(trackIndex('bottom'))
    expect(trackIndex('bottom')).toBeGreaterThan(0)
    // Not overlapping anything earlier, so it shares the lowest overlay track.
    expect(trackIndex('apart')).toBe(trackIndex('bottom'))
  })

  it('moves sound effects to sequence time, resolving open-ended durations and reporting a placeholder', () => {
    const { project, migrationNotes } = loadProject(fixture({ audioClips: [
      { id: 'bed', assetId: 'snd', mediaAssetId: 'y', atUs: 3 * US, inPointUs: 1 * US, durationUs: null, gain: 0.5 },
      { id: 'hit', assetId: 'snd2', mediaAssetId: 'x', atUs: 7 * US, inPointUs: 0, durationUs: null, gain: 1 },
    ] }), ids())
    const audio = project.clips.filter((clip) => clip.kind === 'audio')
    // y's source 3s plays in c3 (2-8 at 8-14) at 9s; x's source 7s first plays in c2 (6-10 at 4-8) at 5s.
    expect(audio.map((clip) => [clip.id, clip.timelineStartUs, clip.sourceStartUs, clip.sourceEndUs])).toEqual([['hit', 5 * US, 0, 1 * US], ['bed', 9 * US, 1 * US, 5 * US]])
    expect(migrationNotes.map((note) => [note.kind, note.itemId])).toEqual([['duration-resolved', 'bed'], ['duration-placeholder', 'hit']])
  })

  it('parks — never drops — an overlay and a sound effect schema 4 no longer played', () => {
    const { project, migrationNotes } = loadProject(fixture({
      overlays: [{ id: 'gone', mediaAssetId: 'x', startUs: 10 * US, endUs: 11 * US, assetId: 'img', rect, opacity: 1, fit: 'contain' }],
      audioClips: [{ id: 'lost', assetId: 'snd', mediaAssetId: 'x', atUs: 11 * US, inPointUs: 0, durationUs: 1 * US, gain: 1 }],
    }), ids())
    const parkedTracks = project.tracks.filter((track) => track.name === 'Parked by migration')
    expect(parkedTracks.map((track) => [track.kind, track.hidden, track.muted])).toEqual([['video', true, true], ['audio', false, true]])
    expect(project.clips.find((clip) => clip.id === 'gone')?.trackId).toBe(parkedTracks[0].id)
    expect(project.clips.find((clip) => clip.id === 'lost')?.trackId).toBe(parkedTracks[1].id)
    expect(migrationNotes.filter((note) => note.kind === 'parked').map((note) => note.itemId)).toEqual(['gone', 'lost'])
  })
})
