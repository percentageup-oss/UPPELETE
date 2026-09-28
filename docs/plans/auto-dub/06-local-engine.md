# 06: Local engine, voice downloads, engine picker

Read `README.md` in this folder first (design, findings, rules, typecheck-only override). Briefs 04 and 05
must have landed, and **05's STATUS entry must say "go"**. Take the voices, URLs, SHA-256 values, sizes,
licenses and packaging notes from that STATUS entry. Do not re-research them.

## Goal
Make dubbing fully offline once the user has downloaded a voice: a `LocalDubEngine` backed by sherpa-onnx
in a separate worker process, a TTS voice catalog with explicit downloads, and a Local/Gemini choice in the
Dub dialog.

## Read only these files
- The brief 05 entry in `docs/STATUS.md`, and `scripts/spikes/local-tts/`.
- `docs/MODELS.md`, `src/core/modelCatalog.ts`, `electron/modelManager.ts`, `electron/modelIpc.ts`: the
  pattern for downloads, verification, removal and ID-only IPC.
- `electron/dub/engine.ts`, `electron/dubIpc.ts`, `src/core/dubIpc.ts`, `src/DubCaptions.tsx`.
- `src/SettingsDialog.tsx` (the models tab).
- `docs/MEDIA_WORKER.md`, and the worker process spawning in `workers/media/client.ts`, for the process
  model.
- `package.json` and the electron-builder config (for `asarUnpack` / extra resources).

## Steps

### 1. Dependency
- Add `sherpa-onnx-node` at the version from brief 05, and commit the lockfile.
- Add it to `docs/DEPENDENCIES.md`: Apache-2.0, per-platform binaries, where it runs.
- Add the packaging config from brief 05's notes.

### 2. Voice catalog: `src/core/ttsVoiceCatalog.ts`
- A compiled allowlist. Each entry has: id, label, language (BCP-47), engine `sherpa-onnx`, model kind
  (`vits-piper` / `kokoro`), files (URL, pinned revision, size, SHA-256), license and attribution.
- Include **only** voices that brief 05 cleared on license.
- Store the files under `userData/Models/tts/<voiceId>/`.
- **Reuse `ModelManager`** by generalizing it over a catalog, if that's small. Otherwise add a
  `TtsVoiceManager` that copies its rules:
  - explicit downloads only
  - `.part` and resume
  - SHA-256 verification
  - atomic activation
  - removal needs a native confirmation
  - the checksum is checked again before every use
- Record each voice's license in `docs/licenses/` and `docs/DEPENDENCIES.md`.

### 3. Worker: `workers/tts/`
- A separate Node process with the same lifecycle as the media worker: spawned by main, a validated
  JSON protocol, cancellation, timeouts.
- Operations: `inspect` (does the addon load; version) and `synthesize { modelDir, voiceId, text, speed: 1 }`.
  `synthesize` returns the path of a WAV written to a directory main supplies.
- Load a voice once and keep it warm while the process is alive.
- Main resolves the voice files with the manager's verified-path call. It never uses a path from the
  renderer.

### 4. `LocalDubEngine`: `electron/dub/localTts.ts`
- Implements `DubEngine` with `id: 'local'`, `model: <voiceId>` and the installed voices for the requested
  language.
- Include `engine: 'local'` and the voice id in the segment cache key (already part of `segmentKey`).

### 5. IPC and UI
- **Schemas.** In `src/core/dubIpc.ts`, widen `engine` to `'gemini' | 'local'`. `dubPreviewRequest` gets the
  same change.
- **IPC.** `dubIpc.ts` picks the engine. Local needs no key and makes no network call.
- **Settings → Models.** Add a "Voices" section: the catalog list with size, license, Download / Cancel /
  Remove, and state. Copy the speech-model rows.
- **`DubCaptions.tsx` engine choice.** An **Engine** `Segmented` with Local / Gemini.
  - Local is listed only when a voice for this language is installed. It is the default then.
  - Otherwise show "Download a <language> voice in Settings → Models".
  - The voice select lists the engine's voices.
  - Change the privacy line to "Runs on this computer. Nothing is uploaded." when Local is chosen.
- **Provenance.** `dubRuns[].engine` records `'local'`, and `model` records the voice id.

## Out of scope
Indic Parler-TTS; voice cloning; voice/music separation (brief 07); MCP.

## Checks
- `npx tsc --noEmit -p .` passes. No tests.
- Confirm by reading:
  - the local path makes no network call except the explicit voice download
  - the renderer sends only voice IDs
  - native code runs outside Electron main and the renderer
- Report platforms honestly: say which OS it was typechecked or built on. Do not claim a macOS run.

## Done
- [ ] Dependency, packaging and license docs.
- [ ] Voice catalog + manager with explicit downloads and verification.
- [ ] The `workers/tts` process.
- [ ] `LocalDubEngine`.
- [ ] Engine choice in IPC and the dialog; Voices section in Settings.
- [ ] Typecheck clean.
- [ ] `docs/STATUS.md` entry ("not tested, typecheck only"), with a manual check for the user: download a
      voice, go offline, Dub a Malayalam layer. Commit.
