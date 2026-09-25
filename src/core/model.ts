import { z } from 'zod'
import { projectMediaSchema } from './media'
import { captionTokens, locateWordSpans } from './captionText'
import { languageCodeSchema, sourceTimedTranscriptSchema } from './transcription'
import { captionAppearanceSchema, captionStyleSchema, motionSchema, motionSpeedSchema, savedCaptionPresetSchema } from '../captions/style'
import { captionDisplaySchema } from '../captions/wordDisplay'
import {
  blurRegionSchema, captionTrackSchema, clipSchema, effectRegionSchema, legacyAudioClipSchema, legacyBlurRegionSchema, legacyClipSchema, legacyImageOverlaySchema,
  markerSchema, mediaAssetIdSchema, projectAssetSchema, segmentSchema, sequenceFormatSchema, trackSchema, zoomRegionSchema, textOverlaySchema, textOverlaySchemaV21, groupSchema, shapeSchema, shapeSchemaV22, shapeSchemaV21, shapeSchemaV18, shapeSchemaV19, shapeSchemaV20, type ProjectAsset, type Track,
} from './edit'
import { clipEndUs, compareClips, trackIndexMap } from './timelineModel'
import { migrateV4, type MigrationNote } from './migrateV4'
import { migrateV5 } from './migrateV5'
import { migrateV6 } from './migrateV6'
import { migrateV7 } from './migrateV7'
import { migrateV8 } from './migrateV8'
import { migrateV9 } from './migrateV9'
import { migrateV10 } from './migrateV10'
import { migrateV11 } from './migrateV11'
import { migrateV12 } from './migrateV12'
import { migrateV13 } from './migrateV13'
import { migrateV14 } from './migrateV14'
import { migrateV15 } from './migrateV15'
import { migrateV16 } from './migrateV16'
import { migrateV17 } from './migrateV17'
import { migrateV18 } from './migrateV18'
import { migrateV19 } from './migrateV19'
import { migrateV20 } from './migrateV20'
import { migrateV21 } from './migrateV21'
import { migrateV22 } from './migrateV22'

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
  // The caption track (schema 6) this cue is on; required by `projectSchema` once the project has
  // one. A new or migrated project always has a default caption track, so in practice every cue
  // ends up stamped — see `bindUnboundItems`, the same mechanism that stamps `mediaAssetId`.
  captionTrackId: z.string().min(1).max(128).optional(),
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
  // A cue may override any of the project-level style's placement fields (an Alt-drag/resize/rotate
  // on the stage, or an explicit "place this caption differently"); absent values inherit the
  // project style. Bounds are the appearance schema's own, so a placement override can never exceed
  // what the style panel itself allows.
  placementOverride: z.object({
    horizontal: captionAppearanceSchema.shape.horizontal.optional(),
    vertical: captionAppearanceSchema.shape.vertical.optional(),
    fontSize: captionAppearanceSchema.shape.fontSize.optional(),
    rotation: captionAppearanceSchema.shape.rotation.optional(),
  }).refine((value) => Object.values(value).some((entry) => entry !== undefined), 'Placement override must change something.')
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
  // Optional (schema-2-compatible, older runs never recorded it): model output that could not become a
  // timed word — text Gemini produced that never reached the transcript, surfaced instead of silently
  // vanishing. See `GeminiRecognition.droppedAnnotations`.
  droppedAnnotationCount: count.optional(),
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
 * time. `clips` is always sorted by `(track index, timelineStartUs, id)`. Retained so a schema-5
 * file still parses and can migrate (`src/core/migrateV5.ts`); schema 6 is now current.
 */
export const projectSchemaV5 = z.object({
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
    // A color or adjustment clip is generated: no asset, and its synthetic source range has no media to bound it.
    const asset = clip.kind === 'color' || clip.kind === 'adjustment' ? undefined : assets.get(clip.assetId)
    if (clip.kind === 'color' || clip.kind === 'adjustment') { /* nothing to reference */ }
    else if (asset?.kind !== clip.kind && !(clip.kind === 'audio' && asset?.kind === 'video')) context.addIssue({ code: 'custom', path: [...path, 'assetId'], message: `A ${clip.kind} clip must reference a ${clip.kind} asset.` })
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

/**
 * Schema 6: captions gain tracks (docs/EDITING.md "Schema 6"). `project.captionTracks` is a second,
 * independent set of lanes alongside `project.tracks` — cues reference one by `captionTrackId`, the
 * same way a clip references a video/audio track by `trackId`. There is deliberately no per-track
 * simultaneous rendering yet: `activeCueAt` (src/core/timelineModel.ts) picks one cue at a time from
 * the topmost visible, unlocked caption track that has one, exactly the rule stacked video already
 * uses for picking one visual layer. Everything else about schema 5 is unchanged. Retained so a
 * schema-6 file still parses and can migrate (`src/core/migrateV6.ts`); schema 7 is now current.
 */
export const projectSchemaV6 = z.object({
  schemaVersion: z.literal(6),
  ...projectCommonShape,
  assets: z.array(projectAssetSchema).max(1000).default([]),
  tracks: z.array(trackSchema).max(64).default([]),
  clips: z.array(clipSchema).max(4000).default([]),
  captionTracks: z.array(captionTrackSchema).max(64).default([]),
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
  for (const [index, track] of project.captionTracks.entries()) claim(track.id, ['captionTracks', index], 'a caption track')
  for (const [index, clip] of project.clips.entries()) claim(clip.id, ['clips', index], 'a clip')
  for (const [index, region] of project.blurRegions.entries()) claim(region.id, ['blurRegions', index], 'a blur region')
  for (const [index, marker] of project.markers.entries()) claim(marker.id, ['markers', index], 'a marker')

  const assets = new Map(project.assets.map((asset) => [asset.id, asset]))
  const tracks = new Map(project.tracks.map((track) => [track.id, track]))
  const captionTracks = new Map(project.captionTracks.map((track) => [track.id, track]))
  const order = trackIndexMap(project.tracks)
  const compare = compareClips(order)
  for (const [index, clip] of project.clips.entries()) {
    const path = ['clips', index]
    const track = tracks.get(clip.trackId)
    if (!track) context.addIssue({ code: 'custom', path: [...path, 'trackId'], message: 'A clip must sit on a track that exists.' })
    else if ((track.kind === 'audio') !== (clip.kind === 'audio')) {
      context.addIssue({ code: 'custom', path: [...path, 'trackId'], message: track.kind === 'audio' ? 'An audio track holds only audio clips.' : 'A video track holds only video and image clips.' })
    }
    // A color or adjustment clip is generated: no asset, and its synthetic source range has no media to bound it.
    const asset = clip.kind === 'color' || clip.kind === 'adjustment' ? undefined : assets.get(clip.assetId)
    if (clip.kind === 'color' || clip.kind === 'adjustment') { /* nothing to reference */ }
    else if (asset?.kind !== clip.kind && !(clip.kind === 'audio' && asset?.kind === 'video')) context.addIssue({ code: 'custom', path: [...path, 'assetId'], message: `A ${clip.kind} clip must reference a ${clip.kind} asset.` })
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
  // Captions name their caption track the same way. Required once the project has one; a project
  // always has a default caption track once anything has stamped it (`bindUnboundItems`), so in
  // practice this only stays optional for a project with no captionTracks at all.
  const hasCaptionTracks = project.captionTracks.length > 0
  for (const [index, cue] of project.cues.entries()) {
    if (cue.mediaAssetId === undefined) {
      if (hasVideo) context.addIssue({ code: 'custom', path: ['cues', index, 'mediaAssetId'], message: 'Once the sequence has video, every caption must name the video it belongs to.' })
    } else if (assets.get(cue.mediaAssetId)?.kind !== 'video') {
      context.addIssue({ code: 'custom', path: ['cues', index, 'mediaAssetId'], message: 'mediaAssetId must reference a video asset.' })
    }
    if (cue.captionTrackId === undefined) {
      if (hasCaptionTracks) context.addIssue({ code: 'custom', path: ['cues', index, 'captionTrackId'], message: 'Once the project has a caption track, every caption must name the one it belongs to.' })
    } else if (!captionTracks.has(cue.captionTrackId)) {
      context.addIssue({ code: 'custom', path: ['cues', index, 'captionTrackId'], message: 'captionTrackId must reference a caption track that exists.' })
    }
  }
})

/**
 * Schema 7: zoom regions (docs/EDITING.md "Zoom regions"). `project.zoomRegions` is one lane over
 * the whole composited program — sequence-timed, no asset, no track of its own — the same shape as
 * `blurRegions`. Only one region can be active at a time, so, like `clips` and schema 3's `segments`,
 * the array is kept ascending and non-overlapping by every command that touches it; `superRefine`
 * checks that invariant rather than re-sorting silently. Everything else about schema 6 is unchanged.
 * Retained so a schema-7 file still parses and can migrate (`src/core/migrateV7.ts`); schema 8 is
 * now current.
 */
export const projectSchemaV7 = z.object({
  schemaVersion: z.literal(7),
  ...projectCommonShape,
  assets: z.array(projectAssetSchema).max(1000).default([]),
  tracks: z.array(trackSchema).max(64).default([]),
  clips: z.array(clipSchema).max(4000).default([]),
  captionTracks: z.array(captionTrackSchema).max(64).default([]),
  blurRegions: z.array(blurRegionSchema).max(1000).default([]),
  zoomRegions: z.array(zoomRegionSchema).max(200).default([]),
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
  for (const [index, track] of project.captionTracks.entries()) claim(track.id, ['captionTracks', index], 'a caption track')
  for (const [index, clip] of project.clips.entries()) claim(clip.id, ['clips', index], 'a clip')
  for (const [index, region] of project.blurRegions.entries()) claim(region.id, ['blurRegions', index], 'a blur region')
  for (const [index, region] of project.zoomRegions.entries()) claim(region.id, ['zoomRegions', index], 'a zoom region')
  for (const [index, marker] of project.markers.entries()) claim(marker.id, ['markers', index], 'a marker')

  const assets = new Map(project.assets.map((asset) => [asset.id, asset]))
  const tracks = new Map(project.tracks.map((track) => [track.id, track]))
  const captionTracks = new Map(project.captionTracks.map((track) => [track.id, track]))
  const order = trackIndexMap(project.tracks)
  const compare = compareClips(order)
  for (const [index, clip] of project.clips.entries()) {
    const path = ['clips', index]
    const track = tracks.get(clip.trackId)
    if (!track) context.addIssue({ code: 'custom', path: [...path, 'trackId'], message: 'A clip must sit on a track that exists.' })
    else if ((track.kind === 'audio') !== (clip.kind === 'audio')) {
      context.addIssue({ code: 'custom', path: [...path, 'trackId'], message: track.kind === 'audio' ? 'An audio track holds only audio clips.' : 'A video track holds only video and image clips.' })
    }
    // A color or adjustment clip is generated: no asset, and its synthetic source range has no media to bound it.
    const asset = clip.kind === 'color' || clip.kind === 'adjustment' ? undefined : assets.get(clip.assetId)
    if (clip.kind === 'color' || clip.kind === 'adjustment') { /* nothing to reference */ }
    else if (asset?.kind !== clip.kind && !(clip.kind === 'audio' && asset?.kind === 'video')) context.addIssue({ code: 'custom', path: [...path, 'assetId'], message: `A ${clip.kind} clip must reference a ${clip.kind} asset.` })
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
  // Zoom regions share one lane over the whole program, so — like clips on a track — they must be
  // kept ascending and never overlap; every zoom command maintains this rather than the schema
  // silently re-sorting.
  for (const [index, region] of project.zoomRegions.entries()) {
    const previous = project.zoomRegions[index - 1]
    if (previous && region.startUs < previous.endUs) {
      context.addIssue({ code: 'custom', path: ['zoomRegions', index], message: 'Zoom regions must be ascending and non-overlapping.' })
    }
  }
  // Captions name the video their source time belongs to. Required once the sequence has video;
  // when present it must always be a real video asset.
  const hasVideo = project.clips.some((clip) => clip.kind === 'video')
  // Captions name their caption track the same way. Required once the project has one; a project
  // always has a default caption track once anything has stamped it (`bindUnboundItems`), so in
  // practice this only stays optional for a project with no captionTracks at all.
  const hasCaptionTracks = project.captionTracks.length > 0
  for (const [index, cue] of project.cues.entries()) {
    if (cue.mediaAssetId === undefined) {
      if (hasVideo) context.addIssue({ code: 'custom', path: ['cues', index, 'mediaAssetId'], message: 'Once the sequence has video, every caption must name the video it belongs to.' })
    } else if (assets.get(cue.mediaAssetId)?.kind !== 'video') {
      context.addIssue({ code: 'custom', path: ['cues', index, 'mediaAssetId'], message: 'mediaAssetId must reference a video asset.' })
    }
    if (cue.captionTrackId === undefined) {
      if (hasCaptionTracks) context.addIssue({ code: 'custom', path: ['cues', index, 'captionTrackId'], message: 'Once the project has a caption track, every caption must name the one it belongs to.' })
    } else if (!captionTracks.has(cue.captionTrackId)) {
      context.addIssue({ code: 'custom', path: ['cues', index, 'captionTrackId'], message: 'captionTrackId must reference a caption track that exists.' })
    }
  }
})

/**
 * Schema 8: effect bypass. `blurRegionSchema` and `zoomRegionSchema` both gained `enabled`, so a
 * region can be switched off without deleting it — preview and export skip a disabled region, but
 * it keeps its place in the lane and still counts toward the non-overlap rule below. `enabled`
 * defaults to `true`, so parsing an older project through it (schema 7 and back) back-fills the
 * flag rather than needing an explicit migration step. Everything else about schema 7 is unchanged.
 */
export const projectSchemaV8 = z.object({
  schemaVersion: z.literal(8),
  ...projectCommonShape,
  assets: z.array(projectAssetSchema).max(1000).default([]),
  tracks: z.array(trackSchema).max(64).default([]),
  clips: z.array(clipSchema).max(4000).default([]),
  captionTracks: z.array(captionTrackSchema).max(64).default([]),
  blurRegions: z.array(blurRegionSchema).max(1000).default([]),
  zoomRegions: z.array(zoomRegionSchema).max(200).default([]),
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
  for (const [index, track] of project.captionTracks.entries()) claim(track.id, ['captionTracks', index], 'a caption track')
  for (const [index, clip] of project.clips.entries()) claim(clip.id, ['clips', index], 'a clip')
  for (const [index, region] of project.blurRegions.entries()) claim(region.id, ['blurRegions', index], 'a blur region')
  for (const [index, region] of project.zoomRegions.entries()) claim(region.id, ['zoomRegions', index], 'a zoom region')
  for (const [index, marker] of project.markers.entries()) claim(marker.id, ['markers', index], 'a marker')

  const assets = new Map(project.assets.map((asset) => [asset.id, asset]))
  const tracks = new Map(project.tracks.map((track) => [track.id, track]))
  const captionTracks = new Map(project.captionTracks.map((track) => [track.id, track]))
  const order = trackIndexMap(project.tracks)
  const compare = compareClips(order)
  for (const [index, clip] of project.clips.entries()) {
    const path = ['clips', index]
    const track = tracks.get(clip.trackId)
    if (!track) context.addIssue({ code: 'custom', path: [...path, 'trackId'], message: 'A clip must sit on a track that exists.' })
    else if ((track.kind === 'audio') !== (clip.kind === 'audio')) {
      context.addIssue({ code: 'custom', path: [...path, 'trackId'], message: track.kind === 'audio' ? 'An audio track holds only audio clips.' : 'A video track holds only video and image clips.' })
    }
    // A color or adjustment clip is generated: no asset, and its synthetic source range has no media to bound it.
    const asset = clip.kind === 'color' || clip.kind === 'adjustment' ? undefined : assets.get(clip.assetId)
    if (clip.kind === 'color' || clip.kind === 'adjustment') { /* nothing to reference */ }
    else if (asset?.kind !== clip.kind && !(clip.kind === 'audio' && asset?.kind === 'video')) context.addIssue({ code: 'custom', path: [...path, 'assetId'], message: `A ${clip.kind} clip must reference a ${clip.kind} asset.` })
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
  // Zoom regions share one lane over the whole program, so — like clips on a track — they must be
  // kept ascending and never overlap; every zoom command maintains this rather than the schema
  // silently re-sorting. A disabled region still claims its place in the lane, so bypassing one
  // never opens a gap another region could be dropped into and then have re-enabled overlap it.
  for (const [index, region] of project.zoomRegions.entries()) {
    const previous = project.zoomRegions[index - 1]
    if (previous && region.startUs < previous.endUs) {
      context.addIssue({ code: 'custom', path: ['zoomRegions', index], message: 'Zoom regions must be ascending and non-overlapping.' })
    }
  }
  // Captions name the video their source time belongs to. Required once the sequence has video;
  // when present it must always be a real video asset.
  const hasVideo = project.clips.some((clip) => clip.kind === 'video')
  // Captions name their caption track the same way. Required once the project has one; a project
  // always has a default caption track once anything has stamped it (`bindUnboundItems`), so in
  // practice this only stays optional for a project with no captionTracks at all.
  const hasCaptionTracks = project.captionTracks.length > 0
  for (const [index, cue] of project.cues.entries()) {
    if (cue.mediaAssetId === undefined) {
      if (hasVideo) context.addIssue({ code: 'custom', path: ['cues', index, 'mediaAssetId'], message: 'Once the sequence has video, every caption must name the video it belongs to.' })
    } else if (assets.get(cue.mediaAssetId)?.kind !== 'video') {
      context.addIssue({ code: 'custom', path: ['cues', index, 'mediaAssetId'], message: 'mediaAssetId must reference a video asset.' })
    }
    if (cue.captionTrackId === undefined) {
      if (hasCaptionTracks) context.addIssue({ code: 'custom', path: ['cues', index, 'captionTrackId'], message: 'Once the project has a caption track, every caption must name the one it belongs to.' })
    } else if (!captionTracks.has(cue.captionTrackId)) {
      context.addIssue({ code: 'custom', path: ['cues', index, 'captionTrackId'], message: 'captionTrackId must reference a caption track that exists.' })
    }
  }
})

/**
 * Schema 9: frame-paint effects (docs/EDITING.md "Frame-paint effects"). `project.effects` holds
 * vignette, letterbox and fade regions — sequence-timed like blur and zoom, painted by the shared
 * caption/overlay host layer rather than an FFmpeg filter (`src/core/frameEffects.ts`). Unlike
 * zoom's one lane, each effect *kind* has its own non-overlap rule below: two vignettes may not
 * overlap, but a vignette and a letterbox may. `effects` defaults to `[]`, so parsing a schema-8
 * file through it back-fills an empty list — `migrateV8.ts` only bumps the version.
 */
export const projectSchemaV9 = z.object({
  schemaVersion: z.literal(9),
  ...projectCommonShape,
  assets: z.array(projectAssetSchema).max(1000).default([]),
  tracks: z.array(trackSchema).max(64).default([]),
  clips: z.array(clipSchema).max(4000).default([]),
  captionTracks: z.array(captionTrackSchema).max(64).default([]),
  blurRegions: z.array(blurRegionSchema).max(1000).default([]),
  zoomRegions: z.array(zoomRegionSchema).max(200).default([]),
  effects: z.array(effectRegionSchema).max(500).default([]),
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
  for (const [index, track] of project.captionTracks.entries()) claim(track.id, ['captionTracks', index], 'a caption track')
  for (const [index, clip] of project.clips.entries()) claim(clip.id, ['clips', index], 'a clip')
  for (const [index, region] of project.blurRegions.entries()) claim(region.id, ['blurRegions', index], 'a blur region')
  for (const [index, region] of project.zoomRegions.entries()) claim(region.id, ['zoomRegions', index], 'a zoom region')
  for (const [index, effect] of project.effects.entries()) claim(effect.id, ['effects', index], 'an effect')
  for (const [index, marker] of project.markers.entries()) claim(marker.id, ['markers', index], 'a marker')

  const assets = new Map(project.assets.map((asset) => [asset.id, asset]))
  const tracks = new Map(project.tracks.map((track) => [track.id, track]))
  const captionTracks = new Map(project.captionTracks.map((track) => [track.id, track]))
  const order = trackIndexMap(project.tracks)
  const compare = compareClips(order)
  for (const [index, clip] of project.clips.entries()) {
    const path = ['clips', index]
    const track = tracks.get(clip.trackId)
    if (!track) context.addIssue({ code: 'custom', path: [...path, 'trackId'], message: 'A clip must sit on a track that exists.' })
    else if ((track.kind === 'audio') !== (clip.kind === 'audio')) {
      context.addIssue({ code: 'custom', path: [...path, 'trackId'], message: track.kind === 'audio' ? 'An audio track holds only audio clips.' : 'A video track holds only video and image clips.' })
    }
    // A color or adjustment clip is generated: no asset, and its synthetic source range has no media to bound it.
    const asset = clip.kind === 'color' || clip.kind === 'adjustment' ? undefined : assets.get(clip.assetId)
    if (clip.kind === 'color' || clip.kind === 'adjustment') { /* nothing to reference */ }
    else if (asset?.kind !== clip.kind && !(clip.kind === 'audio' && asset?.kind === 'video')) context.addIssue({ code: 'custom', path: [...path, 'assetId'], message: `A ${clip.kind} clip must reference a ${clip.kind} asset.` })
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
  // Zoom regions share one lane over the whole program, so — like clips on a track — they must be
  // kept ascending and never overlap; every zoom command maintains this rather than the schema
  // silently re-sorting. A disabled region still claims its place in the lane, so bypassing one
  // never opens a gap another region could be dropped into and then have re-enabled overlap it.
  for (const [index, region] of project.zoomRegions.entries()) {
    const previous = project.zoomRegions[index - 1]
    if (previous && region.startUs < previous.endUs) {
      context.addIssue({ code: 'custom', path: ['zoomRegions', index], message: 'Zoom regions must be ascending and non-overlapping.' })
    }
  }
  // Each effect *kind* has its own lane: two vignettes must be ascending and non-overlapping, the
  // same rule zoom regions follow, but a vignette and a letterbox (different kinds) may freely
  // overlap in time — `effectCommands.ts` only ever compares a region against others of its kind.
  const lastEndByKind = new Map<string, number>()
  for (const [index, effect] of project.effects.entries()) {
    const previousEnd = lastEndByKind.get(effect.kind)
    if (previousEnd !== undefined && effect.startUs < previousEnd) {
      context.addIssue({ code: 'custom', path: ['effects', index], message: 'Effects of the same kind must be ascending and non-overlapping.' })
    }
    lastEndByKind.set(effect.kind, Math.max(previousEnd ?? 0, effect.endUs))
  }
  // Captions name the video their source time belongs to. Required once the sequence has video;
  // when present it must always be a real video asset.
  const hasVideo = project.clips.some((clip) => clip.kind === 'video')
  // Captions name their caption track the same way. Required once the project has one; a project
  // always has a default caption track once anything has stamped it (`bindUnboundItems`), so in
  // practice this only stays optional for a project with no captionTracks at all.
  const hasCaptionTracks = project.captionTracks.length > 0
  for (const [index, cue] of project.cues.entries()) {
    if (cue.mediaAssetId === undefined) {
      if (hasVideo) context.addIssue({ code: 'custom', path: ['cues', index, 'mediaAssetId'], message: 'Once the sequence has video, every caption must name the video it belongs to.' })
    } else if (assets.get(cue.mediaAssetId)?.kind !== 'video') {
      context.addIssue({ code: 'custom', path: ['cues', index, 'mediaAssetId'], message: 'mediaAssetId must reference a video asset.' })
    }
    if (cue.captionTrackId === undefined) {
      if (hasCaptionTracks) context.addIssue({ code: 'custom', path: ['cues', index, 'captionTrackId'], message: 'Once the project has a caption track, every caption must name the one it belongs to.' })
    } else if (!captionTracks.has(cue.captionTrackId)) {
      context.addIssue({ code: 'custom', path: ['cues', index, 'captionTrackId'], message: 'captionTrackId must reference a caption track that exists.' })
    }
  }
})

/** Schema 10 adds independent sequence-timed authored text layers. The schema-9 validator is
 * retained as the base validation contract; then text IDs are checked against its full namespace. */
export const projectSchemaV10 = z.object({
  ...projectSchemaV9.shape,
  schemaVersion: z.literal(10),
  textOverlays: z.array(textOverlaySchemaV21).max(1000).default([]),
}).superRefine((project, context) => {
  const old = projectSchemaV9.safeParse({ ...project, schemaVersion: 9 })
  if (!old.success) for (const issue of old.error.issues) context.addIssue({ code: 'custom', path: issue.path, message: issue.message })
  const ids = new Set<string>()
  for (const cue of project.cues) { ids.add(cue.id); for (const word of cue.words) ids.add(word.id) }
  for (const asset of project.assets) ids.add(asset.id)
  for (const track of project.tracks) ids.add(track.id)
  for (const track of project.captionTracks) ids.add(track.id)
  for (const clip of project.clips) ids.add(clip.id)
  for (const region of project.blurRegions) ids.add(region.id)
  for (const region of project.zoomRegions) ids.add(region.id)
  for (const effect of project.effects) ids.add(effect.id)
  for (const marker of project.markers) ids.add(marker.id)
  for (const [index, overlay] of project.textOverlays.entries()) {
    if (ids.has(overlay.id)) context.addIssue({ code: 'custom', path: ['textOverlays', index, 'id'], message: `IDs must be unique across the project; “${overlay.id}” is already in use.` })
    ids.add(overlay.id)
  }
})

/** Schema 11 adds the optional pan start rect (`zoomRegionSchema.fromRect`). No structural change
 * beyond that field, so validation delegates to the frozen schema-10 contract. */
export const projectSchemaV11 = z.object({
  ...projectSchemaV10.shape,
  schemaVersion: z.literal(11),
}).superRefine((project, context) => {
  const old = projectSchemaV10.safeParse({ ...project, schemaVersion: 10 })
  if (!old.success) for (const issue of old.error.issues) context.addIssue({ code: 'custom', path: issue.path, message: issue.message })
})

/** Schema 12 adds the optional `mask` on clips, text, caption tracks, blur and frame-paint effects.
 * Optional, so there is no structural change; validation delegates to the frozen schema-11 contract. */
export const projectSchemaV12 = z.object({
  ...projectSchemaV11.shape,
  schemaVersion: z.literal(12),
}).superRefine((project, context) => {
  const old = projectSchemaV11.safeParse({ ...project, schemaVersion: 11 })
  if (!old.success) for (const issue of old.error.issues) context.addIssue({ code: 'custom', path: issue.path, message: issue.message })
})

/** Schema 13 adds the `color` clip kind (solid/gradient backgrounds with optional preset motion). It
 * needs no asset, so it is exempt from the asset checks the inherited contract applies, and may only
 * sit on a video track (enforced by the shared track-kind rule). No data transform from 12. */
export const projectSchemaV13 = z.object({
  ...projectSchemaV12.shape,
  schemaVersion: z.literal(13),
}).superRefine((project, context) => {
  const old = projectSchemaV12.safeParse({ ...project, schemaVersion: 12 })
  if (!old.success) for (const issue of old.error.issues) context.addIssue({ code: 'custom', path: issue.path, message: issue.message })
})

/** Schema 14 adds the optional `speed` curve on video and audio clips (docs/EDITING.md "Clip speed").
 * Optional, so there is no data transform from 13; the clip schema itself carries the new field. */
export const projectSchemaV14 = z.object({
  ...projectSchemaV13.shape,
  schemaVersion: z.literal(14),
}).superRefine((project, context) => {
  const old = projectSchemaV13.safeParse({ ...project, schemaVersion: 13 })
  if (!old.success) for (const issue of old.error.issues) context.addIssue({ code: 'custom', path: issue.path, message: issue.message })
})

/** Schema 15 adds linked audio (docs/EDITING.md "Linked audio"): `linkId`/`detachedAudio` on clips,
 * `enabled` on every clip, `solo`/`volume` on tracks, and audio clips may play a video asset's sound.
 * All optional, so there is no data transform from 14. A link group holds at most one video clip. */
export const projectSchemaV15 = z.object({
  ...projectSchemaV14.shape,
  schemaVersion: z.literal(15),
}).superRefine((project, context) => {
  const old = projectSchemaV14.safeParse({ ...project, schemaVersion: 14 })
  if (!old.success) for (const issue of old.error.issues) context.addIssue({ code: 'custom', path: issue.path, message: issue.message })
  const videosByLink = new Map<string, number>()
  for (const [index, clip] of project.clips.entries()) {
    if (clip.kind !== 'video' && clip.kind !== 'audio') continue
    if (!clip.linkId) continue
    if (clip.kind === 'video') {
      if (videosByLink.has(clip.linkId)) context.addIssue({ code: 'custom', path: ['clips', index, 'linkId'], message: 'A link group holds at most one video clip.' })
      videosByLink.set(clip.linkId, index)
    }
  }
})

/** Schema 16 adds the `adjustment` clip kind and the `lut` asset kind (docs/EDITING.md "Color:
 * adjustment layers"). Both are additive to the shapes schema 15 already declares — `clipSchema` and
 * `projectAssetSchema` (`src/core/edit.ts`) already carry the new variants — so there is no data
 * transform from 15; only an adjustment clip whose grade names a `lut` asset needs a fresh check, since
 * that reference can't be expressed in the zod shape alone. */
export const projectSchemaV16 = z.object({
  ...projectSchemaV15.shape,
  schemaVersion: z.literal(16),
}).superRefine((project, context) => {
  const old = projectSchemaV15.safeParse({ ...project, schemaVersion: 15 })
  if (!old.success) for (const issue of old.error.issues) context.addIssue({ code: 'custom', path: issue.path, message: issue.message })
  const assets = new Map(project.assets.map((asset) => [asset.id, asset]))
  for (const [index, clip] of project.clips.entries()) {
    if (clip.kind !== 'adjustment' || clip.grade.input.type !== 'lut') continue
    if (assets.get(clip.grade.input.assetId)?.kind !== 'lut') {
      context.addIssue({ code: 'custom', path: ['clips', index, 'grade', 'input', 'assetId'], message: 'A LUT input must reference a lut asset.' })
    }
  }
})

/** Schema 17 adds `shapes`: sequence-timed vector graphics (docs/EDITING.md "Shapes"). Their IDs join
 * the project-wide namespace, checked here against every other kind including text. */
export const projectSchemaV17 = z.object({
  ...projectSchemaV16.shape,
  schemaVersion: z.literal(17),
  shapes: z.array(shapeSchemaV18).max(1000).default([]),
}).superRefine((project, context) => {
  const old = projectSchemaV16.safeParse({ ...project, schemaVersion: 16 })
  if (!old.success) for (const issue of old.error.issues) context.addIssue({ code: 'custom', path: issue.path, message: issue.message })
  const ids = new Set<string>()
  for (const cue of project.cues) { ids.add(cue.id); for (const word of cue.words) ids.add(word.id) }
  for (const asset of project.assets) ids.add(asset.id)
  for (const track of project.tracks) ids.add(track.id)
  for (const track of project.captionTracks) ids.add(track.id)
  for (const clip of project.clips) ids.add(clip.id)
  for (const region of project.blurRegions) ids.add(region.id)
  for (const region of project.zoomRegions) ids.add(region.id)
  for (const effect of project.effects) ids.add(effect.id)
  for (const marker of project.markers) ids.add(marker.id)
  for (const overlay of project.textOverlays) ids.add(overlay.id)
  for (const [index, shape] of project.shapes.entries()) {
    if (ids.has(shape.id)) context.addIssue({ code: 'custom', path: ['shapes', index, 'id'], message: `IDs must be unique across the project; “${shape.id}” is already in use.` })
    ids.add(shape.id)
  }
})

/** Schema 18 adds `blendMode` on picture clips and `opacity` on text overlays and caption tracks (docs/EDITING.md
 * "Layer opacity and blend"). All optional, so there is no data transform from 17; the version bump makes
 * older builds refuse files that use them. Its shapes still have no `blendMode`. */
export const projectSchemaV18 = z.object({
  ...projectSchemaV17.shape,
  schemaVersion: z.literal(18),
}).superRefine((project, context) => {
  const old = projectSchemaV17.safeParse({ ...project, schemaVersion: 17 })
  if (!old.success) for (const issue of old.error.issues) context.addIssue({ code: 'custom', path: issue.path, message: issue.message })
})

/** Schema 19 adds an optional `blendMode` on shapes (docs/EDITING.md "Layer opacity and blend"). Optional, so
 * there is no data transform from 18; the version bump makes older builds refuse files that use it. Its rect
 * shapes still have no `cornerRadii`. */
export const projectSchemaV19 = z.object({
  ...projectSchemaV18.shape,
  schemaVersion: z.literal(19),
  shapes: z.array(shapeSchemaV19).max(1000).default([]),
}).superRefine((project, context) => {
  const shapes = project.shapes.map(({ blendMode: _blendMode, ...shape }) => shape)
  const old = projectSchemaV18.safeParse({ ...project, schemaVersion: 18, shapes })
  if (!old.success) for (const issue of old.error.issues) context.addIssue({ code: 'custom', path: issue.path, message: issue.message })
})

/** Schema 20 adds an optional `cornerRadii` on rect shapes (docs/EDITING.md "Shapes"). Optional, so there is no
 * data transform from 19; the version bump makes older builds refuse files that use it. Its shapes have no `glass`. */
export const projectSchemaV20 = z.object({
  ...projectSchemaV19.shape,
  schemaVersion: z.literal(20),
  shapes: z.array(shapeSchemaV20).max(1000).default([]),
}).superRefine((project, context) => {
  const shapes = project.shapes.map((shape) => {
    if (shape.geometry.kind !== 'rect') return shape
    const { cornerRadii: _cornerRadii, ...geometry } = shape.geometry
    return { ...shape, geometry }
  })
  const old = projectSchemaV19.safeParse({ ...project, schemaVersion: 19, shapes })
  if (!old.success) for (const issue of old.error.issues) context.addIssue({ code: 'custom', path: issue.path, message: issue.message })
})

/** Schema 21 adds an optional `glass` look on shapes (docs/EDITING.md "Shapes"). Optional, so there is no data
 * transform from 20; the version bump makes older builds refuse files that use it. Its shapes and text overlays
 * have no `groupId`. */
export const projectSchemaV21 = z.object({
  ...projectSchemaV20.shape,
  schemaVersion: z.literal(21),
  shapes: z.array(shapeSchemaV21).max(1000).default([]),
}).superRefine((project, context) => {
  const shapes = project.shapes.map(({ glass: _glass, ...shape }) => shape)
  const old = projectSchemaV20.safeParse({ ...project, schemaVersion: 20, shapes })
  if (!old.success) for (const issue of old.error.issues) context.addIssue({ code: 'custom', path: issue.path, message: issue.message })
})

/** Schema 22 adds `groups` and an optional `groupId` on shapes and text overlays (docs/EDITING.md "Groups").
 * Both are optional, so the migration from 21 only moves the version. Its shapes have no `bubble` geometry and no `fitTo`. */
export const projectSchemaV22 = z.object({
  ...projectSchemaV21.shape,
  schemaVersion: z.literal(22),
  /** Absent = no groups. */
  groups: z.array(groupSchema).max(200).optional(),
  textOverlays: z.array(textOverlaySchema).max(1000).default([]),
  shapes: z.array(shapeSchemaV22).max(1000).default([]),
}).superRefine((project, context) => {
  const groupIds = new Set<string>()
  for (const [index, group] of (project.groups ?? []).entries()) {
    if (groupIds.has(group.id)) context.addIssue({ code: 'custom', path: ['groups', index, 'id'], message: `Group IDs must be unique; “${group.id}” is already in use.` })
    groupIds.add(group.id)
  }
  for (const [index, overlay] of project.textOverlays.entries()) {
    if (overlay.groupId !== undefined && !groupIds.has(overlay.groupId)) context.addIssue({ code: 'custom', path: ['textOverlays', index, 'groupId'], message: `Text “${overlay.id}” belongs to a group that does not exist.` })
  }
  for (const [index, shape] of project.shapes.entries()) {
    if (shape.groupId !== undefined && !groupIds.has(shape.groupId)) context.addIssue({ code: 'custom', path: ['shapes', index, 'groupId'], message: `Shape “${shape.id}” belongs to a group that does not exist.` })
  }
  const { groups: _groups, ...rest } = project
  const textOverlays = project.textOverlays.map(({ groupId: _groupId, ...overlay }) => overlay)
  const shapes = project.shapes.map(({ groupId: _groupId, ...shape }) => shape)
  const old = projectSchemaV21.safeParse({ ...rest, schemaVersion: 21, textOverlays, shapes })
  if (!old.success) for (const issue of old.error.issues) context.addIssue({ code: 'custom', path: issue.path, message: issue.message })
})

/** Schema 23 adds the `bubble` shape geometry and the optional `fitTo` / `fitPadding` on shapes (docs/EDITING.md "Shapes").
 * Both are optional or additive, so the migration from 22 only moves the version. */
export const projectSchema = z.object({
  ...projectSchemaV22.shape,
  schemaVersion: z.literal(23),
  shapes: z.array(shapeSchema).max(1000).default([]),
}).superRefine((project, context) => {
  const shapes = project.shapes.map(({ fitTo: _fitTo, fitPadding: _fitPadding, geometry, ...shape }) => ({
    ...shape,
    geometry: geometry.kind === 'bubble'
      ? { kind: 'rect' as const, rect: geometry.rect, cornerRadius: geometry.cornerRadius, ...(geometry.cornerRadii ? { cornerRadii: geometry.cornerRadii } : {}), rotation: geometry.rotation }
      : geometry,
  }))
  const old = projectSchemaV22.safeParse({ ...project, schemaVersion: 22, shapes })
  if (!old.success) for (const issue of old.error.issues) context.addIssue({ code: 'custom', path: issue.path, message: issue.message })
})

export type Cue = z.infer<typeof cueSchema>
export type CaptionWord = z.infer<typeof wordSchema>
export type CaptionProject = z.infer<typeof projectSchema>
export type CaptionProjectV22 = z.infer<typeof projectSchemaV22>
export type CaptionProjectV21 = z.infer<typeof projectSchemaV21>
export type CaptionProjectV20 = z.infer<typeof projectSchemaV20>
export type CaptionProjectV19 = z.infer<typeof projectSchemaV19>
export type CaptionProjectV18 = z.infer<typeof projectSchemaV18>
export type CaptionProjectV17 = z.infer<typeof projectSchemaV17>
export type CaptionProjectV16 = z.infer<typeof projectSchemaV16>
export type CaptionProjectV15 = z.infer<typeof projectSchemaV15>
export type CaptionProjectV12 = z.infer<typeof projectSchemaV12>
export type CaptionProjectV13 = z.infer<typeof projectSchemaV13>
export type CaptionProjectV14 = z.infer<typeof projectSchemaV14>
export type CaptionProjectV2 = z.infer<typeof projectSchemaV2>
export type CaptionProjectV3 = z.infer<typeof projectSchemaV3>
export type CaptionProjectV4 = z.infer<typeof projectSchemaV4>
export type CaptionProjectV5 = z.infer<typeof projectSchemaV5>
export type CaptionProjectV6 = z.infer<typeof projectSchemaV6>
export type CaptionProjectV7 = z.infer<typeof projectSchemaV7>
export type CaptionProjectV8 = z.infer<typeof projectSchemaV8>
export type CaptionProjectV9 = z.infer<typeof projectSchemaV9>
export type CaptionProjectV10 = z.infer<typeof projectSchemaV10>
export type CaptionProjectV11 = z.infer<typeof projectSchemaV11>
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
  migratedFrom: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | null
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

/** Schema 5 → 6, on top of an already-migrated (or already-parsed) schema-5 project. Its own notes
 * are always empty: adding one default caption track and stamping every cue with it is lossless. */
function toV6FromV5(project: CaptionProjectV5, newId: () => string): CaptionProjectV6 {
  return projectSchemaV6.parse(migrateV5(project, newId).project)
}

function toV6(project: CaptionProjectV4, newId: () => string): { project: CaptionProjectV6; notes: MigrationNote[] } {
  const migrated = migrateV4(project, newId)
  return { project: toV6FromV5(projectSchemaV5.parse(migrated.project), newId), notes: migrated.notes }
}

/** Schema 6 → 7, on top of an already-migrated (or already-parsed) schema-6 project. Its own notes
 * are always empty: an empty zoom-region list is lossless by construction — schema 6 had no zoom
 * concept to carry over (docs/EDITING.md "Zoom regions"). */
function toV7FromV6(project: CaptionProjectV6): CaptionProjectV7 {
  return projectSchemaV7.parse(migrateV6(project).project)
}

function toV7(project: CaptionProjectV4, newId: () => string): { project: CaptionProjectV7; notes: MigrationNote[] } {
  const migrated = toV6(project, newId)
  return { project: toV7FromV6(migrated.project), notes: migrated.notes }
}

/** Schema 7 → 8, on top of an already-migrated (or already-parsed) schema-7 project. Its own notes
 * are always empty: `enabled` defaults to `true` on `blurRegionSchema`/`zoomRegionSchema`, so
 * parsing through `projectSchemaV7` already back-fills every region — `migrateV7` only bumps the
 * version number. */
function toV8FromV7(project: CaptionProjectV7): CaptionProjectV8 {
  return projectSchemaV8.parse(migrateV7(project).project)
}

/** Schema 8 → 9, on top of an already-migrated (or already-parsed) schema-8 project. `effects`
 * defaults to `[]` on `projectSchema`, so `migrateV8` only bumps the version number. */
function toV9FromV8(project: CaptionProjectV8): CaptionProjectV9 {
  return projectSchemaV9.parse(migrateV8(project).project)
}

function toV9(project: CaptionProjectV4, newId: () => string): { project: CaptionProjectV9; notes: MigrationNote[] } {
  const migrated = toV7(project, newId)
  return { project: toV9FromV8(toV8FromV7(migrated.project)), notes: migrated.notes }
}

function toV10FromV9(project: CaptionProjectV9): CaptionProjectV10 {
  return projectSchemaV10.parse(migrateV9(project).project)
}

/** Schema 10 → 11: `fromRect` is optional, so only the version number changes. */
function toV11FromV10(project: CaptionProjectV10): CaptionProjectV11 {
  return projectSchemaV11.parse(migrateV10(project).project)
}

/** Schema 11 → 12: `mask` is optional, so only the version number changes. */
function toV12FromV11(project: CaptionProjectV11): CaptionProjectV12 {
  return projectSchemaV12.parse(migrateV11(project).project)
}

/** Schema 12 → 13: the `color` clip kind is additive, so only the version number changes. */
function toV13FromV12(project: CaptionProjectV12): CaptionProjectV13 {
  return projectSchemaV13.parse(migrateV12(project).project)
}

/** Schema 13 → 14: `speed` is optional, so only the version number changes. */
function toV14FromV13(project: CaptionProjectV13): CaptionProjectV14 {
  return projectSchemaV14.parse(migrateV13(project).project)
}

/** Schema 14 → 15: every new field is optional, so only the version number changes. */
function toV15FromV14(project: CaptionProjectV14): CaptionProjectV15 {
  return projectSchemaV15.parse(migrateV14(project).project)
}
const toV15FromV13 = (project: CaptionProjectV13): CaptionProjectV15 => toV15FromV14(toV14FromV13(project))

/** Schema 15 → 16: the new clip/asset kinds are additive, so only the version number changes. */
function toV16FromV15(project: CaptionProjectV15): CaptionProjectV16 {
  return projectSchemaV16.parse(migrateV15(project).project)
}

/** Schema 16 → 17: `shapes` starts empty. */
function toV17FromV16(project: CaptionProjectV16): CaptionProjectV17 {
  return projectSchemaV17.parse(migrateV16(project).project)
}
const toV17FromV15 = (project: CaptionProjectV15): CaptionProjectV17 => toV17FromV16(toV16FromV15(project))

/** Schema 17 → 18: every new field is optional, so only the version number changes. */
const toV18FromV17 = (project: CaptionProjectV17): CaptionProjectV18 => projectSchemaV18.parse(migrateV17(project).project)
/** Schema 18 → 19: `blendMode` on shapes is optional, so only the version number changes. */
const toV19FromV18 = (project: CaptionProjectV18): CaptionProjectV19 => projectSchemaV19.parse(migrateV18(project).project)
/** Schema 19 → 20: `cornerRadii` on rect shapes is optional, so only the version number changes. */
const toV20FromV19 = (project: CaptionProjectV19): CaptionProjectV20 => projectSchemaV20.parse(migrateV19(project).project)
/** Schema 20 → 21: `glass` on shapes is optional, so only the version number changes. */
const toV21FromV20 = (project: CaptionProjectV20): CaptionProjectV21 => projectSchemaV21.parse(migrateV20(project).project)
/** Schema 21 → 22: `groups` starts empty. */
const toV22FromV21 = (project: CaptionProjectV21): CaptionProjectV22 => projectSchemaV22.parse(migrateV21(project).project)
/** Schema 22 → 23: `bubble` geometry and `fitTo` are additive, so only the version number changes. */
const toV23FromV22 = (project: CaptionProjectV22): CaptionProject => projectSchema.parse(migrateV22(project).project)
const toV23FromV20 = (project: CaptionProjectV20): CaptionProject => toV23FromV22(toV22FromV21(toV21FromV20(project)))
const toV20FromV18 = (project: CaptionProjectV18): CaptionProjectV20 => toV20FromV19(toV19FromV18(project))
const toV20FromV17 = (project: CaptionProjectV17): CaptionProjectV20 => toV20FromV18(toV18FromV17(project))
const toV20FromV16 = (project: CaptionProjectV16): CaptionProjectV20 => toV20FromV17(toV17FromV16(project))
const toV20FromV15 = (project: CaptionProjectV15): CaptionProjectV20 => toV20FromV17(toV17FromV15(project))

/** `newId` mints the ids a migration needs (assets, clips, tracks); injectable for tests. */
export function loadProject(value: unknown, newId: () => string = () => crypto.randomUUID()): ProjectLoadResult {
  const current = projectSchema.safeParse(value)
  if (current.success) return { project: current.data, migratedFrom: null, migrationNotes: [] }
  const from = (migratedFrom: 1 | 2 | 3 | 4, v4: CaptionProjectV4): ProjectLoadResult => {
    const { project, notes } = toV9(v4, newId)
    return { project: toV23FromV20(toV20FromV15(toV15FromV13(toV13FromV12(toV12FromV11(toV11FromV10(toV10FromV9(project))))))), migratedFrom, migrationNotes: notes }
  }
  const v22 = projectSchemaV22.safeParse(value)
  if (v22.success) return { project: toV23FromV22(v22.data), migratedFrom: 22, migrationNotes: [] }
  const v21 = projectSchemaV21.safeParse(value)
  if (v21.success) return { project: toV23FromV22(toV22FromV21(v21.data)), migratedFrom: 21, migrationNotes: [] }
  const v20 = projectSchemaV20.safeParse(value)
  if (v20.success) return { project: toV23FromV20(v20.data), migratedFrom: 20, migrationNotes: [] }
  const v19 = projectSchemaV19.safeParse(value)
  if (v19.success) return { project: toV23FromV20(toV20FromV19(v19.data)), migratedFrom: 19, migrationNotes: [] }
  const v18 = projectSchemaV18.safeParse(value)
  if (v18.success) return { project: toV23FromV20(toV20FromV18(v18.data)), migratedFrom: 18, migrationNotes: [] }
  const v17 = projectSchemaV17.safeParse(value)
  if (v17.success) return { project: toV23FromV20(toV20FromV17(v17.data)), migratedFrom: 17, migrationNotes: [] }
  const v16 = projectSchemaV16.safeParse(value)
  if (v16.success) return { project: toV23FromV20(toV20FromV16(v16.data)), migratedFrom: 16, migrationNotes: [] }
  const v15 = projectSchemaV15.safeParse(value)
  if (v15.success) return { project: toV23FromV20(toV20FromV15(v15.data)), migratedFrom: 15, migrationNotes: [] }
  const v14 = projectSchemaV14.safeParse(value)
  if (v14.success) return { project: toV23FromV20(toV20FromV15(toV15FromV14(v14.data))), migratedFrom: 14, migrationNotes: [] }
  const v13 = projectSchemaV13.safeParse(value)
  if (v13.success) return { project: toV23FromV20(toV20FromV15(toV15FromV13(v13.data))), migratedFrom: 13, migrationNotes: [] }
  const v12 = projectSchemaV12.safeParse(value)
  if (v12.success) return { project: toV23FromV20(toV20FromV15(toV15FromV13(toV13FromV12(v12.data)))), migratedFrom: 12, migrationNotes: [] }
  const v11 = projectSchemaV11.safeParse(value)
  if (v11.success) return { project: toV23FromV20(toV20FromV15(toV15FromV13(toV13FromV12(toV12FromV11(v11.data))))), migratedFrom: 11, migrationNotes: [] }
  const v10 = projectSchemaV10.safeParse(value)
  if (v10.success) return { project: toV23FromV20(toV20FromV15(toV15FromV13(toV13FromV12(toV12FromV11(toV11FromV10(v10.data)))))), migratedFrom: 10, migrationNotes: [] }
  const v9 = projectSchemaV9.safeParse(value)
  if (v9.success) return { project: toV23FromV20(toV20FromV15(toV15FromV13(toV13FromV12(toV12FromV11(toV11FromV10(toV10FromV9(v9.data))))))), migratedFrom: 9, migrationNotes: [] }
  const v8 = projectSchemaV8.safeParse(value)
  if (v8.success) return { project: toV23FromV20(toV20FromV15(toV15FromV13(toV13FromV12(toV12FromV11(toV11FromV10(toV10FromV9(toV9FromV8(v8.data)))))))), migratedFrom: 8, migrationNotes: [] }
  const v7 = projectSchemaV7.safeParse(value)
  if (v7.success) return { project: toV23FromV20(toV20FromV15(toV15FromV13(toV13FromV12(toV12FromV11(toV11FromV10(toV10FromV9(toV9FromV8(toV8FromV7(v7.data))))))))), migratedFrom: 7, migrationNotes: [] }
  const v6 = projectSchemaV6.safeParse(value)
  if (v6.success) return { project: toV23FromV20(toV20FromV15(toV15FromV13(toV13FromV12(toV12FromV11(toV11FromV10(toV10FromV9(toV9FromV8(toV8FromV7(toV7FromV6(v6.data)))))))))), migratedFrom: 6, migrationNotes: [] }
  const v5 = projectSchemaV5.safeParse(value)
  if (v5.success) return { project: toV23FromV20(toV20FromV15(toV15FromV13(toV13FromV12(toV12FromV11(toV11FromV10(toV10FromV9(toV9FromV8(toV8FromV7(toV7FromV6(toV6FromV5(v5.data, newId))))))))))), migratedFrom: 5, migrationNotes: [] }
  const v4 = projectSchemaV4.safeParse(value)
  if (v4.success) return from(4, v4.data)
  const v3 = projectSchemaV3.safeParse(value)
  if (v3.success) return from(3, migrateV3(v3.data, newId))
  const v2 = projectSchemaV2.safeParse(value)
  if (v2.success) return from(2, migrateV3(migrateV2(v2.data), newId))
  // A file that claims the current (or a previous, still-named) schema but fails it reports
  // *that* failure, not schema 1's.
  if (typeof value === 'object' && value !== null && (value as { schemaVersion?: unknown }).schemaVersion === 23) projectSchema.parse(value)
  if (typeof value === 'object' && value !== null && (value as { schemaVersion?: unknown }).schemaVersion === 22) projectSchemaV22.parse(value)
  if (typeof value === 'object' && value !== null && (value as { schemaVersion?: unknown }).schemaVersion === 21) projectSchemaV21.parse(value)
  if (typeof value === 'object' && value !== null && (value as { schemaVersion?: unknown }).schemaVersion === 20) projectSchemaV20.parse(value)
  if (typeof value === 'object' && value !== null && (value as { schemaVersion?: unknown }).schemaVersion === 19) projectSchemaV19.parse(value)
  if (typeof value === 'object' && value !== null && (value as { schemaVersion?: unknown }).schemaVersion === 18) projectSchemaV18.parse(value)
  if (typeof value === 'object' && value !== null && (value as { schemaVersion?: unknown }).schemaVersion === 17) projectSchemaV17.parse(value)
  if (typeof value === 'object' && value !== null && (value as { schemaVersion?: unknown }).schemaVersion === 16) projectSchemaV16.parse(value)
  if (typeof value === 'object' && value !== null && (value as { schemaVersion?: unknown }).schemaVersion === 15) projectSchemaV15.parse(value)
  if (typeof value === 'object' && value !== null && (value as { schemaVersion?: unknown }).schemaVersion === 14) projectSchemaV14.parse(value)
  if (typeof value === 'object' && value !== null && (value as { schemaVersion?: unknown }).schemaVersion === 13) projectSchemaV13.parse(value)
  if (typeof value === 'object' && value !== null && (value as { schemaVersion?: unknown }).schemaVersion === 12) projectSchemaV12.parse(value)
  if (typeof value === 'object' && value !== null && (value as { schemaVersion?: unknown }).schemaVersion === 11) projectSchemaV11.parse(value)
  if (typeof value === 'object' && value !== null && (value as { schemaVersion?: unknown }).schemaVersion === 10) projectSchemaV10.parse(value)
  if (typeof value === 'object' && value !== null && (value as { schemaVersion?: unknown }).schemaVersion === 9) projectSchemaV9.parse(value)
  if (typeof value === 'object' && value !== null && (value as { schemaVersion?: unknown }).schemaVersion === 8) projectSchemaV8.parse(value)
  if (typeof value === 'object' && value !== null && (value as { schemaVersion?: unknown }).schemaVersion === 7) projectSchemaV7.parse(value)
  if (typeof value === 'object' && value !== null && (value as { schemaVersion?: unknown }).schemaVersion === 6) projectSchemaV6.parse(value)
  if (typeof value === 'object' && value !== null && (value as { schemaVersion?: unknown }).schemaVersion === 5) projectSchemaV5.parse(value)
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

/** A new project's default caption lane: one caption track, exactly what every project had
 * (implicitly, as the one hardcoded captions row) before schema 6. */
export function defaultCaptionTracks(newId: () => string = () => crypto.randomUUID()) {
  return [{ id: newId(), name: '', locked: false }]
}

export function createProject(): CaptionProject {
  const now = new Date().toISOString()
  return {
    schemaVersion: 23,
    id: crypto.randomUUID(),
    title: 'Untitled project',
    cues: [],
    assets: [],
    tracks: defaultTracks(),
    clips: [],
    captionTracks: defaultCaptionTracks(),
    blurRegions: [],
    zoomRegions: [],
    effects: [],
    textOverlays: [],
    shapes: [],
    markers: [],
    createdAt: now,
    updatedAt: now,
  }
}
