# 04: Multi-language in the Transcribe dialog

Read `README.md` in this folder first for the shared findings, project rules and the testing override
(typecheck only; no tests). Brief 01 must have landed (`applyTranscription` takes `translations[]`, schema 24,
`translationRuns`). Brief 02 should have landed so the extra languages appear as tabs. Brief 03 is only needed for
the "retry a failed language" hint in the notice.

## Goal
The Transcribe dialog can pick **several** "Translate to" languages in one run. The audio is transcribed once;
each extra language costs one small text call. A language that fails to translate no longer fails the whole job:
the transcript (the expensive part) is kept and the failure is reported.

## Read only these files
- `src/core/transcriptionIpc.ts` (request schemas ~17-40, `TranscriptionOutcome` ~57-60)
- `electron/transcriptionIpc.ts` (key checks ~57-61, `getService().start` ~62-64, outcome ~70-72, smoke ~92)
- `electron/transcriptionService.ts` (request types ~40-64, `TranscriptionJobValue` ~72, `run` ~142-207,
  `translate()` ~210, `translationProvenance` ~216, `runCloud` ~235-292)
- `src/TranscriptionPanel.tsx` (`Delivered` ~14, state ~116, localStorage ~61-62/126, `start()` ~185-200, the two
  selects ~245-249 and ~263-267, button ~283, hint ~293, privacy line ~224)
- `src/core/transcription.ts` (`TranslatedTranscript` schema ~158-170, `validateTranslationOutput` ~209),
  `src/core/translationLanguages.ts`
- `src/App.tsx` only around `applyTranscript` (~765-785)
- Existing tests that construct these requests (`electron/transcriptionService.test.ts`,
  `src/core/transcriptionIpc.test.ts`, `src/TranscriptionPanel.test.tsx`): only to fix them minimally if the
  typecheck breaks

## Steps

### 1. Request shape: `translateTo` becomes an array
`translateTo: LanguageCode[]` (0..5, unique), replacing `LanguageCode | null`. The empty array means "no
translation". Change:
- the zod schemas in `src/core/transcriptionIpc.ts` (`translateToSchema` ~19 and its uses ~29, ~39);
- the request types in `electron/transcriptionService.ts` (~46, ~59);
- the key checks: `electron/transcriptionIpc.ts:~57` (`translateTo.length > 0`) and
  `transcriptionService.ts:~238`;
- the smoke caller (`electron/transcriptionIpc.ts:~92`, pass `[]`).

### 2. Service: one transcription, N translations
In `run()` (~178) and `runCloud()` (~266), replace the single `translate()` call with a loop over `translateTo`:
- Translate **sequentially**, each target in its own try/catch, reusing `translate()`.
- A failed translation records `{ target, message, code }` in a `translationFailures` list and continues. A
  cancellation still aborts the job (`ctx.signal`).
- `TranscriptionJobValue` becomes `{ transcript, run, translations: TranslatedTranscript[],
  translationFailures: { target: LanguageCode; message: string }[] }`. Add the translation token usage to the
  returned translation entries (optional `usage` beside each `TranslatedTranscript`, or a parallel array) so the
  renderer can write `translationRuns`.
- Stop writing `run.translation` (the legacy field stays readable in the schema). Remove `translationProvenance`
  if nothing else uses it.
- Progress: keep the `translating` phase, but say which language is running so the dialog can name it.

### 3. Outcome and IPC
Update `TranscriptionOutcome`'s succeeded branch to
`{ state: 'succeeded'; transcript; run; translations: TranslatedTranscript[]; translationFailures: [...] }` and
`electron/transcriptionIpc.ts:~71` to forward it. Keep `z.strictObject` request schemas.

### 4. Dialog (`src/TranscriptionPanel.tsx`)
- Both "Translate to" selects (~245-249 cloud, ~263-267 whisper) become one shared checkbox list of
  `TRANSLATION_TARGETS`, at most 5, with "None" implied by an empty selection. Disable the boxes once 5 are
  ticked. Show a line stating the cost model: "Audio is transcribed once. Each extra language is a small text
  call."
- localStorage key (~61-62): store a JSON array. Read an old single-string value as a one-item array, and an
  absent or malformed value as `[]`. Wrap reads and writes in try/catch as the surrounding code does.
- Gemini key check (~185, ~207): needed when the array is non-empty.
- Button text (~283): "Transcribe and translate" when the array is non-empty. Progress hint (~293): name the
  language currently being translated.
- `Delivered` (~14) carries `translations` and `translationFailures`.

### 5. Apply (`App.tsx` `applyTranscript`, ~765-785)
Pass `translations` straight to `applyTranscription` (brief 01 already takes an array). It already appends
`translationRuns` and sets `shownTranslation` to the first target. Update the notice text: list the languages
added, list any that failed with their message, and say the original captions were kept. When brief 03 exists,
add: "Use + Translate... in the Captions tab to retry a failed language without transcribing again."

## Out of scope
Batching several languages into one Gemini request (rejected in README), prompt caching, removing a language,
re-translating on edit, any change to how audio is transcribed or extracted.

## Checks
- `npx tsc --noEmit -p .` passes. No tests (README override). Existing tests that build `translateTo: null` or a
  single `translation` will break the typecheck: fix them **minimally** (`null` to `[]`, `'en'` to `['en']`,
  `translation` to `translations: [...]`); do not delete or rewrite them.
- Note: `electron/transcriptionService.ts` and `App.tsx` may have uncommitted work from other sessions.
  Re-read before editing and do not revert unrelated changes.

## Done
- [ ] `translateTo` is `LanguageCode[]` end to end (renderer schema, IPC, service, smoke).
- [ ] Service translates each target sequentially; a failed language is reported, not fatal; one audio pass.
- [ ] `TranscriptionOutcome`/`TranscriptionJobValue` carry `translations` and `translationFailures`.
- [ ] Dialog: checkbox list (max 5), array in localStorage (old value migrated), cost line, per-language progress.
- [ ] `applyTranscript` passes the array; notice lists added and failed languages.
- [ ] `npx tsc --noEmit -p .` clean.
- [ ] `docs/STATUS.md` entry: changes, "not tested, typecheck only", limitations, next task. Commit.
