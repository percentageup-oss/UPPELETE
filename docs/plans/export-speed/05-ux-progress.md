# 05: Export progress: Preparing, time left, speed

## Goal
Replace "Exporting · Rendering…" / "Encoding 42%" with honest, useful status:
- before the first frame: **"Preparing…"** (today it says "Rendering…" while it's actually probing
  and starting the renderer)
- while running: **"Exporting 42% · about 1:12 left · 1.8× realtime"**

## Constraints that matter here
- No fake progress: show percent, ETA and speed only once they're measured. Hide the ETA until it's
  stable (at least 3 s of samples and ≥2 % progress).
- Renderer-only change. No new IPC, and no change to the job/progress schemas in `src/core/jobs.ts`.

## Facts already established
- `electron/exportService.ts` reports `{ kind: 'indeterminate', phase: 'rendering' }` at the start, then
  `{ kind: 'measured', phase: 'encoding', completed, total, unit: 'frames' }` from FFmpeg's `frame=` lines
  (every 0.25 s).
- The UI label comes from `describeJob()` in `src/TranscriptionPanel.tsx` (≈line 74), which is shared
  with transcription. Don't change its behaviour for transcription.
- Export status renders in two places in `src/App.tsx`: the topbar pill (≈line 1929) and the inspector
  footer (≈line 2193). `exportState` (≈line 218) holds `{ kind: 'running', requestId, job }`.
- The output frame rate is needed for "× realtime". The job knows `total` frames, and duration = total / fps.
  If the rate isn't at hand in App, show fps instead ("38 fps").

## Read only
- `src/TranscriptionPanel.tsx`: `describeJob` and `phaseLabels` (lines ≈20–80)
- `src/App.tsx`: ≈200–230 (state), ≈505–535 (`startExportVideo`), ≈1925–1935, ≈2190–2200
- `src/core/jobs.ts`: the `JobSnapshot` type only

## Steps
1. New pure module `src/export/progressRate.ts`:
   `createProgressRate()` → `{ sample(completed: number, total: number, nowMs: number): ExportRateView }`, where
   `ExportRateView = { percent: number | null; etaMs: number | null; framesPerSecond: number | null }`.
   Use an EWMA of the frames/second between samples. Ignore non-increasing samples. Return nulls until stable.
   Also export `formatEta(ms)` ("about 1:12 left", "less than a minute left").
2. New `describeExport(job, rate)` in the same module: `queued`/`cancelRequested` reuse `describeJob`;
   no measured progress yet gives "Preparing…"; measured gives "Exporting 42% · about 1:12 left · 38 fps".
3. In `App.tsx`, keep one `createProgressRate()` per export in a ref, reset in `startExportVideo`. Feed
   it from the job updates, and use `describeExport` in both status spots.
4. Give the topbar pill `title` the text "Uses the project as it was when the export started. You can keep editing."

## Out of scope
Taskbar/notifications (06/07), the dialog estimate (08), worker changes.

## Tests / verify
- `src/export/progressRate.test.ts`: steady rate gives the correct ETA; stays null before stable;
  non-monotonic samples are ignored; `formatEta` edge cases.
- `npx vitest run src/export src/ExportDialog.test.tsx` then `npm run typecheck`.
- Real: `npm run dev`, export a short clip, and watch the label go Preparing… → Exporting with an ETA.

## Done when
- [ ] Tests and typecheck pass; checked in the running app (say which OS)
- [ ] `docs/STATUS.md` ≤10-line entry
- [ ] Committed. Stop.
