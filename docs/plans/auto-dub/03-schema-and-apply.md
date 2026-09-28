# 03: Schema 25 `dubRuns`, apply as one undo step

Read `README.md` in this folder first (design, findings, rules, typecheck-only override). Brief 02 must have
landed: check `docs/STATUS.md`, and that `src/core/dubIpc.ts` and `window` `generateDub` exist.

## Goal
Take a successful `dub:generate` outcome and put it into the project in **one undo step**:
- the dub asset
- a `Dub · <Language>` audio track
- one mirror audio clip per video clip of that asset
- the chosen treatment of the original audio (mute, duck or keep)
- a `dubRuns` provenance entry

A re-dub of the same (language, video) replaces the previous dub.

## Read only these files
- `src/core/model.ts`: `projectSchema`, the V23/V24 schema pattern, `toV24FromV23` (~1218), `loadProject`.
- `src/core/migrateV23.ts` (the most recent migration, to copy its shape).
- `src/core/edit.ts`: track schema (~94-108), audio clip schema (~192-198), video clip.
- `src/core/trackCommands.ts`, `src/core/clipCommands.ts`, `src/core/assetCommands.ts`,
  `src/core/clipLinks.ts`: the command shapes, `effectiveGain`, `linkId`.
- `src/core/captionLanguages.ts`: `applyTranslatedLayers`, the pattern for a pure apply.
- `src/core/translationLanguages.ts` (`translationTargetLabel`).
- `src/App.tsx`: only `commit` (~506), `runCommands` (~763-788), `addAssetsFromInspected` /
  `media.register` (search), and `applyTranslations` (search `applyTranslatedLayers`).

## Steps

### 1. Schema 25
- **Model.** Add `dubRunSchema` to `model.ts` as a `z.strictObject` with these fields:
  - `id`, `createdAt` (ISO)
  - `language`
  - `videoAssetId`, `dubAssetId`, `trackId`
  - `engine: 'gemini' | 'local'`, `model`, `voice`, `style?`
  - `maxTempo`
  - `lineCount`
  - `overflowCueIds: string[]` (≤5000)
  - `originalAudio: 'mute' | 'duck' | 'keep'`
  - `inputTokens?`, `outputTokens?`
- **Project schema.** Bump to version 25 with an optional `dubRuns: z.array(dubRunSchema).max(1000)`.
  - Follow the pattern: keep the V24 schema as `projectSchemaV24`, and have the new schema spread it.
  - Validate referential integrity in `superRefine`: `dubAssetId` must be an audio asset and
    `videoAssetId` a video asset. A stale `trackId` is a warning at most, **never** a load error.
- **Migration.** `src/core/migrateV24.ts` (24 to 25) is lossless: it only sets the version. Wire it as
  `toV25FromV24` and update `loadProject`. Record in STATUS that a migration round-trip test is advised.

### 2. Pure builder: `src/core/dubApply.ts`
```ts
export type DubApplyInput = {
  project: CaptionProject; videoAssetId: string; language: string; languageLabel: string
  dubAsset: ProjectAsset            // built from the InspectedFile (id from newId)
  originalAudio: 'mute' | 'duck' | 'keep'
  run: Omit<DubRun, 'id' | 'createdAt' | 'dubAssetId' | 'trackId' | 'videoAssetId' | 'language' | 'originalAudio'>
  newId: () => string
}
export function buildDubCommands(input): { commands: EditCommand[]; run: DubRun } | { error: string }
```
1. **Previous dub.** Find an existing `dubRuns` entry for the same (language, videoAssetId).
   - If there is one, add `clip-delete` for every clip whose `assetId` is its `dubAssetId`.
   - Then add `asset-remove` for that asset, unless another run still uses it.
   - Reuse its track when it still exists.
2. **Track.** If there is no track to reuse, `track-add` an audio track named `Dub · <languageLabel>` at the
   default audio index.
3. **Mirror clips.** For every **video** clip whose `assetId` is `videoAssetId`, sorted by
   `timelineStartUs`:
   - add `clip-add` of `{ kind: 'audio', assetId: dubAsset.id, trackId, timelineStartUs, sourceStartUs,
     sourceEndUs, speed (copied if present), gain: 1 }`
   - include the asset inline on the first `clip-add` (the command resolves inline assets and dedupes them
     by fingerprint)
   - two video clips of that asset can overlap in sequence time (the same video used twice, stacked). Put
     the overlapping ones on a second dub track (`Dub · <languageLabel> 2`) so nothing is overwritten.
   - check `clip-add`'s `mode` options and use the one that never cuts another clip.
4. **Original audio.** For every clip that carries the original video's sound:
   - That is, audio clips with `assetId === videoAssetId`, plus video clips of that asset when their audio
     isn't detached.
   - `mute` sets `gain: 0`, `duck` sets `gain: 0.25`, `keep` does nothing.
   - Apply it with `clip-update` using `unlinked: true`, so the linked video clip isn't changed with it.
5. **No video clips.** If the video has no clips on the timeline, return `{ error: 'Place this video on the
   timeline before dubbing it.' }`.

`dubRuns` isn't reachable through `EditCommand`. Pick one approach and note it in STATUS:
- **(a, preferred)** Add a small undoable command `dub-run-set { run }` (upsert by (language,
  videoAssetId)). Put it in `captionCommands.ts` or a new `dubCommands.ts`, with its zod entry in
  `editCommandSchema.ts`, so `runCommands` stays the single commit.
- **(b)** Apply the commands to a working copy with `applyEditCommand`, then set `dubRuns`, then call one
  `commit()`.

### 3. App wiring
Add `applyDub(outcome, options)` in `App.tsx`:
1. Register the asset URL with `media.register({ id, kind: 'audio', fingerprint }, file.url)`, as
   `addAssetsFromInspected` does.
2. Build the commands with `buildDubCommands`.
3. Run them with `runCommands(commands, 'Dub <Language>')`.
4. Show a notice: "Dubbed N lines (M from cache). K lines are longer than their caption." If anything failed,
   show the failure message.

Brief 04's dialog calls this function; export it through the same prop path `applyTranslations` uses.

## Out of scope
The dialog UI (04). Per-line ducking. Changing captions. Deleting the old dub WAV from disk: files are never
deleted automatically.

## Checks
- `npx tsc --noEmit -p .` passes. No tests (README override; the migration test is an opt-in).
- Confirm by reading that one Dub produces exactly one history entry, and that undo restores the original
  gains and removes the track, clips and asset.

## Done
- [ ] Schema 25, `dubRunSchema`, `migrateV24.ts`, `loadProject` updated.
- [ ] `dubApply.ts` (replace previous dub, mirror clips, overlap to a second track, mute/duck/keep).
- [ ] `dubRuns` persisted through one undo step (approach recorded).
- [ ] `applyDub` in App.
- [ ] Typecheck clean.
- [ ] `docs/STATUS.md` entry ("not tested, typecheck only"; migration round-trip test advised). Next: brief
      04. Commit.
