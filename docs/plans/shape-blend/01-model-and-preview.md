# 01: Shape blend: schema 19, command, Layers panel, preview

## Goal
Shapes get an optional `blendMode`. The Layers panel Blend select is enabled for shapes and the live
preview blends them. Export is not built yet, so it must **refuse** a project with a blending shape (brief
02 removes the refusal). After this brief nothing pretends to work in export.

## Constraints that matter here
- Schema 19 so older builds refuse new files. v17 and v18 files must stay strict: they must not accept a
  shape `blendMode`. `projectSchemaV17` reuses the live `shapeSchema` (model.ts ~883) and v18 spreads v17
  (~908), so split out a shape schema without `blendMode` for them, as v18 did for clip `blendMode`.
- `normal` is never stored (strip it) so untouched projects stay byte-identical.
- At most `MAX_BLENDING_SHAPES = 8` blending shapes per project (export cost grows with each). Enforce it
  in the command and in duplicate.
- Do not let a control claim to work when export refuses it: the export refusal below must be a clear
  user-facing message, not a crash.

## Read only
- `src/core/layerLookCommands.ts` (whole, short), `src/core/layerStack.ts` (~40-100), `src/LayersPanel.tsx` (~55-75)
- `src/core/edit.ts` ~163-170 (`BLEND_MODES`, clip `blendMode`), ~369-387 (`shapeSchema`)
- `src/core/model.ts` ~880-915 (V17/V18) and ~1070-1130 (migration chain, version checks)
- `src/core/migrateV17.ts` (pattern to copy)
- `src/core/editCommandSchema.ts` ~230-255 (`shapeChanges`, `layerLookSet`)
- `src/core/shapeCommands.ts` (`shape-duplicate`, ~88 `shape-update`)
- `src/captions/ShapeActor.tsx` (~55-100), `src/captions/CompositionLayers.tsx` ~48-49 (`blendStyle`)
- `src/export/plan.ts` (manifest build, near 498-500 where `null` is returned for unsupported cases)
- `grep -rn "Only picture clips have a blend mode\|no blend mode" src electron docs` for wording to update

## Steps
1. `edit.ts`: add `blendMode: z.enum(BLEND_MODES).optional()` to `shapeSchema`. In `model.ts` define a
   `shapeSchemaV18` (current shape without `blendMode`) and use it in `projectSchemaV17`/`V18`; new
   `projectSchema` has `schemaVersion: z.literal(19)`. Add `src/core/migrateV18.ts` (version-only bump,
   copy `migrateV17.ts`) and wire `toV19FromV18`. Update the version constant, writer, fixtures, tests.
2. New `src/core/graphicsPasses.ts` exporting `MAX_BLENDING_SHAPES = 8` and
   `blendingShapes(shapes)` (shapes with `blendMode` set). Brief 02 extends this file.
3. `layerLookCommands.ts` line ~25: allow `blendMode` when `target.kind` is `clip` or `shape`; keep the
   failure for other kinds ("Only picture clips and shapes have a blend mode."). Shape branch applies it
   through the existing `withOptional(..., blendMode === null || blendMode === 'normal')`. Fail with a
   `value-range` step when setting a mode would make a 9th blending shape. `shape-duplicate` of a blending
   shape past the cap drops `blendMode` on the copy.
4. `layerStack.ts:57`: shape row `blendMode: item.blendMode ?? 'normal'`. `LayersPanel.tsx:64` then
   enables automatically; update the row suffix logic only if needed (it already prints non-normal modes).
5. `ShapeActor.tsx`: spread `blendStyle(shape.blendMode)` onto the **outermost** element: the
   `data-shape-mask` div when the shape is masked (~95-97), otherwise the `data-shape-id` div (~60-66).
   Add a prop `blend?: boolean` (default true); when false, skip it. Brief 02 passes false for export passes.
6. Temporary export guard in `plan.ts`: building the manifest for a project with any blending shape throws
   / returns the existing "cannot export" error path with the message "Exporting shapes with a blend mode
   is not supported yet." Find how the Export dialog surfaces existing manifest errors and reuse it.
7. Update the "only picture clips have a blend mode" wording in `docs/MCP.md`, `electron/mcp/tools.ts`,
   `src/core/agentProtocol.ts`, and `docs/EDITING.md` "Layer opacity and blend" (mark shape export as
   pending).

## Out of scope
Any export change beyond the guard (brief 02). Text and caption blend (not requested).

## Tests / verify
- Migration 18 -> 19 round trip; v18 file with a shape `blendMode` is rejected.
- `layer-look-set`: blend on a shape applies + undoes; `normal`/null strips the field; blend on text and
  caption tracks still fails; the 9th blending shape fails; duplicate past the cap drops it.
- `layerStackAt` shape row reports the mode. Update `LayersPanel.test.tsx`, `editCommandSchema.test.ts`,
  `agentProtocol.test.ts`, `layerStack.test.ts`.
- Guard test in `plan.test.ts`.
- `npx vitest run src electron workers` then `npm run typecheck`. Record baseline failures first (see
  docs/STATUS.md and run the suite on a clean stash of your changes if unsure).
- Manual (`npm run dev`, Electron): add a Box over a video, set Multiply in Layers: the video under the box
  darkens; a title below it darkens too; a title above it does not. Try Export: it refuses with the message.

## Done when
- [ ] Tests + typecheck pass (baseline failures noted, none new)
- [ ] `docs/STATUS.md` entry (changes, verification, limitation: export refuses blending shapes; next = 02)
- [ ] Committed. Stop.
