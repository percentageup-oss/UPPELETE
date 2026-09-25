# 01: Per-corner radii on box shapes (schema 20)

## Goal
A rect shape can have four independent corner radii (TL, TR, BR, BL) in addition to today's single
`cornerRadius`. Preview and export match (they share the SVG painter, so export needs no new code).

Project rules: see the "Rules every brief carries" section in `README.md` (schema bump + migration, K = 1
byte-identical, no tests, STATUS entry, commit only your files).

## Findings
- Rect geometry: `src/core/edit.ts:354` (`cornerRadius` 0..20000, `rotation`). `rectPath` `src/core/shapePath.ts:9-16` builds the path with one radius clamped to half the box.
- Painter: `src/captions/ShapeActor.tsx` uses `shapePathD` only, so a new path is automatic.
- `src/ShapeInspector.tsx` (Fill section ~61-68) has NO corner control for shapes. Stage editor: `RectStageEditor` (`src/RectStageEditor.tsx`, used at `src/App.tsx:2083`).
- Schema/migrations: `src/core/model.ts:916-926` (v19), chain `model.ts:1079-1102`, pattern `src/core/migrateV18.ts`; `shapeChanges` `src/core/editCommandSchema.ts:230-243`; MCP `electron/mcp/tools.ts:150-169`, `src/core/creativeOptions.ts:48`, `docs/MCP.md`.
- `defaultShape` box: `src/core/shapeCommands.ts:32` (cornerRadius 12).

## Design
Add optional `cornerRadii: { tl, tr, br, bl }` (each 0..20000) to the rect geometry only. `cornerRadius` stays the master value (used when `cornerRadii` is absent). When set, `cornerRadii` wins and `cornerRadius` is kept equal to the rounded mean so old readers degrade sensibly. Never store `cornerRadii` when all four are equal: strip it and set `cornerRadius`. `rectPath` uses CSS overlap rules: f = min(1, w/(tl+tr), w/(bl+br), h/(tl+bl), h/(tr+br)); scale all four by f. Extract a pure `resolveCornerRadii(geometry)` in `shapePath.ts` for the painter, the inspector and glass (brief 03) to share.

## Steps
1. `edit.ts`: `cornerRadii` optional on rect. Schema 20: `shapeGeometrySchemaV19` (rect without it) keeps v17-v19 files strict; `migrateV19.ts` (version bump only); wire chain, version constant, fixtures.
2. `shapePath.ts`: `resolveCornerRadii`, per-corner circular arcs in `rectPath`. Output byte-identical when uniform.
3. `shapeCommands.ts` / `editCommandSchema.ts`: `shape-update` geometry accepts `cornerRadii`; normalise (equal -> master, strip).
4. `ShapeInspector.tsx`: "Corners" section for rect shapes: master slider, a link toggle (linked = edit master; unlinked = four numeric fields TL/TR/BR/BL with small corner glyphs). Use the existing `Slide`/`Row` components.
5. `RectStageEditor`: per-corner handles only if it is a small change; otherwise skip and note it in STATUS.
6. MCP/docs: document `cornerRadii` in `creativeOptions.ts`, `docs/MCP.md`, `docs/EDITING.md` Shapes section.

## Out of scope
Ellipse/path/highlight corners, glass, groups, templates.


## Done when
- [ ] `npx tsc --noEmit -p .` clean
- [ ] STATUS.md entry (say plainly: not tested, typecheck only; next = 02)
- [ ] Commit only this slice's files. Stop.
