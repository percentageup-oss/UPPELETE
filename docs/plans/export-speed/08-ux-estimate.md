# 08: Time estimate in the Export dialog

**Requires brief 05** (`src/export/progressRate.ts` exists).

## Goal
Next to the size estimate in the Export dialog, show "About 3 min on this machine", based on how
fast previous exports actually ran here. Show nothing when there's no history.

## Constraints that matter here
- Honest: base it only on measured past exports, and label it an estimate. No history, no estimate.
- Per-viewer convenience data goes in `localStorage` wrapped in try/catch, like
  `caption-studio.export-settings` in `src/ExportDialog.tsx`. It's never stored in the project.

## Facts already established
- `src/ExportDialog.tsx`: `output` (width, height, frameRate) is resolved at ≈line 89; the footer summary
  (≈line 129) shows `About N MB (estimate)`. The duration used there is
  `useRange && range ? range.endUs - range.startUs : durationUs`.
- On success, `src/App.tsx` `startExportVideo` gets `{ durationUs, frameCount }`. The progress-rate
  object from brief 05 (a ref in App) knows the measured frames per second, or compute
  frameCount / elapsed wall time since the start.

## Read only
- `src/ExportDialog.tsx`: all of it (≈135 lines)
- `src/export/progressRate.ts` (from 05)
- `src/App.tsx`: `startExportVideo` (≈line 512)

## Steps
1. New `src/export/exportHistory.ts`: `recordExportSpeed({ width, height, framesPerSecond })` and
   `estimateExportMs({ width, height, frameCount })`. Bucket by output pixel count (≤480p, 720p, 1080p,
   1440p, 2160p), keep an EWMA per bucket, and store under `caption-studio.export-speed`.
   Return null without data. Pure functions over an injectable storage, so they're testable.
2. `App.tsx`: on success, record the speed (frames / wall seconds from start to finish).
3. `ExportDialog.tsx`: compute the frame count from the duration and `output.frameRate`, then show
   ` · about 3 min on this machine` in the summary line when the estimate isn't null.

## Tests / verify
- `src/export/exportHistory.test.ts`: no data gives null; after a record the estimate scales with the
  frame count; buckets are separate; corrupt storage gives null.
- Update `src/ExportDialog.test.tsx` if it snapshots the summary text.
- `npx vitest run src/export src/ExportDialog.test.tsx` then `npm run typecheck`.

## Done when
- [ ] Tests and typecheck pass; checked in `npm run dev` after one export
- [ ] `docs/STATUS.md` ≤10-line entry
- [ ] Committed. Stop.
