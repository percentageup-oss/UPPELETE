# Contributing to KathaCut

Thanks for wanting to help. KathaCut is a local-first subtitle and video editor for Malayalam and English creators. Bug reports, Malayalam/Indic text-shaping fixes, Windows and macOS testing, docs and code are all welcome.

For anything bigger than a small fix, please **open an issue first** so we can agree on the approach before you spend time on it.

## Ground rules

These come from the product's core promises. Changes that break them will not be merged.

- **Local-first.** The core workflow works offline after explicit model downloads. No accounts, telemetry, media uploads or required subscription. Cloud features must be optional, user-initiated and disclosed before anything is sent.
- **Malayalam correctness.** Preserve shaping and mixed Malayalam/English text. Never animate raw Unicode code units or split vowel signs from their grapheme cluster (use `Intl.Segmenter`).
- **Honest timing.** Imported SRT text and timings are preserved unless the user edits them. Estimated word timing must never masquerade as aligned timing.
- **User corrections win.** Retranscription must not silently overwrite them.
- **One renderer.** Preview and export share caption layout and time-driven animation logic.
- **No fakes.** Don't add mock transcription, fake progress or controls that do nothing.
- **Never overwrite input media.** Use atomic project saves and relinking for missing media.
- **Portable.** Keep macOS and Windows working. Don't assume CUDA on a Mac.

## Getting set up

Requires Node.js 22.12 or newer.

```sh
./dev.sh      # macOS
.\dev.ps1     # Windows (PowerShell)
```

The scripts install dependencies, find or build FFmpeg and whisper-cli, and save the paths to the git-ignored `caption-studio.local.json`. After that `npm run dev` also works. If Electron starts behaving like plain Node, make sure `ELECTRON_RUN_AS_NODE` is not set in your shell.

## Project layout

| Path | What lives there |
| --- | --- |
| `src/` | React renderer. `src/core/` holds the pure project model, commands and layout logic |
| `electron/` | Main process, preload bridge, IPC, project files, MCP server |
| `workers/` | Separate media/transcription worker processes |
| `scripts/` | Build, smoke-test and export-parity scripts |
| `docs/` | Product, architecture, status, ADRs in `docs/decisions/` |

## Architecture rules

- The renderer has **no Node integration**. Use context isolation and the narrow, validated preload/IPC bridge.
- Spawn external tools with **argument arrays**, never interpolated shell strings.
- Source-media timestamps are canonical; seconds are only for playback adapters. Avoid accumulating frame-rounding error.
- Transcription, waveform extraction and export must **never block the UI thread**.
- A change to the saved project format needs a **schema version bump and a migration**, plus tests.
- Edits go through the undoable command path so undo/redo and the MCP server keep working.

## Before you open a pull request

```sh
npm run typecheck
npm test
npm run build        # or all three: npm run check
```

- Touching timing, SRT round-trips, undo/redo, migrations or export? Add or update tests, and run `npm run parity:export` for renderer/export changes.
- **Say which OS you tested on.** Don't claim macOS or Windows validation you didn't do.
- Update [docs/STATUS.md](docs/STATUS.md) for a meaningful change: what changed, how it was verified, known limitations, next step.

## Dependencies, models and fonts

- Check the license and maintenance status before adding anything, and record it in [docs/DEPENDENCIES.md](docs/DEPENDENCIES.md). It must be compatible with GPL-3.0-or-later.
- FFmpeg stays on the LGPL profile (no GPL or nonfree flags); see [ADR 0001](docs/decisions/0001-media-worker-and-ffmpeg.md).
- Don't bundle fonts or models without confirmed redistribution rights.
- Architecture or dependency decisions get a short ADR in `docs/decisions/`.

## What must never be committed

Models, recordings, caches, generated exports, `caption-studio.local.json`, API keys or any credentials. Check `git status` before committing.

## Commits and pull requests

- Keep PRs small and focused, with a clear description of the problem and the fix. Screenshots help for UI changes (no private footage).
- Sign off every commit with `git commit -s`. This adds a `Signed-off-by:` line and certifies the [Developer Certificate of Origin](https://developercertificate.org/), i.e. that you have the right to submit the work under the project's license.

## Reporting bugs

Open an issue (or email **labs.vx@gmail.com** if you can't use GitHub) with your OS and KathaCut version, the steps to reproduce, what you expected and what happened. The logs are in `%APPDATA%\caption-studio\logs` (Windows) or `~/Library/Application Support/caption-studio/logs` (macOS). A tiny sample SRT is useful; **never attach private media or API keys.**

For security problems, please email **labs.vx@gmail.com** rather than opening a public issue.

## Other ways to help

Star and share the project, test on your hardware, report Malayalam rendering problems, or support development at [buymeacoffee.com/sadiqsulaimn](https://buymeacoffee.com/sadiqsulaimn).

## License

By contributing you agree that your contributions are licensed under the [GPL-3.0-or-later](LICENSE).
