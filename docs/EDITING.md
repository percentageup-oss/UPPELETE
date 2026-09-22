# Video edits: from single-source (V1–V6) to a stacked multi-track timeline (schema 5)

Status: **schema 5 — a stacked multi-track timeline — implemented 2026-09-19** (see "Schema 5" below;
it is the current model and supersedes the schema 3/4 time model the earlier sections describe, which
are kept as the history of how items, cuts and clips were introduced). Design accepted 2026-09-16;
schema 4 / multi-clip foundation 2026-09-19; **V1 implemented 2026-09-17** (schema 3, `sequence.ts`, generic
timeline items/tracks/selection, item commands, manifest v2 and the cut-skipping playback
controller); **V2 implemented 2026-09-18** (image overlays: asset import/relink IPC, preview/export
compositing, overlay track and inspector); V3-V6 not implemented. This document is the contract the V tickets in `tickets.md`
implement. It is deliberately narrow: **one source video**, a kept-range
edit list, time-ranged image overlays, static blur rectangles and inserted sound effects. Multi-clip
sequencing, transitions, keyframed or tracked effects and multitrack compositions stay deferred
(`PRODUCT.md`).

## Relationship to export (X1–X3)

Every edit has a preview half and an export half. The export half rides on the X1/X2 pipeline
([ADR 0003](decisions/0003-export-renderer.md)): the separate GPU export host renders a transparent
caption *layer* per output frame with the shared `CaptionView` and streams PNG frames into the media
worker, which feeds FFmpeg `image2pipe` on `pipe:0` and overlays the layer onto the decoded source.
Edits extend that split without changing it:

| Edit | Preview | Export |
| --- | --- | --- |
| Image overlay | `<img>` sibling of `CaptionView` inside the same scaled composition wrapper | Rendered **into the same transparent layer** by the export host (exact parity, no FFmpeg work) |
| Blur region | `backdrop-filter: blur(r)` div under the overlays/captions | FFmpeg `split/crop/gblur/overlay` on the source **before** the layer overlay, `enable` in sequence time; parity is a measured tolerance |
| Sound effect | Web Audio `AudioBufferSourceNode`s scheduled against the `<video>` clock | FFmpeg `atrim/adelay/volume` per clip, `amix=normalize=0` with the source audio |
| Trim / cut | Playback controller skips removed source ranges; ruler shows sequence time | FFmpeg `trim/atrim + setpts` per kept segment, `concat`; layer frames rendered per **sequence** frame at the mapped **source** timestamp |

The export host never decodes video; FFmpeg never renders text. Arbitrary FFmpeg flags never cross
the worker boundary — a versioned manifest does (`MEDIA_WORKER.md`).

## Time: source stays canonical

Captions, words, overlays, blur regions and audio-clip anchors are stored in **source-time
microseconds**, unchanged by cuts. Cuts are an ordered list of kept source ranges (`segments`). A
project without `segments` is the identity edit (whole media). **Sequence time** — the output
timeline after cuts — exists only in: the timeline ruler and playhead position, the transport clock,
the SRT exported for a cut video, export frame iteration and the manifest's `enable`/`adelay`
values. `src/core/sequence.ts` (V1) is the single pure mapper:

| Function | Semantics |
| --- | --- |
| `effectiveSegments(segments, mediaDurationUs)` | Absent → `[{0, duration}]`; unknown duration → `[{0, MAX_SAFE_INTEGER}]` |
| `sequenceDurationUs(segments, mediaDurationUs)` | Sum of kept ranges |
| `sourceToSequence(sourceUs, segments) → {sequenceUs, kept}` | Removed source times collapse to the cut instant (end of the preceding kept segment) |
| `sequenceToSource(sequenceUs, segments)` | Inverse on `[0, duration]`; a cut instant maps to the **start of the following** segment; clamps outside |
| `spansInSequence(range, segments)` | Intersection of a source range with each kept segment, in sequence time (timeline blocks, SRT) |
| `nextKeptSourceUs(sourceUs, segments)` | `null` when kept, next segment start when inside a removed range, `-1` past the last segment |
| `setTrim`, `splitSegmentAt`, `removeSegment`, `joinWithNext` | EDL edits; results stay ascending and non-overlapping |
| `cuesInSequence(cues, segments)` | Source cues → clipped sequence-time cues for SRT export; fully removed cues/words are dropped |

**Cues that straddle a cut are clipped for display and export, never split in storage.** A cue
spanning a cut is drawn as up to N timeline blocks, is selected/dragged as one cue, and
`captionFrame(layout, cue, sourceUs)` is unchanged because playback and export never visit removed
source times. Undoing a cut therefore restores captions exactly; word containment (`model.ts`) is
never rewritten. Fully removed cues remain in `project.cues` and show a "removed by cut" badge.

Consumers that switch to sequence time in V1: `Timeline.tsx` ruler/ticks, playhead position,
click-to-seek, block `left/width`, snap targets, zoom anchor; `App.tsx` `durationUs`, transport
clock, `seekBy`. Consumers that stay in source time: `currentUs` state, cues/words, `captionFrame`,
transcription (`workers/transcription/run.ts`), item `startUs/endUs`, `audioClips.atUs`, every
media-worker request and cache key (waveform/thumbnail strips are drawn per segment from
source-keyed data via a pure `waveformSlice`).

## Schema 3

`src/core/edit.ts` (new) defines the item schemas; `src/core/model.ts` composes them.

```ts
compositionRectSchema  { x, y, width, height }   // composition units: 1080 wide, height = 1080 / display aspect
projectAssetSchema     projectMediaSchema.extend({ id, kind: 'image' | 'audio' })
imageOverlaySchema     { id, startUs, endUs, assetId, rect, opacity = 1, fit = 'contain' | 'cover' | 'stretch' }
blurRegionSchema       { id, startUs, endUs, rect, radius: 1..100 }   // Gaussian sigma in composition units
audioClipSchema        { id, assetId, atUs, inPointUs = 0, durationUs | null, gain: 0..4 }   // atUs is a source-time anchor
segmentSchema          { id, startUs, endUs }
```

`projectSchema` becomes `schemaVersion: 3`; `media` stays singular; `assets`, `overlays`,
`blurRegions`, `audioClips` default to `[]`; `segments` is `optional()` with `min(1)` (absent means
identity, empty is rejected). `superRefine` enforces one ID namespace across cues, words, assets,
items and segments; `assetId` must reference an asset of the matching kind; segments must be
strictly ascending, non-overlapping and, when metadata duration is known, inside it. The rect
**width** bound is in the schema; the **height** bound depends on the runtime composition aspect
(`App.tsx` derives it from measured or probed aspect), so it is a command-time *warning* via
`CommandContext.compositionHeight` — a relink to a different aspect must never make a project
unloadable.

Assets reuse `projectMediaSchema` (`src/core/media.ts`) so `electron/projectMedia.ts`'s portable
relative paths, fingerprints and relinking apply unchanged; `projectForSave` loops assets through
`portableMediaReference`. `loadProject` tries 3 → 2 → 1; 2 → 3 adds the empty arrays and no
`segments`; `migratedFrom` becomes `1 | 2 | null`. `exportStartSchema` (`src/export/plan.ts`)
embeds `projectSchema`, so schema 3 reaches export without a second contract.

## Schema 5 (stacked multi-track timeline)

Implemented 2026-09-19. Schema 4 stored `assets[] + clips[]` but as a **flat list whose array index
was the position** — clips always touched, gaps were impossible and there was exactly one video
lane. Schema 5 is a true NLE model: named tracks, clips at **absolute** sequence positions, gaps
allowed, upper video tracks compositing over lower ones, audio in sequence time, and delivery all
the way through export. Importing a second video **adds a clip** (appended to V1); nothing replaces
the first video any more.

### Model (`src/core/edit.ts`, `src/core/model.ts`)

```ts
trackSchema  { id, kind: 'video' | 'audio', name = '', muted = false, hidden = false, locked = false, heightPx? }
clipBase     { id, trackId, assetId, timelineStartUs, sourceStartUs, sourceEndUs }        // absolute; gaps allowed
videoClip    { kind: 'video', ...clipBase, rect?, opacity = 1, fit = 'contain', gain = 1 } // rect absent = fill the frame
imageClip    { kind: 'image', ...clipBase, rect?, opacity = 1, fit = 'contain' }           // synthetic source range from 0
audioClip    { kind: 'audio', ...clipBase, gain = 1 }
clipSchema   discriminatedUnion('kind', [video, image, audio])
blurRegion   { id, startUs, endUs, rect, radius }                                          // sequence time, no asset
project      { schemaVersion: 5, ...common, assets, tracks, clips, blurRegions, format?: { width, height, frameRate } }
```

- **Stacking order is array order, back to front** (the convention `overlays` used). The timeline
  draws video tracks in reverse array order (V2 above V1) and audio tracks in array order. Empty
  track names derive V1/V2…/A1… from position (`trackLabel`).
- **A clip's length is always `sourceEndUs - sourceStartUs`.** There is deliberately no rate/speed
  field: keeping timeline length ≡ source length is what makes every mapping a pure translation. An
  image has no source time, so its source range is synthetic and kept anchored at 0 — one length
  formula, one trim gesture and one split for every kind.
- **`format` is load-bearing.** The caption composition is derived from it, not from the video under
  the playhead, so captions never re-layout when playback crosses into a video of another aspect. It
  is seeded from the first video's probe with exactly X2's `planFromMedia` rule (now
  `src/core/format.ts`'s `formatFromMedia`), and is the export's output frame.
- **`superRefine`** keeps the single ID namespace (cues, words, assets, tracks, clips, blur regions)
  and checks, in one pass: every clip's track exists; audio tracks hold audio and video tracks hold
  video/images; a clip's asset is of its own kind; **clips on one track never overlap**; clips are
  **sorted by `(track index, timelineStartUs, id)`** (array order carries no information any more, so
  sorting keeps diffs stable); video/audio stay within their file's known duration. `mediaAssetId`
  survives on **cues only**, required once the timeline has video.
- Retained verbatim for loading: `projectSchemaV4`, `projectSchemaV3`, `projectSchemaV2`, schema 1.

### Time model (`src/core/timelineModel.ts`)

**Captions stay source-anchored to their video; clips, blur and audio are sequence-anchored.**
Captions must stay in source time because every provenance record (`transcriptionRun.sourceRange`,
`alignmentRun.sourceRange`, `word.alignmentRunId`) is source time of one specific file; it also keeps
"undoing a cut restores captions exactly" structural — trimming a clip never touches a cue, the cue
merely stops being seen. Items authored against the program have no such argument, and moving them to
sequence time removes schema 4's accepted trade-off ("overlays, blur and sound effects cannot span a
clip boundary and disappear if their video leaves the sequence") and both of its silent-drop paths.

| Primitive | Meaning |
| --- | --- |
| `sequenceDurationUs(clips)` | end of the last clip on any track |
| `sequenceUsOf(clip, sourceUs)` / `sourceUsAt(clip, sequenceUs)` | pure translation within one clip |
| `activeClipsAt(sequenceUs, tracks, clips)` | **the core primitive**: one clip per track, back to front, half-open, a track in a gap contributing nothing; transport, compositing, caption choice and export all call it |
| `clipsContainingSource(assetId, sourceUs, clips)` | plural — a file may appear many times |
| `spansInSequence(range, assetId, clips)` | where a source range of one file is seen, one span per clip |
| `nextBoundaryAfter(sequenceUs, clips)` | the next clip start or end on any track (preroll) |
| `cuesInSequence(cues, clips)` | SRT export: contiguous spans stay one cue; a caption heard twice becomes one cue per run (render key `${id}:${n}`) |
| `activeCueAt(sequenceUs, tracks, clips, cues)` | **the one active-cue rule**, shared by the preview, the export layer plan and the export frame requests: the caption of the **topmost visible video track that has one**, evaluated at that clip's source time |

Consequences handled explicitly: a file placed twice renders its captions twice (they are heard
twice); dragging a caption maps the sequence-pixel delta back to a source delta **within the clip
the grabbed piece is seen through**, clamped to it; with no video at all (SRT first) captions are
timed in sequence time directly. The playhead lives in sequence time only — schema 4's "collapse to
the cut instant" is gone, since with gaps there is no well-defined collapse.

### Migration 4 → 5 (`src/core/migrateV4.ts`)

`loadProject` chains 5 ← 4 ← 3 ← 2 ← 1 and returns `migratedFrom: 1 | 2 | 3 | 4 | null` plus
`migrationNotes`, surfaced in the open notice (autosave stays suspended until an explicit Save).

1. **Tracks**: `V1` (always), overlay tracks above it, `A1..An`, and — only when needed — muted,
   hidden "Parked by migration" tracks.
2. **Video clips** land on V1 at schema 4's running prefix sums. **A migrated project is exactly
   gapless by construction**, which is what makes export parity structural (below).
3. **Overlays → image clips** at their schema-4 sequence spans. Contiguous spans (an overlay across a
   cut) merge into one clip; spans at separate moments (reordered or repeated video) become one clip
   each, first keeping the id, and are reported. Each overlay goes on the lowest overlay track above
   every *earlier* overlay it overlaps, so the preview's stacking is preserved exactly and no track
   holds an overlap. (This replaces the plan's reuse of `overlayLanes`, which assumed time-sorted
   input; `overlayLanes` is retired.)
4. **Sound effects → audio clips** at `sourceToSequenceForAsset(atUs)`, lane-packed onto A tracks.
   An open-ended `durationUs: null` becomes an explicit out point at the end of the file
   (`duration-resolved`), or a one-second placeholder when the file's length was never probed
   (`duration-placeholder`); both are reported.
5. **Blur regions** take the same span rule and drop `mediaAssetId`. In practice this never fires:
   export still refuses blur and there is no UI entry point.
6. **Cues** are untouched. 7. **`format`** is byte for byte what `planFromMedia` produced.

**Park, never drop**: an overlay or sound effect schema 4 no longer played (anchored inside a removed
range) goes onto a parked track at its best-guess position, and is reported. There is no 5 → 4
downgrade. `src/core/migrateV4.test.ts` pins "the migration does not move a single frame" against a
private copy of schema 4's own mapping: caption SRT output and every kept source time's sequence
position are identical before and after.

### Commands (`assetCommands.ts`, `trackCommands.ts`, `clipCommands.ts`, pure verbs in `clipEdits.ts`)

`itemCommands.ts` keeps the union, `validateItems` and the one epilogue (bind unbound captions →
`validateItems` → `projectSchema.safeParse`); `applyEditCommand`'s dispatch is unchanged.

- `asset-add/remove/update` — remove is refused while any clip plays the file or any caption is bound
  to it; a relink that changes a file's length refits its clips (never into the next clip on the
  track), and gives a never-probed video its whole V1 clip.
- `track-add/remove/update/reorder` — remove is refused while the track holds clips; reorder moves a
  track among tracks of its own kind with `overlay-reorder`'s forward/backward/front/back semantics.
- `clip-add` (with an optional inline asset and a track created in the same undo step), `clip-move`
  (within and **across** tracks of the same kind), `clip-trim`, `clip-split` (every unlocked clip under
  the playhead, or the selection), `clip-delete` (lift or ripple), `gap-close`, `clip-update`
  (rect/opacity/fit/gain; `rect: null` returns a picture-in-picture clip to full frame), `clips-set`
  (silence removal: each video keeps its kept source ranges, rippled **within its own track**),
  `clips-restore`, `format-set`, `blur-add/update/delete`.
- **Overwrite vs ripple** is one toolbar toggle (default overwrite), never a modifier. Overwrite never
  moves other clips — what an edit lands on is carved away; ripple pushes or pulls everything after
  the edit **on the same track** (cross-track ripple is deferred). A ripple insert never splits a clip:
  a point inside one moves to its nearer edge. Trims clamp to the source (`sourceStartUs ≥ 0`,
  `sourceEndUs ≤` the file's duration; images unbounded), to a 1 ms minimum and, in overwrite, to the
  neighbour. Locked tracks refuse every edit.

### Timeline (`src/Timeline.tsx`, `src/timeline/*`, `src/core/timelineLayout.ts`, `src/core/clipDrag.ts`)

Rows come from `project.tracks` (`timelineRows`): ruler, captions, video tracks top-down, a divider
splitting the video and audio stacks, audio tracks. Track headers edit the name (double-click), toggle
M/H/L, move up/down, remove (refused with clips, like `asset-remove`), and add video/audio tracks.
`ClipBlock` draws a clip with trim handles; video clips show a per-clip filmstrip of **their own
source range** and their sound as a waveform band, audio clips their sliced waveform. Clips move
within and across tracks (`trackAtY`, refusing audio↔video), Alt+drag clones, gaps offer "Close gap".
Snap targets are sequence time: every clip edge on every track, the playhead, 0, the sequence end and
caption edges (which fixes schema 4's note that snapping computed in source time). The caption row
(`CaptionsTrack`) is lifted from the old component with its LINE/WORD modes; word blocks are now
placed within the piece of the caption each block shows.

Keys: Delete lifts the selected clip, Shift+Delete ripple-deletes it, ⌘/Ctrl+B splits clips at the
playhead. **Per-clip thumbnails** go through `src/timeline/thumbnailQueue.ts`: cached by
`(fingerprint, source range, count)`, at most 8 requests in flight, and only for clips intersecting
the viewport — `THUMBNAIL_MAX_COUNT` bounds one request, not how many a long timeline makes.

### Playback (`src/playback/sequenceClock.ts`, `transport.ts`, `videoPool.ts`, `src/app/useProjectPlayback.ts`)

No single `<video>` owns the transport any more, so the stage's `<video controls>` is gone and the
transport row is the only one. `createSequenceClock` keeps `PlaybackClock`'s `subscribe/getUs/set`
shape (so `CaptionStage`'s `useSyncExternalStore` — the only per-frame subtree — is unchanged) and
free-runs from wall time × rate. Where a video plays on the topmost visible video track, the transport
**disciplines** the clock to that element's `requestVideoFrameCallback` time: small errors are slewed
(a quarter of the error per frame, at most 4 ms), errors beyond 40 ms snap. In a gap, or an
image/audio-only stretch, the clock free-runs — correct, since nothing is decoding. **The asymmetry
is documented, not hidden**: with several stacked videos there is no single presented frame, so
preview is approximately frame-accurate while export stays exact (it never plays; it iterates frames).

**The master video is disciplined, never drift-seeked.** A seek is what stops a decoder presenting
frames (hundreds of ms at 1440×2560), so re-seeking the playing master for drift only makes it fall
further behind. `transportActionsAt` therefore seeks the master (the topmost playing video, the one
`discipline` follows) only when the clock was just sought (`seekEpoch` changed — a scrub or ruler
click) or, as a last resort, when it is a full second out (`DEFAULT_PLAYING_DRIFT_LIMIT_US`);
everything smaller is the clock's job, via `discipline`. Every *other* playing video (picture-in-
picture, a lower track) has nothing disciplining it, so it is still re-seeked past 250 ms
(`DEFAULT_PLAYING_TOLERANCE_US`). Where `requestVideoFrameCallback` is missing the transport disciplines from
`currentTime` instead. Paused (scrubbing) elements are still held to within 20 ms.

**The transport follows the clock through `attach(clock)` / `detach()`**, called from
`useProjectPlayback`'s mount effect (as `SfxScheduler` is), not from the factory. React StrictMode
sets an effect up, tears it down and sets it up again on mount without re-running `useMemo`; a
subscription made in the memoised factory was lost for good, so the clock ran (timecode, captions)
while the video sat on its first frame. `detach` keeps the pooled elements loaded; the clock, pool
and transport live as long as the window and are not disposed on effect cleanup.

`videoPool` keeps one element per **(track, asset)** with an LRU cap of 6 — per track alone would
reload `src` between consecutive clips of different files; per clip would be unbounded. The pure
`transportActionsAt` decides load/seek/play/pause for every element on each clock change; ~500 ms
before a clip starts its element is **prerolled** (loaded and seeked, paused), since the seek is what
stalls a boundary. Elements are `muted` on a muted track or a silent clip, `volume = min(gain, 1)`:
**preview clamps gain above 1 to 1 and the inspector says so**; export honours it. Consecutive clips of
the *same* file on one track share an element, so a cut inside one video is still one seek (as before).
The boundary gap between different files has not been measured on real media yet (`STATUS.md`).

`SfxScheduler` attaches to the transport's state (`{ playing, rate, seekEpoch }`) rather than a
`<video>`; audio clips carry their sequence start, so its mapping and the "anchored inside a removed
range" drop are gone, and a muted track gives its clips gain 0. Mute and hide are read on every
evaluation, so toggles take effect while playing. Solo is deferred.

### Preview compositing (`CompositionLayers.tsx`, `ClipStageEditor.tsx`)

Everything paints inside the one projected composition wrapper (`useCompositionProjection`, now
actually factored out of `CaptionPreview`, whose size comes from `project.format`). `CompositionLayers`
paints a `CompositionLayer` union — `image`, `video`, `blur` — in the order given, `rect: null` meaning
fill. **Paint order, back to front: visual clips in track order → blur → captions.** (V4's plan put
blur *under* overlays; a `backdrop-filter` blurs what is painted below it, so it must sit above the
media.) Pooled `<video>`s are mounted by `VideoSlot`, which appends the transport's element rather than
letting React create one, so a layer-list change never reloads media. The stage is black wherever no
clip paints, like the exported canvas. **Picture-in-picture comes free**: `ClipStageEditor` (formerly
the overlay stage editor) edits any picture clip under the playhead that has a `rect`, video or image,
with the same rect math (`overlayRect.ts`); the inspector's Picture-in-picture toggle gives a
full-frame clip a rect.

### Export — manifest v3 (`src/export/plan.ts`, `workers/media/exportArguments.ts`, `export.ts`)

**Parity is a code path, not a coincidence.** `buildExportManifest` emits **manifest v2** — whose
encoder arguments are snapshot-pinned byte for byte — whenever `flatSequence(project)` holds: one
video's clips on one visible, unmuted track, gapless from 0, full frame, opaque, `contain`, unity
gain, nothing running past the video's end, and images only for the identity edit (one clip over the
whole file, where sequence time *is* source time, so image clips are exactly v2's host-painted
overlays). Every project that existed before schema 5 with one video is flat. Everything else is v3.
Both routes are kept permanently. (The plan also proposed promoting v1/v2 to v3 in
`normalizeManifest`; that was not done — v1/v2 keep their own snapshot-tested path.)

```ts
{ version: 3, cues, style, display, format: { width, height, frameRate }, sequenceDurationUs,
  inputs: [{ path, kind }],                                  // one per clip FFmpeg reads — never shared
  clips: [{ id, inputIndex, assetId, kind, trackIndex, timelineStartUs, sourceStartUs, sourceEndUs,
            rect?: pixelRect, opacity, fit, gain }],          // gain 0 = a video on a muted track
  overlays: [...],                                           // host-painted images, in SEQUENCE time
  blurRegions: [...] }
```

- **Every FFmpeg-read clip is its own input**, opened with `-ss <sourceStart> -t <length>` before `-i`
  (images: `-loop 1 -framerate R -t <length>`). This deviates from the plan (per-clip `trim` of shared
  inputs, `-ss` only on the identity route): with shared decoders a reordered or repeated clip, or a
  picture-in-picture of the same file, makes one consumer buffer another's decoded frames — potentially
  gigabytes of RGBA at 1080p. Separate inputs give every clip an independent decoder, a fast accurate
  seek and a PTS origin of 0; verified frame-exact on FFmpeg 9.0.1 (below). One export reads at most 250.
- **Route A — flat** (`v3Route`): one video track played end to end, full frame and opaque (the "two
  videos back to back" case). Each clip is scaled/padded to the output frame and `concat`enated; CFR
  conversion runs once after the concat, as v2's cuts do, so rounding never accumulates.
- **Route B — stacked**: `color=c=black:s=WxH:r=R:d=<sequence>,format=rgba` canvas; each visual clip,
  back to front, is fitted (`contain` letterboxes with **transparent** bars, `cover` crops, `stretch`
  distorts), given its opacity, and **`tpad`-ded with transparent frames up to its timeline start**, then
  `overlay=x:y:format=auto:eof_action=pass:repeatlast=0`. `tpad` means the overlay never stalls waiting
  for a clip; `eof_action=pass:repeatlast=0` means a clip's last frame never smears across a following
  gap. Then the caption layer, then `format=yuv420p`.
- **Audio**: silence pinned to the sequence length, plus every video clip's own sound (unmuted track,
  audio stream present) and every audio clip, each `atrim/asetpts/aresample/adelay/volume`, mixed with
  `amix=normalize=0:duration=first`. The plan's "latent `dropout_transition` bug" is not one: with
  `normalize=0` amix applies each input's weight directly and never renormalises, so v2 is unchanged.
- **Images and ADR 0003**: images stay painted by the export host into the caption layer — exact
  preview parity — **whenever every image track is above every video track** (titles, logos,
  watermarks). Only an image genuinely *under* a video is composited by FFmpeg, at a measured
  tolerance; see [ADR 0005](decisions/0005-stacked-export.md).
- **The layer plan** (`layerPlan.ts`) gained a `timeline` mode for v3: the shown caption comes from
  `activeCueAt` and overlays are sequence-timed; `captionFrame` reuse, signature-based PNG reuse and
  `spans()` are untouched.
- **Plumbing**: the worker task takes `inputPaths` (every file read; the destination must differ from
  all of them); the renderer sends only `{ requestId, project }` and main resolves **every** asset the
  timeline plays through its fingerprint registry, refusing by name before the job starts; the plan
  comes from `project.format`, falling back to the first video's probe. `PROTOCOL_VERSION` stays 1
  (nothing is persisted). Blur is still refused by both routes until V4.

**Verified with real FFmpeg 9.0.1** (h264_videotoolbox, this machine, 2026-09-19), using the builder's
own argv: Route A two different files back to back → 5.000 s / 125 frames, and with a per-frame
brightness counter the seek is frame-exact (output frame 0 is source frame 25, the last frame of the
first clip is its last source frame, the second file starts on the exact boundary frame); Route B with
a gap, a portrait clip letterboxed on V1, a half-opacity picture-in-picture on V2 and an image →
10.000 s / 250 frames, black gaps, no stall before a clip, no smear after one, transparent letterbox
over the black canvas, correct opacity.

### Per-video transcription, alignment, silence, waveforms and thumbnails

- A **video picker** (Captions panel, Remove Silence dialog) chooses the video these work on, defaulting
  to the one under the playhead on the topmost visible video track. The transcription panel is offered
  whenever the chosen video has no captions yet, so a second video can be transcribed after the first.
- **`captionsOverlappingRange` gained an asset filter.** It compared times only, so transcribing video
  B would have offered to replace video A's captions whose source times merely overlap numerically.
  `applyTranscription` binds new captions to the transcribed video and never removes another video's.
  Transcription and alignment runs record `mediaAssetId`. The transcribed video is captured when the
  job starts, since the picker may move on before the result arrives.
- **Silence removal** runs per video into `clips-set`, rippling each track that plays it.
- **Waveforms** are one map by asset id (the video's own and every audio file's), each extracted once
  per file and sliced per clip; the per-fingerprint cache in main is unchanged.
- No IPC changed for any of this — only which fingerprint is sent.

### Deferred, to keep this shippable

Transitions and crossfades (overlapping clips on one track); speed/retime (hence the length rule);
blur in export (V4); preview gain above 1; solo, track colours, nested sequences, ducking; cross-track
ripple; measuring the cross-file boundary gap on real media.

## Commands and undo (V1 history — see Schema 5 for the current commands)

`src/core/itemCommands.ts` adds a second discriminated union beside `CaptionCommand`, sharing
`CommandResult`/`ValidationIssue` from `captionCommands.ts` (issue kinds widened with
`asset-missing | asset-kind | rect-bounds | segment-order | segment-empty | gain-range | asset-in-use`):
`asset-add/remove`, `overlay-add/update/reorder`, `blur-add/update`, `audio-add/update`, `item-move`,
`item-resize`, `item-delete`, `trim-set/clear`, `segment-split/delete/join-next/resize`.
`src/core/commands.ts` exposes `applyEditCommand` dispatching on the union so `App.tsx`'s single
`runCommand` and `history.ts`'s whole-project snapshots give every item undo/redo for free.
`validateItems` runs after every item command exactly as `validateCaptions` does after every caption
command. `asset-remove` fails with `asset-in-use` while any overlay/clip references the asset.

## Timeline (V1 history — see Schema 5)

`src/core/timelineItems.ts` defines `TimelineItem { kind: 'cue' | 'overlay' | 'blur' | 'audio' |
'segment', id, startUs, endUs, label, bounds? }`, `Selection { kind, id }` and `TimelineTrack`.
`src/core/timeline.ts` extracts the cue-only clamp into `cueDragBounds` and adds `dragRangeBy`
(`dragCueBy` becomes a wrapper; `snapDelta` is already range-typed). `Timeline.tsx` replaces the
fixed CSS-variable grid rows with `gridTemplateRows` from a `tracks[]` list (the video/audio divider
becomes a track entry so the existing split logic is unchanged) and drags a `TimelineItem` rather
than a `Cue`. `App.tsx` replaces `selectedId` with `selection` and derives `selectedCueId` for the
existing read sites. The captions track keeps its specialised cue/word rendering.

## Preview compositing and playback (V1–V3 history — see Schema 5)

`src/captions/CompositionLayers.tsx` renders, inside the one projected and scaled wrapper that
`CaptionPreview.tsx` already positions (factored into `useCompositionProjection`), in order: blur
divs (`backdrop-filter`), overlay `<img>`s, then `CaptionView`. Because the wrapper is
`transform: scale()`, the CSS blur radius scales with it, matching `gblur sigma = radius ×
output.width / 1080` at export. The export host's frame harness renders the same component with
`renderBlur={false}`; `src/export/frameRequest.ts` gains a v2 carrying visible overlays and their
asset URLs. `index.html`'s CSP must add `media:` to `img-src` (overlays) and `connect-src` (SFX
decode).

`src/playback/SfxScheduler.ts` decodes each clip once (`fetch(media://…)` → `decodeAudioData`) and
reschedules on the video's `play`, `seeked`, `ratechange`, `pause`, `ended` and `volumechange`;
clips are placed at `sourceToSequence(atUs)` with a per-clip `GainNode`. Cut skips are seeks, so
`seeked` re-syncs; drift is bounded by seek latency and is measured in V3.

The playback controller builds on `src/core/playbackClock.ts`'s `requestVideoFrameCallback` clock:
per frame it updates `currentUs`, and when `nextKeptSourceUs` reports a removed range it seeks to
the next kept start (or pauses past the end). Expected preview behaviour is 0–1 removed frame
visible and one seek stall per cut; export is exact.

## Edit manifest v2 and filtergraph (still the exact route for flat sequences)

X2's `exportManifestSchema` v1 is `{ version: 1, cues, style }`; V1 adds v2 as a strict superset:

```ts
{ version: 2, cues, style,
  segments: [{ startUs, endUs }],                              // source, ascending; identity = [{0, duration}]
  overlays: [{ id, startUs, endUs, assetUrl, rect, opacity, fit }],   // consumed by the export host, not FFmpeg
  blurRegions: [{ id, sequence: { startUs, endUs }, rect: pixelRect, sigmaPx }],   // output pixels, sequence time
  audioClips: [{ id, path, delayUs, inPointUs, durationUs | null, gain }] }         // delayUs in sequence time
```

Main builds the manifest with pure `src/core/composition.ts` (`displayDimensions` — the rotation
swap currently inline in `App.tsx`; `compositionToPixels`; `compositionScalarToPixels`). FFmpeg
autorotates on decode, so `[0:v]` is already display-oriented; the builder never emits
`-noautorotate`. Because the composition aspect equals the display aspect, composition → output is
the single scalar `output.width / 1080`.

`workers/media/exportArguments.ts` becomes a deterministic builder over the manifest, snapshot-tested
on both the argument array and the filtergraph string. Regions and clips are sorted by
`(startUs, id)` before labels are assigned so output is independent of project order. When the
graph exceeds a few KiB it is written to the job directory and passed with `-filter_complex_script`
(Windows argv limit). Skeleton, in sequence time `t` after `setpts=PTS-STARTPTS`:

```
# cuts (omitted entirely for identity)
[0:v]trim=start=1.500000:end=4.250000,setpts=PTS-STARTPTS[v0]; [0:v]trim=start=6.000000:end=9.000000,setpts=PTS-STARTPTS[v1];
[v0][v1]concat=n=2:v=1:a=0[vcat];
[0:a]atrim=start=1.500000:end=4.250000,asetpts=PTS-STARTPTS[a0]; [0:a]atrim=...[a1]; [a0][a1]concat=n=2:v=0:a=1[acat];
#   (no source audio: anullsrc=r=48000:cl=stereo,atrim=end=<sequenceDuration>[acat])
# normalise once: CFR at output rate, output size, RGBA so crop offsets need not be even
[vcat]fps=fps=30000/1001:round=near,scale=W:H,setsar=1,format=rgba[vbase];
# blur regions, chained
[vbase]split=2[b0src][b0copy]; [b0copy]crop=w=320:h=180:x=100:y=50:exact=1,gblur=sigma=12.0:steps=2[b0blur];
[b0src][b0blur]overlay=x=100:y=50:format=auto:enable='between(t,2.000000,5.500000)'[v1b];
# caption/overlay layer from the export host (image2pipe input), then pixel format
[1:v]fps=fps=30000/1001:round=near,format=rgba[layer]; [v1b][layer]overlay=0:0:alpha=straight:format=auto:shortest=1[vrgba];
[vrgba]format=yuv420p[outv];
# sound effects: exact sample delays, per-clip gain, no renormalisation, length pinned to the video
[2:a]atrim=start=0.250000:end=1.750000,asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,adelay=delays=72000S:all=1,volume=0.800000[s0];
[acat]aresample=48000,aformat=channel_layouts=stereo[abase]; [abase][s0]amix=inputs=2:normalize=0:duration=first[outa]
```

`adelay` is expressed in samples at 48 kHz (`round(delayUs × 48000 / 1e6)`) so microsecond anchors
stay exact; `gblur` is used rather than `boxblur` because CSS `blur(r)` is Gaussian with σ = r;
`enable` expressions use six-decimal seconds from `usDecimal`. Layer frames are produced per output
frame by `src/core/layerPlan.ts`: it maps each sequence frame to its source timestamp, computes a
signature (active cue id, `captionFrame` state, visible overlay ids/opacities) and lets the export
host re-send the previous PNG bytes when the signature is unchanged — the same frame count on the
wire, far fewer paints. `captionFrame` is reused, never reimplemented.

Encoder: X2 selected `h264_videotoolbox` on macOS; a Windows encoder within the LGPL profile
(`libopenh264` is the candidate) remains an X2/D2 gate and is not changed by any V ticket.

## Ticket map

| Ticket | Delivers |
| --- | --- |
| V1 | ✅ Schema 3, `sequence.ts`, generic timeline items/tracks/selection, item commands, manifest v2 + builder refactor, cut-skipping playback on `playbackClock` |
| V2 | ✅ Image overlays: asset import/resolve/relink IPC, `CompositionLayers`, overlay track and inspector, layer export via frame request v2 |
| V3 | Sound effects: `SfxScheduler`, SFX track/inspector, audio filtergraph branch |
| V4 | Blur regions: stage rect tool, blur inspector, video filtergraph branch, measured parity tolerance |
| V5 | Trim in/out: I/O commands and shortcuts, sequence ruler, SRT in sequence time, single-segment export |
| V6 | Cuts: cut/delete/join segments, per-segment strips, multi-segment concat, straddling-caption behaviour |

## What V1 actually landed, and what it deliberately did not

V1 built the substrate and shipped **no new user-visible edit**. Two consequences matter for the
tickets that follow.

**FFmpeg still does exactly what X2 made it do.** `workers/media/exportArguments.ts` is now a
deterministic builder over the manifest, and for an identity edit with no effects it produces X2's
argument array byte for byte — that parity is pinned by `exportArguments.test.ts`, which passes
unchanged, plus argument-array and filtergraph snapshots. A manifest carrying anything else is
**refused with an explicit error** naming the ticket that will implement it, rather than silently
encoding a video without the edit:

| Manifest carries | Behaviour | Implemented by |
| --- | --- | --- |
| `segments` that are not the whole range | trim/concat filtergraph, sequence-time frame count | Remove Silence (2026-09-18), ahead of V6's manual UI |
| `blurRegions` | throws | V4 |
| `audioClips` | throws | V3 |
| `overlays` | frame request v2 to the export host; FFmpeg's filtergraph is unchanged | ✅ V2 (2026-09-18) |

V4/V3 each remove their line from `assertExportableManifest` and add the corresponding filtergraph
branch from the skeleton above, with their own measured smoke evidence. Cuts reached
`assertExportableManifest`/`exportFilterGraph` early, driven by the Remove Silence feature rather than
V6's own cut/delete/join UI — see `docs/STATUS.md`'s 2026-09-18 entry for exactly what landed and what
of V6 (the manual tools, and a real-media smoke test) is still open.

**The trim and segment commands exist but have no manual UI.** `trim-set`, `trim-clear`,
`segment-split`, `segment-delete`, `segment-join-next` and `segment-resize` are implemented and
unit-tested in `itemCommands.ts`; V5 and V6 add the shortcuts, toolbar actions and track rendering
that reach them. One entry point does exist ahead of either ticket: Remove Silence
(`src/SilenceRemovalDialog.tsx`, 2026-09-18) drives a new `segments-set` command that replaces the
whole edit list at once from a detector's output, rather than through the interactive split/delete/join
tools — so a project can carry `segments` today, and the sequence-time paths above are exercised by
real (automatic) cuts, not only by unit tests, once that dialog has been used.

`layerPlan` is wired into the real export loop: consecutive frames with an unchanged signature re-send
the previous PNG instead of being repainted, and no-cue frames stay cached for the whole export (X2's
gap-frame reuse, generalised). The frame count written to the encoder is unchanged.

Snapping still computes in source time while the threshold is derived from the sequence axis. That is
exact for the identity edit; V6 should revisit it once a cut can actually compress the axis.

## What V2 landed

Image overlays are import → preview → export, end to end, with no test-authored coverage this
session (see `docs/STATUS.md`'s 2026-09-18 V2 entry) — verification is a manual checklist instead.

**Asset paths never come from the project JSON at render or export time.** Exactly like the source
video, an asset's path is looked up in main's `inspectedMedia` fingerprint registry
(`electron/main.ts`), populated the moment the file is opened, imported or relinked. `project:open`
resolves every stored asset the same way it resolves the source media (`candidatePaths` +
`inspectMedia`) and rewrites a **resolved** asset's reference in place; a **missing** or **mismatched**
asset is left alone and flagged, and only gets a `media://` URL once the user relinks it. Exporting
with an unregistered overlay asset is refused before the job starts, naming the asset.

**The export host gained its own `media:` scheme**, allow-listed per job. `workers/media/export.ts`
passes each overlay's unique `assetUrl` as a `--asset <url>` argv entry when it spawns
`scripts/export-host.mjs`; the host registers the scheme privileged (mirroring `main.ts`) and serves
only those exact URLs from its window's session, via `mediaPathFromUrl` (now shared between main and
the host, `electron/projectMedia.ts`) and `net.fetch` on the resulting `file://` path. A frame request
with no visible overlay is still v1, byte for byte — `frameRequestAt` only emits v2 (with an
`overlays` array) for a frame that actually has one, so an unedited project's export path is
untouched.

**The Overlays timeline track exists only when `project.overlays.length > 0`** — an unedited project's
`Timeline.tsx` layout (row count, heights, snapshot markup) is unchanged from V1. Dragging/resizing an
overlay reuses the generic `dragRangeBy`/`itemDragBounds` path V1 built but never wired up; the caption
track's own `dragCueBy` path is untouched, kept as a separate branch rather than merged.

**Out of scope, deliberately**: audio assets (`assets:import`/`assets:relink` already take a `kind`,
so V3 reuses them rather than adding new IPC). Dragging/resizing the overlay rect directly on the
stage *was* deliberately deferred here (the inspector's x/y/width/height fields were the only way to
change it) — see "Overlay stage editing, stacking and clone" below for the pass that added it.

## Overlay stage editing, stacking and clone

Closes the gap V2 left open: overlays can now be moved, resized, stacked and cloned the way any
NLE handles them, without leaving the preview or losing the inspector's fields.

**Stacking order is array order.** `project.overlays` was sorted by `startUs` on every `overlay-add`
in V2; it is now append-only — a new overlay always lands at the end, i.e. on top, exactly like a
new layer in any editor. Both `CompositionLayers.tsx` (preview) and `plan.ts`'s manifest builder
already paint `project.overlays` in array order, so this one change makes array order *the*
z-order, front to back, with no reordering at either paint site. `itemCommands.ts` gained
`{ type: 'overlay-reorder', overlayId, direction: 'forward' | 'backward' | 'front' | 'back' }`,
splicing the overlay to a new array index; a no-op (already at the requested end) returns the
project unchanged, so it never spends an undo step. The inspector's Layer row (Bring
forward/Send backward, shown once there are 2+ overlays) is the only UI for it today.

**`src/core/overlayRect.ts`** is the pure geometry every manipulation surface shares: `moveRect`/
`resizeRect` (handle-anchored, corners keep aspect unless freed, clamped to the composition and a
16-unit minimum), `nudgeRect` (keyboard arrows), `roundRect` (commit-time rounding) and
`centerRect` (the inspector's Center/Center H/Center V actions). `overlayLanes` does the timeline
track's interval packing: overlapping overlays get separate lanes, walked from the *end* of the
array so the top-painted overlay lands in lane 0 (the top row).

**`src/OverlayStageEditor.tsx`** renders as a sibling of `CaptionStage` inside `.video-frame`,
reusing `projectCaptionViewport` (the same function `CaptionPreview` positions its own wrapper
with) to map composition units to screen pixels, so its hit boxes and handles always sit exactly on
the painted overlay. Only a visible overlay's hit box and handles are `pointer-events: auto`; the
wrapper itself is click-through, so the native `<video controls>` bar is unaffected. Drag/resize
draft into the live preview and commit one undo step per gesture, through the same
`onRectDraft`/`onRectCommit` pair the inspector's fields already used — the stage and the fields are
two views onto one draft/commit contract. **Alt+drag on an overlay's body clones it**: the drag
subject becomes a synthetic overlay with a new id (never present in `project.overlays`), shown by
`App.tsx`'s `visibleOverlays` appending rather than replacing when the draft's id isn't found;
release calls `overlay-add` with the placed copy, one undo step for the whole clone-and-place.
Escape mid-gesture cancels without committing.

**`Timeline.tsx`**'s Overlays track packs overlapping overlays into lanes the same way (`overlayLanes`
over the drag-preview list), growing the track only when overlays actually overlap in time — one
lane is the same height V2's fixed single-lane track used, so an unedited project's layout is
unchanged. Alt+drag on a timeline block clones in time the same way the stage clones in space:
`onOverlayDragCommit` gained an optional `{ clone?: boolean }`, and a clone commits through
`overlay-add` instead of `item-move`. Blocks are labelled by their asset's name once there is more
than one, instead of the constant "Image overlay".

## Left rail, media bin and drag-and-drop

The fixed transcript column became a CapCut-style icon rail (`src/LeftRail.tsx`, roving-tabindex
tablist copied from `InspectorTabs.tsx`) that switches a `.side-panel` between Media
(`src/MediaBin.tsx`), Captions (`src/CaptionsPanel.tsx` — `TranscriptCue`/`CaptionTools` moved out of
`App.tsx` unchanged), Overlays (`src/OverlaysPanel.tsx`) and Transitions (`src/TransitionsPanel.tsx`,
a thin wrapper around the unchanged `TemplatesPanel.tsx`, which the inspector's Templates tab
dropped — `InspectorTabs` is now Edit/Style only). Settings stays a button, opening the existing
dialog; it was never a panel and still isn't.

**Classification stays real, not extension-based.** `src/core/assetKind.ts`'s `classifyMedia`
extends the existing `classifyAsset` (image/audio) with a `'video'` outcome for any non-image-codec
video stream; `classifyAsset` is kept as a `classifyMedia` wrapper that still returns `null` for
video, so every existing caller and test is unaffected. A dropped `.srt` is read as text and never
probed (`electron/assetInspect.ts`'s `inspectFileForBin`, dependency-injected for tests). Schema 3's
`projectAssetSchema.kind` is still `'image' | 'audio'` only — Phase 1 keeps the single-source model,
so a video is never stored as an asset; it always goes through the existing replace-source flow
(`useMediaCandidate`), now reachable from the bin/stage/timeline too via `pendingReplaceSource`'s
confirmation (`App.tsx`'s `ReplaceVideoReview`).

**Drag payload** (`src/core/dragPayload.ts`): `dragover` cannot read `DataTransfer.getData` (browser
restriction), so a bin drag also mirrors its payload into a module-level variable set on
`dragstart`/cleared on `dragend`; `dropContent(dataTransfer)` reads that for a live in-window drag
and falls back to `getData`/the `Files` type for `drop` and for an out-of-window OS file drag.
`src/core/timelineDrop.ts`'s `dropPlanForAsset(kind, sequenceUs, toSource, mediaDurationUs)` is the
one place that decides what a drop does: image → a 3s overlay anchored at the drop point (reusing
`overlayDefaults.ts`, clamped to the known media end); audio → refused with "Sound effects arrive in
ticket V3" (the existing "Add at playhead" *button* path for a bin audio asset still works — it
reuses the same `audio-add` command the working `SfxScheduler` playback already ships; only the new
drag-to-an-arbitrary-point timeline gesture is refused, pending V3's own validation bar); video →
`replace-source` (Phase 2 changes this arm to insert a clip).

**Import paths** all funnel through `App.tsx`'s `addAssetsFromInspected(results, placement?)`:
the bin's Import… button (`assets:import-files`, multi-select), an OS drop onto the bin/stage/
timeline (`assets:inspect-dropped`, resolved to real paths inside the sandboxed preload via
`webUtils.getPathForFile` — the renderer never handles a path string for a bin import), or a bin-row
drag onto the timeline. A fingerprint match against an existing asset (`findAssetByFingerprint`,
mirroring `overlay-add`/`audio-add`'s own inline dedupe) reuses the asset instead of duplicating it.
`placement` (a sequence-time drop point) places only an image, as a single `overlay-add` step —
audio and video ignore it, matching the refusal above and the replace-source confirmation. An SRT
import (from any of these paths, or the File menu) never silently replaces existing captions:
`importSrtContent` shows `ReplaceCaptionsReview` first whenever `project.cues.length > 0`.

**`Timeline.tsx`** gained `onDropAsset`/`onDropFiles` on `.timeline-content`, driven by the same
`dropContent`; a `.drop-indicator` previews the drop point (and, for an image, its 3s placeholder
width) during `dragover` and is cleared on `dragleave`/`drop`.
