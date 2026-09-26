# 05: Hinglish and Manglish targets

Read `README.md` in this folder first for the shared findings, project rules and the testing override
(typecheck only; no tests). Brief 01 must have landed (`translationLanguage` on cues, `translationRuns`,
`shownTranslation`). Brief 04 should have landed (checkbox list of targets in the Transcribe dialog). Brief 02
should have landed (language tabs); this brief only adds two more languages to them.

## Goal
Offer **Hinglish** (Hindi written in Latin letters, English words kept as English) and **Manglish** (Malayalam
written in Latin letters, English words kept as English) as two extra "Translate to" targets. They behave like
any other translation layer: a tab in the Captions panel, a "Show on video" checkbox, replace-on-video, SRT
export, cues `needsReview: true` with estimated word timing, the native-script original kept in the project.

This is **transliteration by Gemini on the recognized text**. No audio leaves the machine and no new engine or
model is involved. It reverses the "Manglish transliteration is deferred" note in `docs/PRODUCT.md`.

## Design decisions (already made)
- Approach: two new translation targets, not a new recognition mode and not offline rule-based conversion.
- Sequenced on top of the caption-languages layers, not standalone.
- **Codes.** `languageCodeSchema` is `^[a-z]{2,3}$` (`src/core/transcription.ts:30`) and describes *spoken*
  language codes for recognition. Do **not** widen it. Add a separate
  `translationTargetSchema = languageCodeSchema.or(z.enum(['hi-latn', 'ml-latn']))` and use it only where a
  *translation target* is stored or requested: cue `translationLanguage` and `shownTranslation` (brief 01),
  `translationRuns[].targetLanguage`, `translateTo` (brief 04), `TranslatedTranscript.targetLanguage`
  (`transcription.ts:~167`), and `set-shown-translation`. Export a `TranslationTarget` type. `hi-latn` and
  `ml-latn` are BCP 47 style ("Hindi, Latin script"); no other Latn codes are added.
- Adding two allowed values to an existing optional field needs **no schema migration** (old projects never
  contain them). Do not bump the schema version.

## Read only these files
- `src/core/translationLanguages.ts` (list and `translationTargetLabel`)
- `src/core/transcription.ts` (`languageCodeSchema` ~30, `TranslatedTranscript` ~158-170,
  `validateTranslationOutput` ~209)
- `src/core/scriptCheck.ts` (`EXPECTED_SCRIPT` ~22, `scriptCounts`, `checkTranscriptScript` ~90)
- `electron/geminiTranslation.ts` (prompt ~52-57, `translateTranscript` script check ~117)
- Wherever brief 01/04 put the target types: `src/core/model.ts` (`translationLanguage`, `shownTranslation`,
  `translationRuns`), `src/core/transcriptionIpc.ts` (`translateTo`), `src/core/captionLanguages.ts`,
  `src/core/editCommandSchema.ts`, `src/core/captionCommands.ts` (`set-shown-translation`)
- `src/TranscriptionPanel.tsx` (target checkbox list, localStorage read), the translate dialog from brief 03 and
  the tab labels from brief 02, only to make them use `translationTargetLabel`
- `docs/PRODUCT.md` lines ~25 and ~52

## Steps

### 1. Target list and labels (`translationLanguages.ts`)
Change `TRANSLATION_TARGETS` to `{ code: TranslationTarget; label: string; hint?: string }[]` and add, right
after Hindi and Malayalam respectively or grouped at the end under a visible separator (dialog decides):
- `{ code: 'hi-latn', label: 'Hinglish (Latin script)', hint: 'Hindi in English letters, English words kept' }`
- `{ code: 'ml-latn', label: 'Manglish (Latin script)', hint: 'Malayalam in English letters, English words kept' }`

`translationTargetLabel` keeps working unchanged. Add `isRomanizedTarget(code): boolean`
(`code === 'hi-latn' || code === 'ml-latn'`) and `romanizedBase(code): 'hi' | 'ml'` for the prompt.

### 2. Schemas
Introduce `translationTargetSchema` as described above and swap it in at the places listed in the design
decisions. Everything downstream that is typed `LanguageCode` for a *target* becomes `TranslationTarget`
(the compiler will find them; `GeminiTranslator`'s `target`, `translateTranscript`, `translationProvenance`,
`TranscriptionRequest.translateTo`). Recognition-side types (`language`, `requestedLanguage`, run `language`)
stay `LanguageCode`.

### 3. Script check for Latin output (`scriptCheck.ts`)
Today `checkTranscriptScript(language, texts)` looks up `EXPECTED_SCRIPT[language]`, which has no entry for
`en` and so accepts anything. For romanized targets the failure mode is the opposite: Gemini returns the
**native script unchanged**. Add a branch:
- For `hi-latn` / `ml-latn`, expected script is `Latin`; fail with the existing `{ ok: false, dominantScript, ... }`
  shape when the dominant script is Devanagari (hi) or Malayalam (ml) (i.e. the model did not transliterate).
  Reuse `scriptCounts`, `MIN_SCRIPT_LETTERS` and the dominance threshold the file already uses. If `scriptCounts`
  has no `Latin` bucket, add one.
- `translateTranscript` (`geminiTranslation.ts:~117`) already surfaces this as `UNEXPECTED_SCRIPT`,
  `retryable: true`. Its message says "mostly X script, not Y"; that reads correctly for Latin.

### 4. Prompt (`geminiTranslation.ts`)
Add a romanized branch to `systemInstruction`; leave the existing branch exactly as is for normal targets.
Suggested wording for `hi-latn` / `ml-latn` (`base` = Hindi / Malayalam):
- `Transliterate each subtitle line's "text" into ${base} written in Latin (English) letters, as people type it
  in chat (${target === 'hi-latn' ? 'Hinglish' : 'Manglish'}). Do NOT translate the meaning.`
- `Keep every word that is already English (Latin script) exactly as written. Do not translate ${base} words
  into English.`
- `Use simple, common spellings a native reader expects; no diacritics, no IPA, no long-vowel marks.
  Keep numbers, names and punctuation style.`
- Keep the existing lines about one output per input, same order, same "i", never merge/split/add/drop,
  no commentary.
`sourceLanguage` may be `null` or a different language; the instruction must still work, so do not mention
"from ${sourceLanguage}" for these targets.

### 5. UI touch-ups
- Dialog checkbox list (brief 04) and the "+ Translate..." dialog (brief 03): render every entry of
  `TRANSLATION_TARGETS`, showing `hint` as secondary text when present. Remember-last-choice code must accept
  the new codes (it validates against `TRANSLATION_TARGETS`, so it does once step 1 is done).
- Captions panel tabs (brief 02) and the "Show on video" label: use `translationTargetLabel`, so a tab reads
  "Manglish (Latin script)". If a tab or checkbox builds its label from an ISO code directly, fix it.
- Privacy line in the dialog already says caption text only goes to Gemini; leave it.
- Optional and only if trivial: when a Hinglish/Manglish target is ticked and the source language is not
  Hindi/Malayalam, show one muted line: "Works best when the spoken language is Hindi/Malayalam or English mixed
  with it."

### 6. Docs
- `docs/PRODUCT.md`: line ~25, replace "Manglish transliteration is deferred" with a sentence that Hinglish and
  Manglish are offered as Gemini transliteration targets on caption text (estimated timing, Needs review). Line
  ~52, remove "Manglish transliteration" from the deferred list.
- `docs/TRANSCRIPTION.md`: one short subsection describing the two targets, that they are transliteration not
  translation, that only text is sent, and the retryable wrong-script failure.
- Update the table in `README.md` (this folder) to list this brief. Already done if you are reading this from a
  fresh clone.

## Out of scope
Offline/rule-based transliteration, direct Hinglish/Manglish speech recognition (Gemini audio prompt), a
romanization option for other languages, a scheme choice (ITRANS, ISO 15919), editing aids like a
phonetic-spelling dictionary, changing font or shaping (Latin text needs none).

## Checks
- `npx tsc --noEmit -p .` passes. No tests (README override). Existing tests that use `LanguageCode` for a
  target should still compile since `TranslationTarget` is a superset; fix minimally if not.
- Read-through check: a `ml-latn` run with Malayalam source text goes through `translateTranscript`, the
  prompt takes the romanized branch, the script check rejects Malayalam-script output and accepts Latin, the
  cues get `translationLanguage: 'ml-latn'`, and the tab label reads "Manglish (Latin script)".
- `electron/geminiTranslation.ts`, `src/TranscriptionPanel.tsx` and other files may carry uncommitted work
  from other sessions. Re-read before editing; do not revert unrelated changes.

## Done
- [ ] `translationTargetSchema` / `TranslationTarget` used for every stored or requested translation target;
      `languageCodeSchema` unchanged; no schema bump.
- [ ] `TRANSLATION_TARGETS` includes Hinglish and Manglish with labels and hints; `isRomanizedTarget`,
      `romanizedBase` helpers.
- [ ] Script check handles Latin-expected targets and rejects untransliterated native script.
- [ ] Gemini prompt has a romanized branch that keeps English words and never translates meaning.
- [ ] Dialog, translate dialog and tabs show the new labels.
- [ ] `docs/PRODUCT.md` and `docs/TRANSCRIPTION.md` updated.
- [ ] `npx tsc --noEmit -p .` clean.
- [ ] `docs/STATUS.md` entry: changes, "not tested, typecheck only", limitations (transliteration quality
      unverified on real clips, Gemini-only, needs a Gemini key), next task. Commit.
