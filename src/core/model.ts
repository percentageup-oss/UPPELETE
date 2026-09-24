import { z } from 'zod'
import { projectMediaSchema } from './media'
import { captionTokens, locateWordSpans } from './captionText'
import { languageCodeSchema, sourceTimedTranscriptSchema } from './transcription'
import { captionStyleSchema, motionSchema, motionSpeedSchema, savedCaptionPresetSchema } from '../captions/style'
import { captionDisplaySchema } from '../captions/wordDisplay'
import {
  blurRegionSchema, clipSchema, legacyAudioClipSchema, legacyBlurRegionSchema, legacyClipSchema, legacyImageOverlaySchema,
  markerSchema, mediaAssetIdSchema, projectAssetSchema, segmentSchema, sequenceFormatSchema, trackSchema, type ProjectAsset, type Track,
} from './edit'
import { clipEndUs, compareClips, trackIndexMap } from './timelineModel'
import { migrateV4, type MigrationNote } from './migrateV4'

export const wordSchema = z.object({
  id: z.string().min(1),
  startUs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  endUs: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  text: z.string().min(1),
  // Optional offsets make partial timing lists unambiguous while keeping schema-2 files loadable.
  textStart: z.number().int().nonnegative().optional(),
  textEnd: z.number().int().positive().optional(),
  confidence: z.number().min(0).max(1).nullable().optional(),
  timingSource: z.enum(['model', 'aligned', 'manual', 'estimated']),
  needsReview: z.boolean().default(false),
  // Present only for timing accepted from a recorded alignment run.
  alignmentRunId: z.string().min(1).max(128).optional(),
}).refine((word) => word.endUs > word.startUs, { message: 'Word end must follow its start' })

export const cueSchema = z.object({
  id: z.string().min(1),
  // The video asset this cue's source time belongs to; required by `projectSchema` once clips exist.
  mediaAssetId: mediaAssetIdSchema,
  startUs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  endUs: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  text: z.string(),
  timingSource: z.enum(['imported', 'manual', 'model', 'aligned', 'estimated']).default('imported'),
  needsReview: z.boolean().default(false),
  textSource: z.enum(['imported', 'model', 'user']).default('imported'),
  words: z.array(wordSchema).default([]),
  emphasized: z.array(z.strictObject({ text: z.string().min(1), textStart: z.number().int().nonnegative(), textEnd: z.number().int().positive() })).optional(),
  // Set only on cues created from a transcription run; the run record carries engine/model provenance.
  transcriptionRunId: z.string().min(1).max(128).optional(),
  // A cue may override either project-level motion field; absent values inherit it.
  motionOverride: z.object({ motion: motionSchema.optional(), motionSpeed: motionSpeedSchema.optional() })
    .refine((value) => value.motion !== undefined || value.motionSpeed !== undefined, 'Caption override must change motion or speed.')
    .optional(),
}).refine((cue) => cue.endUs > cue.startUs, { message: 'Cue end must follow its start' })
  .superRefine((cue, context) => {
    const tokens = captionTokens(cue.text)
    const marks = cue.emphasized ?? []
    if (marks.some((mark, i) => !tokens.some((token) => token.text === mark.text && token.textStart === mark.textStart && token.textEnd === mark.textEnd)
      || (i > 0 && mark.textStart < marks[i - 1].textEnd))) {
      context.addIssue({ code: 'custom', path: ['emphasized'], message: 'Emphasis must select ordered, unique whole words in the caption.' })
    }
    const seen = new Set<string>()
    for (const [index, word] of cue.words.entries()) {
      if (seen.has(word.id) || word.startUs < cue.startUs || word.endUs > cue.endUs
        || (index > 0 && word.startUs < cue.words[index - 1].endUs)) {
        context.addIssue({ code: 'custom', path: ['words', index], message: 'Words must have unique IDs, be ordered and contained by their cue.' })
      }
      if ((word.textStart === undefined) !== (word.textEnd === undefined)) {
        context.addIssue({ code: 'custom', path: ['words', index], message: 'Word text offsets require both boundaries.' })
      }
      seen.add(word.id)
    }
    if (cue.words.length && !locateWordSpans(cue.text, cue.words)) {
      context.addIssue({ code: 'custom', path: ['words'], message: 'Word text must match whole words and grapheme clusters in the caption.' })
    }
  })

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)

// Optional Gemini translation of a transcription run's recognized text, offered for either engine.
// No credential or raw provider response is stored, matching the transcription/alignment run records.
const translationProvenanceSchema = z.strictObject({
  provider: z.literal('gemini'),
  model: z.string().min(1).max(256),
  targetLanguage: languageCodeSchema,
  segmentCount: count,
  inputTokens: count.optional(),
  outputTokens: count.optional(),
})

/** Engine/model provenance for one local transcription whose captions were applied to the project (T3). */
export const whisperTranscriptionRunSchema = z.strictObject({
  id: z.string().min(1).max(128),
  createdAt: z.string().min(1).max(64),
  engine: z.strictObject({ id: z.string().min(1).max(128), version: z.string().min(1).max(128) }),
  model: z.strictObject({ id: z.string().min(1).max(256), fileName: z.string().min(1).max(256), sha256: z.string().regex(/^[a-f0-9]{64}$/) }),
  requestedLanguage: z.string().min(1).max(16),
  language: z.string().min(1).max(16).nullable(),
  requestedDevice: z.enum(['cpu', 'metal', 'cuda', 'vulkan']),
  // The video asset whose source time `sourceRange` is in. Absent on runs recorded before schema 5.
  mediaAssetId: z.string().min(1).max(128).optional(),
  backends: z.array(z.string().min(1).max(64)).max(16),
  sourceRange: z.strictObject({ startUs: count, endUs: count }).refine((range) => range.endUs > range.startUs, 'Range end must follow its start'),
  audioExtraction: z.string().min(1).max(128),
  speechGating: z.string().min(1).max(128),
  chunkCount: count,
  silenceCount: count,
  segmentCount: count,
  adjustedSegmentCount: count,
  // Original recognition, before estimates/grouping/user edits; retained as evidence.
  recognition: sourceTimedTranscriptSchema.optional(),
  droppedSegments: z.strictObject({ empty: count, outsideChunk: count, zeroDuration: count }),
  // Present only when the recognized text was also translated; captions then hold the translated text.
  translation: translationProvenanceSchema.optional(),
})

// Optional cloud transcription with the user's own key. No credential or raw provider response is stored.
export const geminiTranscriptionRunSchema = z.strictObject({
  id: z.string().min(1).max(128),
  createdAt: z.string().min(1).max(64),
  provider: z.literal('gemini'),
  engine: z.strictObject({ id: z.string().min(1).max(128), version: z.string().min(1).max(128) }),
  model: z.strictObject({ id: z.string().min(1).max(256) }),
  mediaAssetId: z.string().min(1).max(128).optional(),
  requestedLanguage: z.string().min(1).max(16),
  language: z.string().min(1).max(16).nullable(),
  sourceRange: z.strictObject({ startUs: count, endUs: count }).refine((range) => range.endUs > range.startUs, 'Range end must follow its start'),
  audioExtraction: z.string().min(1).max(128),
  speechGating: z.string().min(1).max(128),
  chunkCount: count,
  silenceCount: count,
  segmentCount: count,
  adjustedSegmentCount: count,
  wordCount: count,
  droppedWordCount: count,
  inputTokens: count.optional(),
  outputTokens: count.optional(),
  recognition: sourceTimedTranscriptSchema.optional(),
  // Present only when the recognized text was also translated; captions then hold the translated text.
  translation: translationProvenanceSchema.optional(),
})

export const transcriptionRunSchema = z.union([whisperTranscriptionRunSchema, geminiTranscriptionRunSchema])

export const alignmentRunSchema = z.strictObject({
  id: z.string().min(1).max(128),
  createdAt: z.string().min(1).max(64),
  provider: z.literal('gemini'),
  model: z.string().min(1).max(256),
  mediaAssetId: z.string().min(1).max(128).optional(),
  sourceRange: z.strictObject({ startUs: count, endUs: count }).refine((range) => range.endUs > range.startUs, 'Range end must follow its start'),
  segmentCount: count,
  alignedWordCount: count,
  estimatedWordCount: count,
  inputTokens: count.optional(),
  outputTokens: count.optional(),
})

/** Fields every schema version shares. `media` is not one of them: schema 4 removed it. */
const projectCommonShape = {
  id: z.string().min(1),
  title: z.string(),
  cues: z.array(cueSchema),
  // Optional so existing schema-2 files load unchanged; appended when transcribed captions are applied.
  transcriptionRuns: z.array(transcriptionRunSchema).optional(),
  // Optional cloud-alignment provenance; credentials and raw provider transcripts are never stored here.
  alignmentRuns: z.array(alignmentRunSchema).optional(),
  captionStyle: captionStyleSchema.optional(),
  // Optional so existing schema-2 files load unchanged; drives the timeline/preview/export word view (R3 slice 1).
  captionDisplay: captionDisplaySchema.optional(),
  // Timeline-only preference. It deliberately has no effect on preview/export caption display.
  timelineDisplay: captionDisplaySchema.optional(),
  savedCaptionPresets: z.array(savedCaptionPresetSchema).max(100).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
}

/** Schemas 2 and 3 carry one nullable source `media`. */
const projectLegacyBaseShape = {
  ...projectCommonShape,
  media: projectMediaSchema.nullable(),
}

function uniquePresetIds(project: { savedCaptionPresets?: { id: string }[] }, context: z.RefinementCtx) {
  const presetIds = project.savedCaptionPresets?.map((preset) => preset.id) ?? []
  if (new Set(presetIds).size !== presetIds.length) context.addIssue({ code: 'custom', message: 'Saved preset IDs must be unique.' })
}

/** One ID namespace across every kind, so a timeline `Selection { kind, id }` can never be
 * ambiguous and an `assetId` can never accidentally match a cue or a clip. */
function idClaimer(context: z.RefinementCtx) {
  const ids = new Set<string>()
  return (id: string, path: (string | number)[], what: string) => {
    if (ids.has(id)) context.addIssue({ code: 'custom', path, message: `IDs must be unique across the project; “${id}” is reused by ${what}.` })
    ids.add(id)
  }
}

/** Schema 2, retained verbatim so files written before V1 still parse and can be migrated. */
export const projectSchemaV2 = z.object({
  schemaVersion: z.literal(2),
  ...projectLegacyBaseShape,
}).superRefine((project, context) => {
  uniquePresetIds(project, context)
  const ids = new Set<string>()
  for (const cue of project.cues) for (const word of cue.words) {
    if (ids.has(word.id)) context.addIssue({ code: 'custom', message: 'Word IDs must be unique across the project.' })
    ids.add(word.id)
  }
})

/** Schema 3 (single source `media`, optional `segments`), retained so its files still load and migrate. */
export const projectSchemaV3 = z.object({
  schemaVersion: z.literal(3),
  ...projectLegacyBaseShape,
  assets: z.array(projectAssetSchema).max(1000).default([]),
  overlays: z.array(legacyImageOverlaySchema).max(1000).default([]),
  blurRegions: z.array(legacyBlurRegionSchema).max(1000).default([]),
  audioClips: z.array(legacyAudioClipSchema).max(1000).default([]),
  segments: z.array(segmentSchema).min(1).max(1000).optional(),
}).superRefine((project, context) => {
  uniquePresetIds(project, context)
  const claim = idClaimer(context)
  for (const [index, cue] of project.cues.entries()) {
    claim(cue.id, ['cues', index], 'a caption')
    for (const [wordIndex, word] of cue.words.entries()) claim(word.id, ['cues', index, 'words', wordIndex], 'a word')
  }
  for (const [index, asset] of project.assets.entries()) claim(asset.id, ['assets', index], 'an asset')
  for (const [index, overlay] of project.overlays.entries()) claim(overlay.id, ['overlays', index], 'an overlay')
  for (const [index, region] of project.blurRegions.entries()) claim(region.id, ['blurRegions', index], 'a blur region')
  for (const [index, clip] of project.audioClips.entries()) claim(clip.id, ['audioClips', index], 'an audio clip')
  for (const [index, segment] of (project.segments ?? []).entries()) claim(segment.id, ['segments', index], 'a segment')
  const assetKinds = new Map(project.assets.map((asset) => [asset.id, asset.kind]))
  for (const [index, overlay] of project.overlays.entries()) {
    if (assetKinds.get(overlay.assetId) !== 'image') context.addIssue({ code: 'custom', path: ['overlays', index, 'assetId'], message: 'An overlay must reference an image asset.' })
  }
  for (const [index, clip] of project.audioClips.entries()) {
    if (assetKinds.get(clip.assetId) !== 'audio') context.addIssue({ code: 'custom', path: ['audioClips', index, 'assetId'], message: 'An audio clip must reference an audio asset.' })
  }
  const mediaDurationUs = project.media?.metadata?.durationUs ?? null
  for (const [index, segment] of (project.segments ?? []).entries()) {
    const previous = project.segments![index - 1]
    if (previous && segment.startUs < previous.endUs) context.addIssue({ code: 'custom', path: ['segments', index], message: 'Segments must be ascending and non-overlapping.' })
    if (mediaDurationUs !== null && segment.endUs > mediaDurationUs) context.addIssue({ code: 'custom', path: ['segments', index], message: 'Segments must stay within the known media duration.' })
  }
})

/** Schema 4 (one flat clip list whose array order is the sequence), retained so its files still load and migrate. */
export const projectSchemaV4 = z.object({
  schemaVersion: z.literal(4),
  ...projectCommonShape,
  assets: z.array(projectAssetSchema).max(1000).default([]),
  overlays: z.array(legacyImageOverlaySchema).max(1000).default([]),
  blurRegions: z.array(legacyBlurRegionSchema).max(1000).default([]),
  audioClips: z.array(legacyAudioClipSchema).max(1000).default([]),
  /** Array order is sequence order; an empty list is a project with no video (e.g. SRT-first). */
  clips: z.array(legacyClipSchema).max(1000).default([]),
}).superRefine((project, context) => {
  uniquePresetIds(project, context)
  const claim = idClaimer(context)
  for (const [index, cue] of project.cues.entries()) {
    claim(cue.id, ['cues', index], 'a caption')
    for (const [wordIndex, word] of cue.words.entries()) claim(word.id, ['cues', index, 'words', wordIndex], 'a word')
  }
  for (const [index, asset] of project.assets.entries()) claim(asset.id, ['assets', index], 'an asset')
  for (const [index, overlay] of project.overlays.entries()) claim(overlay.id, ['overlays', index], 'an overlay')
  for (const [index, region] of project.blurRegions.entries()) claim(region.id, ['blurRegions', index], 'a blur region')
  for (const [index, clip] of project.audioClips.entries()) claim(clip.id, ['audioClips', index], 'an audio clip')
  for (const [index, clip] of project.clips.entries()) claim(clip.id, ['clips', index], 'a clip')

  const assets = new Map(project.assets.map((asset) => [asset.id, asset]))
  for (const [index, overlay] of project.overlays.entries()) {
    if (assets.get(overlay.assetId)?.kind !== 'image') {
      context.addIssue({ code: 'custom', path: ['overlays', index, 'assetId'], message: 'An overlay must reference an image asset.' })
    }
  }
  for (const [index, clip] of project.audioClips.entries()) {
    if (assets.get(clip.assetId)?.kind !== 'audio') {
      context.addIssue({ code: 'custom', path: ['audioClips', index, 'assetId'], message: 'An audio clip must reference an audio asset.' })
    }
  }
  for (const [index, clip] of project.clips.entries()) {
    const asset = assets.get(clip.assetId)
    if (asset?.kind !== 'video') {
      context.addIssue({ code: 'custom', path: ['clips', index, 'assetId'], message: 'A clip must reference a video asset.' })
      continue
    }
    const durationUs = asset.metadata?.durationUs ?? null
    if (durationUs !== null && clip.endUs > durationUs) {
      context.addIssue({ code: 'custom', path: ['clips', index], message: 'A clip must stay within its video’s known duration.' })
    }
  }
  const bound: { items: readonly { mediaAssetId?: string }[]; key: string }[] = [
    { items: project.cues, key: 'cues' }, { items: project.overlays, key: 'overlays' },
    { items: project.blurRegions, key: 'blurRegions' }, { items: project.audioClips, key: 'audioClips' },
  ]
  for (const { items, key } of bound) for (const [index, item] of items.entries()) {
    if (item.mediaAssetId === undefined) {
      if (project.clips.length) context.addIssue({ code: 'custom', path: [key, index, 'mediaAssetId'], message: 'Once the sequence has clips, every caption and item must name the video it belongs to.' })
    } else if (assets.get(item.mediaAssetId)?.kind !== 'video') {
      context.addIssue({ code: 'custom', path: [key, index, 'mediaAssetId'], message: 'mediaAssetId must reference a video asset.' })
    }
  }
})

/**
 * Schema 5: a stacked multi-track timeline (docs/EDITING.md "Schema 5"). Named `tracks`, clips at
 * absolute sequence positions (gaps allowed), upper video tracks compositing over lower ones.
 * Captions stay in the source time of the video they belong to; clips, blur and audio are sequence
 * time. `clips` is always sorted by `(track index, timelineStartUs, id)`.
 */
export const projectSchema = z.object({
  schemaVersion: z.literal(5),
  ...projectCommonShape,
  assets: z.array(projectAssetSchema).max(1000).default([]),
  tracks: z.array(trackSchema).max(64).default([]),
  clips: z.array(clipSchema).max(4000).default([]),
  blurRegions: z.array(blurRegionSchema).max(1000).default([]),
  markers: z.array(markerSchema).max(1000).default([]),
  format: sequenceFormatSchema.optional(),
}).superRefine((project, context) => {
  uniquePresetIds(project, context)
  const claim = idClaimer(context)
  for (const [index, cue] of project.cues.entries()) {
    claim(cue.id, ['cues', index], 'a caption')
    for (const [wordIndex, word] of cue.words.entries()) claim(word.id, ['cues', index, 'words', wordIndex], 'a word')
  }
  for (const [index, asset] of project.assets.entries()) claim(asset.id, ['assets', index], 'an asset')
  for (const [index, track] of project.tracks.entries()) claim(track.id, ['tracks', index], 'a track')
  for (const [index, clip] of project.clips.entries()) claim(clip.id, ['clips', index], 'a clip')
  for (const [index, region] of project.blurRegions.entries()) claim(region.id, ['blurRegions', index], 'a blur region')
  for (const [index, marker] of project.markers.entries()) claim(marker.id, ['markers', index], 'a marker')

  const assets = new Map(project.assets.map((asset) => [asset.id, asset]))
  const tracks = new Map(project.tracks.map((track) => [track.id, track]))
  const order = trackIndexMap(project.tracks)
  const compare = compareClips(order)
  for (const [index, clip] of project.clips.entries()) {
    const path = ['clips', index]
    const track = tracks.get(clip.trackId)
    if (!track) context.addIssue({ code: 'custom', path: [...path, 'trackId'], message: 'A clip must sit on a track that exists.' })
    else if ((track.kind === 'audio') !== (clip.kind === 'audio')) {
      context.addIssue({ code: 'custom', path: [...path, 'trackId'], message: track.kind === 'audio' ? 'An audio track holds only audio clips.' : 'A video track holds only video and image clips.' })
    }
    const asset = assets.get(clip.assetId)
    if (asset?.kind !== clip.kind) context.addIssue({ code: 'custom', path: [...path, 'assetId'], message: `A ${clip.kind} clip must reference a ${clip.kind} asset.` })
    else if (clip.kind !== 'image') {
      const durationUs = asset.metadata?.durationUs ?? null
      if (durationUs !== null && clip.sourceEndUs > durationUs) context.addIssue({ code: 'custom', path, message: 'A clip must stay within its media’s known duration.' })
    }
    const previous = project.clips[index - 1]
    if (previous) {
      if (compare(previous, clip) > 0) context.addIssue({ code: 'custom', path, message: 'Clips must be sorted by track, then start time.' })
      else if (previous.trackId === clip.trackId && clip.timelineStartUs < clipEndUs(previous)) {
        context.addIssue({ code: 'custom', path, message: 'Clips on one track must not overlap.' })
      }
    }
  }
  // Captions name the video their source time belongs to. Required once the sequence has video;
  // when present it must always be a real video asset.
  const hasVideo = project.clips.some((clip) => clip.kind === 'video')
  for (const [index, cue] of project.cues.entries()) {
    if (cue.mediaAssetId === undefined) {
      if (hasVideo) context.addIssue({ code: 'custom', path: ['cues', index, 'mediaAssetId'], message: 'Once the sequence has video, every caption must name the video it belongs to.' })
    } else if (assets.get(cue.mediaAssetId)?.kind !== 'video') {
      context.addIssue({ code: 'custom', path: ['cues', index, 'mediaAssetId'], message: 'mediaAssetId must reference a video asset.' })
    }
  }
})

export type Cue = z.infer<typeof cueSchema>
export type CaptionWord = z.infer<typeof wordSchema>
export type CaptionProject = z.infer<typeof projectSchema>
export type CaptionProjectV2 = z.infer<typeof projectSchemaV2>
export type CaptionProjectV3 = z.infer<typeof projectSchemaV3>
export type CaptionProjectV4 = z.infer<typeof projectSchemaV4>
export type TranscriptionRun = z.infer<typeof transcriptionRunSchema>
export type AlignmentRun = z.infer<typeof alignmentRunSchema>
export type { MigrationNote }

const legacyProjectSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  title: z.string(),
  media: z.object({ path: z.string().min(1), name: z.string().min(1) }).nullable(),
  cues: z.array(cueSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type ProjectLoadResult = {
  project: CaptionProject
  migratedFrom: 1 | 2 | 3 | 4 | null
  /** What the 4 → 5 migration could not carry over exactly, surfaced as a notice (never silent loss). */
  migrationNotes: MigrationNote[]
}

/** Schema 2 gains the four empty edit lists and no `segments` — the identity edit. Nothing else moves. */
function migrateV2(project: CaptionProjectV2): CaptionProjectV3 {
  return projectSchemaV3.parse({ ...project, schemaVersion: 3, assets: [], overlays: [], blurRegions: [], audioClips: [] })
}

/**
 * Schema 3 → 4: the single `media` becomes a video asset, the kept `segments` (or, for the identity
 * edit, one clip over the whole media) become clips, and every source-time item is stamped with the
 * new asset's id. A media whose duration was never probed cannot get an identity clip — its asset is
 * kept, clips stay empty, and nothing is stamped (unbound items are valid while there are no clips);
 * the first relink that reports a duration supplies the whole-video clip.
 */
export function migrateV3(project: CaptionProjectV3, newId: () => string): CaptionProjectV4 {
  const { media, segments, schemaVersion: _version, ...rest } = project
  if (!media) return projectSchemaV4.parse({ ...rest, schemaVersion: 4, clips: [] })
  const video: ProjectAsset = { id: newId(), kind: 'video', ...media }
  const durationUs = media.metadata?.durationUs ?? null
  const clips = segments?.length
    ? segments.map((segment) => ({ id: segment.id, assetId: video.id, startUs: segment.startUs, endUs: segment.endUs }))
    : durationUs ? [{ id: newId(), assetId: video.id, startUs: 0, endUs: durationUs }] : []
  const stamp = <T extends object>(item: T): T & { mediaAssetId?: string } => clips.length ? { ...item, mediaAssetId: video.id } : item
  return projectSchemaV4.parse({
    ...rest,
    schemaVersion: 4,
    assets: [video, ...rest.assets],
    cues: rest.cues.map(stamp),
    overlays: rest.overlays.map(stamp),
    blurRegions: rest.blurRegions.map(stamp),
    audioClips: rest.audioClips.map(stamp),
    clips,
  })
}

function toV5(project: CaptionProjectV4, newId: () => string): { project: CaptionProject; notes: MigrationNote[] } {
  const migrated = migrateV4(project, newId)
  return { project: projectSchema.parse(migrated.project), notes: migrated.notes }
}

/** `newId` mints the ids a migration needs (assets, clips, tracks); injectable for tests. */
export function loadProject(value: unknown, newId: () => string = () => crypto.randomUUID()): ProjectLoadResult {
  const current = projectSchema.safeParse(value)
  if (current.success) return { project: current.data, migratedFrom: null, migrationNotes: [] }
  const from = (migratedFrom: 1 | 2 | 3 | 4, v4: CaptionProjectV4): ProjectLoadResult => {
    const { project, notes } = toV5(v4, newId)
    return { project, migratedFrom, migrationNotes: notes }
  }
  const v4 = projectSchemaV4.safeParse(value)
  if (v4.success) return from(4, v4.data)
  const v3 = projectSchemaV3.safeParse(value)
  if (v3.success) return from(3, migrateV3(v3.data, newId))
  const v2 = projectSchemaV2.safeParse(value)
  if (v2.success) return from(2, migrateV3(migrateV2(v2.data), newId))
  // A file that claims the current schema but fails it reports *that* failure, not schema 1's.
  if (typeof value === 'object' && value !== null && (value as { schemaVersion?: unknown }).schemaVersion === 5) projectSchema.parse(value)
  const legacy = legacyProjectSchema.parse(value)
  return from(1, migrateV3(migrateV2(projectSchemaV2.parse({
    ...legacy,
    schemaVersion: 2,
    media: legacy.media ? {
      name: legacy.media.name,
      reference: { relativePath: null, absolutePath: legacy.media.path },
      fingerprint: null,
      metadata: null,
    } : null,
  })), newId))
}

export const PROJECT_FILE_EXTENSION = 'cstudio'
export const PROJECT_FILE_FILTER_NAME = 'KathaCut project'

/** A new project's default lanes: one video track and one audio track, exactly the rows the
 * timeline has always shown. */
export function defaultTracks(newId: () => string = () => crypto.randomUUID()): Track[] {
  return [
    { id: newId(), kind: 'video', name: '', muted: false, hidden: false, locked: false },
    { id: newId(), kind: 'audio', name: '', muted: false, hidden: false, locked: false },
  ]
}

export function createProject(): CaptionProject {
  const now = new Date().toISOString()
  return {
    schemaVersion: 5,
    id: crypto.randomUUID(),
    title: 'Untitled project',
    cues: [],
    assets: [],
    tracks: defaultTracks(),
    clips: [],
    blurRegions: [],
    markers: [],
    createdAt: now,
    updatedAt: now,
  }
}
