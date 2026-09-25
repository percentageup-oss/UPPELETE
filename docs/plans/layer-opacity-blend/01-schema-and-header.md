# 01: Schema 18 and the Layers header (opacity for clips and shapes)

## Goal
Add the data model for blend mode / text+caption opacity, a generic per-layer "look" command, and the
Opacity + Blend controls in the Layers tab header. After this brief: Opacity works live for video, image,
color clips and shapes (their renderers already honour it). The blend `<select>` renders but is disabled
everywhere (title "Coming in the next update"), and text/caption opacity is disabled until brief 02.

## Constraints that matter here
- Bump to schema 18 so older builds refuse new files. No data transform from 17 (all new fields optional).
- Absent = default. Never write `blendMode: 'normal'`; strip it so untouched projects stay byte-identical.
- One command = one undo step; slider drags draft live, commit once (same as mask sliders).
- Do not claim a control works when only one of preview/export honours it.

## Read only
- `src/LayersPanel.tsx` (whole), `src/core/layerStack.ts` (whole), `src/core/maskCommands.ts` (whole)
- `src/core/model.ts` lines ~838-905 (V15..V17 chain; copy the pattern for V18)
- `src/core/edit.ts` ~115-135 (captionTrackSchema), ~159-166 (visualFields), ~312-325 (textOverlaySchema)
- `src/core/editCommandSchema.ts` (search `mask-set`, `clipChanges`) and every other place `mask-set` is
  registered (`grep -rn "mask-set" src electron`): agent protocol, MCP tools, history.
- `src/App.tsx`: `maskDraft`/`maskDrafted`/`layerRows` (~198, ~334-337), `<LayersPanel` (~2024), stage props (~2044)
- `src/style/controls.tsx` (`Row`, `SliderWithNumber`), `src/styles.css` (search `layers-head`)

## Steps
1. `edit.ts`: `export const BLEND_MODES = ['normal','multiply','screen','overlay','darken','lighten','color-dodge','color-burn','hard-light','soft-light','difference','exclusion'] as const` and a `BlendMode` type. Add `blendMode: z.enum(BLEND_MODES).optional()` to `visualFields`; `opacity: z.number().finite().min(0).max(1).optional()` to `textOverlaySchema` and `captionTrackSchema` (absent = 1).
2. `model.ts`: rename the current `projectSchema` to `projectSchemaV17` (add its type export); the new `projectSchema` = V17 shape with `schemaVersion: z.literal(18)` and the same `superRefine` pattern as V15/V16. Update the current-version constant / migration entry wherever schema 17 is referenced (`grep -rn "17" src/core/migrate*.ts src/core/model.ts`), plus the writer, tests and fixtures.
3. Command `layer-look-set { target: MaskTarget; opacity?: number; blendMode?: BlendMode | null }` beside `mask-set` (in `maskCommands.ts` or a new `layerLookCommands.ts`). Per target kind: clip (opacity + blend), shape (opacity), text (opacity), captionTrack (opacity). Reject blend on non-clip targets, and any look on blur/effect, with a failure step like `failItem(...)`. Storing opacity 1 removes the field on text/caption; `blendMode: null` or 'normal' removes it. Register in `editCommandSchema.ts`, history, agent protocol and MCP tool schemas wherever `mask-set` is.
4. `layerStack.ts`: extend `LayerRow` with `opacity: number | null` and `blendMode: BlendMode | null` (null = unsupported). Clips report both (opacity default 1, blend default 'normal'); shapes/text/captions opacity only; effects/blur/fade neither.
5. `App.tsx`: `lookDraft { key, target, opacity? }` state mirroring `maskDraft`; apply via a `lookDrafted(items, kind)` next to `maskDrafted` in the stage props and to `layerRows`. Pass `onLookDraft`/`onLookCommit` to `LayersPanel`.
6. `LayersPanel.tsx`: under `layers-head` add a `layers-look` row: blend `<select>` (labels: Normal, Multiply, Screen, Overlay, Darken, Lighten, Color dodge, Color burn, Hard light, Soft light, Difference, Exclusion) + Opacity `SliderWithNumber` 0-100 %. Visible when a row is focused; unsupported controls disabled with a `title` reason. In this brief the blend select is disabled for all rows and text/caption opacity is disabled. Rows show a `· 60%` suffix in `layer-detail` when opacity is not 100 %. Add CSS.

## Out of scope
Any preview/export change for blend or text/caption opacity (briefs 02, 03).

## Tests / verify
- Migration 17 -> 18 round trip; the new schema rejects unknown blend names.
- `layer-look-set`: apply + undo per target kind; rejection cases; default values strip the field.
- `layerStackAt` reports opacity/blend per kind. Update `editCommandSchema` / `agentProtocol` tests.
- `npx vitest run src` then `npm run typecheck`. Note baseline failures from docs/STATUS.md.
- Manual (`npm run dev`): focus a video row, drag Opacity (live), release (one undo), Ctrl+Z; focus an effect row (controls disabled).

## Done when
- [ ] Tests + typecheck pass (baseline failures noted, none new)
- [ ] `docs/STATUS.md` entry (changes, verification, limitations: blend select disabled, next = 02/03)
- [ ] Committed. Stop.
