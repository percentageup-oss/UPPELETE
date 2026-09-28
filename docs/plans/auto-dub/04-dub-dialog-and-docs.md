# 04: Dub dialog in the Captions panel + docs

Read `README.md` in this folder first (design, findings, rules, typecheck-only override). Brief 03 must have
landed: check `docs/STATUS.md`, and that `src/core/dubApply.ts` and `applyDub` in `App.tsx` exist.

## Goal
Give the user a **Dub…** control on each caption language tab: pick a voice, preview it, choose options,
watch progress, cancel, and see the result, including lines that were too long. Then document the feature.

## Read only these files
- `src/CaptionsPanel.tsx` (the tab strip; `TranslateCaptions` rendered at ~125)
- `src/TranslateCaptions.tsx`: copy its popover, key-missing, progress and cancel pattern and its privacy
  line.
- `src/core/captionLanguages.ts` (`cuesForLanguage`, `originalCuesOfVideo`, `projectLanguages`)
- `src/core/dubPlan.ts` (`dubLinesFromCues`, `ttsLanguageCode`), `src/core/dubIpc.ts`,
  `electron/dub/geminiTts.ts` (only the exported `GEMINI_TTS_VOICES`). If that is a main-only module, move
  the voice list to `src/core/dubVoices.ts` and import it from both sides.
- `src/env.d.ts` (the dub API)
- `src/App.tsx`: only where `CaptionsPanel` props are passed (search `<CaptionsPanel`) and `applyDub`.
- `src/style/controls.tsx` (`Segmented`, `Toggle`), and `styles.css` only for the existing popover classes.
- Docs to edit: `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`, `docs/DEPENDENCIES.md`.

## Steps

### 1. `src/DubCaptions.tsx`
- **Button.** A **Dub…** button next to "+ Translate…" in the tab strip, acting on the **active language
  tab** for the **picked video**.
  - The lines are `dubLinesFromCues(cuesForLanguage(...)` of that video`)`, which is the current, edited
    text.
  - The button is disabled with a reason when:
    - the layer has no cues
    - the video isn't on the timeline
    - no Gemini key is configured (same check and "open Settings" link as `TranslateCaptions`)
- **Popover contents:**
  - **Voice** select, from the voice list, with a ▶ **Sample** button. It calls `previewDubVoice` on the first
    line's text (cut to 300 characters), decodes the base64 into a `Blob`, and plays it with an `Audio`
    element. Revoke the object URL when done.
  - **Style** (optional) text field, placeholder "e.g. warm, conversational, speaking briskly".
  - **Max speed-up**: `Segmented` with 1.0× / 1.15× / 1.25× (default) / 1.5×.
  - **Original audio**: `Segmented` with Mute / Duck (default) / Keep.
  - **Privacy line**: "Sends only the caption text (never audio) to Gemini. Generated speech is saved next to
    your project."
  - **Warning** when the video is longer than 30 minutes: "Long videos make a large dub file that preview
    loads fully into memory."
  - **Progress bar** (`done/total` from `onDubProgress`) and **Cancel** (`cancelDub`).
- **Starting a dub.** Call `generateDub` with:
  - `requestId: crypto.randomUUID()`
  - the video fingerprint, duration and name
  - `language` (the tab's code, or the original language, or `'und'`)
  - `engine: 'gemini'`, `voice`, `style`, `maxTempo`
  - `projectPath` (the current project path, or `null`)
  - the lines
  - On success, call `applyDub(outcome, { videoAssetId, language, originalAudio })`.
- **Result area** (it stays until closed):
  - "N lines dubbed, M reused from cache."
  - Each overflow line is a button showing the cue's first words and the overflow in seconds. Clicking it
    seeks to the cue and selects it, using the panel's existing cue click handler.
- **Settings memory.** Remember the last voice, style, speed-up and original-audio choice per language in
  `localStorage`. Wrap every access in try/catch.

### 2. Docs
- **`docs/PRODUCT.md`:** add an "Optional dubbing" section after "Optional translation". Cover:
  - text-only upload, Gemini TTS, preset voices
  - the fitting rule (speed-up only, up to the chosen maximum, overflow reported)
  - mute/duck/keep, and that the original captions are unchanged
  - that a local engine is planned
- **`docs/ARCHITECTURE.md`:** one paragraph, the same length as the translation paragraph. Cover:
  - the engine contract and the segment cache
  - `fitAudio`
  - the source-time dub WAV with mirror clips
  - `dubRuns` and one undo step
  - the file location
- **`docs/DEPENDENCIES.md`:** add a Gemini TTS entry: the model id, that the cloud step is optional and
  text-only, and that no new npm dependency was added.
- **Known limitations** go in the PRODUCT/STATUS text: copy them from the README.

## Out of scope
Local engine (05, 06). Voice/music separation. MCP.

## Checks
- `npx tsc --noEmit -p .` passes. No tests.
- Confirm by reading:
  - the dialog never sends a path or key
  - it dubs the current cue text of the active language layer
  - Cancel really calls `cancelDub`

## Done
- [ ] `DubCaptions.tsx`: voice sample, style, speed-up, original audio, progress, cancel, overflow list with
      seek.
- [ ] Wired into `CaptionsPanel` and `App`.
- [ ] PRODUCT, ARCHITECTURE and DEPENDENCIES updated.
- [ ] Typecheck clean.
- [ ] `docs/STATUS.md` entry: "not tested, typecheck only", limitations, and a manual checklist for the user:
  1. Translate a short clip, then Dub.
  2. Hear the dub in preview.
  3. Cut the video; the dub follows.
  4. Undo.
  5. Save and reopen.
  6. Export.
  7. Re-dub after editing one cue; the other lines come from the cache.

  Next: brief 05. Commit.
