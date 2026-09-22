# Product requirements

## Goal
Minimize the correction time between an edited creator video and polished, accurately timed animated subtitles. Primary content is Malayalam speech mixed with English technical terms, often vertical 9:16. Support landscape media too. Personal use first, open-source distribution later.

## Workspace
Far left: a CapCut-style icon rail (Media, Captions, Overlays, Transitions, plus a Settings button) that switches the panel beside it.
- **Media** is the asset bin: the open source video, imported images and audio, each with a thumbnail/duration, an "Add at playhead" action, Remove (blocked while in use) and Relink (when offline or mismatched). Files are imported via a button or dragged in from Finder/Explorer; bin items are dragged onto the timeline or stage to place them.
- **Captions** is the searchable editable transcript with cue timestamps (unchanged from before the rail existed); its empty state offers Transcribe/Import SRT.
- **Overlays** is a drag-friendly grid of the same image assets, for quick overlay placement.
- **Transitions** is the caption motion/template picker.
- **Settings** opens the existing dialog (speech models, Gemini key, shortcuts); it is a button, not a panel tab.
Centre: video preview, playback, selectable caption position and safe-area guides.
Right: fonts, colors, outline, shadow, background padding, emphasis and animation for the selected caption.
Bottom: thumbnails, waveform, caption blocks, playhead, zoom and expandable word timing.
Transcript, preview, bin and timeline must reflect a single project state.

## Editing
Click a cue to select and seek. Double-click text to edit. Drag cue or edges to adjust timing. Split at playhead, merge adjacent cues, add/delete cues, edit word boundaries, undo/redo. Validate positive duration, media bounds and word containment. Warn on overlaps without silently deleting or retiming imported material. Preserve original imported content for recovery; report malformed cues with actionable errors.
When text changes, keep unchanged token IDs/timings where safe and mark affected timing as needing review. Multiword edits can invalidate alignment. Optional realignment is scoped to the affected cue and requires supported language/model behavior.

## Transcription
Extract audio with source-time mapping. Let user choose language and local model. Show download size and disk location, model removal, device, progress/cancellation and actionable errors. Support CPU fallback. Store engine/model metadata. Distinguish recognition, word alignment and readable phrase grouping. Maintain original time offsets through silence detection/chunking so long pauses do not drift. Never fill silence with invented transcript.
Benchmark Malayalam/English clips before choosing model defaults. Optional Gemini-powered translation into a chosen target language is supported for either engine (see below); Manglish transliteration is deferred.

## SRT
Import video plus SRT as an independent workflow. Cue-level animation works immediately. Word animation requires model-derived/manual timing or explicitly labeled estimates. Optional audio alignment must not rewrite imported text. Export SRT contains plain captions/timestamps; visual styles and animations live in project files and rendered video.

## Styles
Five first-release presets: static clean, active-word highlight, word pop, phrase fade, progressive word reveal. Separate appearance from motion. Custom fonts, two-color styles, per-word emphasis, max lines and saved presets. Use proper Malayalam shaping, Unicode segmentation, explicit font fallbacks and consistent layout across preview/export. Do not ship third-party fonts without redistribution rights.

## Persistence/export
Versioned JSON project, saved as a `.cstudio` file (legacy `.json` saves remain openable), stores media references, subtitles, timings/provenance, style overrides and presets. Atomic autosave, recovery, undo/redo, reopen and missing-media relinking. MP4 with captions, separate SRT and editable project. Export progress, cancellation, temporary-output cleanup and source preservation. Validate dimensions, aspect ratio, rotation, frame rate and audio sync. Start with a tested MP4 codec profile; handle unsupported codecs with clear diagnostics or a local proxy conversion.

## Single-source edits (post first release)
On the one source video only: time-ranged image overlays (logos, stickers), static blur rectangles, inserted sound effects with gain, trim in/out and cuts (remove ranges). Captions, overlays and effects keep source-media timestamps; cuts are a kept-range list so undoing a cut restores every caption exactly. The timeline ruler, transport clock and exported SRT show sequence time after cuts. Preview and export share the same composition-space layer model; blur is the one effect whose preview is a CSS approximation of the FFmpeg export with a documented tolerance. See [EDITING.md](EDITING.md).

## Optional cloud alignment
The editor remains local-first and fully usable offline. A user may explicitly add their own Gemini API key and click **Align audio** to improve imported-SRT word timing, or choose the Gemini engine in **Transcribe**, which uploads only detected speech sections (never silence) and is disclosed as a cloud upload before it starts. This uploads only padded audio ranges covered by non-empty cues, never rewrites imported text, and keeps exact unmatched words as review-required local estimates. No account, cloud provider or subscription is required for the core workflow.

## Optional translation
With the same Gemini API key, a **"Translate to"** choice in **Transcribe** (either engine) sends only the recognized caption text — never audio — to Gemini and creates captions in the chosen language instead of the spoken one. The original spoken-language recognition is always retained in the project. Translated captions get estimated word timing and are marked Needs review, since a translated word cannot correspond to the original audio's word position. Default is off (no target chosen), unchanged behavior.

## Optional local agent control ([MCP.md](MCP.md))
A user may explicitly enable a loopback-only MCP server so a local Claude client (Claude Code today) can inspect and edit the open project — captions, style, tracks/clips, blur, markers — through the same undoable command path the UI itself uses, with the change visible in the app as it happens and reversible with the normal Undo. Off by default; nothing leaves the computer; no account, cloud provider or subscription is involved. Core editing, transcription and export remain fully usable without it.

## Timeline editing (post first release)
A stacked multi-track timeline (schema 5, [EDITING.md](EDITING.md)): several videos in one project, named video and audio tracks, clips at any position with gaps, trim/split/move/ripple, picture-in-picture, images over the video, music and sound effects in sequence time, per-video transcription, and export of the whole timeline.

## Deferred
Transitions and crossfades, speed/retime, keyframed or tracked effects, nested sequences, audio ducking, additional cloud providers, accounts, collaboration, diarization, AI emojis/keywords, Manglish transliteration, marketplace and batch export.
