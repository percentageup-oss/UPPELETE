# 04 — Create project from current DaVinci timeline

## Goal
On Home, while connected, a primary button **Create project from current DaVinci timeline**:
1. Asks Resolve to render the current timeline to a small H.264 proxy with audio in KathaCut's cache.
2. Shows progress with Cancel.
3. Opens a new KathaCut project with that proxy on V1 at 0, linked to the Resolve timeline (`resolveLink`).

After that, the existing Transcribe flow (whisper / Gemini / OpenAI / ElevenLabs) works on the proxy with no
changes. In the editor, a linked project shows a small banner: *Linked to DaVinci: <project> › <timeline>*, with a
warning if Resolve's current timeline is a different one.

Read `docs/plans/resolve-textplus/README.md` and `docs/decisions/0008-resolve-textplus.md` (confirmed render
calls; they win) first. Brief 03 is done: `electron/resolve/bridge.ts` (`ResolveBridge.request`),
`src/core/resolveIpc.ts`, `resources/resolve/bridge.lua` and `src/resolve/frames.ts` (`parseResolveFps`).

## Read only
- The files above from brief 03.
- `src/core/model.ts` (L1025-1060: `projectSchema` schema 24 and its type exports; and the migration chain: search
  `migrateV23` to see how a version is wired into loading), `src/core/migrateV23.ts`.
- `electron/assetInspect.ts` (`inspectFileForBin`), `electron/main.ts` (L57, L69 the cache dir helper,
  `inspectedMedia` and how `dialog:open-video` registers media: search `inspectedMedia.set`).
- `src/App.tsx`: `startFromHome` (~L1267), `addAssetsFromInspected` (~L1051), the managed project creation effect
  (~L1272), and `commit`/`commitHistory`. `src/home/HomeScreen.tsx`.
- `src/core/editCommandSchema.ts` / `src/core/commands.ts`, only if a command is the cleanest way to set
  `resolveLink` (see step 5).

## Steps
1. **Lua** (`bridge.lua`): add handlers.
   - `renderProxyStart { targetDir, name, maxLongSide }`:
     - Refuse if `project:IsRenderingInProgress()`.
     - Remember `project:GetCurrentRenderFormatAndCodec()`.
     - Compute the output size from the timeline resolution, scaled so the long side is at most `maxLongSide`,
       rounded down to even numbers.
     - Call, in order: `SetCurrentRenderMode(1)`, `SetCurrentRenderFormatAndCodec("mp4","H264")`, and
       `SetRenderSettings{ SelectAllFrames=true, TargetDir, CustomName=name, ExportVideo=true, ExportAudio=true,
       FormatWidth, FormatHeight }` (use the ADR's confirmed keys).
     - Then `AddRenderJob`, `StartRendering(jobId)`.
     - Return `{ jobId, width, height }`. Keep the remembered format and codec in a module-level table keyed by
       `jobId`.
   - `renderStatus { jobId }`: returns `{ status, percent, error }` from `GetRenderJobStatus`. When the job has
     finished, failed or been cancelled, also `DeleteRenderJob(jobId)` and restore the remembered format and codec.
   - `renderCancel { jobId }`: `StopRendering()`, then the same cleanup.
2. **Main**: `electron/resolve/proxy.ts`, `renderTimelineProxy(bridge, onProgress, signal)`.
   - First call `timelineInfo`. The output dir is `<userData>/Cache/resolve-proxies/`, and the name is
     `<sanitised timeline name>-<timelineId short>-<Date.now()>`.
   - Start the render and poll `renderStatus` every 500 ms. Map the progress to `onProgress(percent)`.
   - Cancel on abort. When done, find the output file: the expected `<name>.mp4`, otherwise the newest file with
     that prefix in the dir. Error if it's missing.
   - Then inspect it with the same function main uses for `dialog:open-video`, and **register it in
     `inspectedMedia`**, so transcription can resolve its path from the fingerprint.
   - Return `{ inspected, timeline: TimelineInfo & { fps: {num, den} } }`.
3. IPC:
   - `resolve:create-proxy-start` returns `{ requestId }`.
   - Progress arrives via `resolve:proxy-progress { requestId, percent }`.
   - The result comes via `resolve:proxy-done { requestId, ok, result | message }`.
   - `resolve:create-proxy-cancel { requestId }`.
   Add zod schemas in `src/core/resolveIpc.ts`, plus preload and `env.d.ts` entries.
4. **Schema 25** (`src/core/model.ts`): keep `projectSchemaV24` (rename the current export, the same way the V23
   pattern was done). The new `projectSchema` spreads the V24 shape with `schemaVersion: z.literal(25)` and
   `resolveLink: resolveLinkSchema.optional()`. Add `src/core/migrateV24.ts` (it only sets `schemaVersion: 25`)
   and wire it into the loader like `migrateV23`. The `resolveLinkSchema`:
   ```ts
   {
     projectName: string(max 512), timelineName: string(max 512), timelineId: string(max 256),
     startFrame: int >= 0, fps: { num: int 1..1_000_000, den: int 1..1_000_000 },
     width: int 1..16384, height: int 1..16384,
     proxyAssetId: string(min 1, max 128),
     trackName: string(max 64).default('KathaCut'),
     synced: array({ key: string(max 256), clipId: string(max 256), hash: string(max 64),
                     startFrame: int, endFrame: int, text: string(max 4000) }).max(20000).default([]),   // filled by brief 06
   }
   ```
   `superRefine`: `proxyAssetId` must be a video asset in `assets`.
5. **Renderer flow.**
   - `HomeScreen` gets an optional `resolve` prop:
     `{ connected: boolean, timelineName?: string, onCreate: () => void }`. It renders the primary button only
     when connected; the label names the timeline.
   - `App.tsx` `createFromResolve()`:
     - Open a small modal: "Rendering '<timeline>' from DaVinci Resolve… NN%" with Cancel, and a note: "KathaCut
       changes the render format on Resolve's Deliver page for this render and sets it back afterwards."
     - On success: go to the editor the way `startFromHome` does, then call
       `addAssetsFromInspected([inspected], { sequenceUs: 0, trackId: null })`.
     - Then set `resolveLink`, with `proxyAssetId` = the asset id just added: find it by fingerprint in
       `projectRef.current.assets`. Set it with a plain `commit` that merges `resolveLink` into the project in
       the same undo step if the helpers allow; otherwise use a separate commit.
     - Show a notice: "Timeline imported. Transcribe it from the Captions tab."
     - On failure, show the message and stay on Home.
   - The managed project file gets created automatically (the existing effect).
6. **Linked banner.** In the editor, when `project.resolveLink` is set, show a slim bar or pill text:
   *Linked to DaVinci: <projectName> › <timelineName>*. If connected and the live `timelineInfo` id (re-read when
   the status changes) differs from `resolveLink.timelineId`, warn: "Resolve has '<other>' open. Switch to
   '<timelineName>' in Resolve before syncing." Put it next to the brief 03 pill; don't add a new layout region.

## Out of scope
Syncing captions (06); refreshing the proxy after Resolve edits (the user re-creates the project); audio-only
renders; cleaning up the cache dir (note it in STATUS as a limitation).

## Done checklist
- [ ] `npx tsc --noEmit -p .` passes.
- [ ] The Resolve media is never modified, and the proxy goes only to KathaCut's cache.
- [ ] Old projects (schema 24) load through `migrateV24`. Note in STATUS: "schema 25; migration is trivial;
      unit test available on request (migrations are high-risk per AGENTS.md)".
- [ ] `docs/STATUS.md` entry, "not tested, typecheck only". Next brief: 05 (or 06 if 05 is done).
- [ ] Commit only the files this brief changed: `Create KathaCut project from the current DaVinci timeline`.

## Manual check for the user
1. Connect, then Home → Create project from current DaVinci timeline. Progress runs, and the editor opens with the
   proxy.
2. Transcribe with whisper. Captions line up with the audio.
3. Resolve's Deliver page is back to its previous format.
