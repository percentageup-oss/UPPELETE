# Caption languages: session briefs

Each brief is one **fresh session**'s work. Open a new session and say:

> Implement docs/plans/caption-languages/0N-<name>.md

The session reads that brief and only the files it lists, implements it, runs the typecheck, appends a
short entry to `docs/STATUS.md`, commits, and stops. Briefs never rely on earlier conversation. Anything a
later brief needs from an earlier one is recorded in `docs/STATUS.md` or in the code.

## Goal
Today "Transcribe and translate" builds captions from the translated text only
(`src/core/transcriptionApply.ts:58-60`). The original-language text survives only as evidence in
`run.recognition`, and nothing reads it back. Two problems follow: a user cannot switch back to the spoken
language, and a second language means transcribing the audio again (the dialog takes one `translateTo`,
`src/core/transcriptionIpc.ts:19`).

After these briefs:
- The project keeps the original captions **and** each translation as separate language layers.
- The Captions tab has one tab per language. Each translation tab has a **"Show on video"** checkbox.
- A checked translation **replaces** the original on video (preview, video export and SRT). Only one
  translation is shown at a time. Unticking every translation shows the original.
- Extra languages never cost another audio transcription: several targets can be picked in one run
  (brief 04), and existing captions can be translated later with text only (brief 03).

## Order

| # | Brief | Depends on | Size |
|---|-------|-----------|------|
| 01 | [Schema 24, language layers, display filter](01-model-and-display-filter.md) | none | M |
| 02 | [Captions panel language tabs + "Show on video"](02-captions-panel-tabs.md) | 01 | M |
| 03 | [Translate existing captions (text only)](03-translate-existing-captions.md) | 01, 02 | M |
| 04 | [Multi-language in the Transcribe dialog](04-multi-language-transcribe.md) | 01 (03 for the retry hint) | S-M |
| 05 | [Hinglish and Manglish targets](05-hinglish-manglish.md) | 01, 04 (02 for tab labels) | S |

Run them in numeric order. 03 and 04 are independent of each other once 01 and 02 have landed, but 04's
notice text points at 03's "+ Translate..." button.

## Testing override
The user asked (2026-09-25) that session briefs **not** write or run tests, export parity stages, smoke
runs or benchmarks. This **overrides the AGENTS.md testing rule for this plan**. The only check is
`npx tsc --noEmit -p .`. Do not delete existing tests; fix one minimally only when a typecheck breaks.
STATUS entries say "not tested, typecheck only".

One higher-risk item, for the user to opt back in if wanted: brief 01 includes a **schema migration**
(23 to 24). A migration round-trip test would be worth it there.

## Shared findings (verified against the code)
- Cue schema: `cueSchema`, `src/core/model.ts:47-102`. There is **no language or translation field on a
  cue** today. `transcriptionRunId` (`:64`) is the only link to a run.
- Translation provenance lives only on the run: `translationProvenanceSchema` (`model.ts:108-115`), hung
  off `transcriptionRuns[].translation` (`:140`, `:170`).
- Current schema version is **23** (`projectSchema`, `model.ts:992-1005`). Each migration is a file
  `src/core/migrateVN.ts` (N to N+1); the latest is `migrateV22.ts` (22 to 23), wired at `model.ts:~1179`,
  load entry `loadProject` at `:~1187`. Newer schemas spread the previous shape and re-validate against
  the old schema in a `superRefine`.
- `captionTrackSchema` (`src/core/edit.ts:119-128`) has no `hidden`/`language`. We do **not** use caption
  tracks for languages; language layers are a cue-level tag (see brief 01).
- **The one active-cue rule** is `activeCueAt` (`src/core/timelineModel.ts:203`), shared by preview
  (`src/App.tsx:442`, `CaptionStage` `:2627`), export (`src/export/plan.ts:332`, `src/core/layerPlan.ts:117`)
  and the layer stack (`src/core/layerStack.ts:75`). It finds the first time-matching cue and ignores
  everything else, so the fix is to hand it an already-filtered cue list, never to change it.
- Export manifest cue filters: `src/export/plan.ts:627`, `:722`. SRT export: `App.tsx:~1500`, `:~1594-1601`.
- Recognition to cues: `recognitionToCaptions` and `translatedRecognitionToCaptions`
  (`src/core/recognition.ts:7`, `:33`). Translated cues are `needsReview: true` with **estimated** words.
- Apply: `applyTranscription` / `transcriptToCues` (`src/core/transcriptionApply.ts:58-88`); UI entry
  `applyTranscript` (`App.tsx:765-785`), one undo step via `setHistory(commitHistory(...))`.
- Translation service: `electron/geminiTranslation.ts` (`translateTranscript` `:91`, batches of 60),
  `electron/transcriptionService.ts` (`translate()` `:210`, called at `:178` and `:266`),
  `electron/transcriptionIpc.ts:35-77`.
- Undo is snapshot-based (`src/core/history.ts`). `commit(update)` is `App.tsx:~480`; `runCommand`
  `:~691-726`; `runCommands` `:~737` batches into one undo step. Caption commands: `src/core/captionCommands.ts`
  (`applyCaptionCommand` `:187`); command zod schemas: `src/core/editCommandSchema.ts`.
- UI pieces to reuse: tab pattern in `src/GlobalCaptionEditor.tsx:73-75` (`role="tab"`, `.global-edit-tabs`,
  `styles.css:~900`); checkbox label `.global-edit-check` (`styles.css:~904`); `Toggle`/`Segmented` in
  `src/style/controls.tsx`. Language list: `src/core/translationLanguages.ts` (`TRANSLATION_TARGETS`,
  `translationTargetLabel`).

Line numbers drift: other sessions edit this repo. Search by symbol name if a line is off.

## Project rules that matter (from AGENTS.md)
- Core workflow is local. Translation is the only cloud step and sends **caption text only, never audio**.
- Preserve Malayalam shaping and mixed Malayalam/English text. Never split by UTF-16 code units; use
  grapheme-aware helpers (`src/core/captionText.ts`).
- Estimated word timing must never masquerade as aligned timing. Translated cues stay `needsReview: true`.
- User corrections are authoritative: never silently overwrite them.
- Preview and export share caption layout and time-driven animation logic.
- Renderer has no Node integration. Use the narrow validated preload/IPC bridge (zod). Keys are read in the
  main process only, never sent to the renderer.
- Source-media microseconds are canonical time.
- Keep macOS and Windows paths portable.
- Update `docs/STATUS.md` after each slice: changes, verification, limitations, next task.
- Never commit media, models, caches, exports or credentials.

## Out of scope (all briefs)
- Bilingual/stacked display (original and translation on screen together).
- Automatic re-translation when the original text is edited.
- A "Remove language" action (possible follow-up).
- One multi-language request per batch. Considered and rejected: it saves only the repeated input tokens and
  makes failures and retries all-or-nothing. Translate one language per request.
- Prompt caching.
- SRT import stays original-language only.
