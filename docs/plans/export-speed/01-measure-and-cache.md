# 01: Measure export stages + cache the support check

## Goal
Make every export record where its time went, so briefs 02–04 can prove their gains with numbers.
Also remove a redundant per-job tool check. **No behaviour or output changes.**

## Constraints that matter here
- No telemetry: timings go only to the local export log (`electron/exportLog.ts`). Record counts and
  milliseconds only, never caption text or media content.
- Worker work never blocks the UI thread (already true; keep it).
- Report only the platforms you actually ran on.

## Read only
- `workers/media/export.ts`: all of it (~360 lines). Key spots: `exportSupport()` (≈line 83),
  `renderVideo()` (≈106), the frame loop (≈209–223), the result object (≈236).
- `workers/media/protocol.ts`: search for `operation: 'export'` in the MediaResult schema.
- `electron/exportIpc.ts`: the `logExport('outcome', …)` call (≈line 146).
- `electron/exportService.ts`: `run()` / `render()` (it passes the worker result through).
- `workers/media/export.test.ts`: skim how fake `spawn`/`probe`/`runTool` are injected via `ExportDependencies`.

## Steps
1. In `renderVideo`, time these with `performance.now()`:
   - `startupMs`: from entry to the first frame request (support check, manifest parse, prepare, probes, host spawn, masks)
   - `hostWaitMs`: summed time awaiting `fromHost`
   - `encoderWaitMs`: summed time awaiting `toEncoder`
   - `paintedFrames` and `reusedFrames` (cached branch vs host branch)
   - `finalizeMs`: from after the loop to after output validation
   - `totalMs` and `fps` (= frames / loop seconds)
2. Add an optional `timings` object with exactly those fields to the export MediaResult in
   `protocol.ts` (zod schema; optional so older results still parse). Return it from `renderVideo`.
3. Pass it through `ExportService` into `ExportJobValue` (optional field), then add
   `timings: outcome.value.timings` to the `logExport('outcome', …)` detail in `exportIpc.ts`.
   Also include it in the `runExportSmoke` return value so the smoke run prints it.
4. Cache `exportSupport()` results per session inside the worker: a module-level `Map` keyed by
   `ffmpegPath|ffprobePath|exportHost.executable`, the same pattern as `selectVideoEncoder`'s
   `selected` map in `workers/media/exportEncoderSelect.ts`. Cache only `supported: true` results, so a
   fixed install is re-checked. Export a `resetExportSupportCacheForTests()`.
5. Baseline on this machine: build (`npm run build`), then run the real smoke on a caption-heavy clip:
   ```
   CAPTION_STUDIO_EXPORT_SMOKE_PATH=<abs video> CAPTION_STUDIO_EXPORT_SMOKE_OUTPUT=<abs out.mp4> \
   CAPTION_STUDIO_EXPORT_SMOKE_SRT=<abs .srt> npx electron . --export-smoke
   ```
   Do a 1080p run, and a 4K run if you have 4K media (`CAPTION_STUDIO_EXPORT_SMOKE_SETTINGS='{"resolution":2160,...}'`,
   see `src/export/settings.ts` for the schema). Put output files in a temp dir, never in the repo.

## Out of scope
Changing the frame loop order, transport, arguments, or any UI. That's briefs 02+.

## Tests / verify
- Add to `workers/media/export.test.ts`: the result has `timings` with `paintedFrames + reusedFrames === frameCount`.
- Add a cache test: two `exportSupport` calls issue the `-version` runs once.
- `npx vitest run workers/media electron/exportService.test.ts` then `npm run typecheck`.

## Done when
- [ ] Tests and typecheck pass
- [ ] `docs/STATUS.md` has a ≤10-line entry with the **baseline table** (resolution, frames, fps,
      startupMs, hostWaitMs, encoderWaitMs, painted/reused) and the platform you ran on. Brief 02 reads this.
- [ ] Committed. Stop.
