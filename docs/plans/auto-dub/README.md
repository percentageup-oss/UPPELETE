# Auto dub: session briefs

Each brief is one **fresh session**'s work. Open a new session and say:

> Implement docs/plans/auto-dub/0N-<name>.md

The session reads that brief and only the files it lists. It implements the brief, runs the typecheck,
adds a short entry to `docs/STATUS.md`, commits, and stops. Briefs never rely on earlier conversation.
Anything a later brief needs from an earlier one is recorded in `docs/STATUS.md` or in the code.

## Goal
Speak the captions. The user picks a caption language layer: the original, or a translation from the
caption-languages work. The app generates a dubbed voice track from that layer's cue text, with each line
fitted to its cue's timing. The track is placed on its own audio track and follows the video through cuts,
trims and moves. The original voice is muted, ducked or kept.

Decisions (made with the user, 2026-09-27):
- **Engine:** Gemini TTS first (briefs 01-04). An open-source local engine comes next (05-06), behind the
  same engine contract.
- **Source:** any caption language layer, using the cue text as it currently is (user edits win).
- **Original audio:** Mute (gain 0), Duck (gain 0.25, about -12 dB) or Keep. Keeping background music under
  the dub needs voice/music separation, which is a possible later brief 07.
- **Voices:** preset voices only, plus an optional style hint. No voice cloning.

## Order

| # | Brief | Depends on | Size |
|---|-------|-----------|------|
| 01 | [Engine contract, Gemini TTS, segment cache, `fitAudio`, `dubPlan`](01-engine-and-fit.md) | none | M |
| 02 | [Dub job + IPC, WAV assembly, file registration](02-dub-job-and-ipc.md) | 01 | M |
| 03 | [Schema 25 `dubRuns`, apply as one undo step](03-schema-and-apply.md) | 02 | M |
| 04 | [Dub dialog in the Captions panel + docs](04-dub-dialog-and-docs.md) | 03 | M |
| 05 | [Spike: sherpa-onnx local voices](05-local-tts-spike.md) | 02 | S-M |
| 06 | [Local engine, voice downloads, engine picker](06-local-engine.md) | 04, 05 | L |

Run them in numeric order. 05 can run any time after 02.

## Testing override
The user asked (2026-09-25) that session briefs **not** write or run tests, export parity stages, smoke runs
or benchmarks. This **overrides the AGENTS.md testing rule for this plan**. The only check is
`npx tsc --noEmit -p .`. Do not delete existing tests. If a typecheck breaks one, fix it minimally.
STATUS entries say "not tested, typecheck only".

One higher-risk item the user may want to opt back into: brief 03 adds a **schema migration** (24 to 25),
where a migration round-trip test would be worth it.

## Design summary (every brief follows this)

**Privacy.** Gemini TTS receives caption **text only, never audio**. The key is loaded in main only, never
from the renderer. The core workflow stays offline, and dubbing is optional.

**Engine contract** `electron/dub/engine.ts`:
`DubEngine { id; model; voices; synthesize({ text, languageCode, voice, style? }, signal) => Promise<{ wav: Buffer; usage? }> }`.

**Segment cache.** One cached WAV per synthesized line at
`userData/Cache/dub-segments/<sha256(engine|model|voice|style|lang|text)>.wav`. Re-dubbing after the user
edits one cue synthesizes only that cue.

**Fitting timing** (pure, `src/core/dubPlan.ts`):
- A cue's window runs from `startUs` to the earlier of the next cue's `startUs` and `endUs + 400 ms`.
- If the speech is longer than its window, it is sped up with FFmpeg `atempo`, which keeps the pitch, up to
  `maxTempo`. The default is 1.25; the user can pick 1.0-1.5.
- Speech is never slowed down and never truncated. A line that still doesn't fit is placed anyway and
  reported as **overflow**.

**One dub WAV per (language, video asset), in that video's source time.** The WAV is 24 kHz mono s16 and as
long as the source video, with each line mixed in at its cue's source-time start. On the timeline, each
video clip of that asset gets a **mirror audio clip** with the same `timelineStartUs`, `sourceStartUs`,
`sourceEndUs` and `speed`. This means:
- The dub follows cuts, trims and moves exactly as captions do.
- Export needs one FFmpeg input per video clip rather than per cue, which stays under the stacked route's
  250-input cap (`src/export/plan.ts`, search `250`).
- The existing export `amix` mixes it, so there is no new export code.

**Files.** For a saved project the WAV goes in `<projectDir>/<projectName> Dubs/`, which gets a relative
path on save. For an unsaved project it goes in `userData/generated-dubs/`. It is registered through
`inspectFileForBin`, so it is fingerprinted and served over `media://`. Input media is never touched.

**Project model.** Schema 25 adds an optional `dubRuns[]` field: provenance plus what re-dub needs.

## Shared findings (verified 2026-09-27; line numbers drift, so search by symbol)
- **Gemini SDK.** `@google/genai` runs in main only.
  - Recognition uses the Interactions API: `ai.interactions.create(..., { signal })` with `store: false`
    (`electron/geminiRecognition.ts:46-58`).
  - Translation uses `ai.models.generateContent` (`electron/geminiTranslation.ts`).
  - Error mapping: an aborted signal becomes `jobFailure('CANCELLED')`; anything else becomes
    `BACKEND_FAILED` with `retryable: true` (`geminiTranslation.ts:86-89`).
  - Usage type: `GeminiUsage = { inputTokens?, outputTokens? }` (`geminiRecognition.ts:6`).
- **Key.** `providerSecretStore().load('gemini')` (`electron/geminiKey.ts:6`,
  `electron/providerSecretStore.ts`). Never accept a key from the renderer.
- **Gemini TTS (docs, 2026-09).**
  - Models: `gemini-3.8-flash-tts` (recommended) and `gemini-3.8-flash-lite-tts`.
  - Uses the Interactions API. The unary result is WAV (RIFF, 24 kHz, mono, 16-bit) in
    `interaction.output_audio.data` (base64).
  - Voice config: `generation_config.speech_config`. Style/pace: `speech_metadata.style`.
  - 30 prebuilt voices: Zephyr, Puck, Charon, Kore, Fenrir, Leda, Orus, Aoede, Callirrhoe, Autonoe,
    Enceladus, Iapetus, Umbriel, Algieba, Despina, Erinome, Algenib, Rasalgethi, Laomedeia, Achernar,
    Alnilam, Schedar, Gacrux, Pulcherrima, Achird, Zubenelgenubi, Vindemiatrix, Sadachbia, Sadaltager,
    Sulafat.
  - Supports `ml-IN`. Brief 01 confirms exact field names against
    https://ai.google.dev/gemini-api/docs/speech-generation and the installed SDK's types.
- **IPC pattern to copy.**
  - Main side: `electron/captionTranslationIpc.ts`. It keys jobs by `sender.id:requestId`, loads the key in
    main, enqueues on `getJobScheduler()`, sends progress with `event.sender.send`, cancels when the
    renderer is destroyed, and reports a succeeded/failed/cancelled outcome.
  - Schemas: `src/core/captionTranslationIpc.ts` (`z.strictObject`).
  - Exposure: `electron/preload.ts:74-82`, `src/env.d.ts:46-48`, registered in `electron/main.ts`.
- **Jobs.** `jobKindSchema` and `JOB_RESOURCE_CLASS` are in `src/core/jobs.ts:10,19`. Heavy jobs run one at a
  time in FIFO order.
- **Media worker operations** (`workers/media/protocol.ts`): `taskSchema` (:18), `operationSchema` (:54),
  `resultSchema` (:72), a `case` in `operations.ts` with an exhaustive `never` check.
  - Callers use `getMediaWorker().start(task, { signal, timeoutMs, onProgress }).result`
    (`workers/media/client.ts`; example in `electron/alignmentService.ts`).
  - Pattern for ffmpeg argv: `extractAudio` in `workers/media/audio.ts`.
  - WAV helpers in `workers/media/wav.ts`: `readWavInfo`, `parseWavHeader`, `pcm16MonoWavHeader`.
  - `atempoChain(rate)` is in `workers/media/exportArguments.ts:415`.
- **Registering a generated file.** `lut:save-generated` (`electron/main.ts:620-639`) writes to a temporary
  name, renames, then registers. `inspectFileForBin(path, deps)` (`electron/assetInspect.ts:22`) returns an
  `InspectedFile` (`src/core/assetImport.ts:5`). Renderer side: `addAssetsFromInspected` / `media.register`
  (`App.tsx`, search `addAssetsFromInspected`).
  - Project paths main already trusts: `knownProjectPaths` (`main.ts:426`, checked at `:701`).
- **Timeline.**
  - Audio clip schema: `edit.ts:192-198` (`gain` 0-4, `speed`, `linkId`, `enabled`).
  - Track schema: `edit.ts:94-108`.
  - Commands: `track-add`, `track-update` (`trackCommands.ts`); `clip-add`, `clip-update`, `clip-delete`
    (`clipCommands.ts`); `asset-add` / `asset-remove` (`assetCommands.ts`).
  - `runCommands(commands, message)` (`App.tsx:763`) applies every command as **one undo step** and
    commits nothing if one fails.
  - Linked original audio: `clipLinks.ts`. `effectiveGain` is at :73-80. A detached video's sound lives on a
    mirror audio clip that shares its `linkId`.
- **Time mapping.** `spansInSequence`, `cuesInSequence` and `activeClipsAt` are in
  `src/core/timelineModel.ts`.
- **Caption languages.** In `src/core/captionLanguages.ts`: `cuesForLanguage`, `projectLanguages`,
  `originalCuesOfVideo`, and `applyTranslatedLayers` (the pattern for applying to the project plus
  appending runs).
  - UI: `src/CaptionsPanel.tsx` renders `TranslateCaptions` (`src/TranslateCaptions.tsx`) at about :125.
  - `applyTranslations` in `App.tsx` (search `applyTranslatedLayers`) commits the result.
- **Schema.**
  - The current version is **24**. The latest migration is `src/core/migrateV23.ts` (23 to 24), wired at
    `model.ts` `toV24FromV23` (~:1218).
- **Preview audio.** `src/playback/SfxScheduler.ts` decodes each audio asset once into memory.
  - Audio-file clips play with Web Audio `playbackRate`, which does **not** keep pitch.

## Project rules that matter (from AGENTS.md)
- The core workflow is local. Dubbing via Gemini is optional, sends **text only**, and is disclosed.
- Preserve Malayalam text. Send the cue text exactly as it is.
- User corrections are authoritative. Dub the current cue text, never raw recognition.
- The renderer has no Node. Use a narrow zod-validated IPC; keys stay in main.
- Spawn tools with argument arrays. Never overwrite input media. Write files atomically (temporary name, then
  rename).
- Never block the UI thread: synthesis and assembly run in main or a worker, as jobs.
- Source-media microseconds are canonical time.
- Keep macOS and Windows paths portable (`path.join`, no hardcoded separators).
- Never commit media, models, caches, generated audio or credentials.
- Record new dependencies and models in `docs/DEPENDENCIES.md` (the app is GPL-3.0-or-later; everything
  must be compatible with that).
- Update `docs/STATUS.md` after each slice: changes, verification, limitations, next task.

## Out of scope (all briefs)
Voice cloning; lip sync; per-line ducking or gain automation; multi-speaker voices; MCP tools for dubbing;
pitch-correct preview of dub clips on speed-changed video clips; Indic Parler-TTS (unless brief 05 finds a
practical ONNX path).

**Possible brief 07 (not written yet).** Voice/music separation (sherpa-onnx Spleeter/UVR, or Demucs, MIT)
producing a "music + effects" stem to use under the dub in place of muting the original.

## Known limitations (document in brief 04)
- The dub WAV is as long as the source video: about 170 MB per hour. Preview decodes it fully into memory,
  so the dialog warns when the source is longer than 30 minutes.
- A video clip with speed other than 1 plays its dub mirror pitch-shifted in preview. Export keeps the pitch.
- Overflow lines can run into the next line. They are reported, never cut.
