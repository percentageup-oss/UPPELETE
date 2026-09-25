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
the way through export. Importing a second video **adds a clip** (appended after the last clip on V1; the timeline draws headroom past the program end so drops and drags can go beyond it); nothing replaces
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
- **A clip's length is `sourceEndUs - sourceStartUs` unless it has a `speed` curve** (schema 14, video
  and audio clips only — see "Clip speed" below). Without one, every mapping is a pure translation.
  An image has no source time, so its source range is synthetic and kept anchored at 0 — one length
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
5. **Blur regions** take the same span rule and drop `mediaAssetId`. In practice this rarely fires
   against a real file: schema 4 predates the blur UI (V4).
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
  neighbour — except a neighbour that merely **continues** the clip (same file, same source↔sequence
  mapping, identical settings: the piece an overwrite carved off), which the trim passes over and
  carves away. So a clip cut by something dropped inside it heals back to full length by dragging its
  edge once that clip is removed (`continuesClip`, `clipEdits.ts`). An overwrite that splits a linked
  pair regroups the right-hand pieces into their own pair. An overwrite trim of a linked clip carries
  only partners whose same edge is in sync with it (`trimPartners`); ripple trims carry every partner.
  Locked tracks refuse every edit.

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
playhead, ⌘/Ctrl+C copies the selected clip/caption/text item and ⌘/Ctrl+V pastes a clone of it
(`shortcuts.ts`'s `copy-item`/`paste-item`, dispatched through `App.tsx`'s `copySelection`/
`pasteClipboard` against a `{ kind, id }` reference re-resolved at paste time — a caption clone gets
the `duplicate` `CaptionCommand`, mirroring the existing `clip-add`/`text-duplicate` copy paths).
**Per-clip thumbnails** go through `src/timeline/thumbnailQueue.ts`: cached by
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

**Playback proxies** (`src/app/usePlaybackProxies.ts`, `electron/playbackProxyService.ts`) are the fix
for a large source (a 4K import edited for a 1080p delivery): `videoPool` above always decodes some
*real* file, and neither `project.format` nor the export target changes that — only a genuinely
smaller preview file does. `urlOf` passed into `useProjectPlayback` is `usePlaybackProxies`'s wrapped
version, not `useAssetUrls`'s own; every other media consumer (export, transcription, waveform,
thumbnails, parity) keeps calling `useAssetUrls`'s `urlOf` directly and so never sees a proxy — proxy
substitution happens at exactly this one call site, nowhere else. A proxy is requested at most once
per fingerprint per session, generated in the background (queued on the same job scheduler as
transcription/export, so it never competes with either), cached outside Git by fingerprint, and only
ever used once re-probed and confirmed to match the source's duration. See docs/ARCHITECTURE.md
"Playback performance" for the full pipeline.

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
  (nothing is persisted). Blur reaches FFmpeg on both routes as of V4 (`blurPictureChain`).

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

Transitions and crossfades (overlapping clips on one track); freeze frame, reverse and smooth slow motion;
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
graph exceeds a few KiB it is written to the job directory and passed with `-/filter_complex <file>` (FFmpeg 7+; FFmpeg 8 removed `-filter_complex_script`)
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
| V3 | ✅ Sound effects: `SfxScheduler`, SFX track/inspector, audio filtergraph branch |
| V4 | ✅ Blur regions: Effects-panel tiles, timeline lane, blur inspector, stage rect gizmo, `split/crop/gblur/overlay` filtergraph branch (v2 and v3) — parity tolerance not yet measured (2026-09-23) |
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
| `blurRegions` | `split/crop/gblur/overlay`, `enable` in sequence time, before the zoom crop | ✅ V4 (2026-09-23) |
| `audioClips` | `amix` onto a fixed-duration base, exact sample delays, per-clip gain | ✅ V3 |
| `overlays` | frame request v2 to the export host; FFmpeg's filtergraph is unchanged | ✅ V2 (2026-09-18) |

`assertExportableManifest` is gone from `workers/media/exportArguments.ts` — every manifest field
this table lists now has a filtergraph branch, so there was nothing left for it to refuse. Cuts reached
`assertExportableManifest`/`exportFilterGraph` early, driven by the Remove Silence feature rather than
V6's own cut/delete/join UI — see `docs/STATUS.md`'s 2026-09-18 entry for exactly what landed and what
of V6 (the manual tools, and a real-media smoke test) is still open.

**Trim to playhead and the In/Out range (V5, 2026-09-24).** `Q`/`W` run `clip-trim-to` (trim one edge of the selected clip, or of every clip under the playhead, to the playhead). `I`/`O` set an In/Out range that is view state only: it dims the timeline outside it, stops playback at Out and limits MP4/SRT export through `projectInRange` (`src/core/sequenceRange.ts`), which crops clips and every sequence-time item and shifts them to start at 0 before the normal manifest builder runs. See `docs/STATUS.md` for limitations.

**The legacy segment commands (superseded by clips) exist but have no manual UI.** `trim-set`, `trim-clear`,
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
`App.tsx` unchanged), Overlays (`src/OverlaysPanel.tsx`), Titles (`src/TitlesPanel.tsx`, a thin
wrapper around the unchanged `TemplatesPanel.tsx`, which the inspector's Templates tab dropped —
`InspectorTabs` is now Edit/Style only) and Effects (`src/EffectsPanel.tsx`, a library of picture
effects grouped by section — Zoom is the first). Settings stays a button, opening the existing
dialog; it was never a panel and still isn't.

Titles and Effects were named Transitions and Zoom respectively until the effects library grew
past zoom; only the rail labels, icons and the two panel/test files were renamed (`git mv` from
`TransitionsPanel`/`ZoomPanel` — see "Zoom regions", below, for the data model, which keeps its
`project.zoomRegions` name).

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

## Zoom regions (schema 8)

`project.zoomRegions` is one sequence-timed, non-overlapping lane over the whole program. A region
stores `{ id, startUs, endUs, rect, easeInUs, easeOutUs, enabled }`: the picture eases from the full
output frame into one static composition-space target rectangle, holds, then eases back out. It is
not a keyframe or tracking system. Zoom in defaults to 500 ms in/out; Zoom out starts tight
(`easeInUs: 0`) and defaults to a 700 ms release. The timeline has one permanent lane for it,
labeled **Effects** to match the rail tab (`TimelineTrackHeaders.tsx`'s `zoomLane` row, and
`ZoomLane.tsx`'s own block label and aria-labels — the component and its props stay zoom-specific
internally); regions move and trim like clips, but do not belong to tracks or assets.

`zoomRectAt` is the absolute-time evaluator used by preview. The preview transforms the picture
below host-painted images; captions and host-painted overlays remain pinned. Any project with at
least one *enabled* zoom region uses export manifest v3, where target rectangles become output
pixels and FFmpeg runs dynamic `scale=…:eval=frame` plus a fixed output-sized crop **after** the
flat/stacked picture chain and **before** the transparent caption/overlay layer. Slow ramps can
differ by an integer pixel from browser resampling; this is measured tolerance, not byte parity.
Zoom enlarges the already-composed canvas, so it does not recover extra source detail from
higher-resolution footage.

**Settings and bypass (schema 8).** Selecting a zoom region on the timeline shows `ZoomInspector`
(`src/ZoomInspector.tsx`) in the right inspector's Edit tab — the same slot `ClipInspector` fills
for a selected clip, and the pattern every later effect follows. It exposes start/length (move/trim,
committing immediately), ease in/out (a slider showing the *effective*, half-length-clamped value
when the raw one is longer than the region can use), a "Zoom amount" slider (rescales the target
rect around its own center at the composition's aspect ratio — `rectAtZoomFactor`/`zoomFactorOf` in
`src/core/zoomRegion.ts`), Reset framing and Delete. Rect and ease edits draft into the live preview
through one shared `{ id, changes: ZoomRegionChanges }` draft (`App.tsx`'s `zoomRegionDraft`, folded
into `visibleZoomRegions`) and commit as a single `zoom-region-update`, mirroring `ClipInspector`'s
rect-drag contract.

`enabled` (default `true`) bypasses a region without deleting it: the picture stays full-frame in
preview (`CaptionStage` filters `zoomRegions`/`blurRegions` to the enabled ones before calling
`zoomRectAt` or building the blur layer) and the region is left out of the export manifest
(`blurFor`/`zoomFor` in `src/export/plan.ts`). A disabled region still claims its place in the one
lane — the non-overlap check does not exempt it, so re-enabling it can never surprise-overlap
another region — and still renders in the Zoom lane, dashed and dimmed (`.zoom-block.disabled`,
`ZoomLane.tsx`), so it stays selectable. A project whose zoom regions are *all* disabled is treated
as zoom-free for the v2/v3 export routing decision (`flatSequence`), the same as a project with none.

Blur regions (`project.blurRegions`) gained the same `enabled` flag in the same schema bump — see
"Blur regions (V4)" below for its own lane and inspector, added later.

Schema 7 → 8 (`src/core/migrateV7.ts`) only bumps the version number: `enabled` defaults to `true`
on `blurRegionSchema`/`zoomRegionSchema`, so parsing a schema-7 file through the frozen
`projectSchemaV7` already back-fills it before the migration function ever runs — the same
"parsing already did the work" shape as schema 6 → 7's empty zoom lane.

## Pan / Ken Burns (schema 11)

A zoom region may carry an optional `fromRect`. When present the region is a **pan**: the picture
eases `fromRect → rect` (one smoothstep) across the region's whole length, with no hold and no
return to the full frame, and `easeInUs`/`easeOutUs` are ignored. Without `fromRect` the region is
exactly the schema-8 zoom above. It stays in the one zoom lane (labeled **Pan** when it has
`fromRect`) and reuses the same commands: `zoom-region-update` sets `fromRect`, and `fromRect: null`
clears it back to a plain zoom (`applyZoomChanges` in `zoomRegionCommands.ts`, shared by the live
draft preview and the commit so they can never disagree).

Both evaluators branch on `fromRect` in the same file: `zoomRectAt` for preview and
`zoomScaleCropExpressions` for FFmpeg, so a pan uses the same dynamic-`scale` + fixed-crop chain as
zoom and needs no new filter. `zoomFor` (`plan.ts`) carries `fromRect` in output pixels and, unlike
a plain zoom, does **not** truncate a pan's end to the sequence end — a pan's progress depends on
its whole length, so truncating would make export move faster than preview.

Presets (`defaultPanRects`): *Pan* slides a 1.5x window from the left edge to the right edge;
*Ken Burns* pushes from the full frame to a 1.25x window offset toward the upper-left third. Both
default to 5 s. `ZoomInspector` shows a **Start / End framing** switch for pan regions; the stage
gizmo, the Zoom-amount slider and Swap follow the selected framing, and switching seeks the
playhead to the region's start or end so the picture shows what is being framed. *Remove pan* keeps
the end framing as a plain zoom.

Schema 10 → 11 (`src/core/migrateV10.ts`) only bumps the version: `fromRect` is optional.

## Blur regions (V4)

`project.blurRegions` predates zoom (schema 5) and already had `id`/timing/`rect`/`radius`/`enabled`
and its own `blur-add`/`blur-update`/`blur-delete` commands, MCP access and a preview layer
(`CompositionLayers`'s `backdrop-filter` blur, under the captions). What V4 added is everything a
user needs to reach it without MCP, plus the FFmpeg branch that had refused it until now — no schema
change. Unlike zoom, **blur regions may overlap**: `blur-update` never checks for overlap, and
neither does the UI, so several blurred areas can be live at the same timestamp. This is also why
blur has no `clampZoomRegion`-style gap-fitting: `src/core/blurRegion.ts`'s `previewBlurDrag` clamps
a drag only against zero and the region's own `MIN_BLUR_REGION_US`, never against other regions.

**Timeline lane.** Unlike the always-shown Zoom lane, the blur lane (`blurLane` in
`timelineLayout.ts`, `BlurLane.tsx`) is shown only when `project.blurRegions` is non-empty — the
pattern every later effect kind follows; a first blur region is created from the Effects panel tile,
not an empty permanent row. Overlapping regions currently stack in DOM order rather than packing
into sub-rows (a stated limitation, not yet built).

**Effects panel and stage editor.** `EffectsPanel.tsx`'s "Blur" section offers two tiles — *Blur
area* (`defaultBlurAreaRect`, a third of the frame, centered) and *Blur frame*
(`defaultBlurFrameRect`, the whole output) — both draggable to the timeline or clickable to add at
the playhead, reusing the same `PresetDragPayload` the Zoom tiles use (`preset: 'blur-area' |
'blur-frame'`). The stage rect gizmo was generalized: `ZoomStageEditor.tsx` became
`RectStageEditor.tsx`, taking `keepAspect` and a `label`/`hitClassName` so zoom (aspect-locked, lime)
and blur (free aspect, cyan `.blur-hit`) share one gesture implementation. `BlurInspector.tsx`
mirrors `ZoomInspector.tsx` minus ease and zoom-amount (blur has neither ramps nor an aspect-locked
target) plus a radius slider (1–100 composition units, `blurRegionSchema`'s own bounds).

**Export.** `workers/media/exportArguments.ts`'s `blurPictureChain` chains FFmpeg's
`split/crop/gblur/overlay` per enabled region, each `enable`d over its own sequence-time window,
before the zoom crop (matching preview's paint order: blur is inside the zoomed picture) and before
the transparent caption/host-overlay layer. `crop=…:exact=1` on a `format=rgba` input keeps
arbitrary (possibly odd) pixel offsets exact — a chroma-subsampled format would round them to even
boundaries. The normalize/concat step's own label and `,format=rgba` only appear when a manifest
actually carries a blur region, so a blur-free export's filtergraph string is provably unchanged
(`exportArguments.test.ts`, `exportArgumentsV3.test.ts`). `assertExportableManifest` — the guard that
refused any manifest carrying `blurRegions` — is gone; there is nothing left for it to refuse.
`flatSequence` needed no change: `blurFor` already resolved blur regions into both v2 and v3
manifests before V4, so blur reaches FFmpeg on whichever route the rest of the project already takes.

**Verified**: `split/crop/gblur/overlay/format` (and, for later effects, `colorchannelmixer`,
`lutrgb`, `rgbashift`) are present in this project's pinned LGPL-only FFmpeg 9.0.1 build (`--disable-
gpl`); `eq`/`boxblur` are absent, confirming the doc's `gblur`-over-`boxblur` choice was necessary,
not stylistic. The exact filter-graph fragments `blurPictureChain` generates — single and two
chained, time-overlapping regions — were run against that real binary and produced valid RGBA output
with no filter errors. Not yet run: `scripts/export-parity.mjs`'s full Electron smoke encode, so
there is no measured pixel tolerance yet (docs/STATUS.md).

## Frame-paint effects (schema 9)

`project.effects` holds vignette, letterbox and fade/dip regions — a new discriminated-union item
kind (`effectRegionSchema`, `src/core/edit.ts`), sequence-timed like blur and zoom. Unlike blur/zoom,
this family is never touched by FFmpeg: it is painted by the exact same React layer the caption and
host-painted-overlay pipeline already uses (`CompositionLayers.tsx`), once in the live preview and
once by the export host — so preview/export parity is exact by construction, not a measured
tolerance the way blur and zoom's pixel-grid differences are. This is the "frame paint" family from
the effects shortlist (blur, fade/flash, color adjust, vignette/letterbox/pan); color adjust and pan
are not part of this slice.

**Data model.** Each kind shares `{ id, startUs, endUs, enabled }` plus its own fields:
`vignette` (`amount`, `softness`, both 0–1), `letterbox` (`aspect`, `color`, `easeInUs`/`easeOutUs`
for the bars sliding in/out) and `fade` (`shape: 'in' | 'out' | 'dip'`, `color`,
`easeInUs`/`easeOutUs` — only `dip` uses both; `in`/`out` ramp once across the whole region). Flash
is a UI preset, not its own kind: a brief white `dip` (`defaultFlash`, `src/core/effectCommands.ts`).
Unlike zoom's single lane, **each kind has its own non-overlap lane**: two vignettes must be
ascending and non-overlapping (the schema-9 `superRefine` in `model.ts` tracks the last end per
kind), but a vignette and a letterbox may freely overlap in time — a fade held over a vignette is a
normal composition, not a conflict. `src/core/migrateV8.ts` only bumps the version: `effects`
defaults to `[]`, so parsing a schema-8 file through the schema-9 object already back-fills it.

**Evaluator (`src/core/frameEffects.ts`).** `frameEffectsAt(effects, sequenceUs, composition)` is
the one closed-form-in-absolute-time function both preview and export call — the same contract
`zoomRectAt` established, so seeking to the same timestamp from either direction gives the same
result. `rampAmount` reuses `zoomRectAt`'s own ease-in/hold/ease-out shape (now exported from
`zoomRegion.ts` as `smoothstep`/`lerp` so every effect ramps on the identical curve) for letterbox's
slide and fade's `dip`; `in`/`out` are a single ramp across the region's length. Letterbox bars land
top/bottom when the target aspect is *wider* than the composition's own aspect (shrinking the
visible height to `width / aspect`) and left/right when it is *narrower* (shrinking the visible
width to `height * aspect`) — so a "Letterbox 2.39" preset bars top/bottom on both a 16:9 and a 9:16
vertical export, since 2.39 is wider than either. All effect data stays in **composition units**
(never resolved to output pixels the way blur/zoom's manifest fields are), because
`CompositionLayers` already does that scaling itself for every layer kind.

**Preview (`App.tsx`'s `CaptionStage`).** Vignette and letterbox are pinned to the output frame like
a host-painted image overlay — never zoomed with the picture — so they join the same
`CompositionLayers` call `pinnedLayers` already used for host-painted images, under the captions.
Fade must cover the captions too, so `CaptionPreview.tsx` gained a new `overCaption` slot, rendered
after `CaptionView` inside the same scaled composition wrapper `layers` renders below it in.

**Commands (`src/core/effectCommands.ts`).** `effect-add/move/trim/update/delete` mirror
`zoomRegionCommands.ts` exactly, reusing its `clampZoomRegion`/`MIN_ZOOM_REGION_US` (both already
generic over any `{startUs,endUs}` item) with one change: the "others" an add/move/trim clamps
against are only effects of the *same kind* (`sameKindOthers`), never the whole `project.effects`
array. `EffectChanges` is a plain (non-discriminated) union of each kind's own partial change shape,
since a caller's inspector already knows which kind it is editing. `TimelineItemKind`/`Selection`
gained `'effect'`; the MCP `select` tool and `agentProtocol.ts`'s `select` request schema follow.

**Timeline.** `timelineRows` (`timelineLayout.ts`) takes an `effectKinds` list and emits one
`effectLane` row per kind actually present (`EFFECT_KIND_ORDER`: vignette, letterbox, fade), shown
only when used — the same "each lane names its own kind" convention blur set. `EffectLane.tsx` is
one generic component parameterized by kind (label, CSS class), rather than three near-duplicate
files, since — unlike blur's one-off addition — three new lane kinds arriving at once justified the
shared component. `Timeline.tsx`'s drag state machine gained one `EffectDrag` kind mirroring `zoom`'s
branch (`previewEffectDrag`, filtering "others" to the dragged region's own kind); blur's branch was
left untouched as the precedent for "no lane, may overlap" items, which frame-paint effects are not.

**Effects panel.** Two new sections: **Look** (Vignette, Letterbox 2.39, Letterbox 1.85) and
**Transitions** (Fade in, Fade out, Dip to black, Flash), same `PresetDragPayload`/tile pattern as
Zoom and Blur (`PresetDragPayload['preset']` extended with the seven new preset ids).
`App.tsx`'s `addEffectPreset` dispatcher now routes zoom/blur/frame-paint presets to their own
default-builder (`defaultVignette`/`defaultLetterbox`/`defaultFade`/`defaultFlash`).

**Inspector (`src/EffectInspector.tsx`).** One shared shell (enabled/bypass, start/length, Delete)
across all three kinds, plus a per-kind section below it — the same settings-view shape
`ZoomInspector`/`BlurInspector` established, generalized instead of duplicated a third time.

**Export.** `flatSequence` (`src/export/plan.ts`) forces v3 whenever any effect is enabled, the same
reason zoom does — v2's `frameRequestAt` never evaluates frame-paint effects. `buildExportManifest`'s
v3 branch adds `effects: effectsFor(sequenceDurationUs)` (clipped to the sequence end, composition
units untouched); `manifestEffectSchema` is `effectRegionSchema` reused directly, since — unlike
blur/zoom, which need FFmpeg pixel coordinates — the manifest's effect data is exactly what the
project already stores. `frameRequestAtSequence` evaluates `frameEffectsAt` at each requested
sequence timestamp (in `compositionFor(formatAspect(manifest.format))`, never the manifest's own
output-pixel `format`) and, only when something is actually visible, emits a new `frameRequestV3`
(base shape plus `overlays` plus `frameEffects`) instead of v1/v2 — an effect-free v3 project's frame
requests are therefore still v1/v2, unaffected. `frameHarness.tsx` paints `frameEffects` with the
exact same `CompositionLayers`/`overCaption` split preview uses. `layerPlan.ts`'s frame signature
folds in `frameEffectsAt`'s result (sequence-timed, like `timeline` overlays already are) so ramp
frames are never wrongly deduplicated as identical to their neighbors.

**Verified**: `npx tsc --noEmit` and `npx vitest run` are clean (1112 tests, 115 files, including new
`frameEffects.test.ts`, effect-command and per-kind-overlap cases in `itemCommands.test.ts`, schema-9
migration/validation cases in `model.test.ts`, v3-forcing/frame-request cases in `plan.test.ts`, and
signature/ramp-dedup cases in `layerPlan.test.ts`). `npm run build` (Vite renderer, Electron
main/preload, worker) succeeds.

**Not verified.** No FFmpeg work was needed or run for this slice — there is nothing to check against
a real binary, unlike blur. `scripts/export-parity.mjs`'s full Electron smoke encode was not run, so
there is no real rendered frame confirming a vignette, sliding letterbox bars or a fade actually
paint correctly pixel-for-pixel between preview and export, only that both sides call the same pure
evaluator and the same paint component. Not exercised in the running app (`/run`): add each preset
by click and drag, the new lanes appear only when used, drag/trim/select on each lane, the inspector
sliders move the live preview, Undo/redo, Bypass, a saved schema-8 project opening and re-saving as
schema 9. Only macOS (this machine) was touched; Windows is unvalidated.

### Texture effects: Film grain and VHS (still schema 11)

Two more `project.effects` kinds, `grain` (`amount`, `size`) and `vhs` (`amount`, `scanlines`,
`tracking`), on the same frame-paint path: own lane per kind, evaluated by `frameEffectsAt`, painted by
`CompositionLayers` in preview and the export host, no FFmpeg filter. They add union members to the
current effect list rather than a new schema version; a project using them will not open in a build
that predates them.

**Time-driven, deterministic.** Both re-seed at a fixed 24 Hz "film rate" in absolute sequence time
(`TEXTURE_TICKS_PER_SECOND`), independent of the project frame rate. `frameEffectsAt` resolves the seed,
the VHS band position (rolls down the frame every ~7 s), horizontal jitter and flicker from a stateless
integer hash of the tick, so seeking in any direction, preview and export all agree, and `layerPlan`'s
signature (which folds in the evaluator result) only repaints when a tick changes. A 30 fps export
therefore reuses the painted frame across ticks it shares.

**Painting.** Noise is signed and painted with plain alpha (a white and a black `feTurbulence` rect,
each keeping half the noise above/below mid-gray), because the export layer is transparent and a blend
mode would have nothing to blend with. Grain size is applied through the SVG `viewBox`, so it scales
with the composition (4K grain looks like 1080p grain). VHS is scanlines + left/right color bleed +
flicker + a rolling tracking band + head-switching noise at the bottom. Both paint in the pinned layer
under captions (order: vignette, VHS, grain, particles, letterbox), so caption text stays clean.

**Honest limits.** VHS is an *overlay* look: it cannot displace or channel-split the picture itself,
because FFmpeg composes the picture before the host layer exists. A true chroma-shift/wobble would need
an FFmpeg branch and a measured preview/export tolerance, and is not implemented. Grain and VHS are not
applied to still frames of the caption-only path (`frameRequestAt` v1/v2); like other frame-paint
effects they force manifest v3.

### Light particles (schema 16)

`particles` is a masked frame-paint effect with `amount`, `size`, `speed` and `color`; it uses the
normal per-kind timeline lane, inspector, bypass and undo commands. The default is a three-second
warm dust field (55% amount, size 4, speed 1×, `#FFD6A0`). Amount selects up to 72 particles; size is
in composition units and speed is a 0–2× multiplier.

The painter draws one transparent SVG layer with soft radial dots and occasional bright cores. It
derives its field from the effect ID and the absolute sequence timestamp quantized to 60 Hz, so a seek
to the same timestamp produces the same image. A fixed 200 ms eased fade at each region edge avoids
a hard appearance or disappearance. The evaluator carries the tick in the frame request and layer
signature, so export repaints as the dots move. Preview and export use the same painter; no FFmpeg
filter or external particle asset is involved. Particles are pinned below captions and titles and can
be limited with the existing effect mask.

There is no project version bump for this additive effect variant. Projects containing it require a
build that understands the `particles` effect kind. GUI interaction and export parity remain for the
user's manual acceptance pass.

## Authored text (schema 10)

`project.textOverlays` stores authored sequence-timed text independently of speech cues. Items carry stable project-wide IDs, non-empty text, a full `CaptionStyle` snapshot, item-specific enter/exit motion, and layer order relative to the caption plane. Schema 9→10 only adds an empty array; text is not a transcript, does not participate in alignment, and is never included in SRT. Text may overlap other text and captions. The always-visible Text lane packs overlapping blocks into stable subrows; new items start at the playhead with a three-second default, clamped to sequence duration. Users can add from Titles or the Text lane, or double-click empty video-frame space to create a title at that normalized composition location. The new item is selected and opens for direct preview editing; double-clicking an existing title edits it instead.

The selected text item is the target for Titles styles, saved presets, word-animation choices and style controls; with no selected text, existing global caption-style behavior is unchanged. Applying a style/template updates appearance while preserving position, rotation, word animation and item-specific In/Out transitions. `TextInspector` exposes text, timing, whole-layer transition kinds/directions/durations, layer controls, duplicate and delete. Its stage editor shares caption move/resize/rotation behavior. Text items can move above or below the caption plane and are pinned to the output frame.

`textMotionAt` evaluates enter/exit animation from absolute sequence time (fade, pop and four slide directions), proportionally shortening ramps on short items. Template word motion uses deterministic runtime-only timing distributed across whole `captionTokens`; it is decorative, not estimated/aligned audio timing. Preview and the export host share `TextOverlayActor` and the same shaped caption painter. Text forces manifest v3; frame request v4 carries already-ordered active text actors, and the host waits for each actor's font/layout readiness before frame commit. Text render order is below-captions items, caption plane, above-captions items, then fade.

Six refined title treatments add an optional `titleMotion` entrance to `CaptionStyle` and authored text: Focus Reveal, Soft Lift, Word Cascade, Line Wipe, Violet Accent and Quiet Scale. These are additive schema-13 fields; older captions and titles without them keep their original appearance and motion. All previous caption templates and the six treatments remain visible in the Titles library. A template click updates the selected authored text layer, or applies to captions when no text layer is selected. The Title motion inspector edits an authored text item's kind and duration, while its existing whole-layer In/Out transitions remain independent. Applying a treatment to text preserves its words, sequence timing, stage placement, rotation and layer order. Applying one to captions preserves cue text and timestamps.

`titleMotionAt` derives progress from an authored item's sequence time or a caption cue's canonical source time. Word Cascade and Violet Accent paint crops of complete shaped lines using measured word regions from the shared caption renderer; for captions, those regions use runtime-only decorative token timing and do not change aligned or imported words. Line Wipe clips complete lines. No treatment creates per-code-unit or per-letter spans. Gallery previews, the live stage and export all use the same `CaptionPreview`/`CaptionView` paint path. Title font choice uses installed Helvetica Neue when available and the existing Malayalam/system fallback stack; no font is bundled.

When a cue has manual emphasis, title word regions are measured against the complete shaped line with those emphasized runs. Word Cascade and Violet Accent crop copies of that same emphasized line, and Line Wipe clips it. Emphasis does not turn off the title treatment or change cue timing.

Verification for the initial implementation: `npm test` and `npm run typecheck` pass. `npm run build` builds the Vite, Electron and media worker bundles. GUI interaction and pixel-level export parity have not yet been manually exercised; Windows remains unvalidated.

## Picture effects: Dreamy glow (still schema 11)

`project.effects` gains a `glow` kind (`amount`, `radius` in composition units, `threshold`), a union
member like grain/VHS, so no schema bump. Unlike the frame-paint kinds it is **not** painted by the
host layer: it needs the picture's own pixels (bright areas are isolated, blurred and screened back),
so it follows blur's model instead. `pictureEffectsAt` (`frameEffects.ts`) evaluates it and keeps it out
of `FrameEffects`, so the export host's frame request never sees it.

**One recipe, two renderers** (all in sRGB): highlight pass `clip((v-t)/(1-t))` → Gaussian blur σ → screen
at `amount` (`a + k·b·(1-a)`).

| Step | Preview (`glowFilterStyle`) | Export (`pictureEffectChain`) |
| --- | --- | --- |
| Highlights | `feComponentTransfer` linear slope/intercept | `lutrgb` |
| Blur | `feGaussianBlur` (`edgeMode=duplicate`) | `gblur=sigma:steps=2` |
| Screen | `feComposite arithmetic k1=-k k2=1 k3=k` | `blend=all_mode=screen:all_opacity=k` |

**Placement.** After zoom (the glow radius does not scale with the camera) and before the transparent
caption/host layer, so captions, text layers and host-painted images stay crisp. Preview wraps the zoomed
picture in a filtered div; pinned layers and captions sit outside it. The manifest carries
`pictureEffects` with `sigmaPx` already resolved to output pixels (like blur); a glow-free graph is
byte-identical to before.

**Limits.** No ease in/out (hard on/off at the region edges, like blur). Blur kernels and 8-bit rounding
differ slightly between Chromium and FFmpeg, so preview/export parity is close, not exact; no tolerance
has been measured. Glow forces manifest v3.

## Layer masks (schema 12)

Any painted layer can carry one optional, static **mask**: `mask?: LayerMask` on video/image clips, text
overlays, caption tracks (the whole caption plane — every cue on that track), blur regions and the
frame-paint effects (vignette, letterbox, fade, grain, VHS, light particles). Not maskable: audio, markers, zoom regions,
and glow (it reads the picture's own pixels). The shape is a `rect` (with corner radius), an `ellipse`, or
a closed bezier `path` (3–256 anchors with optional absolute in/out handles), in composition units, and may
overhang the frame. `invert`, `feather` (Gaussian σ = feather/2), `density` (0–1) and `enabled` complete it.
Schema 11 → 12 (`migrateV11.ts`) only bumps the version. One command, `mask-set { target, mask | null }`
(`maskCommands.ts`, zod-mirrored for MCP), is one undo step. Moving a picture-in-picture clip on the stage
carries its mask with it (`clip-update` translates it when the rect only moved); resizing does not, and a
title's mask is fixed in the frame while the title moves under it.

**One generator.** `layerMask.ts` turns a mask into an SVG whose *alpha* is the mask — a pure function, so
the worker and tests run it too. Preview and the export host apply it as a CSS `mask-image`
(`maskStyle.ts`) on the layer's own element (never a wrapper: an ancestor mask creates a backdrop root and
would break `backdrop-filter` blur). Enter/exit motion of a title moves inside a fixed mask.

**Export.** *Host-painted* layers (captions, text, images above every video, frame-paint effects) are
masked by the same components in the export host, so parity is exact by construction — the frame request
carries `captionMask` and per-item `mask` (optional fields; no version bump). *FFmpeg-composited* layers
(video clips, images under a video, blur) take a mask image: the worker sends the host a **v5 frame
request** (`maskFill`), which paints an opaque white fill through the mask, and stores the PNG per distinct
mask. The mask files are extra `-loop 1 -framerate R -t <len>` inputs **after** the caption pipe (so a
mask-free export's arguments are unchanged), in `maskTargets(manifest)` order. Per layer the graph does
`split → alphaextract` of the fitted picture, `[mask]format=rgba,alphaextract,crop=box` for the matte,
`blend=all_mode=multiply:shortest=1`, then `alphamerge` — multiplying keeps `contain` letterbox
transparency; opacity and the start `tpad` come after. A masked blur masks its blurred copy before the
`overlay`, so blur shows only inside the mask. Any active mask forces manifest v3 (`flatSequence`) and the
stacked route (`v3Route`). The host runs first so the mask images exist before the encoder opens them.

**Layers tab** (left rail, after Effects; `LayersPanel.tsx`, `layerStack.ts`). Lists what is painted at
the playhead, front to back in the stage's paint order: fade, text above captions, the caption plane, text
below, pinned effects, host-painted images, blur, then clips from the top track down. Clicking a row selects
the item on the timeline (a caption plane selects its active cue) and focuses its **Mask** section: add a
rectangle/ellipse/pen; enable, shape (converting keeps the footprint), invert, feather, density, corner
radius; *Edit on preview*, *Reset to layer*, *Delete mask*. Sliders draft live and commit once. On the
preview (`MaskStageEditor.tsx`): the outside of the mask is tinted red; a rect/ellipse is moved and resized
by its box; a pen path is drawn by clicking corners and click-dragging smooth points (click the first point
or Enter closes, Backspace removes the last, Esc cancels), then edited by dragging anchors and handles,
Alt-click (corner/smooth), double-click the outline (add a point) and Delete (remove one). `penPath.ts`
holds the geometry.

**Fix that shipped with it.** `layerPlan`'s frame signature ignored authored text, so a title animating
over otherwise-static frames could re-send a stale PNG; text actors' motion is now part of the signature.

**Limits.** Masks are static (no keyframes) and one per item. Rect/ellipse gizmo edits stay inside the
frame (paths may overhang). A mask on a FFmpeg-composited layer differs from preview only by
Chromium-vs-FFmpeg edge rasterization; no pixel tolerance has been measured for it.

## Backgrounds (schema 13)

A background is a solid color or a two-stop gradient that lives on a **video track** as a `color` clip, so it stacks, moves, trims, splits, fades (opacity), masks and undoes exactly like other clips. It has no media file. Fill is `{ type: 'solid', color }` or `{ type: 'gradient', from, to, angle }` (CSS angle: 0° up, 90° right). Optional `motion`, all looping smoothly and never jumping:

- **shift** — blends toward a second fill and back;
- **pulse** — blends toward black or white by `depth` and back;
- **drift** — pans an oversized gradient in `direction` (a solid has nothing to pan, so it stays still).

`periodUs` (1–20 s) is one full there-and-back. The phase counts from the clip's source start, so moving a clip keeps its loop and the right half of a split continues the left half's.

**Adding one.** Effects tab → Backgrounds: ten presets and a Custom block (Solid/Gradient, angle, motion, loop length). Drag a swatch onto the timeline or click to add at the playhead. It is 2 s long by default (trim or stretch it) and lands on the lowest free video track *below* every track holding video or images, else on a new track at the bottom. Drop it on a specific free video track to override. The Edit tab's clip inspector changes the fill and motion afterwards; `clip-update` accepts `fill` and `motion` (`null` stops the motion) and `clip-add` accepts `trackIndex`.

**Trim.** Like video, the start can only be dragged back as far as it has been trimmed in; the end extends freely. To grow a background earlier, move it or extend its end.

**Export.** FFmpeg makes the picture (see ARCHITECTURE.md "Backgrounds"). Solids are exact; gradients follow the same line as the preview to within rounding (±1–2 levels measured against the shared math with the pinned FFmpeg build), and shift/pulse on frames ≥480 px are within ~4 levels of an exact blend. Preview (Chromium CSS) versus export has **not** been compared pixel-for-pixel in the running app. A timeline with only backgrounds cannot export until a video sets the output size.

## Clip speed (schema 14)

A video or audio clip may carry `speed: { points: [{ sourceUs, rate }] }` — a piecewise-linear rate
over the asset's **source** time (rate 0.1×–10×, 1–32 points in strictly increasing order, the rate
held before the first and after the last point). One point, or all rates equal, is a constant speed;
anything else is a ramp. Because points live in source time, split and trim never rewrite the curve
and both halves of a split keep evaluating it. The field is optional: a project without it is
byte-for-byte what it was (schema 13 → 14 only bumps the version).

**One mapping.** `src/core/clipTime.ts` owns source↔sequence time. The sequence time to reach source
offset `s` is `∫ ds / v(s)`; on a constant piece that is `L/v`, on a linear piece `L/(vb−va)·ln(vb/va)`,
so the mapping and its inverse are closed-form, not numerically integrated. `timelineModel.ts`
(`clipLengthUs`, `sequenceUsOf`, `sourceUsAt`, `spansInSequence`) delegate to it; preview, captions,
edits and export all read time through those. Floats inside, one `Math.round` out.

**Edits.** A trim or drag delta is timeline time; `trimClip` maps it to the source edge with
`sourceUsAt`. `clip-update { speed }` changes the clip's timeline length and ripples later clips on
its track by the difference (a locked track refuses); `speed: null` returns to 1×. Silence removal and
"restore removed ranges" lay clips out by retimed length.

**Captions** stay stored and evaluated in source time, so word timing follows the retimed speech;
their animation durations therefore scale with the clip (a 2× clip plays a 200 ms fade in 100 ms).

**Audio.** A constant speed keeps pitch (`<video>`'s default `preservesPitch` in preview, `atempo` in
export; `atempo` accepts 0.5–100 so slow-downs below 0.5× are split into equal stages). A ramp is
**muted** in preview and export. Known limitation: an *audio-track* clip in preview goes through Web
Audio (`AudioBufferSourceNode`), which cannot preserve pitch, so it sounds pitch-shifted in preview
but not in export.

**Preview.** `transport.ts` sets each element's `playbackRate` to the clock rate × the curve's rate at
the current source time (clamped to Chromium's 0.0625–16), re-evaluated every tick so a ramp follows
the curve; the master clock discipline maps the presented frame's media time through `sequenceUsOf`.

**Export.** A clip with `speed` forces manifest v3 (`flatSequence` returns null). The graph keeps
`trim=duration` and the input `-t` in *source* length and retimes after `setpts=PTS-STARTPTS`:
constant `setpts=PTS/rate`, ramps a nested `if(lt(…))` closed-form expression built from the same
pieces (`retimeFilter`, tested against `clipTime` at sample points). `fps` then makes constant frame
rate, so slow motion repeats frames (no interpolation) and fast motion drops them. `sequenceDurationUs`
and the flat/stacked route use the retimed length.

**Timeline.** A `2×`/`Ramp` badge on the clip; ramp filmstrips sample evenly along timeline width and
ramp waveforms are resampled per column (`clipPeaks`); caption word blocks are laid out in sequence time.

**UI.** Inspector → Speed: Constant (0.25/0.5/1/2/4× chips, log slider, exact field) or Curve (Montage,
Hero, Bullet, Flash in/out, Jump cut presets and an editable curve: drag points, double-click to add,
Delete to remove, arrow keys nudge). Presets are position/rate lists laid over the clip's source range.

## Linked audio (schema 15)

Implemented 2026-09-24. A video's sound is its own **audio clip on an audio lane**, linked to the picture, as in DaVinci Resolve — not a band inside the thumbnail.

```ts
videoClip { …, detachedAudio?: true, linkId?: id }   // detachedAudio: the video is silent; its sound is the linked audio clip
audioClip { …, linkId?: id }                          // may reference a *video* asset (first audio stream)
every clip { enabled?: false }                        // disabled: kept on the timeline, skipped by preview and export
audio track { solo?: boolean, volume?: 0..4 }         // solo silences unsoloed audio tracks (and legacy embedded video sound)
```

- **Placement.** `clip-add` of a video whose asset has an audio stream also places a mirror audio clip (same start, source range, speed, gain) on the audio lane with the same ordinal (V2 → A2), or the lowest free unlocked lane, or a new lane, in the same undo step. `detachedAudio: false` keeps the legacy embedded sound; a clone (a `linkId` already in use) gets a fresh pair. **Existing projects are not migrated to separate audio**; `clip-detach-audio` converts one legacy video on request.
- **Groups.** Clips sharing a `linkId` (at most one video) are moved by one shared delta, trimmed by the smallest achievable common delta, split together (right halves form a new group), deleted, disabled and re-speeded together. `unlinked: true` on the command (Alt-click in the UI) acts on one clip; a half whose partner was not split leaves the group. `clips-link` / `clips-unlink` edit membership; a group of one is dissolved. Silence removal cuts audio of the same asset by the same kept ranges and regroups each piece pairwise; restore collapses linked audio runs like video runs.
- **Gain.** `effectiveGain(clip, tracks)` (`clipLinks.ts`) = clip gain × track fader, and 0 when disabled, on a muted or unsoloed track, or for a detached video. Preview (pooled elements, `SfxScheduler`) and export both use it.
- **Preview.** Audio clips of a video asset play through the transport's pooled elements (keyed track/asset, never the clock master); `videoAssetIds` tells `wantedElements` which audio clips those are. Audio-file clips still use Web Audio.
- **Export.** `contributing()` drops disabled and silent clips. `flatSequence` (manifest v2) accepts a detached video only when its linked audio is an exact unity mirror (same file, position, range, audible) — v2's own `[0:a:0]` then already plays it; every other case is v3, where the audio clip is a separate input and the detached video has gain 0.
- **Timeline.** Waveform only in audio lanes (a legacy embedded video still draws its band); link glyph, dashed partner highlight, disabled clips greyed; audio headers carry M / S / L and a fader; D toggles a clip, Cmd/Ctrl+Alt+L links or unlinks.

## Color: adjustment layers (schema 16)

> Pooled `<video>` ownership: the same element moves between `VideoSlot` and `GradedVideo`, so every mounter applies the full `pooledVideoStyle` (including `opacity`) — never a partial style, or a leftover `opacity: 0` blanks the preview once the grade goes away.

A **DaVinci-style adjustment layer**: a clip with no asset that grades every video/image clip on
the tracks below it, for its own time range, instead of carrying a picture of its own — a new
**Color** rail tab, after Effects. Preview and export share the baked 3D LUT and trilinear sampling;
video decode, half-float upload, `.cube` serialization and H.264 encoding still create measured
pixel differences (see the evidence below).

```ts
grade = { input: {type:'none'} | {type:'log', profile} | {type:'lut', assetId}, primaries, look: {id, strength} | null, intensity: 0..1 }
adjustmentClip { kind: 'adjustment', ...clipTiming, grade }   // video-track only, synthetic source range like `color`
projectAsset { kind: 'lut', ... }                             // a user-imported `.cube`, referenced/relinked like media
```

- **Pipeline** (`src/color/`): input transform (`transfer.ts`+`gamut.ts` for the six built-in camera
  log curves — F-Log, F-Log2, S-Log3, Apple Log, V-Log, C-Log3 — or a user `.cube`) → primaries
  (`primaries.ts`: exposure, white balance, contrast, highlights/shadows, lift/gamma/gain, saturation)
  → an optional bundled film look (`looks.ts`, 17 original procedural looks, no camera/film brand
  or creator name anywhere; six are hue-selective — `hues` bands in OkLCh via `oklab.ts`, plus an
  optional matte `fade` — so teal-and-orange or neon grades can move skin and sky in opposite
  directions) → an intensity mix back toward the untouched input. `bakeGrade` (`bake.ts`) evaluates
  that pipeline at every point of a 33³ lattice; `composeLuts` folds two baked LUTs into one for a
  stack of adjustment layers, bottom-up by track order. A `color` (generated background) clip is
  never graded.
- **Look thumbnails and reference matching** (Color tab). Film-look tiles show the frame under the
  playhead (captured from the pooled `<video>` once the playhead has been still 250 ms, only while
  the Color tab is open) graded through each look's own baked 17³ lattice (`lookThumbnail.ts`), or a
  drawn sample scene with no clip. "Match reference image…" (My LUTs) picks a still and derives a
  grade from the playhead frame (`referenceMatch.ts`: Oklab quantile-matched, slope-limited tone
  curve plus per-shadow/mid/highlight chroma shift and gain), previews before/after with a strength
  slider, and saves a `.cube` through `lut:save-generated` (native save dialog, defaulting to the
  project folder; main re-validates with `parseCube`), which then joins the project as a normal `lut`
  asset. It is a statistical transfer, not scene understanding.
- **Grade resolution** (`src/core/gradeStack.ts`): `adjustmentsOver`/`gradeStackFor` pick the
  enabled adjustment clips on a track above a picture clip that overlap it — shared verbatim by the
  export plan (which splits a clip into constant-stack segments before baking, `src/export/plan.ts`)
  and the live preview, so the two can never disagree about which layers apply.
- **Preview** (WebGL2, `src/captions/GradedVideo.tsx` + `src/color/webglLut.ts`): the preview's own
  bake-and-cache step is `src/color/previewGrade.ts` (`bakedGradeStack`, memoized by the stack's own
  content, mirroring the export worker's `bakeStackLut`). `GradedVideo` takes over mounting the
  pooled `<video>` element from `VideoSlot` for a graded layer — it stays decoding at `opacity: 0`
  under a canvas that draws it each presented frame (`requestVideoFrameCallback`) through the LUT,
  uploaded as an `RGBA16F` `TEXTURE_3D` (core-filterable in WebGL2, unlike `FLOAT`) and sampled with
  the texel-center remap that matches `sampleLut`'s manual trilinear math. A lost WebGL context, or
  no WebGL2 at all, falls back to the plain ungraded element with a visible "Grade unavailable"
  badge — never a silently wrong picture. Images go through the same component, redrawn only when
  their grade changes.
- **Export** (`src/export/plan.ts`, `workers/media/exportArguments.ts`, `export.ts`): a graded
  segment gets a `lutId` naming a manifest-level baked LUT (deduped by content); the export worker
  writes each into its job's temp directory as a real `.cube` file (`src/color/cube.ts`) and inserts
  `lut3d=interp=trilinear` into the FFmpeg filtergraph, right after retiming, with an explicit
  `in_color_matrix=bt709:in_range=tv` for video YUV→RGB. Images remain full-range RGB and pass
  through FFmpeg when adjustment layers are present, so they can receive the same per-layer LUT.
- **Placement** (`src/core/clipEdits.ts`'s `adjustmentTrackAbove`/`topAdjustmentTrackFor`,
  `src/ColorPanel.tsx`). A Color tile is a drag payload carrying a starting `grade`
  (`COLOR_DRAG_TYPE`, `src/core/dragPayload.ts`). Dropped onto an existing clip, the new adjustment
  layer spans that clip's own range on the free unlocked video track directly above it, creating one
  there if none is free. Dropped on empty timeline space, it is 5 seconds long on the track under
  the pointer if that fits, else the topmost free video track. A click adds it at the playhead on
  the topmost free video track. `src/ColorInspector.tsx` (embedded in `ClipInspector` for a selected
  adjustment clip) edits the grade's input, primaries, look and intensity; the clip's own
  Enabled toggle (shared chrome every clip kind has) is its bypass.
- **`.cube` import.** "My LUTs" → Import .cube opens a native dialog filtered to `.cube`
  (`lut:import` IPC, `electron/main.ts`'s `inspectLut`), reads, validates (`parseCube`) and
  fingerprints the file the same way other media is, and creates a new `lut`-kind project asset. A
  `lut` asset resolves at `project:open` the same way as media (`electron/projectMedia.ts`'s
  `candidatePaths`), just without ffprobe; its `.cube` text is hydrated into the renderer's
  `useLutAssets` cache in the same round trip. Until a missing or mismatched LUT is relinked (the
  same `assets:relink` IPC, a `lut`-specific branch), any grade naming it renders ungraded with a
  warning in preview; export blocks with a relink message rather than writing an ungraded MP4.

The macOS arm64 synthetic S-Log3 + Cinema Soft parity run (`npm run parity:export -- --only color`,
2026-09-24) compared 27,648 interior RGB channels from a real WebGL2 `readPixels` preview against
the production v3/FFmpeg H.264 export. Mean absolute difference was 5.93/255, 95th percentile
23/255 and observed maximum 43/255. An identity-LUT comparison against the source decode alone
measured 3.83/255 mean, 12/255 at the 95th percentile and 16/255 maximum. These are observations
for this fixture and machine, not a general tolerance for all codecs or camera footage. See
`docs/decisions/evidence/x3-parity-2026-09-24.json`. Windows and a real log-camera file remain
unmeasured.

- **Out of scope for v1.** Keyframed grades, scopes/waveforms, HSL qualifiers and power windows, 1D
  LUTs, grading a `color` (background) clip, HDR output. The primaries inspector exposes lift/gamma/
  gain as one master slider per wheel (all three channels together) rather than per-channel R/G/B —
  the underlying schema already carries a full RGB triplet, an agent or a future per-channel UI can
  set it precisely.

## Shapes (schema 17)

`project.shapes` stores vector graphics (boxes, circles, lines, arrows, highlighter bars) as sequence-timed items, the way `textOverlays` stores titles. Schema 16→17 only adds an empty array. A shape has a stable project-wide ID (one namespace with text and every other item), a `geometry`, an optional `stroke` and `fill` (at least one), `arrowStart`/`arrowEnd`, `opacity`, `enter`/`exit` animation, a `layerOrder` and an optional layer mask.

**Geometry** is in composition units (1080 wide), so a shape lands in the same place at any output size. Kinds: `rect` (corner radius, rotation), `ellipse`, `highlight` (a marker bar), `line` (`from`, `to`, and an optional quadratic `control` that bends it) and `path` (2–256 points, open or closed; the schema and painter support it, but there is no editor for it yet). Coordinates may overhang the frame.

**Stroke** has `color`, `width` (0–80), `dash` (`solid`, `dashed`, `dotted`) and `cap`. Dotted is a zero-length dash under a round cap, so it always renders with round dots. **Arrowheads** (`triangle`, `open`, `dot`) are computed from the line's end tangent and are painted as shapes, not SVG markers, so they appear only when the draw-on reaches the end.

**Animation** (`shapeFrameAt`, `src/captions/shapeMotion.ts`) is closed-form in sequence time with the same smoothstep as text: `fade`, `pop`, `slide` (four directions) `grow` (width 0 → 100% about the shape's left edge, a horizontal scale of the unrotated shape, usable on enter and exit), and two that need geometry — `draw` traces the outline (stroke dash offset through an SVG mask, so dashed and dotted lines draw on too) and `sweep` reveals left to right through a clip (the highlighter). Enter and exit ramps shrink proportionally on short items, exactly as `textMotionAt` does. There are no keyframes.

**Layer order** is shared with authored text (`src/core/graphicsOrder.ts`): below zero paints under the captions, zero or above over them, ties by start time then ID. Preview, the export host and the Layers panel all sort with `compareLayered`, so a shape and a title never swap places between preview and export. Shapes are pinned to the output frame; they do not follow zoom or pan yet (the camera slice adds that).

**Editing.** Overlays → Shapes places one of six presets (Box, Circle, Arrow, Dotted arrow, Underline, Highlighter) at the playhead for three seconds. `defaultShape` (`shapeCommands.ts`) builds each; every field stays editable. A shape gets a row in the Graphics lane (shown only when the project has one; overlapping shapes stack), with the same move/trim gestures as the Text lane. On the video, rect-like shapes use the shared rectangle gizmo and lines use `LineStageEditor` (an end handle each, a bend handle when curved, a move handle mid-line; Shift snaps an end to 15°, Escape cancels). `ShapeInspector` edits timing, stroke, fill, arrowheads, opacity, In/Out animation and layer order. Commands are `shape-add|update|move|trim|duplicate|delete|reorder` (`shapeCommands.ts`) and are undoable through the shared project snapshots; the MCP `edit` tool accepts them and `add_shape` adds a preset in one step.

**Export.** Shapes force manifest v3 (`manifest.shapes`, clipped to the sequence like text). Frame request v4 gains an optional `shapeActors` (active shapes with their sequence timestamp; a request without shapes is unchanged, so no new version). The export host mounts the same `ShapeActor` the preview does. `createLayerPlan` puts each active shape's evaluated motion in the frame signature, so a still-animating shape is never reused as a frozen frame and a settled one is.

**Verification.** Unit tests cover the motion, path geometry, commands, migration, schema round-trip, layer-plan signature, manifest and frame request, timeline lane and line dragging. `npm run parity:export -- --only shapes` (Windows) paints every preset at four times in a 4:5 and a 16:9 frame in the visible preview window and the export host: all 48 cases agree to within 1 level per channel and the export host demonstrably draws the shape (evidence: `docs/decisions/evidence/x3-parity-shapes-2026-09-25.json`). A real H.264 export with shapes has not been run (this machine has no H.264 encoder), and macOS is untested.

**Not built yet** (the roadmap's later slices): hand-drawn roughness and boil, the freehand path tool, follow-camera vs pinned (`space`), paper looks, and cut-outs.


## Groups (schema 22)

Schema 22 adds an optional project-level `groups` list (`{ id, name }`, at most 200) and an optional `groupId` on shapes and text overlays; both are absent until used, so the 21 → 22 migration only moves the version. A `groupId` must name an existing group. A group is a set of at least two shapes and/or text overlays that move, retime and duplicate together; it is not a paint layer (members keep their own `layerOrder`) and groups do not nest.

Commands (`src/core/groupCommands.ts`, all ids come from the caller; each is one undo step): `group-create { groupId, name?, itemIds }` (items must exist, none already grouped, at least two), `group-ungroup`, `group-rename`, `group-move { startUs }` (the earliest member moves to `startUs`, the rest by the same delta, clamped so no member leaves the sequence), `group-translate { dx, dy }` (composition units: shape geometry incl. line/path points and handles; text `horizontal`/`vertical` by dx/1080 and dy/height, clamped 0..1), `group-scale { factor, anchor }` (shape geometry and stroke widths about the anchor; text `fontSize` clamped 20..120 and positions about the anchor), `group-duplicate { groupId, idMap }` (`idMap` gives the new id for the group and each member; copies are offset in time like `shape-duplicate` and keep their relative `layerOrder`; refused if it would exceed the blend/glass pass caps), `group-delete` (removes the members too).

Single-item commands keep working on members. `shape-delete`/`text-delete` on a member dissolves a group left with fewer than two members; `shape-duplicate`/`text-duplicate` of a member yields an ungrouped copy. The agent project summary lists `groupId` per shape/text and a `groups` list with member ids. No UI yet (later brief); not tested, typecheck only.


**Groups in the UI.** Ctrl/Shift-click shapes and titles (stage or timeline) to pick them, then Ctrl/Cmd+G groups them (Ctrl/Cmd+Shift+G ungroups; also in the item context menu). Clicking a member selects its group; double-click on the stage, Alt-click, the Items list in the group inspector or a member row in the Layers tab selects the part. A selected group shows one dashed stage box around its members that are visible at the playhead (shapes by their rotated bounds, titles by their measured layout box): dragging it issues `group-translate`, a corner handle `group-scale` (uniform, anchored at the opposite corner), and the drag previews by applying the same command to a draft project, so a gesture is one undo step. On the timeline members share an accent colour and a chip; dragging a member moves the whole group (`group-move`, the drag offset kept), Alt-drag moves only that member; trimming a member still trims only that member. The Layers tab nests a group's visible rows under a group row (collapsible, double-click renames, shows the shared time range). Delete removes the whole group (`group-delete`). Groups are authoring-only: `buildExportManifest` never reads them.

## Layer opacity and blend

Schema 18 adds an optional `opacity` (absent = 1) on text overlays and caption tracks, and `blendMode` on picture clips (schema 19 adds it to shapes); clips and shapes already carry `opacity`. The Layers panel edits them through `layer-look-set`. **Titles:** `TextOverlayActor` multiplies the item opacity into the actor wrapper, on top of the enter/exit motion opacity. **Caption plane:** the track opacity dims the whole plane (`CaptionPreview` `captionOpacity`, sharing the wrapper div with `captionMask`). Export carries it as manifest `captionOpacities` (only tracks below 1) and frame request `captionOpacity`; preview and export paint through the same components, checked by the `--only layer-opacity` parity stage.

### Blend modes

Picture clips (video, image, colour background) blend onto everything painted beneath them. Shipped modes: Multiply, Screen, Overlay, Darken, Lighten, Hard light, Difference, Exclusion; `normal` is never stored. **Dropped:** Color dodge, Color burn and Soft light — FFmpeg's `dodge`, `burn` and `softlight` use different formulas from the W3C ones (and reversing the operands would lose the clip's alpha), so they could not match the preview. Captions, titles, effects and blur have no blend mode: the export host paints them on a transparent layer above the picture.

**Corner radii (schema 20).** A `rect` shape may carry `cornerRadii { tl, tr, br, bl }` (each 0..20000) beside `cornerRadius`. When set it wins; `cornerRadius` then holds the rounded mean so older readers degrade sensibly, and equal radii are never stored (`normalizeShapeGeometry`, applied by `shape-add` and `shape-update`, collapses them to `cornerRadius`). `resolveCornerRadii` and `fitCornerRadii` (`shapePath.ts`) apply the CSS overlap rule (all four scale by the same factor when neighbours exceed a side); a uniform radius draws byte-identical paths to before. The inspector's Corners section links the corners (one slider) or edits them separately. The stage gizmo has no per-corner handles yet.

**Bubble, fit-to-text and templates (schema 23).** A `bubble` geometry is a rounded box with a tail merged into one closed outline: `{ kind: 'bubble', rect, cornerRadius, cornerRadii?, tail { side: left|right|top|bottom, offset 0..1, width, length, curve 0..1 }, rotation }`. `offset` slides the tail along its side across the straight stretch between the corner arcs, so it never overlaps a corner; a tail with no room (tiny box, huge radii, zero width or length) is simply not drawn. `shapeBox` is the rect (the tail is outside it), `glassBounds` grows by the tail length, and the outline counts as closed, so a bubble can be glass. The stage shows the box handles plus a tail handle at the tip (drag to change side, position and length); the inspector has a Tail section. `fitTo` (a title id) and `fitPadding [horizontal, vertical]` are optional stored fields on a shape: they only record which title the box is sized to. `fitShapeToText` (`src/core/fitToText.ts`) is pure: it takes a measured title block (`textBlockBounds`, which runs the same `layoutCaption` as the painter, so Malayalam shaping is measured as painted) plus padding and returns the new rect; an ellipse is grown by root two, `maxWidth` only caps the box width, lines and paths are never fitted. Nothing is fitted at render time. When a title with a fitted shape changes text or style, the UI (`fitMeasure.ts`, hooked in `App.tsx` `runCommand`) measures first, then commits the text update and the refitted shapes as one undo step. `template-insert` (`templateCommands.ts`, builders in `overlayTemplates.ts`) inserts a whole template as a new group with its shapes and titles in one command: `{ templateId, startUs, endUs, ids { group, items { <memberKey>: id } }, at { x, y }, measured { <textKey>: { width, height } } }`. The caller measures the template's texts (`getTemplate(id).texts`) and passes the sizes, so the command stays pure and replayable; the group is selected. Only one sample template (`sample-bubble`) exists; the catalogue is a later slice.

**Glass (schema 21).** A closed shape (`rect`, `ellipse`, `highlight`, or a closed `path`) may carry `glass { blur 0..60, saturation 0.5..3, refraction 0..40, bezel 2..80, tintOpacity 0..1, rim 0..1, specular 0..1, shadow { blur 0..60, offsetY -40..40, opacity 0..1 } }`; absent means not glass and nothing is ever stored for it. The preview blurs and saturates the picture behind the shape with `backdrop-filter`, refracts it in the `bezel` band with an SVG displacement map, and paints the tint (the fill colour at `tintOpacity`), an inner glow, a top-left rim light, a specular highlight and a drop shadow clipped outside the silhouette. The refraction map comes from one pure generator (`src/core/glassMap.ts`: distance to the edge, convex squircle profile inside the bezel, zero in the interior, direction along the inward normal). The glass layer and its surface are siblings, not nested, because an ancestor with opacity, mask, filter, blend or clip-path stops `backdrop-filter` seeing the picture. Commands refuse glass on an open line or path, on a shape with a mask or a blend mode, with a `draw`, `sweep` or `grow` animation, and beyond 8 blending plus glass shapes together. **Export** builds the glass with FFmpeg, in the same pass model as blend modes: a glass shape takes one odd band, the *map sub-frame* (an opaque frame the host paints: R/G = refraction shift, B = silhouette coverage times the shape opacity, following the shape motion, from `glassMap.ts`), and its surface (tint, rim, specular, shadow, stroke) is an ordinary graphic in the even band right after it. FFmpeg crops the picture to the shape's lifetime bounds plus 3 sigma of blur and the refraction shift, then applies `gblur`, a `colorchannelmixer` saturation matrix (CSS `saturate()`), `displace` with the x/y maps and `alphamerge` with the coverage, and overlays the result on the picture over the shape's span. A static glass shape reuses its map buffer. Limits: the cap of 8 is shared with blending shapes (each costs K = 2k+1 passes and a larger pipe); a project with glass always uses PNG frame transport, since the raw transport's un-premultiply bug would corrupt the map; refraction is whole-pixel on both sides; preview (Chromium `backdrop-filter`) and export (FFmpeg) have **not** been compared pixel by pixel, so expect small differences in blur falloff and edge rounding. A glass shape over another glass shape sees the lower one already glassed, as in preview.

**Shapes (schema 19).** A shape may also carry `blendMode`, blending with everything beneath it in layer order — video, images, backgrounds, pinned effects, and any captions, titles or shapes below it (`ShapeActor`'s `blend` prop, default on, spreads the same `blendStyle` onto the shape's outermost element; a masked shape blends on the mask wrapper so the mask itself never gets blended away). At most `MAX_BLENDING_SHAPES` (8, `src/core/graphicsPasses.ts`) blending shapes per project — each one costs an extra export pass.

Export splits into passes at each blending shape instead of painting everything onto one transparent
layer (which has nothing beneath it to blend with): `graphicsPasses(shapes)` (`src/core/graphicsPasses.ts`)
sorts the project's blending shapes by the same `compareLayered` order preview uses, giving
K = 2k+1 bands for k blending shapes — even bands are normal host-painted content composited with
FFmpeg `overlay`, odd bands are exactly one blending shape each, composited with the same
`blendChains` a blending picture clip uses. Pinned overlays/effects always land in band 0, fade
always lands in the last band, and the caption plane lands in whichever band its `layerOrder: 0`
boundary falls in. Each output frame sends K sub-frames down the same pipe, at K× the frame rate;
FFmpeg `select`s them apart (`exportFilterGraphV3`, `workers/media/exportArguments.ts`) and
recombines them in order. A project with no blending shapes is K = 1 — the untouched single pass,
byte-identical to before this existed. See `docs/plans/shape-blend/` for the design and status.

**Export cost.** Only a blending shape costs anything: a project with none exports exactly as before. Each blending shape adds two bands, so each output frame carries 2k+1 sub-frames through the host pipe. The host still paints only bands whose signature changed (a band that is empty at a frame is never sent to the host at all), so a static blending shape costs little to paint; the extra work is FFmpeg's `split`/`select`/`blend`/`overlay` per band and the encoder waiting on the larger pipe. Measured on Windows (960x540, 30 fps, 10 s, a Multiply box and a Screen highlighter over a title on a video, default PNG transport, this machine's own encoder selection): 300 frames in about 4.4 s without blending (136 fps) against 5.6 s with it (82 fps), about 25% more time end to end; with the opt-in raw transport, 4.2 s against 7.4 s. Numbers are one machine and one clip, the engine's own `totalMs` from warm runs (a first cold run of the no-blend case took 5.9 s, dominated by startup; the with-blending PNG runs were 5.60 and 5.62 s); see `docs/STATUS.md`.

- **Preview:** `mix-blend-mode` on the layer, inside a container with `isolation: isolate` and an opaque black background (`BLEND_BACKDROP_STYLE`, applied only when a layer blends), matching FFmpeg's black canvas.
- **Export:** any blending clip forces manifest v3 and the stacked route (`blendMode` is on `ManifestClip`, emitted only when not `normal`). A blended clip is fitted, masked and given its opacity as usual, then padded to a full frame (`pad` with transparent colour) and in time at both ends (`tpad`) so it spans the sequence; `[prev]split`, both sides `format=gbrap`, `blend=c0_mode=M:c1_mode=M:c2_mode=M:c3_mode=normal:shortest=1` (the clip first, so alpha follows it), then `overlay` onto the picture. A normal-only project's arguments are unchanged. `BLEND_FFMPEG` maps names; FFmpeg's operand order is the reverse of W3C's for `overlay`/`hardlight`, so they are swapped there.
- **Images:** the host paints images on a transparent layer, which cannot blend, so `imagesHostPainted` (`src/core/hostPainted.ts`, shared by preview, the Layers list and the export plan) is false whenever an image blends: that image is composited by FFmpeg like a video.
- **Checks:** `workers/media/blend.test.ts` renders every mode through the exact chain over solid-colour grids and compares each pixel with the W3C formulas (±2/255); `--only layer-blend` in `scripts/export-parity.mjs` compares the preview's CSS blend with the FFmpeg render; `--only shape-blend` (540x540, a Multiply box and a Screen highlighter above a title over SMPTE bars) renders the real per-band frame requests through the offscreen host and the real v3 filter graph and compares them with the preview's CSS blend (measured max 1/255 on every channel, mean 0.02).
- **Raw transport caveat:** the parity stage uses the default PNG transport. With the opt-in raw BGRA transport, a semi-transparent shape pixel (a 0.85-opacity highlighter, say) was blended with roughly the alpha applied twice on this Windows FFmpeg build (`unpremultiply=inplace=1` leaves the premultiplied colour almost unchanged), so a blending shape with a translucent fill looks lighter than in preview. Raw is off by default and was already documented as not within +-1 of PNG; blending makes the error large enough to see, so keep raw off for projects with blending shapes.
