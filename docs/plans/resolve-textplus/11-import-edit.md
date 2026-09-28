# 11 — Resolve → KathaCut: import the timeline edit (render becomes the fallback)

## Goal
**Import DaVinci timeline** builds a KathaCut project from the Resolve timeline's **original media files and
cuts**, with no render. It's faster, needs no proxy on disk, and transcribes full-quality audio. The brief 04
render stays as the fallback for timelines the import can't rebuild.

v1 scope: **video-track clips, with their embedded audio.** Clips on audio tracks (e.g. a separately recorded
lav) are listed as "not imported"; importing them is a later phase.

Read `docs/plans/resolve-textplus/README.md`, **ADR 0009** (brief 09 findings: which read APIs exist, the
source frame origin, classification rules) and ADR 0008 first. **Where ADR 0009 disagrees with this brief,
follow the ADR** and note it in STATUS. If ADR 0009 doesn't exist yet, stop and tell the user to run brief 09.

## Read only
- ADR 0009, ADR 0008 (its launcher/globals addendum).
- `resources/resolve/bridge.lua`: the handler pattern, `requireTimeline`, `json.array`/`json.null`.
- `electron/resolve/bridge.ts` (`request`), `electron/resolve/ipc.ts`, `electron/resolve/proxy.ts` (how brief 04
  returns an inspected asset plus timeline info).
- `electron/assetInspect.ts` `inspectFileForBin`; in `electron/main.ts`: `inspectMedia`, `inspectedMedia` and
  where `registerResolveIpc` gets its deps.
- `src/core/resolveIpc.ts`: `resolveProxyResultSchema` and `resolveInspectedVideoSchema` (the pattern to extend).
- `src/resolve/frames.ts`: `parseResolveFps`, `timelineFrameToUs`. `src/resolve/editSignature.ts` (brief 10).
- `src/App.tsx`: `createFromResolve`, `addAssetsFromInspected`; `src/home/HomeScreen.tsx` (the `resolve` prop);
  `src/core/model.ts` clip/track schemas and `newId`.
- `src/app/usePlaybackProxies.ts` / `src/core/proxy.ts`: the existing playback-proxy flow for codecs Chromium
  can't play.

## Steps
1. **Lua `readTimelineEdit { timelineId }`** (`bridge.lua`; `requireTimeline` first):
   - For each **video** track (1..count): for each item, return `{ trackIndex, recordStart, recordEnd,
     sourceStart, sourceEnd, filePath|null, fileFps|null, name, kind }`. Use the method and property names
     ADR 0009 confirmed.
   - `kind` is `'file' | 'title' | 'generator' | 'fusion' | 'compound' | 'multicam' | 'retimed' | 'unknown'`,
     using ADR 0009's classification rules.
   - Also return per-audio-track item counts, for the "not imported" note.
   - Return the timeline info (as `timelineInfo` does) in the same response.
   - Cap at 5000 items; `pcall` per item; items that fail come back as `kind: 'unknown'`.
   - Keep the call under ~2 s. If ADR 0009 says reading is slow, page it with `{ trackIndex, offset }`.
2. **Schemas** (`src/core/resolveIpc.ts`): `resolveTimelineEditSchema` (the Lua result; frames are ints, paths
   ≤ 32768 chars, fps via `numericLike`) and `resolveImportEditResultSchema` (for the renderer: inspected assets,
   planned clips, the `unsupported` list, timeline info with rational fps).
3. **Pure mapper** `src/resolve/editToProject.ts`:
   `planEditImport(edit, fps, inspectedByPath) → { clips, unsupported, notImported }`.
   - **Record frames → sequence µs:** offset from the timeline start frame, via `timelineFrameToUs` with the
     timeline's rational fps. Compute each boundary independently.
   - **Source frames → source µs:** use the **source's** fps and the frame origin ADR 0009 found (subtract the
     file's start-TC frames if source frames count from the timecode).
   - Clamp to the inspected media's duration.
   - Only `kind === 'file'` whose path inspected OK becomes a clip. Everything else goes to `unsupported` with a
     reason ("retimed clip", "compound clip", "title", "file missing", "unreadable format (e.g. BRAW/R3D)").
   - KathaCut video tracks are created to match Resolve's video track order.
4. **Main** (`electron/resolve/importEdit.ts`, new; wired as `resolve:import-edit` in `ipc.ts`):
   - Call `readTimelineEdit`.
   - Inspect each **unique** file path with the same probe brief 04 uses (`deps.inspect`). The paths come from
     Resolve, never from the renderer. Register each one in `inspectedMedia`, as `dialog:open-video` does, so
     transcription and export resolve it.
   - Unreadable files count as unsupported, not failures.
   - Return the planned import. Add progress events if inspection takes a while
     (`resolve:import-edit-progress`, `{ done, total }`).
5. **Renderer:**
   - **Home:** the primary Resolve button becomes **Import DaVinci timeline — "<name>"**, with a secondary
     **Render instead** that keeps the brief 04 flow.
   - After the import IPC, if `unsupported` or `notImported` is non-empty, show a small dialog listing them.
     Choices: **Import the rest** or **Render instead**. If everything is supported, go straight on.
   - Build the project the way `createFromResolve` does, placing **several** clips from the plan instead of one
     proxy clip at 0. Reuse `addAssetsFromInspected` for the assets.
   - Commit `resolveLink` with `origin: 'edit'`, no `proxyAssetId`, `startFrame`/`fps`/`width`/`height` from the
     timeline info, and `editSignature` computed after placement.
   - Files Chromium can't play go through the existing playback-proxy flow (`usePlaybackProxies`). Don't add a
     new one.
6. Update `docs/STATUS.md` (and the README "Order" table if a step moved); commit only this brief's files:
   `Import a DaVinci timeline's edit from its original media`.

## Out of scope
Audio-track clips and separate-audio sync, retimed/compound/multicam/nested items (they go to the render
fallback), transitions, clip transforms/grades, and re-importing into an existing project.

## Done checklist
- [ ] `npx tsc --noEmit -p .` passes.
- [ ] No source media is written. Paths come only from Resolve and are never taken from the renderer.
- [ ] Every skipped item is listed with a reason. Nothing is silently dropped.
- [ ] Frame → µs conversions use rational fps with independent boundaries.
- [ ] `docs/STATUS.md` entry, "not tested, typecheck only". Offer a unit test for `planEditImport`.

## Manual check for the user
1. In Resolve, open a timeline with a few cuts from one or two camera files. Click **Import DaVinci timeline**.
   The KathaCut timeline shows the same cuts at the same times, with no render.
2. Transcribe, then **Sync to Resolve**. The captions land on the right frames on either side of each cut.
3. Try a timeline that contains a retimed clip. The dialog lists it, and **Render instead** still works.
