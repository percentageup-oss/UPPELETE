# 01: Schema 24, language layers, display filter

Read `README.md` in this folder first for the shared findings, project rules and the testing override
(typecheck only; no tests).

## Goal
Give every cue an optional language tag, give the project a "which translation is shown" setting, and make
**every place that decides what is on screen** use one filter. After this brief, preview, video export and SRT
show the chosen language, and old translated projects still render exactly as before.

No new UI is added here except what is needed to keep the app working (one translation still comes from the
existing Transcribe dialog).

## Read only these files
- `src/core/model.ts` (cue schema ~47-102, run schemas ~104-171, `projectSchema` ~992, migration wiring ~1179,
  `loadProject` ~1187, `createProject` ~1291)
- `src/core/migrateV22.ts` (template for the new migration)
- `src/core/transcriptionApply.ts`, `src/core/recognition.ts`
- `src/core/captionCommands.ts` (`validateCaptions` ~118, `merge-next` ~403, `add` ~279)
- `src/core/editCommandSchema.ts`, `src/core/itemCommands.ts` (how commands are routed)
- `src/core/layerStack.ts` (~75), `src/export/plan.ts` (~627, ~722)
- `src/App.tsx` only around: `visibleCues` (~348), `applyTranscript` (~765-785), SRT export (~1494-1503,
  ~1594-1601), `<Timeline cues=` (~2538)
- `src/core/translationLanguages.ts`, `src/core/transcription.ts` (`languageCodeSchema`)

## Steps

### 1. Schema 24
In `src/core/model.ts`:
- Add `translationLanguage: languageCodeSchema.optional()` to `cueSchema`. Absent means an original-language
  cue; present means a translated cue.
- Add to the project (a new schema 24 layered on top of 23, the same way 23 was layered on 22):
  - `shownTranslation: languageCodeSchema.optional()`: absent means the original is shown on video.
  - `translationRuns: z.array(translationRunSchema).max(...).optional()` where a translation run is
    `{ id, createdAt, provider: 'gemini', model, sourceLanguage: string | null, targetLanguage, mediaAssetId?,
    transcriptionRunId?, segmentCount, inputTokens?, outputTokens? }`. Use the same `count` helper and length
    caps as the existing run schemas. This one list will record translations made during transcription (brief
    04) and later from existing captions (brief 03).
- Keep the legacy `transcriptionRuns[].translation` field (`:140`, `:170`) **readable**. Stop writing it from
  this brief on (new runs use `translationRuns`), but do not remove it from the schema.
- The schema-24 `superRefine` must strip the new fields (`translationLanguage` from cues, `shownTranslation`,
  `translationRuns`) and validate the rest against `projectSchemaV23`. Copy the pattern at `model.ts:996-1004`.
  `cueSchema` is shared by older schemas, so check that older-schema validation ignores or strips the field the
  way the existing pattern does; if `cueSchema` being strict causes a V23 failure, strip it from the cues in the
  refine.
- Export a `CaptionProjectV23` type next to the other `CaptionProjectVNN` types (~1010).
- Bump `createProject` and the literal schema version to 24.

### 2. Migration `src/core/migrateV23.ts` (new)
Model it on `migrateV22.ts`. 23 to 24:
- For every cue with a `transcriptionRunId` whose run has `translation`, set
  `translationLanguage = run.translation.targetLanguage`.
- If any cue was tagged, set `shownTranslation` to that language (a project has at most one translated
  language today, so use the first tagged cue's), so old projects render exactly as before.
- Move nothing else. Bump `schemaVersion` to 24.
- Wire it into the load path next to `migrateV22` (~1179) and the version checks (~1238+).

### 3. Pure helpers `src/core/captionLanguages.ts` (new, no React, no Electron)
- `displayedCues(cues, shownTranslation)`: if `shownTranslation` is set and at least one cue has that
  `translationLanguage`, return those cues; otherwise return cues with no `translationLanguage`.
  (If a language was set but its cues are all gone, fall back to the original rather than showing nothing.)
- `cuesForLanguage(cues, language: LanguageCode | null)`: `null` means the original layer.
- `projectLanguages(project)`: `{ originalLanguage: string | null, translations: LanguageCode[] }`. Translations
  are the distinct `translationLanguage` values in first-seen order. The original language comes from the latest
  transcription run's `language` (fall back to `null`, which the UI labels "Original").

### 4. Use `displayedCues` everywhere something is shown
Do not touch `activeCueAt`. Hand it filtered cues instead:
- Preview: `visibleCues` (`App.tsx:~348`). Keep the drag-preview swap.
- Export manifests: `src/export/plan.ts:~627` and `:~722` filter by asset; also apply `displayedCues`. Pass the
  project's `shownTranslation` through the same way the other manifest inputs come from `project`.
- Layer stack: `src/core/layerStack.ts:~75-76`.
- Timeline: the `cues=` prop at `App.tsx:~2538` shows the on-screen language.
- SRT export: `App.tsx:~1500` and `~1594-1601` export the displayed language.
Search for other `project.cues` readers that decide on-screen content (`grep -n "project.cues"` and
`"\.cues\b"` in `src/`) and decide each: on-screen consumers use the filter; editing/counting consumers do not.

### 5. Validation and editing
- `validateCaptions` (`captionCommands.ts:127-128`) groups cues by video only. Group by video **plus**
  `translationLanguage` so an original and its translation do not raise overlap warnings.
- `merge-next` (~403) must only merge with the next cue **of the same language**.
- Split and duplicate spread `...cue`, so they keep the language. Confirm this and leave as is.
- `add` (~279) takes a full cue; callers set `translationLanguage`. Nothing to change in the command.

### 6. Applying a transcription (`transcriptionApply.ts`)
- Change the signature to take `translations: TranslatedTranscript[]` (0..n) instead of one nullable
  translation, and update `applyTranscription`'s parameter list and its callers.
- `transcriptToCues` builds the original cues (`recognitionToCaptions`) **plus** one set per translation
  (`translatedRecognitionToCaptions`), each tagged with `translationLanguage: translation.targetLanguage` and
  grouped separately (`groupCaption`).
- The replace/keep choice covers every language layer of that video in the transcribed range: retranscribing
  makes old translations stale. `kept` and the overlap check (`:75`, `:82`) must compare cues of the **same
  language** only, so a new translation is not dropped because the original overlaps it.
- Append a `translationRuns` entry per translation and set `shownTranslation` to the first translation's target.
  That keeps today's default of showing the translation after "Transcribe and translate".
- In this brief the IPC still returns one translation. In `applyTranscript` (`App.tsx:~765-785`) wrap it as
  `translation ? [translation] : []`. Keep the notice text at `:~776`, but say the original is kept too.

### 7. New command `set-shown-translation`
In `captionCommands.ts` and `src/core/editCommandSchema.ts`: `{ type: 'set-shown-translation', language:
LanguageCode | null }`. It sets or clears `project.shownTranslation`. Validate that a non-null language has at
least one cue. It goes through the normal command path so it is undoable and visible to the MCP agent protocol.

### 8. Docs
Add a short "Schema 24" section to `docs/EDITING.md` if that file documents earlier schemas the way the
`docs/` references in `edit.ts` suggest; otherwise skip.

## Out of scope
The Captions tab UI (brief 02), translating existing captions (03), multi-language transcribe (04),
removing a language layer, bilingual display.

## Checks
- `npx tsc --noEmit -p .` passes. Do not write or run tests (README override). If an existing test breaks the
  typecheck, fix it minimally; do not delete tests.
- Quick self-check by reading: an old project with translated cues loads, the migration tags them, and
  `displayedCues` returns them.

## Done
- [ ] Schema 24 with `translationLanguage`, `shownTranslation`, `translationRuns`; migration 23 to 24 wired.
- [ ] `src/core/captionLanguages.ts` with `displayedCues`, `cuesForLanguage`, `projectLanguages`.
- [ ] Preview, export manifests, layer stack, timeline and SRT all use `displayedCues`.
- [ ] `validateCaptions` groups by language; `merge-next` same-language only.
- [ ] `applyTranscription` builds original + translated layers and sets `shownTranslation`.
- [ ] `set-shown-translation` command and its zod schema.
- [ ] `npx tsc --noEmit -p .` clean.
- [ ] `docs/STATUS.md` entry: changes, "not tested, typecheck only", limitations (migration untested), next
      task (brief 02). Commit.
