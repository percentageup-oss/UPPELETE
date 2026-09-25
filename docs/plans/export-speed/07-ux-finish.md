# 07: "Show in folder" + completion notification

## Goal
When an export finishes, let the user jump straight to the file, and tell them even if the app is in
the background.

## Constraints that matter here
- **Narrow, validated IPC:** the renderer never sends a path. It sends the export's `requestId`, and main
  maps that to the path of an export **that succeeded in this session**. Validate with zod like the
  existing handlers.
- Context isolation, no Node in the renderer. Expose one preload function.
- Notifications are local OS notifications only (no service, no telemetry).

## Facts already established
- `electron/exportIpc.ts` `export:start` returns `{ state: 'succeeded', path, … }`. `requestId` comes from
  `exportStartRequestSchema` in `src/export/ipc.ts`. `export:cancel` shows the handler + schema pattern (≈line 156).
- Preload: `electron/preload.ts` (export functions near `startExport`); types in `src/env.d.ts` (≈line 78).
- Renderer: `src/App.tsx` `startExportVideo` (≈line 512) sets the success notice (≈line 525). The notice
  renders at ≈line 2239 as a clickable div that dismisses itself on click. Its type is
  `Notice` (≈line 128): `{ tone, text }`.

## Read only
- `electron/exportIpc.ts`, `electron/preload.ts` (export section), `src/env.d.ts` (captionStudio API),
  `src/export/ipc.ts`
- `src/App.tsx`: ≈125–130, ≈510–530, ≈2235–2242

## Steps
1. Main: a `completedExports = new Map<string, string>()` (key `${sender.id}:${requestId}` → path), filled on
   success and capped at the last 20 entries. New `ipcMain.handle('export:reveal', …)`: parse the requestId,
   look it up, `fs.stat` it (the file may have been moved), then `shell.showItemInFolder(path)`. Return
   `{ ok: true } | { ok: false, message }`.
2. On success, if `!win.isFocused()` and `Notification.isSupported()`: `new Notification({ title: 'Export finished', body: path.basename(file) })`.
   Clicking it focuses the window and reveals the file. On failure, notify with title "Export failed".
3. Preload + `env.d.ts`: `revealExport(requestId: string): Promise<{ ok: true } | { ok: false; message: string }>`.
4. Renderer: extend `Notice` with an optional `action?: { label: string; run(): void }`. Render it as a
   button inside the notice, with `event.stopPropagation()` so clicking it doesn't dismiss. The success
   notice gets `{ label: 'Show in folder', run: () => revealExport(requestId) }`, and a failure result
   shows as an error notice.

## Out of scope
Progress text (05), taskbar/quit (06).

## Tests / verify
- If there's an existing IPC schema test pattern in `src/export/*.test.ts`, add a case for the reveal schema.
- `npm run typecheck`, `npx vitest run src electron`.
- Real (`npm run dev`): export, then "Show in folder" opens Explorer/Finder with the file selected.
  Minimize the app during an export and confirm the notification appears.

## Done when
- [ ] Typecheck and tests pass; checked manually (say which OS)
- [ ] `docs/STATUS.md` ≤10-line entry
- [ ] Committed. Stop.
