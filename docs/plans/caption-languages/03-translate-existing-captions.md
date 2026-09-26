# 03: Translate existing captions (text only)

Read `README.md` in this folder first for the shared findings, project rules and the testing override
(typecheck only; no tests). Briefs 01 and 02 must have landed: check `docs/STATUS.md`, and that
`src/core/captionLanguages.ts`, the tab strip in `CaptionsPanel.tsx` and `translationRuns` exist.

## Goal
Let the user add translation languages to a project **without re-transcribing**: a "+ Translate..." control in the
Captions tab sends the caption **text** (never audio) to Gemini and adds one language tab per target. This is the
main API-cost saving: a translation costs a small text call, not another pass over the audio.

## Read only these files
- `electron/geminiTranslation.ts` (`geminiTranslator` ~40, `translateTranscript` ~91, script check ~117)
- `electron/transcriptionIpc.ts` (the pattern for loading the key in main, progress events, cancel)
- `electron/jobs.ts` and `src/core/jobs.ts` (`getJobScheduler`, `JobSnapshot`, `jobFailure`)
- `electron/preload.ts`, `src/env.d.ts` (~41-44, where `startTranscription` is exposed), `electron/main.ts`
  (where IPC registrars are called)
- `src/core/transcriptionIpc.ts` (zod request schemas, for style), `src/core/transcription.ts`
  (`languageCodeSchema`), `src/core/translationLanguages.ts`, `src/core/scriptCheck.ts`
- `src/core/captionLanguages.ts` (brief 01), `src/CaptionsPanel.tsx`, `src/TranscriptionPanel.tsx`
  (for the key-configured check and the privacy line wording), `src/core/wordTiming.ts`
  (`estimateWordTimings`), `src/core/transcriptionApply.ts` (`isUntouchedModelCue`)
- `src/App.tsx` only around `applyTranscript` (~765-785) and how `providerKeys` / `geminiKey` reach the panel

## Steps

### 1. Reuse the translator (main process)
In `electron/geminiTranslation.ts` extract the batching loop and the script check from `translateTranscript`
into `translateLines(translator, texts, target, sourceLanguage, signal, onProgress)` returning
`{ texts, usage }`. `translateTranscript` then calls it, so its behaviour and existing callers are unchanged.
Keep batches of 60 and the `UNEXPECTED_SCRIPT` check.

### 2. New IPC: `electron/captionTranslationIpc.ts`
Channels `captions:translate`, `captions:translate:cancel`, and progress events `captions:translate:progress`.
- Request schema (zod, in a new `src/core/captionTranslationIpc.ts`):
  `{ requestId: uuid, sourceLanguage: string | null, targets: LanguageCode[] (1..5, unique), lines: string[]
  (1..5000, each non-empty and length-capped) }`.
- The Gemini key is loaded in main only (`providerSecretStore().load('gemini')`, as in
  `electron/transcriptionIpc.ts:45-61`). Never accept a key from the renderer. Missing key returns a clear failed
  outcome: "Add a Gemini API key in Settings before translating captions."
- Run on the job scheduler for progress and cancel. Targets run **sequentially**, one `translateLines` call
  chain per target, each in its own try/catch.
- Outcome: `{ state: 'succeeded', results: Array<{ target, ok: true, texts: string[], model: string,
  inputTokens?: number, outputTokens?: number } | { target, ok: false, error: { code, message, retryable } }> }`,
  or `{ state: 'failed', error }` / `{ state: 'cancelled' }`. **A failed language never discards the ones that
  worked.**
- Cancel on renderer destruction like the transcription IPC does.
- Register it in `electron/main.ts`; expose `translateCaptions`, `cancelCaptionTranslation` and
  `onCaptionTranslationProgress` in `electron/preload.ts`; type them in `src/env.d.ts`.

### 3. Pure cue builder (renderer, in `src/core/captionLanguages.ts`)
`translatedCaptionsFromCues(originals, texts, target, newId)`: one new cue per original cue with the same
`startUs`/`endUs`/`mediaAssetId`/`captionTrackId`, `textSource: 'model'`, `timingSource: 'model'`,
`needsReview: true`, `translationLanguage: target`, `transcriptionRunId` copied from the original when present,
and **estimated** words via `estimateWordTimings` (never inherited from the source words; see
`recognition.ts:44-53`). Reject a texts/originals length mismatch.

**Source is the current original-language cues of the picked video, not raw `run.recognition`**: user
corrections are authoritative, so edited text is what gets translated.

### 4. Panel UI in `CaptionsPanel`
A "+ Translate..." button at the end of the tab strip (and on the Original tab when there are no translations
yet, where the strip is otherwise hidden).
- Opens a popover with language checkboxes from `TRANSLATION_TARGETS`, leaving out the source language and
  languages that already exist unless the user re-picks one (re-picking means "redo"), at most 5 at once, a
  progress bar (percent of batches, from the progress events) and a Cancel button.
- Disabled with a visible reason when no Gemini key is configured.
- Privacy line, matching `TranscriptionPanel.tsx:224`: "Sends only the caption text (never audio) to Gemini.
  Translated captions get estimated word timing and are marked Needs review."

### 5. Applying results (one undo step)
Build cues for every successful language and commit **all** of them in one `commit()`:
- If a language already has cues for this video, confirm first. Then replace only untouched model cues
  (`isUntouchedModelCue`, `transcriptionApply.ts:28`) and keep cues the user edited (same rule as
  `keep-authored`). Say in the confirmation how many edited cues will be kept.
- Append a `translationRuns` entry per language (source language, target, model, segment count, tokens).
- Leave `shownTranslation` alone: adding a language does not change what is on the video. Switch the active tab
  to the first added language so the user sees the result.
- Show a notice listing added languages and any that failed with their message, so a failed language can simply
  be retried.

## Out of scope
Multi-language transcribe (04), re-translating automatically when the original is edited, removing a language,
bilingual display, any change to the audio transcription path, sending audio anywhere.

## Checks
- `npx tsc --noEmit -p .` passes. No tests (README override); fix an existing test minimally only if the
  typecheck breaks. `electron/geminiTranslation.test.ts` covers `translateTranscript`; keep its exports working.
- Confirm by reading that the request schema is `z.strictObject` and that no path reads a key from the renderer.

## Done
- [ ] `translateLines` extracted; `translateTranscript` unchanged in behaviour.
- [ ] `captions:translate` IPC with zod schema, main-only key, sequential per-language results, cancel, progress.
- [ ] preload + `env.d.ts` typed; registered in main.
- [ ] `translatedCaptionsFromCues` (estimated words, needs review, source = current original cues).
- [ ] "+ Translate..." popover with progress and cancel; disabled without a key.
- [ ] One undo step; `translationRuns` appended; failed languages reported.
- [ ] `npx tsc --noEmit -p .` clean.
- [ ] `docs/STATUS.md` entry: changes, "not tested, typecheck only", limitations, next task (brief 04). Commit.
