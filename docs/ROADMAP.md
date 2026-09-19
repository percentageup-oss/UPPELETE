# Roadmap and acceptance gates

## 1. Editor foundation
- Scaffold secure Electron/React/TypeScript app and reproducible development commands.
- Video playback; real SRT import; synchronized cue list/timeline/overlay.
- Text/timestamp edits, seek, split/merge/add/delete, drag boundaries, zoom, undo/redo.
- Waveform and thumbnails through media worker.
- Versioned save/reopen, autosave recovery, relink media, SRT export.
Gate: edit a real SRT against a video, undo/redo, reopen without data loss, export correct UTF-8 SRT. Check mixed script, BOM/CRLF, multiline cues, invalid times and overlaps.

## 2. Local subtitle generation (required for first usable release)
- Model manager and one real local backend; language selection and CPU/device reporting.
- Extract video audio, recognize, retain source offsets, group into readable captions.
- Editable model word timings, manual timing, provenance/review state.
- Progress/cancellation/errors; preserve human edits; optional scoped alignment only if supported.
Gate: video to editable timed subtitles offline after model download. Evaluate normal speech, fast mixed-language speech and long pauses using user-provided clips; never infer transcript from prior scripts. Track correction time, sampled boundary error, processing time and memory. Define numeric thresholds from measured baseline instead of inventing them.

## 3. Visual styles
- Five presets, font selection, emphasis, position and saved presets.
- Shared deterministic time-based renderer and font readiness.
Gate: Malayalam ligatures/vowel marks, wrapping and word emphasis remain stable at different preview scales and across target machines.

## 4. Export
- Frame rendering plus encoding, dimensions/frame rate, audio mux, progress/cancellation.
Gate: preview/export snapshots agree at fixed timestamps; rendered audio and captions stay synced, including long pauses and source rotation/VFR handling. Source files remain untouched.
Milestones 1-4 constitute the first usable release. No milestone is complete merely because a mock UI exists.

## 4b. Single-source video edits (after the first usable release)
- Schema 3: assets, overlays, blur regions, audio clips and a kept-range edit list; sequence↔source mapping; generic timeline tracks and item commands ([EDITING.md](EDITING.md)).
- Image overlays rendered in the shared caption layer; sound effects mixed in export and scheduled in preview; blur regions with a measured preview/export tolerance; trim in/out; cuts.
Gate: an exported MP4 reflects overlays, blur, sound effects and cuts placed in the editor; preview and export agree within the documented tolerances; undoing a cut restores captions exactly; SRT export of a cut project is in sequence time; source media and assets remain untouched. Measured on the actual target machines.

## 5. Distribution
- Validate macOS Apple Silicon and Windows x64 clean installation.
- Dependencies/models/fonts license inventory, selected source license, contributor docs and public-release checklist.
- No repository publication until requested.
