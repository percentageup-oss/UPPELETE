# 06: Taskbar progress, keep awake, quit guard

## Goal
Three main-process changes that make long exports safer and visible outside the app:
1. Export progress on the Windows taskbar button and the macOS Dock (`BrowserWindow.setProgressBar`).
2. Keep the machine from sleeping during an export (`powerSaveBlocker`).
3. Quitting during an export asks first, instead of silently cancelling it.

## Constraints that matter here
- Main process only (plus a tiny test seam). No new renderer IPC.
- Must work on Windows and macOS; tested only on the OS you run.
- Shutdown must still settle all owned work before exit (see the comment in `before-quit`).

## Facts already established
- `electron/exportIpc.ts` `export:start` handler: progress snapshots arrive in the callback passed to
  `getService().start(…, (job) => { … event.sender.send('export:progress', …) })` (≈line 134). The outcome
  is awaited right after, with a `finally`. `event.sender` → `BrowserWindow.fromWebContents(event.sender)`.
- A measured snapshot is `job.progress = { kind: 'measured', completed, total }`.
- `activeRequests` (module-level Map in `exportIpc.ts`) holds running exports.
- `electron/main.ts` `app.on('before-quit', …)` (≈line 722) calls `closeJobs()`, which cancels everything.

## Read only
- `electron/exportIpc.ts`: the whole `registerExportIpc`
- `electron/main.ts`: ≈700–735
- `electron/jobs.ts`: `closeJobs`

## Steps
1. In `export:start`: after the save dialog, get `win = BrowserWindow.fromWebContents(event.sender)`.
   On each snapshot: measured → `win.setProgressBar(completed / total)`, otherwise
   `win.setProgressBar(2)` (indeterminate on Windows). In `finally`: `setProgressBar(-1)` on success or
   cancel; on failure, set `{ mode: 'error' }` at 1, then clear it after ~4 s. Guard with `win.isDestroyed()`.
2. `const blocker = powerSaveBlocker.start('prevent-app-suspension')` when the job starts;
   `powerSaveBlocker.stop(blocker)` in `finally`.
3. Export `hasRunningExports(): boolean` from `exportIpc.ts`. In `before-quit`, before `shuttingDown = true`:
   if an export is running and the user hasn't already confirmed, show
   `dialog.showMessageBox({ type: 'warning', buttons: ['Keep exporting', 'Cancel export and quit'], defaultId: 0, cancelId: 0, message: 'An export is still running.', detail: 'Quitting now cancels it and no file is saved.' })`.
   "Keep exporting" returns (the quit is already prevented). "Quit" sets a `quitConfirmed` flag and calls
   `app.quit()` again. Don't show it in `--export-smoke` / smoke modes.

## Out of scope
Renderer UI, notifications (07).

## Tests / verify
- Unit-test `hasRunningExports` if practical (`electron/exportService.test.ts` shows how the service is faked).
- `npm run typecheck` and `npx vitest run electron`.
- Real (`npm run dev`): the taskbar/Dock bar fills during an export; quitting mid-export shows the
  dialog and both buttons behave; a finished export clears the bar.

## Done when
- [ ] Typecheck and tests pass; checked manually (say which OS)
- [ ] `docs/STATUS.md` ≤10-line entry
- [ ] Committed. Stop.
