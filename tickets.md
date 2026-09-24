# Caption Studio implementation tickets

This file turns the product roadmap into small vertical slices. Copy one prompt at a time into a new Codex task. A ticket is complete only when its behavior works, its checks pass, and `docs/STATUS.md` records the result.

## How to choose the next ticket

You do not need to finish an entire phase before moving to another one. Follow each ticket's dependencies, then choose based on the kind of progress you want:

| Goal | Choose | Why |
| --- | --- | --- |
| Best next engineering step | **E1** | Establishes safe editing commands needed by later timeline and transcription work |
| Most visible UI progress | **E2**, after E1 | Adds draggable timing and timeline zoom |
| Start real media processing | **M1** | Establishes the worker boundary and FFmpeg decision |
| Start local AI work | **T1**, after M1 | Defines the backend contract without prematurely choosing model behavior |
| Improve project safety | **P1** | Adds autosave, recovery and migrations |
| Work on subtitle appearance | **R1** | Solves Malayalam-safe shared rendering before style controls |
| Start single-source video edits | **V1**, after X2 | Schema 3, sequence time and generic tracks that overlays, sound effects, blur, trim and cuts all build on |

Model suggestions use the models currently available in Codex:

- **GPT-5.6 Luna, medium/high:** small, contained UI or test changes.
- **GPT-5.6 Terra, high:** ordinary feature implementation across a few files.
- **GPT-5.6 Sol, high/xhigh:** cross-process implementation, debugging and larger vertical slices.
- **GPT-6 Astra, high/xhigh:** architecture, dependency/licensing research, timing correctness and export design.

## Progress board

### Phase A — Foundation

- [x] **A1** Secure Electron/React/TypeScript scaffold
- [x] **A2** Real SRT import, synchronized preview, basic editing and project/SRT saves
- [ ] **A3** Establish the reviewed baseline commit

### Phase B — Editing core

- [x] **E1** Command-based caption editing and validation
- [x] **E2** Draggable timing boundaries and timeline zoom
- [x] **E3** Keyboard editing and accessibility pass
- [x] **E4** Track-based timeline layout (toolbar, ruler, Captions/Video/Audio tracks, snap, trim, WORD/LINE view)

### Phase C — Media foundation

- [x] **M1** Media-worker contract and FFmpeg/ffprobe decision
- [x] **M2** Media metadata, fingerprints and relinking
- [x] **M3** Real waveform extraction
- [x] **M4** Real thumbnail extraction and proxy diagnostics

### Phase D — Persistence and recovery

- [ ] **P1** Autosave, recovery copies and schema migrations

### Phase E — Local transcription

- [x] **T1** Transcription adapter and cancellable job system
- [x] **T2** Explicit local model manager
- [x] **T3** Real whisper.cpp transcription integration
- [x] **T4** Caption grouping, word provenance and correction preservation
- [ ] **T5** Malayalam/English benchmark harness

### Phase F — Shared caption rendering and styles

- [x] **R1** Malayalam-safe grapheme and layout engine
- [x] **R2** Five real style/motion presets
- [x] **R2.1** Style inspector tabs (Edit/Style/Templates), local font access, per-frame preview clock
- [ ] **R3** Word timing and emphasis editor

### Phase G — Rendered video export

- [x] **X1** Export renderer prototype and architecture decision
- [x] **X2** Cancellable MP4 export pipeline
- [x] **X3** Preview/export parity and sync validation

### Phase I — Single-source video edits (after the first usable release; see docs/EDITING.md)

- [ ] **V1** Edit foundation: schema 3, sequence time, generic timeline items, item commands, manifest v2
- [ ] **V2** Image overlays
- [ ] **V3** Sound effects
- [ ] **V4** Blur regions
- [ ] **V5** Trim in/out
- [ ] **V6** Cuts

### Phase J — Local agent control (docs/MCP.md)

- [x] **MCP1** Command schema/protocol, renderer bridge, MCP server core (get_project, get_captions, edit, set_caption_style, apply_template, list_style_options, seek, select, undo, redo), timeline markers, Settings tab, top-bar indicator
- [ ] **MCP2** Vision loop and media: render_frame/prepare-snapshot, import_media, import_image_data, place_at_word, alpha-clip export support, Claude Desktop stdio bridge
- [ ] **MCP3** Job tools (transcribe, detect_silence, export_video, export_srt, get_job, cancel_job, save_project) and repo-shipped Claude Code skills (B-roll/ComfyUI, filler/Remotion recipes)
- [ ] **MCP4** (separate, later) schema-6 text/title clip type and built-in parametric fillers rendered by the shared caption renderer, for in-app "Vox-style" edits without Node/Remotion

### Phase H — Distribution

- [ ] **D1** Complete dependency and license inventory
- [ ] **D2** macOS and Windows packaging
- [ ] **D3** Clean-machine release validation

---

## A3 — Establish the reviewed baseline commit

**Dependencies:** A1, A2  
**Suggested model:** GPT-5.6 Luna, medium. This is a contained review and repository task.

```text
Work only on ticket A3 from tickets.md: establish the reviewed baseline commit.

Read AGENTS.md, docs/PRODUCT.md, docs/ARCHITECTURE.md, docs/ROADMAP.md, docs/STATUS.md and TICKETS.md first. Review every currently uncommitted file for accidental artifacts, secrets, generated media, caches, unsafe Electron settings, missing lockfile entries and obvious build problems. Do not discard user changes. Run npm run check and a macOS desktop smoke test if the environment allows it. Fix only issues that prevent this scaffold from being a sound baseline. Update docs/STATUS.md with exact verification and limitations. Mark A3 complete in TICKETS.md only if the review passes. Then create one local commit with a clear initial-project message. Do not add a remote or publish anything.
```

## E1 — Command-based caption editing and validation

**Dependencies:** A2  
**Suggested model:** GPT-5.6 Sol, high. This affects state history, timing rules and several editing operations.

```text
Work only on ticket E1 from tickets.md: command-based caption editing and validation.

Read AGENTS.md and all files in docs/ before implementation. Inspect the existing React state and core project model. Replace ad hoc caption mutation with pure TypeScript editing commands for update text, update time, add, delete, split at playhead and merge adjacent cues. Preserve stable cue IDs where semantically safe, make each user action one undo/redo step, and treat user text corrections as authoritative. Validate positive duration, media bounds when known, and word containment. Detect overlaps and return visible warnings without silently retiming or deleting imported content. Text edits must preserve unchanged timing where safe and mark affected timing as needing review.

Wire the commands into the existing UI with real controls. Add focused tests for commands, undo/redo, boundary cases, overlaps and mixed Malayalam/English text. Do not add mock features. Run npm run check and a desktop smoke test where available. Update docs/STATUS.md and mark E1 complete in TICKETS.md only after the acceptance behavior works.
```

## E2 — Draggable timing boundaries and timeline zoom

**Dependencies:** E1  
**Suggested model:** GPT-5.6 Sol, high. Pointer interactions and canonical timing need careful implementation.

```text
Work only on ticket E2 from tickets.md: draggable timing boundaries and timeline zoom.

Read AGENTS.md, the product/architecture/roadmap/status docs and the completed E1 implementation. Add draggable cue blocks and start/end handles to the real timeline, plus useful zoom and horizontal scrolling. Keep integer microseconds as canonical time; convert to seconds only at the video playback boundary. One drag gesture must create one undoable command. Enforce positive duration and media bounds, warn on overlaps, and never silently alter neighboring imported cues. Seeking, transcript selection, caption overlay and timeline selection must stay synchronized while dragging.

Add meaningful tests for time/pixel conversion, zoom invariance, drag clamping and undo/redo. Smoke-test pointer interaction in the Electron app. Avoid frame rounding and do not claim frame accuracy for variable-frame-rate media. Run npm run check, update docs/STATUS.md and mark E2 complete in TICKETS.md only when verified.
```

## E3 — Keyboard editing and accessibility pass

**Dependencies:** E1  
**Suggested model:** GPT-5.6 Terra, high. This is a focused renderer and interaction task.

```text
Work only on ticket E3 from tickets.md: keyboard editing and accessibility.

Read AGENTS.md and the project docs first. Add documented keyboard shortcuts for play/pause, seek, split, delete, undo/redo and moving between cues. Do not intercept shortcuts while the user is typing unless the shortcut is explicitly safe. Make the transcript, timeline, inspector and transport usable by keyboard with visible focus, accurate labels and sensible focus restoration after deletion. Add an in-app shortcut reference that reflects only implemented actions.

Test shortcut routing and editing-field exclusions where meaningful, run npm run check, and perform an accessibility-tree desktop smoke test. Update docs/STATUS.md and mark E3 complete only after verification.
```

## M1 — Media-worker contract and FFmpeg/ffprobe decision

**Dependencies:** A2  
**Suggested model:** GPT-6 Astra, high. This needs current dependency, redistribution and cross-platform research.

```text
Work only on ticket M1 from tickets.md: define the media-worker boundary and make the initial FFmpeg/ffprobe decision.

Read AGENTS.md and all project docs first. Research maintained FFmpeg/ffprobe distribution options from primary sources, including macOS Apple Silicon and Windows x64 support, exact licensing, build configuration visibility, binary size, update policy and offline redistribution. Do not adopt Remotion. Record evidence and the decision in an architecture decision record and update docs/DEPENDENCIES.md.

Implement a small typed media-worker client/server boundary in a separate process. Define request, progress, cancellation, structured error and result messages for probe, waveform, thumbnails, audio extraction and future export. Validate all messages. Spawn processes with executable plus argument arrays, never interpolated shell commands. Prove the boundary with a harmless real worker operation and tests; do not fake FFmpeg output or progress. Keep platform paths portable. Run npm run check, update docs/STATUS.md and mark M1 complete only if the contract and decision are reviewable.
```

## M2 — Media metadata, fingerprints and relinking

**Dependencies:** M1  
**Suggested model:** GPT-5.6 Sol, high. This spans the worker, schema, IPC and UI.

```text
Work only on ticket M2 from tickets.md: real media metadata, fingerprints and relinking.

Read AGENTS.md and all project docs. Through the media-worker boundary, use the selected ffprobe integration to read duration in canonical integer microseconds, rational frame rate, dimensions, rotation, audio/video streams and codec information. Add a practical media fingerprint and portable project media reference without embedding the source. On project reopen, resolve safe relative paths where possible and provide a real relink flow when media is missing. Verify the selected replacement against stored metadata/fingerprint and explain mismatches without blocking an intentional user choice. Never overwrite or copy the input media silently.

Add schema migration support for the new fields and tests for paths containing spaces/Unicode, missing media, VFR metadata and rotated media fixtures where available. Run npm run check and a real-media desktop smoke test. Update docs/STATUS.md and mark M2 complete only when verified on the platform actually tested.
```

## M3 — Real waveform extraction

**Dependencies:** M1, M2  
**Suggested model:** GPT-5.6 Sol, high. This combines asynchronous media processing and timeline rendering.

```text
Work only on ticket M3 from tickets.md: real waveform extraction.

Read AGENTS.md and the project docs. Implement cancellable waveform extraction through the media worker using the project's selected FFmpeg build. Generate bounded-size peak data mapped to source-media timestamps, cache it outside Git with a media fingerprint and extraction-version key, and render it efficiently behind the caption timeline. Keep the UI responsive, expose honest progress states and clean only job-owned temporary files on cancellation/failure. Never show generated placeholder waveform data.

Test peak reduction and timestamp mapping with deterministic audio fixtures. Verify cache invalidation and cancellation. Run npm run check and smoke-test with a real local video. Update docs/STATUS.md and mark M3 complete only after the real waveform is visible and synchronized.
```

## M4 — Real thumbnail extraction and proxy diagnostics

**Dependencies:** M1, M2  
**Suggested model:** GPT-5.6 Terra, high. The worker pattern should already exist, making this a bounded media feature.

```text
Work only on ticket M4 from tickets.md: real thumbnails and proxy diagnostics.

Read AGENTS.md and the project docs. Add cancellable thumbnail extraction through the media worker at zoom-aware source timestamps. Cache bounded thumbnails outside Git using the media fingerprint. Render them on the timeline without blocking interaction. Add codec diagnostics that clearly identify media the embedded player cannot decode and define a local proxy-conversion path, but expose proxy controls only if conversion is functional. Never overwrite source media.

Test timestamp selection, cache invalidation, cancellation and cleanup. Smoke-test a supported MP4 and one diagnostically unsupported fixture if available. Run npm run check, update docs/STATUS.md and mark M4 complete only for behavior actually verified.
```

## P1 — Autosave, recovery copies and schema migrations

**Dependencies:** A2; M2 recommended  
**Suggested model:** GPT-6 Astra, high. Persistence correctness and recovery deserve deeper review.

```text
Work only on ticket P1 from tickets.md: autosave, recovery and project migrations.

Read AGENTS.md and all project docs. Implement debounced atomic autosave for named projects, a recovery copy that does not replace the last known-good project, startup detection of newer recoverable work, and a clear restore/discard decision. Never overwrite input media. Add an explicit migration pipeline from each supported schema version to the current version; validate before and after migration and retain a recoverable original when migration writes a file. Keep project paths portable and credentials/cache data out of project JSON.

Test interrupted-write behavior, corrupt JSON, recovery precedence, migration success/failure, Unicode paths and preservation of human edits. Run npm run check and a desktop recovery smoke test. Update docs/STATUS.md and mark P1 complete only after proving reopen without data loss.
```

## T1 — Transcription adapter and cancellable job system

**Dependencies:** M1  
**Suggested model:** GPT-6 Astra, high. The contracts will constrain every transcription backend.

```text
Work only on ticket T1 from tickets.md: transcription adapter and cancellable job system.

Read AGENTS.md and all project docs. Design and implement typed transcription contracts for capabilities(), transcribe(input, options, progress, cancellation), and optional align() with explicit supported-language declarations. Add queued/running/succeeded/failed/cancelled job states, structured progress/errors and resource arbitration so heavy transcription and export jobs do not run together by default. Validate backend output before any project mutation. Preserve source timestamp offsets through the contract. Do not integrate a fake backend, fake transcript or fake progress.

Use a deterministic test adapter only in tests to verify lifecycle, cancellation, malformed-output rejection and no project mutation on failure. Run npm run check, update docs/STATUS.md and mark T1 complete only when the reusable contracts are tested.
```

## T2 — Explicit local model manager

**Dependencies:** T1  
**Suggested model:** GPT-5.6 Sol, high. This is cross-process file management with integrity and UI states.

```text
Work only on ticket T2 from tickets.md: explicit local model management.

Read AGENTS.md and all project docs. Implement a model catalog and manager for the planned whisper.cpp backend. Show exact model name, language capability, download size, disk location, checksum, installed state and supported device modes. Downloads must require an explicit user action, support cancellation and resume if the source supports it, verify a trusted checksum before activation, and use atomic finalization. Model removal must target only the selected managed model and require a clear user action. The app must remain usable offline after download.

Do not bundle model weights or claim arbitrary model compatibility. Test state transitions, checksum failure, interrupted download recovery, disk errors and safe removal with local fixtures/mocks at the network boundary. Run npm run check, update dependency/license records and docs/STATUS.md, and mark T2 complete only when model state is honest.
```

## T3 — Real whisper.cpp transcription integration

**Dependencies:** M2, T1, T2  
**Suggested model:** GPT-6 Astra, xhigh. This is a required release feature with native-process, timing and portability risks.

```text
Work only on ticket T3 from tickets.md: integrate one real local whisper.cpp transcription backend.

Read AGENTS.md and all project docs. Verify the maintained whisper.cpp version, build configuration, model compatibility, licenses and macOS/Windows execution strategy from primary sources. Record exact decisions in docs/DEPENDENCIES.md. Implement real audio extraction with source-time mapping, then invoke whisper.cpp in a separate worker process using argument arrays. Support language selection, CPU fallback, detected device/capabilities, honest progress where the backend exposes it, cancellation and actionable errors. Preserve long-silence offsets and never invent text for silence.

Parse and validate real backend output into project captions with engine/model provenance. Do not overwrite human-corrected cues during retranscription; require an explicit replacement/merge choice. Test parsers and timestamp mapping, then run a real offline transcription smoke test with an explicitly downloaded model and report the actual machine/model/clip. Update docs/STATUS.md and mark T3 complete only after video audio produces editable timed captions locally.
```

## T4 — Caption grouping, word provenance and correction preservation

**Dependencies:** T3  
**Suggested model:** GPT-6 Astra, high. Mixed-language token identity and authoritative edits are subtle.

```text
Work only on ticket T4 from tickets.md: readable grouping, word timing provenance and correction preservation.

Read AGENTS.md and all project docs. Separate speech recognition output, word timing, and readable caption grouping in pure tested core modules. Extend the schema with stable word IDs, canonical microsecond boundaries, timing source (model/aligned/manual/estimated) and needsReview. Preserve Malayalam grapheme clusters and mixed Malayalam/English tokens. When users edit text, retain unchanged word IDs/timings only when safe; mark affected alignment for review and never label estimates as aligned. Retranscription must not silently overwrite authoritative user corrections.

Add tests for insertions, deletions, repeated words, punctuation, Malayalam combining marks, long pauses, word containment and regrouping without timing drift. Add UI that clearly distinguishes timing provenance. Run npm run check, update docs/STATUS.md and mark T4 complete only after the rules are visible and tested.
```

## T5 — Malayalam/English benchmark harness

**Dependencies:** T3, T4  
**Suggested model:** GPT-6 Astra, high. The benchmark must produce defensible measurements rather than invented thresholds.

```text
Work only on ticket T5 from tickets.md: create the Malayalam/English transcription benchmark harness.

Read AGENTS.md and all project docs. Build a local benchmark workflow for user-provided clips covering normal Malayalam speech, fast Malayalam/English technical speech and long pauses. Keep recordings and transcripts out of Git. Measure processing time, peak memory where practical, sampled boundary error against manually reviewed references, and correction effort using an explicitly documented method. Store only non-sensitive aggregate results or empty templates in Git. Compare practical model sizes/device modes supported by the implemented backend.

Do not invent numeric release thresholds or infer ground-truth transcripts. Establish thresholds only from measured baselines and document limitations. Run the harness on available authorized fixtures, update docs/STATUS.md and model guidance, and mark T5 complete only when results are reproducible.
```

## R1 — Malayalam-safe grapheme and layout engine

**Dependencies:** A2; T4 recommended before word animation  
**Suggested model:** GPT-6 Astra, xhigh. Unicode shaping and preview/export parity are core correctness risks.

```text
Work only on ticket R1 from tickets.md: the shared Malayalam-safe caption renderer.

Read AGENTS.md and all project docs. Create one deterministic, time-driven caption-rendering module used by preview and designed for future export. Segment text by Unicode grapheme clusters with maintained standards-based APIs/libraries; never animate raw code units or detach Malayalam vowel signs. Define layout inputs for viewport, safe area, font stack/readiness, max lines, position, wrapping, appearance and timestamp. Ensure scale changes do not change semantic line layout unexpectedly. Use source timestamps, not accumulated frames.

Add focused mixed Malayalam/English fixtures for combining marks, ligatures, punctuation, wrapping and fallback fonts. Add renderer snapshot/geometry tests that are meaningful across preview sizes. Record the font strategy and redistribution status. Run npm run check and visually inspect real Malayalam samples. Update docs/STATUS.md and mark R1 complete only after preview uses the shared renderer.
```

## R2 — Five real style and motion presets

**Dependencies:** R1  
**Suggested model:** GPT-5.6 Sol, high. This is a substantial renderer/UI feature on an established foundation.

```text
Work only on ticket R2 from tickets.md: implement the five first-release caption presets.

Read AGENTS.md and all project docs. Using only the shared renderer, implement static clean, active-word highlight, word pop, phrase fade and progressive word reveal. Separate appearance from motion. Add functional controls for font, primary/secondary colors, outline, shadow, background padding, caption position, max lines and saved presets. Evaluate motion from absolute source time so seeking produces the same frame every time. Disable or clearly explain word-dependent presets when only cue timing exists; never disguise estimated timing as aligned timing.

Preserve Malayalam grapheme clusters through every animation. Add deterministic timestamp tests for each preset and visual checks at portrait and landscape sizes. Run npm run check, update docs/STATUS.md and mark R2 complete only when all controls affect the real preview.
```

## R3 — Word timing and emphasis editor

**Status:** partially addressed (2026-09-16, "R3 slice 1" in docs/STATUS.md) — `WORD`/`LINE` is a saved
project setting driving the timeline, preview and export identically; missing word timing is
auto-estimated (labelled, gap-filling only) when switching to WORD; word blocks support
select/seek/add/delete. Still open: draggable word boundaries and manual per-word timing creation.

**Dependencies:** E1, T4, R2  
**Suggested model:** GPT-5.6 Sol, high. This joins timeline interaction, stable word identity and rendering.

```text
Work only on ticket R3 from tickets.md: editable word timing and emphasis.

Read AGENTS.md and all project docs. Add an expandable word-timing track with selectable words, draggable boundaries, manual timing creation and per-word emphasis. Keep word IDs stable, enforce containment within the parent cue and preserve grapheme clusters. One drag is one undoable action. Clearly label model, aligned, manual and estimated timing. Text edits must not silently transfer emphasis to a different repeated token.

Test repeated words, mixed scripts, containment, boundary dragging, undo/redo and emphasis identity after edits. Run npm run check and a desktop smoke test. Update docs/STATUS.md and mark R3 complete only when the shared preview reflects real edited timing.
```

## X1 — Export renderer prototype and architecture decision

**Dependencies:** M1, R1  
**Suggested model:** GPT-6 Astra, xhigh. This is an architecture and performance decision with long-term consequences.

```text
Work only on ticket X1 from tickets.md: prototype the export renderer and decide the implementation path.

Read AGENTS.md and all project docs. Prototype Chromium-based offscreen frame rendering using the same caption renderer as preview. Measure correctness, throughput, memory, transparency and font readiness on representative portrait and landscape frames. Compare only credible maintained alternatives from primary sources, including redistribution/license implications; do not commit to Remotion without a documented suitability evaluation. The prototype must render real caption frames at requested absolute source timestamps.

Record measurements, limitations and the decision in an architecture decision record. Add a small parity fixture between interactive preview state and exported frame state. Do not expose a final Export Video button yet. Run npm run check, update docs/DEPENDENCIES.md and docs/STATUS.md, and mark X1 complete only when the decision is supported by evidence.
```

## X2 — Cancellable MP4 export pipeline

**Dependencies:** M2, R2, X1  
**Suggested model:** GPT-6 Astra, xhigh. Encoding, timestamp mapping and cleanup are high-risk release behavior.

```text
Work only on ticket X2 from tickets.md: implement real cancellable MP4 export.

Read AGENTS.md and all project docs. Implement export through the job/media-worker system using the renderer chosen in X1 and the pinned FFmpeg build. Render captions from canonical source timestamps, encode one documented MP4 profile, preserve or correctly transcode audio, handle dimensions/aspect ratio/rotation/rational frame rate, report real progress, support cancellation and clean only job-owned temporary files. Write to a temporary destination and atomically finalize. Never overwrite source media; require an explicit destination and handle existing files safely.

Expose the Export Video UI only when the pipeline works end to end. Add tests for argument construction, timestamp/frame mapping, cancellation and finalization. Smoke-test a real short export and record actual platform, codec and input. Run npm run check, update docs/STATUS.md and mark X2 complete only when the exported MP4 plays with audio and captions.
```

## X3 — Preview/export parity and sync validation

**Dependencies:** X2  
**Suggested model:** GPT-6 Astra, xhigh. This requires precise visual and timing evidence.

```text
Work only on ticket X3 from tickets.md: validate preview/export parity and long-form sync.

Read AGENTS.md and all project docs. Build a repeatable parity suite that compares preview and exported caption frames at fixed absolute timestamps for all five presets, portrait/landscape layouts and Malayalam/English shaping cases. Validate audio/caption sync across long pauses, rotated sources and representative VFR input. Measure tolerances from the actual pipeline and document them; do not claim bit-identical output if scaling or color conversion prevents it.

Fix discrepancies in the shared renderer or export mapping rather than adding a second caption implementation. Store only small redistributable fixtures. Run npm run check and the parity suite, update docs/STATUS.md with measured results/platforms, and mark X3 complete only when the milestone gate is supported by evidence.
```

## V1 — Edit foundation: schema 3, sequence time, generic timeline, item commands, manifest v2

**Dependencies:** X2, E4, R2.1 (V1 edits App.tsx, Timeline.tsx and CaptionPreview.tsx, which R2.1 rebuilt).  
**Suggested model:** GPT-6 Astra, xhigh. Schema migration, time mapping and the export manifest are correctness-critical and everything in Phase I builds on them.

```text
Work only on ticket V1 from tickets.md: the foundation for single-source video edits.

Read AGENTS.md, all project docs and especially docs/EDITING.md; implement its contract, do not redesign it. Add src/core/edit.ts (composition rect, asset, image overlay, blur region, audio clip and segment schemas) and bump src/core/model.ts to schema 3: media stays singular, assets/overlays/blurRegions/audioClips default to empty arrays, segments is optional with min(1), one ID namespace across every kind, assetId kind matching, segments ascending/non-overlapping/within media duration. Keep schema 2 loadable (loadProject tries 3, 2, 1; migratedFrom becomes 1|2|null) and make electron/projectMedia.ts's portable-path save/relink cover assets. Add src/core/sequence.ts exactly as documented (effectiveSegments, sequenceDurationUs, sourceToSequence, sequenceToSource, spansInSequence, nextKeptSourceUs, setTrim, splitSegmentAt, removeSegment, joinWithNext, cuesInSequence) — pure, integer microseconds, identity when segments is absent. Cues straddling a cut are clipped for display/export, never split in storage.

Generalise the timeline: src/core/timelineItems.ts (TimelineItem, Selection, TimelineTrack), dragRangeBy/cueDragBounds in src/core/timeline.ts with dragCueBy as a wrapper so its tests pass unchanged, dynamic track rows from a tracks list in Timeline.tsx replacing the fixed CSS grid variables, item-typed drag state, and selection as {kind,id} in App.tsx with a derived selectedCueId for existing read sites. Add src/core/itemCommands.ts and src/core/commands.ts (applyEditCommand) sharing CommandResult/ValidationIssue with captionCommands.ts and the existing whole-project undo history; validate after every command, with rect height a warning through CommandContext.compositionHeight, never a schema error. Ruler, playhead, seek, block positions, snap targets, zoom anchor, durationUs, transport clock and seekBy move to sequence time; currentUs, cues, captionFrame, transcription and every worker request stay in source time. Build the cut-skipping playback controller on src/core/playbackClock.ts (nextKeptSourceUs → seek to next kept start, pause past the end) and note in STATUS that per-frame motion preview now updates at frame rate.

Extend export without breaking X2: add manifest v2 as a strict superset of src/export/plan.ts's v1 (segments, overlays, output-pixel blur regions, sequence-time audio clips), src/core/composition.ts (displayDimensions extracted from App.tsx, compositionToPixels, compositionScalarToPixels) and src/core/layerPlan.ts (per-sequence-frame source timestamps and frame signatures reusing captionFrame). Refactor workers/media/exportArguments.ts into a deterministic builder over the manifest with snapshot tests for the argument array and filtergraph; identity segments and empty effect lists must produce the same encode X2 produces today. No new effect reaches FFmpeg in this ticket.

Tests: model (2→3 and 1→3 add empty arrays and no segments; duplicate ID across a cue and an overlay rejected; overlay referencing an audio asset rejected; unsorted, overlapping, empty or out-of-media segments rejected), sequence (identity, round-trips, cut-instant collapse, spans across two cuts, nextKeptSourceUs past end, cuesInSequence clipping words and dropping removed cues), timeline (dragRangeBy reproduces every existing dragCueBy case), itemCommands, commands, layerPlan (static cue yields three spans; word-pop changes signature only inside its ramps; exact frame times at 30000/1001 for indices 0, 1 and 10000), composition (rotated fixture swaps dimensions; even rounding), exportArguments snapshots. Smoke on real media: a schema-2 project reopens as schema 3 with no cue change; drag, snap, split, merge and undo behave as before; X2 export of an unedited project is unchanged. Run npm run check, update docs/ARCHITECTURE.md, docs/EDITING.md and docs/STATUS.md, and mark V1 complete only when the schema, sequence mapping, generic timeline and unchanged export are all verified.
```

## V2 — Image overlays

**Dependencies:** V1  
**Suggested model:** GPT-5.6 Sol, high. Cross-process asset handling plus preview/export layer parity.

```text
Work only on ticket V2 from tickets.md: time-ranged image overlays.

Read AGENTS.md, all project docs and docs/EDITING.md. Add asset import through main: a filtered native open dialog, probe via the existing inspectMedia/inspectedMedia fingerprint gate, classify image vs audio from ffprobe metadata in a pure src/core/assetKind.ts, and return an asset record plus its media:// URL; resolve and relink assets on project open with the same resolved/missing/mismatch shapes the media reference uses, and make project save portable for assets. Add media: to img-src in index.html's CSP. Create src/captions/CompositionLayers.tsx rendering overlays as <img> siblings of CaptionView inside the projection wrapper factored out of CaptionPreview.tsx (useCompositionProjection); rect, fit and opacity are in composition units and scale with the wrapper. Add an Overlays timeline track using V1's generic items (drag, resize, select, delete, undo) and an inspector for asset, rect, fit and opacity with the same draft/commit-per-gesture pattern as the style panel.

Export: extend src/export/frameRequest.ts to v2 carrying visible overlays and asset URLs, render them in the export host's frame harness so overlays are part of the transparent layer, include overlay identity and opacity in layerPlan signatures, and leave FFmpeg untouched. A missing asset renders a visible placeholder in preview and fails export with an actionable message; it never silently drops the overlay.

Tests: assetKind (PNG/JPEG probe JSON → image; WAV/MP3 → audio; MP4 → rejected), CompositionLayers (visible only inside its time range; 1:1 composition rect; fit/opacity applied; missing asset placeholder), layerPlan (an overlay boundary starts a new span), projectMedia (portable asset references round-trip), frameRequest v2 validation. Smoke on real media: import a PNG with alpha, place and time it, save/reopen with the asset resolved relatively, export and confirm its pixel position in the output within one pixel after scaling, with source and asset hashes unchanged. Run npm run check, update docs/STATUS.md and mark V2 complete only when the exported frame shows the overlay the preview showed.
```

## V3 — Sound effects

**Dependencies:** V2  
**Suggested model:** GPT-5.6 Sol, high. Web Audio scheduling against the video clock and an FFmpeg mix graph.

```text
Work only on ticket V3 from tickets.md: inserted sound effects.

Read AGENTS.md, all project docs and docs/EDITING.md. Reuse V2's asset import for audio files. Add src/playback/SfxScheduler.ts: decode each clip once from its media:// URL (add media: to connect-src in the CSP), schedule AudioBufferSourceNodes against the <video> on play/seeked/ratechange/pause/ended/volumechange, place clips at sourceToSequence(atUs), apply per-clip gain and follow the video's mute/volume/playback rate. Add an SFX timeline track (move, select, delete, undo; waveform of the clip through the existing waveform extraction) and an inspector for asset, in point, duration and gain.

Export: add the audio branch of the manifest builder — per clip atrim/asetpts/aresample/aformat/adelay in samples at 48 kHz/volume, then amix with normalize=0 and duration=first over the source audio (anullsrc when the source has none); clips anchored inside a removed range are dropped with a warning in the manifest builder. Keep the graph deterministic and snapshot-tested.

Tests: SfxScheduler with a fake AudioContext (future clip scheduled with the correct when; mid-clip start uses the right offset; seeked restarts; ratechange sets playbackRate; pause stops all; one GainNode per clip), exportArguments (adelay samples from microseconds; amix flags; deterministic order; anullsrc path), manifest builder (clip in a removed range dropped). Smoke on real media: two overlapping clips exported; measure each onset in the output with a peak scan and record the offset from the expected sequence time; measure preview onset drift against the video clock and document it. Run npm run check, update docs/STATUS.md and mark V3 complete only when exported onsets are within one millisecond and preview drift is measured and documented.
```

## V4 — Blur regions

**Dependencies:** V3  
**Suggested model:** GPT-5.6 Sol, high. Filtergraph correctness and a measured preview/export tolerance.

```text
Work only on ticket V4 from tickets.md: static blur rectangles.

Read AGENTS.md, all project docs and docs/EDITING.md. Add a drag-to-draw rectangle tool on the preview stage (composition units), a Blur timeline track and an inspector for rect and radius. Render blur regions in CompositionLayers as backdrop-filter divs beneath overlays and captions, with renderBlur=false in the export frame harness because blur is applied by FFmpeg. Export: add the video branch of the manifest builder — per region split/crop/gblur/overlay chained with unique labels, enable windows in sequence time after any concat, sigma scaled from composition units to output pixels via compositionScalarToPixels, crop clamped to output bounds — deterministic and snapshot-tested. Never emit -noautorotate.

Tests: exportArguments (N regions chain with unique labels; enable windows in sequence time; clamped crop; scaled sigma), composition (rect to pixels at 1080 and 720 outputs and for a rotated source), CompositionLayers (backdrop-filter value equals the radius; renderBlur=false renders nothing). Smoke on real media: place a region over a high-contrast area, export, and compare mean gradient magnitude inside the region between a preview capture and the exported frame; record the measured tolerance in docs/CAPTION_RENDERER.md for X3 to reuse. Run npm run check, update docs/STATUS.md and mark V4 complete only when the export is blurred where the preview was and the tolerance is recorded.
```

## V5 — Trim in/out

**2026-09-24 note:** V5 was redefined for the multi-track timeline as (a) trim-to-playhead (`Q`/`W`, `clip-trim-to`) and (b) an In/Out export range (`I`/`O`, `projectInRange`, dimming, stop at Out, range MP4 and SRT). Both are implemented and unit-tested (`docs/STATUS.md` 2026-09-24). Still open before it can be checked off: a real range export measured against Out − In within one frame, a GUI pass, and the below text's single-segment trim commands are obsolete. Stays unchecked.

**Dependencies:** V1  
**Suggested model:** GPT-5.6 Sol, high. First use of sequence time in export and SRT.

```text
Work only on ticket V5 from tickets.md: trim in/out points.

Read AGENTS.md, all project docs and docs/EDITING.md. Add set-in/set-out/clear shortcuts and toolbar actions using V1's trim-set/trim-clear commands (one kept segment). The timeline dims regions outside the range and its ruler shows the shorter sequence duration; the playback controller pauses at the out point and seeks to the in point when playing from before it. SRT export of a trimmed project goes through cuesInSequence so it starts at zero and drops cues outside the range. Export uses a single trim/atrim pair; identity emits no trim filters and matches X2's output exactly.

Tests: sequence (setTrim on identity and on an existing multi-segment list; in ≥ out rejected), itemCommands (trim beyond media rejected; trim-clear restores identity), srt (trimmed export starts at zero and clips a straddling cue), exportArguments (single trim pair snapshot; identity emits none). Smoke on real media: trim two seconds off each end, export, confirm the output duration equals the sequence duration within one frame and the first caption's timestamp shifted by exactly the in point, with the source untouched. Run npm run check, update docs/STATUS.md and mark V5 complete only when preview, SRT and MP4 agree on the trimmed range.
```

## V6 — Cuts

**Dependencies:** V5, V4  
**Suggested model:** GPT-6 Astra, xhigh. Multi-segment playback, concat export and straddling captions are timing-critical.

```text
Work only on ticket V6 from tickets.md: cut and remove ranges.

Read AGENTS.md, all project docs and docs/EDITING.md. Add cut-at-playhead, delete-segment and join-with-next using V1's segment commands, with segment blocks and cut markers on the video track; thumbnail strips and waveform slices are drawn per kept segment from source-keyed data (pure src/core/waveformSlice.ts) so extraction caches are unchanged. The playback controller skips removed ranges (built in V1) is now exercised for real: measure removed frames shown and stall time per cut. Cues straddling a cut render as multiple blocks, select and drag as one cue, and are clipped — never split — in export and SRT; fully removed cues stay in the transcript with a "removed by cut" badge. Export emits per-segment trim/atrim + setpts and concat with blur enable windows and sound-effect delays expressed after the concat.

Tests: sequence (splitSegmentAt at a boundary is a no-op; removeSegment then joinWithNext round-trips; nextKeptSourceUs across three gaps), waveformSlice (exact bucket edges for a source range), exportArguments (three segments → two concat filters; enable windows post-concat), playback controller with a fake video and frame callback (one seek per gap; pause past the end). Smoke on real media: three cuts; count removed frames shown per cut (expect 0–1) and stall time; export and confirm duration equals the sequence duration within one frame, a caption straddling a cut appears in both halves with correct word highlighting, SRT export is in sequence time and the source hash is unchanged. Run npm run check, update docs/STATUS.md and mark V6 complete only when preview, SRT and MP4 agree on the cut sequence and undoing a cut restores every caption.
```

**2026-09-18 note:** the "Remove Silence" feature (`docs/STATUS.md`) landed V6's export half early, through an
automatic detector rather than this ticket's manual UI: `segments-set` (one command replacing the whole edit
list, `itemCommands.ts`), `src/core/waveformSlice.ts`, per-segment waveform `<svg>`s and `.cut-marker`s on the
video track, the "Removed by cut" transcript badge, and the `exportArguments.ts` trim/concat filtergraph branch
(with `-filter_complex_script` spillover past 8 KiB) are all in place and unit-tested. Still open for this ticket
specifically: cut-at-playhead, delete-segment and join-with-next as interactive tools, segment blocks/handles on
the video track, and the real-media smoke test this ticket's own text calls for — V6 stays unchecked until those
land and the smoke runs.

## V7 — Multi-clip sequencing

**Dependencies:** V1, V6's silence-removal half  
**Suggested model:** GPT-6 Astra, xhigh. A new time model across playback, export and every source-time item.

Supersedes the "one source video" constraint of V1–V6: the source video becomes an asset kind, the kept-range
list becomes an ordered `clips` list (schema 4, `docs/EDITING.md` "Schema 4"), and V5's trim and V6's cuts are
clip operations (`clip-resize`, `clip-split`, `clip-delete`, `clip-join-next`). Delivered in six sub-steps, each
leaving `npm run check` green; mark a sub-step only when its own verification ran.

- [x] **2a — Schema 4, clip API, clip commands, migration** (2026-09-19; `docs/STATUS.md`). UI still single-clip through `legacySegmentsOf`.
- ~~2b–2f~~ **Superseded (2026-09-19) by schema 5 — a stacked multi-track timeline** (`docs/EDITING.md`
  "Schema 5"; plan: named tracks, clips at absolute positions, gaps, picture-in-picture, sequence-time
  audio, export all the way through). The flat-list sub-steps 2b–2f were specced for schema 4's model and
  are replaced by S1–S8 below. Each landed with `npm run check` green; see `docs/STATUS.md` 2026-09-19.
  - [x] **S1 — Schema 5 + migration 4 → 5** (tracks, absolute clips, `format`, park-never-drop report).
  - [x] **S2 — Pure time model and clip verbs** (`timelineModel.ts`, `clipEdits.ts`, `clipDrag.ts`); the
    stacked-export filtergraph validated against real FFmpeg 9.0.1.
  - [x] **S3 — Timeline decomposition** (`src/timeline/*`, rows from `project.tracks`).
  - [x] **S4 — Clip blocks, trim/split/move/ripple/overwrite, track headers**; video import/drop adds a
    clip; `ReplaceVideoReview` deleted.
  - [x] **S5 — Sequence transport + multi-`<video>` compositing** (unit-tested; the cross-file boundary
    gap is **not yet measured on real media**).
  - [x] **S6 — Manifest v3 + multi-input worker/IPC** (flat and stacked routes; ADR 0005).
  - [x] **S7 — Per-video transcription/alignment/silence/waveforms/thumbnails + video picker.**
  - [x] **S8 — Cleanup and docs** (`sequence.ts`, `sfxClip.ts`, the element-bound clock and cut
    controller, `CutMarkers`, `overlayLanes` removed).

Smoke for the whole ticket (manual, on real media — **not yet run**): two MP4s of different aspect/fps; confirm
the second adds a clip; transcribe each and confirm transcribing B never offers to replace A's captions;
reorder, split, trim, ripple-delete and undo across both (undo restores captions exactly); a music bed on A1
spanning both videos survives deleting the first; B on V2 as picture-in-picture over A, then V2 hidden and A1
muted; play across every boundary and a gap, recording the measured boundary gap in `docs/STATUS.md`; export
and confirm duration equals the sequence within one frame, each caption on its own clip, the PiP where the
preview showed it and SFX onsets within 1 ms; open a schema-3 and a schema-4 `.cstudio` and confirm the
migration notice, suspended autosave and identical argv. Mark V7 complete only once that smoke passes.

## D1 — Complete dependency and license inventory

**Dependencies:** T3, R1, X2  
**Suggested model:** GPT-6 Astra, high. License and redistribution claims require careful current research.

```text
Work only on ticket D1 from tickets.md: complete the release dependency and license inventory.

Read AGENTS.md and all project docs. Using primary sources, audit the exact pinned Electron/runtime packages, FFmpeg binary and build flags, whisper.cpp, model weights, fonts, installer tooling and any bundled codecs/assets. Record version, source, license, copyright/notice requirement, redistribution terms, source-offer obligations where applicable and unresolved risks. Generate third-party notices where required. Identify incompatible or unclear dependencies and replace them only after documenting the decision.

Do not select the project's own open-source license unless the user has provided that choice. Run applicable license tooling, verify the lockfile and update docs/DEPENDENCIES.md and docs/STATUS.md. Mark D1 complete only when every distributed component is accounted for.
```

## D2 — macOS and Windows packaging

**Dependencies:** X3, D1  
**Suggested model:** GPT-5.6 Sol, xhigh. Packaging spans build tooling and platform-specific behavior.

```text
Work only on ticket D2 from tickets.md: package Caption Studio for macOS Apple Silicon and Windows x64.

Read AGENTS.md and all project docs. Select and pin maintained installer tooling after verifying licensing. Produce reproducible development packages for macOS arm64 and Windows x64 with required worker binaries, notices and runtime assets. Keep model downloads explicit rather than bundling weights. Add build-time checks for missing binaries/assets and ensure caches, recordings, credentials and sample media are excluded. Treat code signing as a separately configured release concern; do not invent certificates or publish artifacts.

Test the package that can run on the current host and report cross-builds only as builds, not platform validation. Update exact commands, docs/DEPENDENCIES.md and docs/STATUS.md. Mark D2 complete only when both package configurations build successfully.
```

## D3 — Clean-machine release validation

**Dependencies:** D2  
**Suggested model:** GPT-5.6 Sol, high. The work is broad but follows a defined release checklist.

```text
Work only on ticket D3 from tickets.md: clean-machine release validation.

Read AGENTS.md and all project docs. Create and execute a release checklist on the actually available target machines: macOS Apple Silicon and Windows x64. Verify install/uninstall, first launch, offline editing after an explicit model download, video/SRT workflows, project recovery/relinking, Malayalam shaping, transcription CPU fallback and supported acceleration, all presets, MP4/SRT export, cancellation and source preservation. Capture exact OS/hardware/build details and actionable failures. Do not claim validation on a platform that was not run.

Fix release-blocking defects within scope, rerun affected checks, and update docs/STATUS.md and release documentation. Do not publish a repository or release without a separate user request. Mark D3 complete only when both target-machine results are recorded.
```

## MCP2 — Vision loop, media and Claude Desktop

**Dependencies:** MCP1  
**Suggested model:** GPT-5.6 Sol, xhigh. Cross-process (renderer readiness + main capturePage + a new client transport).

```text
Work only on ticket MCP2 from tickets.md: read docs/MCP.md and AGENTS.md first.

Implement `render_frame` (seek, await committed frames + fonts.ready via the existing playback/font readiness hooks, capturePage the preview stage, return PNG as MCP image content) and wire up `prepare-snapshot` in useAgentBridge, which today returns an honest "not available yet". Add `import_media` (absolute path → inspectMedia → asset, optional placement) and `import_image_data` (base64 → userData/agent-imports). Add `place_at_word` (resolve a word's source time to sequence time via timelineModel, place on a free upper track). Add alpha-clip export support (probe reports pix_fmt/alpha, manifest v3 carries hasAlpha, exportArguments emits libvpx-vp9 for those inputs) with an argument-snapshot test and, if the environment allows, a real fixture export. Build the stdio bridge (dist-electron/mcp-stdio.cjs) that proxies tools/list and tools/call to the HTTP endpoint using the saved token, and update the Settings tab to show the Claude Desktop config snippet once it actually works. Update docs/MCP.md's "Not implemented yet" list and docs/STATUS.md with exact verification. Report which platforms were actually tested.
```

## MCP3 — Job tools and recipes

**Dependencies:** MCP2  
**Suggested model:** GPT-5.6 Terra, high.

```text
Work only on ticket MCP3 from tickets.md: read docs/MCP.md and AGENTS.md first.

Add MCP tools for transcribe, detect_silence, export_video, export_srt, get_job, cancel_job and save_project, reusing the existing job scheduler/services rather than duplicating them — every heavy job still arbitrates through the one scheduler. transcribe must take an explicit keep/replace choice up front, matching the UI's gate; export_video must refuse an output path inside any source media directory; save_project must only ever write to the project's current path. Add the repo-shipped Claude Code skills (.claude/skills/caption-studio-broll, caption-studio-filler) documented in docs/MCP.md's "Planned" section. Update docs/MCP.md and docs/STATUS.md.
```

## Ticket completion rule

At the end of every ticket, the implementing task should:

1. Run the checks appropriate to the change, including `npm run check` unless a documented environment blocker prevents it.
2. Test real behavior rather than presenting mock controls as complete.
3. Update `docs/STATUS.md` with changes, verification, limitations and the best next task.
4. Change that ticket's checkbox to `[x]` only after its acceptance behavior passes.
5. Report which platforms were actually tested.
6. Leave unrelated tickets and user changes untouched.
