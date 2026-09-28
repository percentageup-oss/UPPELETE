# 06 — Sync to Resolve (incremental, with conflict check)

## Goal
In a linked project, a **Sync to Resolve** button (with a badge such as "12 changes") sends the captions as Text+
clips to a video track named **KathaCut**, changing only what changed:
- New caption: insert a clip.
- Text or style change with the same frames: update the existing clip in place (`SetInput`).
- Timing change: delete the clip and insert it again.
- Caption deleted in KathaCut: delete its clip.
- Unchanged: don't touch it.

Before anything is written, KathaCut reads the track back from Resolve. A clip that was **changed or deleted in
Resolve** since the last sync is a **conflict**. The dialog lists conflicts, and the default choice is **Keep the
Resolve version**, which stops KathaCut from managing that clip. KathaCut never touches clips on other tracks, or
clips on its track that it didn't create.

Read `docs/plans/resolve-textplus/README.md` and **`docs/decisions/0008-resolve-textplus.md`** (placement method,
batch size, input IDs, tagging) first. Also check that the template `.drb` exists at
`resources/resolve/kathacut-captions.drb` (brief 02). If it's missing and the ADR's placement needs it, stop and
ask the user to export it.

## Read only
- ADR 0008. From brief 03: `resources/resolve/bridge.lua`, `electron/resolve/bridge.ts`, `electron/resolve/ipc.ts`,
  `src/core/resolveIpc.ts`, `src/resolve/ResolveStatusPill.tsx`, `src/resolve/useResolveStatus.ts`.
- From brief 04: `resolveLinkSchema` in `src/core/model.ts`.
- From brief 05: `src/resolve/textPlusPlan.ts`, `textPlusInputs.ts`, `specHash.ts`, `frames.ts`.
- `src/App.tsx`: `commit`, the notice helpers, and where the brief 03 pill sits in the editor header.
- One existing dialog as the UI pattern, e.g. `src/SilenceRemovalDialog.tsx`.

## Steps
1. **Lua handlers** (`bridge.lua`). Keep each command short. Batching happens in TS.
   - `ensureTemplate { drbPath, clipName }`: search the media pool for a folder `KathaCut` holding `clipName`. If
     it isn't there, `mediaPool:ImportFolderFromFile(drbPath)` (or the ADR's method), then search again. Error if
     it's still missing.
   - `findTrack { name }` returns `{ trackIndex | nil }`. `ensureTrack { name }` finds the track, or adds a video
     track at the top with `AddTrack` + `SetTrackName`, and returns `{ trackIndex }`.
   - `readClips { trackIndex }`: for every item on that track, return `{ clipId = GetUniqueId(), startFrame =
     GetStart(), endFrame = GetEnd(), key = comp GetData("KathaCut.key"), text = tool StyledText }`. Use `pcall`
     per item; items without our tag get `key = nil`.
   - `insertClips { trackIndex, templateName, clips: [spec] }`: one `AppendToTimeline` call with all clips, then
     `applySpec(item, spec)` for each and `SetData("KathaCut.key", spec.key)`. Return `[{ key, clipId }]` in input
     order. Verify each returned item's start frame and report any mismatch.
   - `updateClips { trackIndex, clips: [{ clipId, spec }] }`: map `clipId` → item for that track, then
     `applySpec` (clear existing keyframes on the inputs the spec animates).
   - `deleteClips { trackIndex, clipIds }`: collect the items on that track only, then `DeleteClips(items,
     false)`.
   - `jumpTo { frame }`: `SetCurrentTimecode` for the frame. This is used to reveal a conflict.
   - `applySpec(item, spec)`:
     - `comp:Lock()`
     - For each entry in `spec.inputs`: skip it unless its id is in `LUA_INPUT_WHITELIST` (hard-coded in Lua,
       copied from `textPlusInputs.ts`). Convert `{x,y}` to the Fusion point table, then `tool:SetInput(id, value)`.
     - Set `StyledText` to `spec.text`.
     - Set keyframes and style ranges per the ADR (brief 07 fills these; skip if empty).
     - `comp:Unlock()`
   - Every handler checks that the current timeline's `GetUniqueId()` equals `params.timelineId`, and fails with
     "Resolve has a different timeline open" otherwise.
2. **Pure diff**: `src/resolve/syncDiff.ts`.
   ```ts
   diffSync({ specs, synced /* resolveLink.synced */, remote /* readClips result */ }) => {
     insert: Spec[], update: { clipId, spec }[], replace: { clipId, spec }[], remove: string[] /* clipIds */,
     conflicts: { key, clipId?, kind: 'changed-in-resolve' | 'deleted-in-resolve', resolveText?, keptText }[],
     unchanged: number, foreign: number /* untagged clips on our track, never touched */
   }
   ```
   - Match remote clips to synced entries by `clipId`. If a synced clip id is gone, fall back to `key` (the
     GetData tag).
   - A remote clip counts as **changed** if its start, end or text differs from what KathaCut last sent (the
     synced entry's `startFrame`, `endFrame` and `text`, from brief 04's schema).
   - A synced entry whose clip is missing counts as **deleted in Resolve**.
   - Changed spec vs. the synced hash: same frames → `update`; different frames → `replace`.
   - A tagged remote clip whose key isn't in `synced` (e.g. after an undo in KathaCut): adopt it if the key exists
     in specs and its text matches; otherwise treat it as a conflict.
   - Spec keys with no synced entry → `insert`. Synced keys with no spec → `remove`, unless in conflict.
3. **Local change count** (no Resolve round trip): `countPendingChanges(specs, synced)` compares keys and hashes.
   The badge uses it and recomputes when the project changes (memoised; the planner needs the DOM measurer, so run
   it in the renderer, debounced ~300 ms).
4. **IPC** (`electron/resolve/ipc.ts`, schemas in `src/core/resolveIpc.ts` with size limits: specs ≤ 20000, text ≤
   4000 chars, only whitelisted input ids):
   - `resolve:sync-preview { timelineId, trackName, specs, synced }`: `findTrack`, then `readClips` if the track
     exists. Returns `diffSync(...)`.
   - `resolve:sync-apply { timelineId, trackName, specs, synced, decisions: Record<key,'keep-resolve'|'overwrite'> }`.
     Main recomputes the diff itself (fresh `readClips`) rather than trusting a plan from the renderer. The
     template path is never sent by the renderer; main resolves it. Steps:
     - main: `ensureTemplate`
     - `ensureTrack`
     - `deleteClips` (removes + replaces + overwritten conflicts)
     - `insertClips` in ADR-sized batches (inserts + replaces + overwritten deleted-in-Resolve)
     - `updateClips` in batches
     - Progress events `resolve:sync-progress { done, total, phase }`.
     - Returns `{ synced: SyncedEntry[] /* the full new list */, errors: string[] }`. Kept-Resolve conflicts are
       dropped from `synced`, so KathaCut stops managing them.
     - The template is `<bridge resources dir>/kathacut-captions.drb`, with the clip name from ADR 0008.
   - Main stops at the first failing batch and returns what succeeded, so the synced list stays truthful.
5. **UI**:
   - A **Sync to Resolve** button next to the pill, shown only when `project.resolveLink` is set. It's disabled
     when disconnected or on a different timeline, with a tooltip saying why. A badge shows the pending change
     count, or "Synced".
   - Clicking it runs the preview, then opens `ResolveSyncDialog`:
     - summary counts (add / update / remove / unchanged)
     - target track name
     - conflicts list, each with "Keep Resolve version" (the default) or "Overwrite", plus "Show in Resolve"
       (`jumpTo`)
     - a note if `foreign > 0`: "N clips on the KathaCut track weren't made by KathaCut and won't be touched"
     - the **support list** from the plan (sent / approximated / not sent)
     - Sync and Cancel buttons
   - During apply: a progress bar, then a result notice.
   - Commit the new `resolveLink.synced` as one undo step labelled "Sync to Resolve". (If undone, the next preview
     re-adopts the tagged clips; see the diff rules.)
6. Linked projects only: if `resolveLink.proxyAssetId` no longer exists in assets, disable sync with the reason
   "The DaVinci proxy video was removed from this project."

## Out of scope
Emphasis and animations (07), auto-sync, other tracks or item kinds, reordering tracks, and changing the track name
from the UI (it's the stored `trackName`).

## Done checklist
- [ ] `npx tsc --noEmit -p .` passes.
- [ ] Only clips on the KathaCut track tagged by KathaCut are ever updated or deleted. Conflicts default to
      keeping Resolve's version.
- [ ] Lua applies only whitelisted inputs and never executes request content.
- [ ] `docs/STATUS.md` entry, "not tested, typecheck only". Offer a unit test for `diffSync`.
- [ ] Commit only the files this brief changed: `Sync captions to DaVinci Resolve as Text+ clips`.

## Manual check for the user
1. Sync a transcribed project. Text+ clips appear on the "KathaCut" track at the right frames, with the font,
   colours and position close to the KathaCut preview.
2. Edit one caption's text in KathaCut. The badge says 1 change, and the sync updates only that clip.
3. Change a clip's text in Resolve's Inspector, then edit it in KathaCut and sync. It shows a conflict, and "Keep
   Resolve version" leaves it alone.
4. Delete a caption in KathaCut and sync. Its clip is removed.
