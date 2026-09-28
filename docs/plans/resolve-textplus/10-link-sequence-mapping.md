# 10 — Link v26 + sequence-time caption mapping

## Goal
One caption → Resolve-frame mapping for every way a project can be linked to a Resolve timeline:
- `proxy`: rendered from Resolve (brief 04);
- `edit`: rebuilt from Resolve's cuts (brief 11);
- `pushed`: created in Resolve from KathaCut (brief 12).

Captions are placed by **sequence time**, the KathaCut timeline, instead of by time on the single proxy asset.
Brief 11 and 12 links then work across cuts and several source files.

The link also records an **edit signature** of the video clips. If the video edit changes in KathaCut after
linking, Sync is **disabled** with a reason (user decision, 2026-09-27; pushing cut changes is a later phase).

Read `docs/plans/resolve-textplus/README.md` and ADR 0008 first.

## Read only
- `src/core/model.ts`: `resolveLinkSchema`, `resolveSyncedCueSchema`, `projectSchema` (schema **25**) and its
  `superRefine`.
- `src/core/migrateV24.ts` and `src/core/migrateV23.ts` (the migration pattern), and where migrations are
  chained (search for `migrateV24`).
- `src/core/timelineModel.ts`: `cuesInSequence`, `captionClips`, `spansInSequence`.
- `src/resolve/textPlusPlan.ts` (`planTextPlus`), `src/resolve/frames.ts` (`usToTimelineFrame`),
  `src/resolve/specHash.ts`.
- `src/resolve/ResolveSync.tsx`: the `disabledReason` chain.
- `src/App.tsx`: `createFromResolve`, where brief 04 commits `resolveLink`.

## Steps
1. **Schema 26** (`src/core/model.ts`):
   - Add `origin: z.enum(['proxy', 'edit', 'pushed'])` and `editSignature: z.string().max(64)` to
     `resolveLinkSchema`.
   - `proxyAssetId` becomes optional.
   - In the project `superRefine`: `origin === 'proxy'` requires `proxyAssetId`, pointing at a video asset (the
     existing check); other origins must not have one.
   - Bump `schemaVersion` to 26 following the V24→V25 pattern (`projectSchemaV25` and so on).
   - New `src/core/migrateV25.ts`: a v25 link gets `origin: 'proxy'` and `editSignature` =
     `editSignature(project)` at migration time. Chain it where `migrateV24` is chained.
2. **`src/resolve/editSignature.ts`** (new, pure): `editSignature(project)` = `fnv1a32Hex(stableStringify(...))`
   (`specHash.ts`) over the caption clips (`captionClips(tracks, clips)`), sorted by track order then
   `timelineStartUs`. Each entry is `[assetId, trackId, timelineStartUs, sourceStartUs, sourceEndUs, speed ??
   null]`. Only video clips count: moving a text overlay or an audio clip doesn't invalidate the link.
3. **Planner** (`textPlusPlan.ts`):
   - Replace the `.filter((cue) => cue.mediaAssetId === link.proxyAssetId)` source-time path with
     `cuesInSequence(displayedCues(project.cues, project.shownTranslation), captionClips(project.tracks,
     project.clips))`. That gives sequence-time cues; the second and later runs have ids `${cue.id}:${n}`.
   - Frame mapping stays `usToTimelineFrame(sequenceUs, link)`.
   - `draftsForCue` word splitting works unchanged, because `cuesInSequence` also maps `words`.
   - Style lookup (`resolveCaptionStyle`) needs the **original** cue, whose id has no `:n` suffix. Map back by
     id prefix before resolving the style.
   - The spec `key` stays the (render) cue id, so existing proxy-linked `synced` entries keep matching.
   - Update the doc comment on `usToTimelineFrame` (its input is now "sequence µs, the offset from the Resolve
     timeline's start").
4. **Proxy parity:** a proxy link's project has the proxy clip at sequence 0 with source = sequence. Check by
   reading the code that sequence times equal the old source times there, so already-synced proxy projects see
   **no** pending changes after this brief. If the user had trimmed the proxy clip, the signature check
   (step 5) blocks sync instead.
5. **Sync gating** (`ResolveSync.tsx`):
   - Add the disabled reason "The video edit changed since this project was linked to DaVinci. Use Create in
     DaVinci to make a new timeline." when `editSignature(project) !== link.editSignature`. Memoise the
     signature on `project.clips`/`project.tracks`.
   - The "proxy video was removed" reason applies only to `origin === 'proxy'`.
   - Until brief 12 exists, the message's second sentence is omitted. Don't mention a button that isn't there.
6. **Brief 04 path** (`createFromResolve` in `App.tsx`): write `origin: 'proxy'` and `editSignature` computed
   **after** the proxy clip is placed.
7. Update `docs/STATUS.md`; commit only this brief's files: `Map Resolve captions by sequence time (link v26)`.

## Out of scope
The import and push features themselves (11, 12). Changing cuts in an existing Resolve timeline. Emphasis and
animations (07).

## Done checklist
- [ ] `npx tsc --noEmit -p .` passes. Fix existing tests only if the typecheck breaks, and only minimally.
- [ ] A v25 project with a `resolveLink` opens as v26 with `origin: 'proxy'` and no pending changes.
- [ ] Cues are placed by sequence time. A cue spanning a non-contiguous cut produces one spec per run.
- [ ] `docs/STATUS.md` entry, "not tested, typecheck only". Offer a unit test for `editSignature` and the planner
      mapping.

## Manual check for the user
1. Open a project already synced with brief 06. The badge still says **Synced**.
2. Trim or move the video clip in KathaCut. Sync is disabled with the new reason. Undo re-enables it.
