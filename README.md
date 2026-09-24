# KathaCut

**Your local AI video toolkit.**

A local-first desktop subtitle editor for Malayalam/English creator videos.

Status: editor foundation in development. The current desktop slice probes local media through the isolated worker, stores portable references and sampled fingerprints, resolves/relinks missing media, extracts and caches real audio waveforms, opens SRT files, synchronizes captions with playback, edits text/timing, supports undo/redo, and saves/opens `.cstudio` projects (schema 3, with schema 1/2 migration) with autosave once a project is named, or exports SRT.

The Models button manages three exact approved whisper.cpp GGML artifacts with explicit
download/resume/cancel, SHA-256 verification, atomic activation and confirmed selected-model
removal. Local rechecking works offline. The transcription backend is still pending; see
[model management](docs/MODELS.md) and [status](docs/STATUS.md).

## Start
Extract this folder to your development directory and open it as the working folder in Codex. Read AGENTS.md, docs/PRODUCT.md, docs/ARCHITECTURE.md and docs/ROADMAP.md. Paste the contents of START_HERE.md into the first task.
Install Node.js 22.12 or newer, then run:

```sh
./dev.sh            # installs dependencies if needed, then Vite + Electron with hot reload
./dev.sh electron   # production build, then electron .
```

On first run `./dev.sh` asks for your local ffmpeg/ffprobe executables, builds the project-pinned
whisper-cli (whisper.cpp 1.9.4, macOS arm64) automatically if it isn't configured yet, and saves
everything to the gitignored `caption-studio.local.json`. The app reads that file directly in
unpackaged runs, so plain `npm run dev` or `npx electron .` also work afterwards. No tools are
downloaded or looked up on PATH by the app itself; see [media worker](docs/MEDIA_WORKER.md) and
[dependencies](docs/DEPENDENCIES.md).

**Windows (PowerShell):** `.\dev.ps1` does the same and needs no manual paths. It finds FFmpeg/ffprobe
(PATH, winget, Scoop, Chocolatey, `C:\ffmpeg`, `.tools`), checks the build can export (PNG codec plus
`h264_nvenc` or `h264_mf`), and otherwise downloads a BtbN LGPL build into `.tools\`. It also fetches
whisper-cli (CUDA build when an NVIDIA GPU is present). Export uses NVIDIA NVENC when a test encode
succeeds, else Windows Media Foundation; set `CAPTION_STUDIO_EXPORT_ENCODER=h264_mf` to force the
fallback. Flags: `-Reconfigure`, `-Yes`. If scripts are blocked: `powershell -ExecutionPolicy Bypass -File .\dev.ps1`.

Use `npm run check` for type checks, tests and production builds. No remote repository has been created. Select an open-source license before public release; no license choice is implied by this project.

## Target machines
Primary: Mac mini M4 Pro, 24 GB unified memory.
Validation: Windows PC, Ryzen 5 5600X, 32 GB RAM, RTX 3070 Ti 8 GB.
macOS and Windows are first-release targets. Keep portable interfaces for future Linux support; Linux release validation is not yet promised.

## Core workflow
Import video -> generate timed captions locally OR import SRT -> edit text and timing in transcript/timeline -> style and animate -> export video and SRT -> reopen editable project.

Automatic transcription is required in the first usable release, not an optional later feature.
