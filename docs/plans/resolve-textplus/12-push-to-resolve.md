# 12 — KathaCut → Resolve: Create in DaVinci

## Goal
A **Create in DaVinci** button makes a **new timeline in the Resolve project that's open**. Never switch or
create Resolve projects (user decision, 2026-09-27). It then:
- imports the media files the KathaCut project uses into a `KathaCut Media` bin;
- places the **video clips with KathaCut's cuts**;
- adds the captions as Text+ clips on the `KathaCut` track.

The project becomes linked (`origin: 'pushed'`), so later caption edits use the normal **Sync to Resolve**.

**v1 sends video clips and captions only.** Images, text overlays, shapes, effects, audio clips, speed curves,
transitions, grades and zooms are listed as "not sent yet"; later phases add them.

Read `docs/plans/resolve-textplus/README.md`, **ADR 0009** (brief 09: timeline creation, custom timeline
settings, `ImportMedia`, `AppendToTimeline` with source ranges, which fps source frames use) and ADR 0008 first.
Follow the ADR where it disagrees with this brief. If ADR 0009 doesn't exist yet, stop and tell the user to run
brief 09. Brief 10 must be done (link v26, sequence mapping).

## Read only
- ADR 0009, ADR 0008.
- `resources/resolve/bridge.lua`: `requireTimeline`, `findFolderNamed`, `insertClips` (the batch pattern).
- `electron/resolve/sync.ts` (`applySync`, `chunks`, the batch constants), `electron/resolve/ipc.ts`,
  `electron/resolve/bridge.ts`.
- `electron/main.ts`: `inspectedMedia`, `fingerprintKey`, and how `registerExportIpc(lookupMedia)` resolves an
  asset's file from its fingerprint.
- `src/core/model.ts` (clips, tracks, `project.format`, `resolveLinkSchema` v26), `src/core/timelineModel.ts`
  (`captionClips`, `clipEndUs`), `src/core/media.ts` (asset `fingerprint`, `metadata.frameRate`).
- `src/resolve/frames.ts`, `src/resolve/editSignature.ts`, `src/resolve/textPlusPlan.ts`,
  `src/resolve/ResolveSync.tsx` (the header control and dialog patterns).

## Steps
1. **Pure planner** `src/resolve/pushPlan.ts`:
   `planPush(project) → { timeline: { name, fps, width, height }, media: assetIds[], clips: PushClip[], notSent:
   { feature, count }[] }`.
   - `fps`/`width`/`height` come from `project.format`, or `formatFromMedia` of the primary video when there's
     no format.
   - Each caption clip (`captionClips`) **without** a speed curve becomes `{ assetId, trackIndex (1-based, in
     KathaCut video-track order), recordOffsetFrames, sourceStartFrame, sourceEndFrame }`.
     - Record frames come from `timelineStartUs` / `clipEndUs` through the timeline fps.
     - Source frames come from `sourceStartUs` / `sourceEndUs` through the fps **ADR 0009 says `AppendToTimeline`
       expects** (usually the source's own `metadata.frameRate`).
     - Round each boundary independently. Use `endFrame` inclusive or exclusive as ADR 0009 found.
   - Clips with `speed`, and every non-video item, are counted in `notSent`.
   - Captions aren't planned here. Brief 10's `planTextPlus` does that once the link exists.
2. **Lua** (`bridge.lua`, each short):
   - `createTimeline { name, fps, width, height }` → `{ timelineId, startFrame }`:
     - use `mediaPool:CreateEmptyTimeline(name)` plus the custom-settings calls ADR 0009 confirmed;
     - if a name is taken, add ` (2)`, ` (3)` and so on;
     - make it the current timeline;
     - return a note if fps or size could not be set, so KathaCut can warn.
   - `importMedia { paths }` → `{ items: [{ path, ok }] }`:
     - find or create the `KathaCut Media` bin at the media pool root;
     - reuse an existing item whose `File Path` matches, by ADR 0009's lookup method, and never import duplicates;
     - otherwise `ImportMedia`.
   - `appendVideoClips { timelineId, clips }`:
     - one `AppendToTimeline` per batch, looking media pool items up by `File Path` in the bin;
     - return each placed item's actual record and source frames, so main can report mismatches.
   - Every handler runs `requireTimeline` (except `createTimeline` and `importMedia`) and touches only the
     timeline it created.
3. **Main** (`electron/resolve/push.ts`, new; `resolve:push-start` + `resolve:push-progress` in `ipc.ts`):
   - **Resolve file paths in main:** look each asset up with the same fingerprint → `inspectedMedia` lookup that
     export uses. **The renderer never sends paths.**
   - A missing asset stops the push before anything is created: "<name> is offline — relink it first."
   - Then `createTimeline` → `importMedia` → `appendVideoClips` in batches (ADR 0009's size) → the captions via
     `applySync` against the new `timelineId`, with `synced: []`, the `trackName` (`KathaCut`) and the specs
     from the renderer.
   - The renderer plans the captions after it knows the new timeline's `startFrame`. Split the IPC into
     `resolve:push-timeline` (returns `timelineId`, `startFrame`, placement report) and the existing
     `resolve:sync-apply` for the captions. Don't duplicate the apply logic.
   - Stop at the first failing step and report what exists in Resolve.
4. **Renderer** (`src/resolve/CreateInResolve.tsx`, new; header button next to the pill in `App.tsx`):
   - **Visibility:** shown while connected and the project has at least one caption clip.
   - **Dialog:** the timeline name (default: the project title), fps and size, what's sent (N video clips,
     M captions) and the `notSent` list.
     - If the project is already linked: "This makes a new timeline and moves the link to it. The old timeline
       isn't changed."
   - **On Create:**
     1. `resolve:push-timeline`.
     2. Build a provisional `resolveLink` (`origin: 'pushed'`, the new `timelineId`/`startFrame`/fps/size,
        `trackName: 'KathaCut'`, `editSignature`, `synced: []`).
     3. `planTextPlus({ ...project, resolveLink })`.
     4. `resolveSyncApply` with those specs.
     5. Commit the final link with the returned `synced` as **one** undo step.
     A progress dialog runs throughout, followed by a result notice that includes any placement mismatches.
   - Brief 10's disabled reason now gains the sentence "Use Create in DaVinci to make a new timeline."
5. Update `docs/STATUS.md`; commit only this brief's files: `Create a DaVinci timeline from a KathaCut project`.

## Out of scope
Audio clips, images, overlays, shapes, effects, speed curves, transitions, grades, zooms. Pushing later cut
changes into an existing timeline. Creating or switching Resolve projects.

## Done checklist
- [ ] `npx tsc --noEmit -p .` passes.
- [ ] Media paths are resolved only in main; no media is modified; existing Resolve timelines and clips are
      never touched.
- [ ] Nothing unsupported is sent silently. The dialog lists everything that isn't sent.
- [ ] `docs/STATUS.md` entry, "not tested, typecheck only". Offer a unit test for `planPush`.

## Manual check for the user
1. Open a KathaCut project with a few cuts and captions. Click **Create in DaVinci**. A new timeline appears in
   the open Resolve project, with the same cuts, the media in `KathaCut Media`, and the captions on the
   `KathaCut` track.
2. Edit a caption in KathaCut. The badge shows 1 change, and Sync updates only that clip.
3. Re-cut the video in KathaCut. Sync is disabled with the reason, and **Create in DaVinci** makes a fresh
   timeline.
