# 06: Groups: schema 22, model and commands

## Goal
Shapes and authored text overlays can belong to a **group**. Group commands move, retime, duplicate and
delete the parts together as ONE undo step. No UI yet (brief 07); after this the agent/MCP `edit` tool can
create and use groups.

Project rules: `README.md` "Rules every brief carries".

## Findings
- No grouping concept exists. Only `linkId` on video/audio clips (`src/core/edit.ts:185,197`, `src/core/clipLinks.ts`) is comparable: copy its style of link-aware commands.
- Items: shapes `Shape` (`src/core/edit.ts:369-397`), text overlays `textOverlaySchema` (`edit.ts:320-335`). Project arrays `textOverlays` (`src/core/model.ts:778`), `shapes` (`model.ts:921`); unique IDs across both are enforced in the v17+ project schema (`model.ts:879-926`, superRefine).
- Commands: `src/core/shapeCommands.ts` (`applyShapeCommand`), `src/core/textCommands.ts` (`applyTextCommand`, `TextCommand` union, `defaultTextOverlay`), shared helpers `src/core/itemStep.ts` (`failItem`, `replaceById`, `ItemStep` with `selection`). Text position is `style.appearance.horizontal/vertical` (0..1 of the frame; `src/captions/style.ts:39`); shape position is geometry coordinates in composition units (1080 wide, height = 1080 / aspect).
- Selection type: `src/core/timelineItems.ts:33` (`Selection`). Command dispatch/history: `src/core/history.ts`, `src/core/editCommandSchema.ts` (zod command schemas), `src/core/agentProtocol.ts`.
- Migration pattern: `src/core/migrateV18.ts`; chain `model.ts:1079-1102`.

## Design
- Schema 22: `groups: [{ id, name }]` (max 200) at project level; optional `groupId` on shapes and text overlays. A group with fewer than 2 members is deleted automatically by any command that leaves it so. Nested groups are out of scope. `groupId` must reference an existing group (project superRefine).
- `src/core/groupCommands.ts`: `group-create { groupId, name?, itemIds }` (items must exist, none already grouped, at least 2), `group-ungroup`, `group-rename`, `group-move { startUs }` (shifts all members by the same delta, clamped so no member leaves the sequence; time delta is applied to the earliest member's start), `group-translate { dx, dy }` (composition units; shapes offset geometry incl. line/path points and controls; text changes `horizontal/vertical` by dx/width, dy/height, clamped 0..1), `group-scale { factor, anchor }` (shapes scale geometry/stroke widths; text scales `fontSize` clamped 20..120 and positions about the anchor), `group-duplicate { groupId, idMap }` (new ids for group and members, offset in time like `shape-duplicate`, keeps relative layerOrder), `group-delete`.
- Existing single-item commands keep working on members. `shape-delete`/`text-delete` of a member auto-dissolves a group left with < 2. `shape-duplicate`/`text-duplicate` of a member does NOT join the group.
- Layer order inside a group is preserved (parts keep their own `layerOrder`); a group is not a paint layer.
- All ids come from the caller (like existing commands) so undo/redo replays deterministically.

## Steps
1. Schema 22 in `edit.ts`/`model.ts`: `groupSchema`, `groupId` optional on `shapeSchema` and `textOverlaySchema`; `groups` array default `[]`; keep `projectSchemaV21`/`shapeSchemaV21`/`textOverlaySchemaV21` strict for old versions; `migrateV21.ts`; wire everything, fixtures.
2. `groupCommands.ts` with `applyGroupCommand`; register in the edit dispatcher and `editCommandSchema.ts`; agent protocol summary (`src/core/agentProtocol.ts:157,180`) lists `groupId` per item and a `groups` list; MCP `docs/MCP.md`.
3. Shape/text delete + `groupId` cleanup in `shapeCommands.ts` / `textCommands.ts`.
4. Pure helper `groupMembers(project, groupId)` and `translateShapeGeometry(geometry, dx, dy)` / `scaleShapeGeometry(...)` in `src/core/shapePath.ts` (or a new `shapeTransform.ts`), covering `rect` (rotation about centre kept), `line`, `path` (points + in/out handles), `bubble` is added later.

## Out of scope
UI (07), nesting, templates, glass.


## Done when
- [ ] `npx tsc --noEmit -p .` clean
- [ ] STATUS.md entry (say plainly: not tested, typecheck only; next = 07)
- [ ] Commit only this slice's files. Stop.
