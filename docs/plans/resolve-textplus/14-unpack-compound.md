# 14 — Import DaVinci timeline: unpack compound clips

## Goal
When a Resolve timeline contains a compound clip, **Import DaVinci timeline** imports the compound's **inner
file clips** as normal, editable KathaCut clips, at the times they're visible on the outer timeline. The outer
trim is respected. Anything inside that can't be unpacked is listed in the existing review dialog with a
reason, never dropped. **Render instead** stays the fallback.

Read `docs/plans/resolve-textplus/README.md`, **ADR 0010** (brief 13's findings: which export format carries the
inner edit, its time origins and rates) and ADR 0009 first. **Where ADR 0010 disagrees with this brief, follow
the ADR** and note it in STATUS.
- If ADR 0010 doesn't exist, stop and tell the user to run brief 13.
- This brief assumes **OTIO** (JSON, no new dependency). **If ADR 0010 says only FCPXML carries the inner
  clips, stop and ask the user.** That needs an XML parser dependency: a license check plus
  `docs/DEPENDENCIES.md`.
- If ADR 0010 says the export is slower than ~2 s, make it a start + poll pair, like `renderProxyStart`/
  `renderStatus`.

## How it fits (current code)
- `electron/resolve/importEdit.ts` `importTimelineEdit`: `timelineInfo` → `readTimelineEdit` → inspect each
  unique `kind === 'file'` path → `planEditImport(edit, fps, inspectedByPath)` → assets + clips. The unpacking
  goes **between `readTimelineEdit` and the path collection**. It replaces each compound item with synthetic
  `kind: 'file'` items, so inspection, the retime check, clamping and placement all run unchanged.
- `src/resolve/editToProject.ts`: `planEditImport`, `KIND_REASON`, the embedded-audio matching
  (`videoKey` = record start + file path or name).
- `src/core/resolveIpc.ts`: `resolveTimelineEditSchema` (item shape: `trackIndex, recordStart, recordEnd,
  sourceStart, sourceEnd, filePath, fileFps, clipType, name, kind`), `ResolveEditSkip`.
- `src/resolve/frames.ts`: `parseResolveFps`, `timelineFrameToUs`.

## Read only
- ADR 0010, ADR 0009, and the evidence `.otio`/`.fcpxml` files in `docs/decisions/evidence/`.
- The files in "How it fits", plus `resources/resolve/bridge.lua` (handler pattern, `requireTimeline`,
  `joinPath`, `mailboxDir`, the command whitelist) and `electron/resolve/bridge.ts` (`request`).

## Steps
1. **Lua `exportTimelineOtio { timelineId }`** (`bridge.lua`): call `requireTimeline`, then
   `timeline:Export(joinPath(mailboxDir, "timeline-export.otio"), resolve.EXPORT_OTIO, resolve.EXPORT_NONE)`
   (the exact call per ADR 0010). **The bridge picks the path; the request never supplies one.** Error if it
   returns false. Return `{ path }`. Add it to the whitelist and to the README's command list.
2. **Schemas** (`src/core/resolveIpc.ts`):
   - `resolveExportOtioResultSchema` (`{ path }`, ≤ 32768 chars).
   - A minimal zod schema for the OTIO subset ADR 0010 documents: `Timeline` → `Stack` → `Track` →
     `Clip | Gap | Stack`, `source_range` (`RationalTime` value + rate), `media_reference.target_url`,
     `available_range` and `effects`. Use `.passthrough()`, a recursive `z.lazy` with a depth cap of 8, and cap
     the children array lengths.
3. **Pure `src/resolve/compoundUnpack.ts`** (new):
   `unpackCompounds(edit, otio, fps) → { edit: ResolveTimelineEdit, skipped: ResolveEditSkip[] }`.
   - **Match** each `kind: 'compound'` item to its OTIO stack by video track index and record start
     (sequence position within ±1 timeline frame), using ADR 0010's track-order rule. No match → the compound
     stays as it is (it's skipped later with its existing reason).
   - **Visible window:** the inner span the outer trim exposes (ADR 0010's rule), with length = the compound's
     record length.
   - **Flatten** the inner stack recursively (a nested compound is a nested stack; depth ≤ 4). If its inner
     **video spans more than one track**, don't unpack it. Skip the whole compound with "Compound clip with
     several video tracks inside".
   - For each inner clip that overlaps the window, clip it to the window, then **convert each boundary on its
     own** through integer µs with rational rates (no accumulated rounding):
     - `recordStart/recordEnd`: outer timeline frames (`timeline.startFrame` + offset), in the timeline's fps.
     - `sourceStart/sourceEnd`: frames in the media's fps, **counted from the file's first frame**. Remove the
       start-TC origin if ADR 0010 says OTIO includes it.
     - `filePath`: decode `target_url` per ADR 0010 (`file://` URL → OS path, percent-decoding, Windows drive
       letter). Anything that isn't a local file is skipped.
     - `fileFps`: the media rate as a string `parseResolveFps` accepts. `clipType: null`. `kind: 'file'`.
       `trackIndex`: the compound's. `name`: `"<compound name> › <file name>"`.
   - **Inner items that can't be unpacked** are skipped with `"<reason> (inside <compound name>)"` and the
     outer `startUs` where they'd be visible:
     - a retimed clip (per ADR 0010's signal) → reason "Retimed clip (speed change)";
     - a title or generator → its `KIND_REASON`;
     - no media reference, or a missing reference → "Could not read this clip".
     Gaps produce nothing.
   - **Audio:** remove the `audioItems` that belong to an unpacked compound (same record start and the
     compound's name), so they aren't reported as separate audio. The inner files' embedded audio comes in as
     linked audio clips, as for any file clip today.
   - Return the new edit (compound items replaced, other items unchanged, in timeline order) and `skipped`.
4. **Main** (`electron/resolve/importEdit.ts`): after `readTimelineEdit`, **only if some item is `compound`**:
   - call `exportTimelineOtio`;
   - read the file (cap it at e.g. 50 MB), `JSON.parse`, validate with the schema, and delete the file in a
     `finally`;
   - run `unpackCompounds`.
   If the export, read or validation fails, keep the edit as it is. Each compound is then skipped with
   "Could not read the compound clip's contents", not "Compound clip or nested timeline". Everything after that
   (unique paths, inspection, `planEditImport`, asset mapping) is unchanged. The final
   `unsupported = [...skipped, ...plan.unsupported]`.
5. **Renderer:** no new UI; the review dialog already lists skips. In `src/home/HomeScreen.tsx`, change the
   **Render instead** tooltip to "…works for retimed, multicam and Fusion clips" (drop "compound").
6. Update `docs/STATUS.md` ("not tested, typecheck only"; offer an opt-in unit test for `unpackCompounds`, since
   its frame math and window clipping are pure and off-by-one-prone). Commit only this brief's files:
   `Unpack compound clips when importing a DaVinci timeline`.

## Out of scope
- Compounds whose inner video uses several tracks.
- Retimed, title, generator or Fusion clips inside a compound (they're listed).
- Multicam clips.
- Rendering only a compound's section of the timeline (a possible later fallback).
- Pushing compounds back to Resolve (brief 12 sends flat clips).
- Re-importing into an existing project.

## Done checklist
- [ ] `npx tsc --noEmit -p .` passes.
- [ ] The export path is chosen by the bridge; no path comes from the renderer or the request. The temp file is
      deleted. Source media is never written.
- [ ] Every compound, and every inner item that isn't imported, is listed with a reason. Nothing is silently
      dropped.
- [ ] Frame ↔ µs conversions use rational rates with independent boundaries.
- [ ] `docs/STATUS.md` entry.

## Manual check for the user
1. Open brief 13's spike timeline in Resolve and click **Import DaVinci timeline**. Compound A's inner clips
   appear on V1 at the times they're visible in Resolve, with the head and tail trim applied. Scrub across each
   cut and compare the frames with Resolve.
2. The review dialog lists Compound B's retimed clip and the title inside Compound A. **Import the rest** and
   **Render instead** both still work.
3. Transcribe, then **Sync to Resolve**. The captions land on the right frames across the compound's inner cuts.
Windows only; Mac is unverified.
