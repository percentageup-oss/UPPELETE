# 05: Spike: sherpa-onnx local voices

Read `README.md` in this folder first. Brief 02 must have landed, because the spike checks the output
against the engine contract in `electron/dub/engine.ts`.

## Goal
Find out whether an open-source, fully offline TTS engine can back the `DubEngine` contract on Windows,
with macOS arm64 noted. Write the findings to `docs/STATUS.md` so that brief 06 can build on them.
**No product code ships from this brief.** Spike code lives in `scripts/spikes/local-tts/` and is committed
without models or audio.

## Candidates (researched 2026-09-27; verify each claim)

**Runtime: sherpa-onnx** (k2-fsa, Apache-2.0).
- ONNX Runtime-based TTS on CPU, with no Python.
- npm `sherpa-onnx-node` has prebuilt per-platform addon packages.
- It also offers source separation (relevant to a later brief 07).
- Links: https://github.com/k2-fsa/sherpa-onnx, https://www.npmjs.com/package/sherpa-onnx

**Piper `ml_IN` voices `arjun` and `meera` (medium).**
- Source: https://huggingface.co/rhasspy/piper-voices/tree/main/ml/ml_IN (about 126 MB for both).
- Piper code: legacy MIT (`rhasspy/piper`) or GPL-3.0 (`piper1-gpl`).
- **The voice MODEL_CARD says the data is the Indic TTS Malayalam corpus (IIT Madras) and gives only "See
  URL" for the license.** Find and record the real dataset license. If it is non-commercial or unclear,
  the voice **cannot** ship in the default catalog. Say so plainly in STATUS.
- sherpa-onnx needs Piper models in its converted form (a `.onnx` with metadata, plus `tokens.txt` and
  `espeak-ng-data`). Check whether k2-fsa's `tts-models` release already has `vits-piper-ml_IN-*`, or
  document the conversion script.

**Kokoro-82M** (Apache-2.0). No Malayalam, but it has English and Hindi. Check whether sherpa-onnx's Kokoro
bundle licenses are clean. It is a candidate for dubbing English layers.

**Indic Parler-TTS** (AI4Bharat, Apache-2.0, about 0.9B, Malayalam plus 20 Indic languages and English).
Only check whether a maintained ONNX export exists. It is otherwise PyTorch-only and out of scope.

**Rejected on license** (don't spend time on these): MMS-TTS `mms-tts-mal` (CC-BY-NC-4.0), Coqui XTTS-v2
(CPML), F5-TTS weights (CC-BY-NC).

## Steps
1. **Setup.** In `scripts/spikes/local-tts/`, run a Node script **in a child process, not Electron main**.
   Load `sherpa-onnx-node` and synthesize with Piper `ml_IN-meera`. Download models to a git-ignored folder,
   and add that folder to `.gitignore`.
2. **Output.** Synthesize 5 real Malayalam lines and 3 mixed Malayalam/English lines, the kind of captions
   this app gets. Write 24 kHz or native-rate mono WAVs, and check them with `workers/media/wav.ts`
   `parseWavHeader`.
3. **Measure and record on Windows:**
   - install size (addon and model)
   - cold load time
   - real-time factor on CPU
   - peak memory
   - how English words inside Malayalam text are pronounced
   - whether any line fails
   - the same for Kokoro English, if time allows
4. **Packaging.** Check that the addon loads from an Electron `utilityProcess` or worker, and whether the
   binaries need `asarUnpack`. The app uses a separate worker for native tools; follow
   `docs/MEDIA_WORKER.md`'s process model.
5. **macOS.** Record what must be verified on a Mac (arm64 addon package, signing). Do not claim it was
   tested.

## Out of scope
Any change under `src/` or `electron/`. Shipping models. UI.

## Checks
`npx tsc --noEmit -p .` still passes. No tests.

## Done
- [ ] A spike script that synthesizes Malayalam through sherpa-onnx in a child process.
- [ ] A STATUS entry with:
  - the measured numbers (Windows)
  - the **voice license verdict** per voice
  - the model file URLs plus SHA-256 values and sizes, for brief 06's catalog
  - packaging notes
  - a go/no-go for brief 06
- [ ] No models or audio committed. Commit.
