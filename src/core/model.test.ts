import { describe, expect, it } from 'vitest'
import { createProject, loadProject, migrateV3, projectSchema, projectSchemaV3, projectSchemaV4 } from './model'

const dates = { createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }
/** Schema 4's edit lists as a migration or a `.default([])` parse produces them: empty. */
const v4Edits = { assets: [], overlays: [], blurRegions: [], audioClips: [], clips: [] }

const asset = (id: string, kind: 'image' | 'audio', durationUs: number | null = null) => ({
  id, kind, name: `${id}.bin`, reference: { relativePath: null, absolutePath: `/assets/${id}.bin` },
  fingerprint: null, metadata: durationUs === null ? null : { durationUs, width: null, height: null, rotationDegrees: null, frameRate: null, nominalFrameRate: null, streams: [] },
})
const rect = { x: 100, y: 50, width: 320, height: 180 }
const metadata = { durationUs: 10_000_000, width: 1920, height: 1080, rotationDegrees: 0, frameRate: null, nominalFrameRate: null, streams: [] }
const mediaWithDuration = { name: 'clip.mp4', reference: { relativePath: null, absolutePath: '/clip.mp4' }, fingerprint: null, metadata }
const video = (id: string, durationUs: number | null = 10_000_000) => ({
  id, kind: 'video' as const, name: `${id}.mp4`, reference: { relativePath: null, absolutePath: `/${id}.mp4` }, fingerprint: null,
  metadata: { ...metadata, durationUs },
})
const cueOf = (id: string, extra: object = {}) =>
  ({ id, startUs: 0, endUs: 2_000_000, text: 'ആദ്യ വാചകം', timingSource: 'imported', needsReview: false, textSource: 'imported', words: [], ...extra })
/** A deterministic id source, so a migration's minted ids are assertable. */
const ids = () => { let serial = 0; return () => `minted-${++serial}` }
const trackOf = (id: string, kind: 'video' | 'audio', extra: object = {}) => ({ id, kind, name: '', muted: false, hidden: false, locked: false, ...extra })

describe('project schema migration', () => {
  it('migrates schema 1 media paths without fabricating metadata or fingerprints', () => {
    const loaded = loadProject({ schemaVersion: 1, id: 'legacy', title: 'Legacy', media: { name: 'വീഡിയോ clip.mp4', path: '/Media folder/വീഡിയോ clip.mp4' }, cues: [], ...dates }, ids())
    expect(loaded.migratedFrom).toBe(1)
    expect(loaded.project.schemaVersion).toBe(5)
    // The old media becomes a video asset carrying exactly what was stored: no invented probe data.
    expect(loaded.project.assets).toEqual([{
      id: 'minted-1', kind: 'video', name: 'വീഡിയോ clip.mp4',
      reference: { relativePath: null, absolutePath: '/Media folder/വീഡിയോ clip.mp4' }, fingerprint: null, metadata: null,
    }])
    // Its duration was never probed, so there is nothing to build a whole-video clip from yet, nor a format.
    expect(loaded.project.clips).toEqual([])
    expect(loaded.project.format).toBeUndefined()
    expect(projectSchema.parse(loaded.project)).toEqual(loaded.project)
  })

  it('migrates schema 2 to 5 leaving captions untouched, with the default V1 and A1 tracks', () => {
    const cues = [cueOf('c1')]
    const v2 = { schemaVersion: 2, id: 'p', title: 'P', media: null, cues, captionDisplay: 'word', ...dates }
    const loaded = loadProject(v2, ids())
    expect(loaded.migratedFrom).toBe(2)
    const { media: _media, ...rest } = v2
    expect(loaded.project).toEqual({
      ...rest, schemaVersion: 5, assets: [], clips: [], blurRegions: [],
      tracks: [trackOf('minted-1', 'video'), trackOf('minted-2', 'audio')],
    })
    expect(loaded.project.cues).toEqual(cues)
    expect(loaded.migrationNotes).toEqual([])
  })

  it('migrates a schema 3 project with media through 4 to 5: V1 clip, bound captions, sequence-time items', () => {
    const v3 = {
      schemaVersion: 3, id: 'p', title: 'P', media: mediaWithDuration, cues: [cueOf('c1')],
      assets: [asset('img-1', 'image'), asset('snd-1', 'audio', 3_000_000)],
      overlays: [{ id: 'ov-1', startUs: 0, endUs: 1_000_000, assetId: 'img-1', rect }],
      audioClips: [{ id: 'sfx-1', assetId: 'snd-1', atUs: 500_000 }], ...dates,
    }
    const loaded = loadProject(v3, ids())
    expect(loaded.migratedFrom).toBe(3)
    const { project } = loaded
    expect(project.schemaVersion).toBe(5)
    expect(project).not.toHaveProperty('media')
    expect(project).not.toHaveProperty('overlays')
    expect(project.assets.map((entry) => [entry.id, entry.kind])).toEqual([['minted-1', 'video'], ['img-1', 'image'], ['snd-1', 'audio']])
    const [v1, v2, a1] = project.tracks
    expect(project.tracks.map((track) => track.kind)).toEqual(['video', 'video', 'audio'])
    expect(project.clips).toEqual([
      { kind: 'video', id: 'minted-2', trackId: v1.id, assetId: 'minted-1', timelineStartUs: 0, sourceStartUs: 0, sourceEndUs: 10_000_000, opacity: 1, fit: 'contain', gain: 1 },
      { kind: 'image', id: 'ov-1', trackId: v2.id, assetId: 'img-1', timelineStartUs: 0, sourceStartUs: 0, sourceEndUs: 1_000_000, rect, opacity: 1, fit: 'contain' },
      { kind: 'audio', id: 'sfx-1', trackId: a1.id, assetId: 'snd-1', timelineStartUs: 500_000, sourceStartUs: 0, sourceEndUs: 3_000_000, gain: 1 },
    ])
    expect(project.cues[0].mediaAssetId).toBe('minted-1')
    // The output frame is exactly what the export planned from the media before.
    expect(project.format).toEqual({ width: 1920, height: 1080, frameRate: { numerator: 30, denominator: 1 } })
    // The SFX had no explicit out point; the migration had to choose one, and says so.
    expect(loaded.migrationNotes.map((note) => [note.kind, note.itemId])).toEqual([['duration-resolved', 'sfx-1']])
  })

  it('turns schema 3 segments into gapless V1 clips that keep their ids and order', () => {
    const v3 = {
      schemaVersion: 3, id: 'p', title: 'P', media: mediaWithDuration, cues: [cueOf('c1')], ...dates,
      assets: [], overlays: [], blurRegions: [], audioClips: [],
      segments: [{ id: 's1', startUs: 0, endUs: 3_000_000 }, { id: 's2', startUs: 5_000_000, endUs: 10_000_000 }],
    }
    const { project } = loadProject(v3, ids())
    expect(project.clips.map((clip) => [clip.id, clip.timelineStartUs, clip.sourceStartUs, clip.sourceEndUs])).toEqual([
      ['s1', 0, 0, 3_000_000], ['s2', 3_000_000, 5_000_000, 10_000_000],
    ])
    expect(project.cues[0].mediaAssetId).toBe('minted-1')
  })

  it('migrates an SRT-only schema 3 project (no media) to an unbound, clip-free schema 5 project', () => {
    const { project, migratedFrom } = loadProject({
      schemaVersion: 3, id: 'p', title: 'P', media: null, cues: [cueOf('c1')], assets: [], overlays: [], blurRegions: [], audioClips: [], ...dates,
    }, ids())
    expect(migratedFrom).toBe(3)
    expect(project.clips).toEqual([])
    expect(project.cues[0].mediaAssetId).toBeUndefined()
  })

  it('keeps a schema 3 media with no probed duration as an asset, with no clip and nothing bound', () => {
    const noDuration = { ...mediaWithDuration, metadata: { ...metadata, durationUs: null } }
    const { project } = loadProject({
      schemaVersion: 3, id: 'p', title: 'P', media: noDuration, cues: [cueOf('c1')], assets: [], overlays: [], blurRegions: [], audioClips: [], ...dates,
    }, ids())
    expect(project.assets).toHaveLength(1)
    expect(project.clips).toEqual([])
    expect(project.cues[0].mediaAssetId).toBeUndefined()
    // Dimensions were probed, so the format is still known.
    expect(project.format).toEqual({ width: 1920, height: 1080, frameRate: { numerator: 30, denominator: 1 } })
  })

  it('migrates by parsed schema 3 value too, so a caller holding one need not re-serialize', () => {
    const v3 = projectSchemaV3.parse({ schemaVersion: 3, id: 'p', title: 'P', media: mediaWithDuration, cues: [], ...dates })
    expect(migrateV3(v3, ids()).clips).toHaveLength(1)
  })

  it('round-trips transcription provenance, including the transcribed video, and rejects a malformed model checksum', () => {
    const run = {
      id: 'run-1', createdAt: '2026-09-15T00:00:00.000Z', engine: { id: 'whisper.cpp', version: '1.9.4' },
      model: { id: 'whisper-base', fileName: 'ggml-base.bin', sha256: 'a'.repeat(64) }, requestedLanguage: 'auto', language: 'ml',
      requestedDevice: 'metal', mediaAssetId: 'v1', backends: ['MTL0'], sourceRange: { startUs: 0, endUs: 32_006_667 }, audioExtraction: 'ffmpeg-v1', speechGating: 'gating-v1',
      chunkCount: 2, silenceCount: 1, segmentCount: 1, adjustedSegmentCount: 0, droppedSegments: { empty: 0, outsideChunk: 0, zeroDuration: 0 },
    }
    const project = {
      schemaVersion: 5, id: 'transcribed', title: 'Transcribed', ...dates, assets: [], tracks: [], clips: [], blurRegions: [], transcriptionRuns: [run],
      cues: [{ id: 'c1', startUs: 1_200_000, endUs: 3_000_000, text: 'ആദ്യ വാചകം', timingSource: 'model', needsReview: false, textSource: 'model', words: [], transcriptionRunId: 'run-1' }],
    }
    expect(projectSchema.parse(project)).toEqual(project)
    expect(projectSchema.safeParse({ ...project, transcriptionRuns: [{ ...run, model: { ...run.model, sha256: 'not-a-checksum' } }] }).success).toBe(false)
  })

  it('does not rewrite a current schema project', () => {
    const current = { schemaVersion: 5, id: 'current', title: 'Current', cues: [], assets: [], tracks: [], clips: [], blurRegions: [], ...dates }
    expect(loadProject(current)).toEqual({ project: current, migratedFrom: null, migrationNotes: [] })
  })

  it('reports a broken schema 5 file as itself rather than as an unreadable schema 1 file', () => {
    expect(() => loadProject({ schemaVersion: 5, id: 'p', title: 'P', cues: [], clips: [{ kind: 'video' }], ...dates })).toThrow(/clips/)
  })

  it('creates new projects with one video and one audio track', () => {
    expect(createProject().tracks.map((track) => track.kind)).toEqual(['video', 'audio'])
  })
})

describe('schema 5 tracks and clips', () => {
  const V1 = trackOf('V1', 'video'), V2 = trackOf('V2', 'video'), A1 = trackOf('A1', 'audio')
  const base = { schemaVersion: 5 as const, id: 'p', title: 'P', cues: [], blurRegions: [], ...dates, tracks: [V1, V2, A1],
    assets: [video('x'), video('y', 6_000_000), asset('img', 'image'), asset('snd', 'audio', 4_000_000)] }
  const clip = (kind: 'video' | 'image' | 'audio', id: string, trackId: string, assetId: string, timelineStartUs: number, sourceStartUs: number, sourceEndUs: number) =>
    ({ kind, id, trackId, assetId, timelineStartUs, sourceStartUs, sourceEndUs })
  const parse = (clips: unknown[], extra: object = {}) => projectSchema.safeParse({ ...base, clips, ...extra })
  const message = (clips: unknown[], extra: object = {}) => JSON.stringify(parse(clips, extra).error?.issues ?? [])

  it('accepts stacked, gapped clips of every kind and applies clip defaults', () => {
    const parsed = projectSchema.parse({ ...base, clips: [
      clip('video', 'a', 'V1', 'x', 0, 0, 3_000_000), clip('video', 'b', 'V1', 'y', 5_000_000, 1_000_000, 6_000_000),
      clip('image', 'i', 'V2', 'img', 1_000_000, 0, 2_000_000), clip('audio', 's', 'A1', 'snd', 0, 0, 4_000_000),
    ] })
    expect(parsed.clips[0]).toMatchObject({ opacity: 1, fit: 'contain', gain: 1 })
    expect(parsed.clips[2]).not.toHaveProperty('gain')
  })

  it('rejects overlap on one track but allows it across tracks', () => {
    expect(message([clip('video', 'a', 'V1', 'x', 0, 0, 3_000_000), clip('video', 'b', 'V1', 'x', 2_000_000, 0, 1_000_000)])).toContain('must not overlap')
    expect(parse([clip('video', 'a', 'V1', 'x', 0, 0, 3_000_000), clip('video', 'b', 'V2', 'x', 2_000_000, 0, 1_000_000)]).success).toBe(true)
  })

  it('requires clips sorted by track, then start', () => {
    expect(message([clip('video', 'b', 'V1', 'x', 5_000_000, 0, 1_000_000), clip('video', 'a', 'V1', 'x', 0, 0, 1_000_000)])).toContain('sorted')
    expect(message([clip('image', 'i', 'V2', 'img', 0, 0, 1_000_000), clip('video', 'a', 'V1', 'x', 0, 0, 1_000_000)])).toContain('sorted')
  })

  it('keeps audio on audio tracks and pictures on video tracks, with the asset of the same kind', () => {
    expect(message([clip('audio', 's', 'V1', 'snd', 0, 0, 1_000_000)])).toContain('video track holds only')
    expect(message([clip('video', 'a', 'A1', 'x', 0, 0, 1_000_000)])).toContain('audio track holds only')
    expect(message([clip('video', 'a', 'V1', 'img', 0, 0, 1_000_000)])).toContain('video clip must reference a video asset')
    expect(message([clip('video', 'a', 'gone', 'x', 0, 0, 1_000_000)])).toContain('track that exists')
  })

  it('bounds video and audio by their media duration but not images', () => {
    expect(message([clip('video', 'a', 'V1', 'y', 0, 0, 7_000_000)])).toContain('known duration')
    expect(message([clip('audio', 's', 'A1', 'snd', 0, 0, 5_000_000)])).toContain('known duration')
    expect(parse([clip('image', 'i', 'V2', 'img', 0, 0, 99_000_000)]).success).toBe(true)
  })

  it('rejects an empty or reversed clip', () => {
    expect(parse([clip('video', 'a', 'V1', 'x', 0, 1_000_000, 1_000_000)]).success).toBe(false)
    expect(parse([clip('video', 'a', 'V1', 'x', 0, 3_000_000, 1_000_000)]).success).toBe(false)
  })

  it('shares one ID namespace across cues, assets, tracks, clips and blur regions', () => {
    expect(message([clip('video', 'c1', 'V1', 'x', 0, 0, 1_000_000)], { cues: [cueOf('c1', { mediaAssetId: 'x' })] })).toContain('unique across the project')
    expect(message([clip('video', 'V1', 'V1', 'x', 0, 0, 1_000_000)])).toContain('unique across the project')
    expect(message([clip('video', 'x', 'V1', 'x', 0, 0, 1_000_000)])).toContain('unique across the project')
  })

  it('requires every caption to name its video once the sequence has video — and only then', () => {
    expect(message([clip('video', 'a', 'V1', 'x', 0, 0, 1_000_000)], { cues: [cueOf('c1')] })).toContain('name the video')
    expect(parse([clip('video', 'a', 'V1', 'x', 0, 0, 1_000_000)], { cues: [cueOf('c1', { mediaAssetId: 'x' })] }).success).toBe(true)
    expect(parse([clip('image', 'i', 'V2', 'img', 0, 0, 1_000_000)], { cues: [cueOf('c1')] }).success).toBe(true)
    expect(parse([], { cues: [cueOf('c1', { mediaAssetId: 'img' })] }).success).toBe(false)
  })

  it('rejects a rect that escapes the composition width but accepts one that only exceeds the height', () => {
    const withRect = (r: typeof rect) => parse([{ ...clip('image', 'i', 'V2', 'img', 0, 0, 1_000_000), rect: r }])
    expect(withRect({ x: 900, y: 0, width: 300, height: 100 }).success).toBe(false)
    expect(withRect({ x: 0, y: 0, width: 100, height: 99_999 }).success).toBe(true)
  })

  it('validates the sequence format', () => {
    expect(parse([], { format: { width: 1920, height: 1080, frameRate: { numerator: 30000, denominator: 1001 } } }).success).toBe(true)
    expect(parse([], { format: { width: 1921, height: 1080, frameRate: { numerator: 30, denominator: 1 } } }).success).toBe(false)
    expect(parse([], { format: { width: 1920, height: 1080, frameRate: { numerator: 240, denominator: 1 } } }).success).toBe(false)
  })

  it('round-trips through JSON unchanged', () => {
    const project = projectSchema.parse({ ...base, clips: [clip('video', 'a', 'V1', 'x', 0, 0, 3_000_000), clip('video', 'b', 'V1', 'x', 3_000_000, 0, 3_000_000)],
      cues: [cueOf('c1', { mediaAssetId: 'x' })] })
    expect(loadProject(JSON.parse(JSON.stringify(project)))).toEqual({ project, migratedFrom: null, migrationNotes: [] })
  })
})

describe('retained schemas', () => {
  it('schema 4 files still parse as themselves and always go through migration', () => {
    const v4 = { schemaVersion: 4, id: 'p', title: 'P', cues: [], ...v4Edits, ...dates }
    expect(projectSchemaV4.safeParse(v4).success).toBe(true)
    expect(projectSchema.safeParse(v4).success).toBe(false)
    expect(loadProject(v4).migratedFrom).toBe(4)
  })

  it('schema 3 still accepts an ascending segment list and rejects unsorted or out-of-range ones', () => {
    const base = { schemaVersion: 3 as const, id: 'p', title: 'P', media: mediaWithDuration, cues: [], assets: [], overlays: [], blurRegions: [], audioClips: [], ...dates }
    const withSegments = (segments: unknown) => projectSchemaV3.safeParse({ ...base, segments })
    expect(withSegments([{ id: 's1', startUs: 0, endUs: 3_000_000 }, { id: 's2', startUs: 5_000_000, endUs: 10_000_000 }]).success).toBe(true)
    expect(withSegments([]).success).toBe(false)
    expect(withSegments([{ id: 's1', startUs: 5_000_000, endUs: 8_000_000 }, { id: 's2', startUs: 0, endUs: 3_000_000 }]).success).toBe(false)
    expect(withSegments([{ id: 's1', startUs: 0, endUs: 12_000_000 }]).success).toBe(false)
  })
})
