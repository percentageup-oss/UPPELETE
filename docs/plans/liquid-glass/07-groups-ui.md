# 07: Groups: selection, stage, timeline and Layers panel

## Goal
Users can select shapes and titles, group them (Ctrl+G), ungroup (Ctrl+Shift+G), and then drag, retime,
scale, duplicate or delete the group as one item, while still being able to edit any part.

Project rules: `README.md` "Rules every brief carries". Read STATUS.md brief 06 first (command names and semantics). Do the UI on top of those commands; add no new schema.

## Read first (locate by search; line numbers drift)
- `src/core/timelineItems.ts:33` (`Selection`), `src/core/history.ts`, keyboard shortcut handling and item dispatch in `src/App.tsx` (search `shape-delete`, `text-delete`, `onKeyDown`)
- Stage editing: `src/App.tsx:2069-2095` (`RectStageEditor` for shapes/zoom/blur, `LineStageEditor`), `src/RectStageEditor.tsx`
- Timeline: `src/Timeline.tsx`, `src/timeline/*` (lane rows for shapes/text; `packTextOverlays` in `src/core/textLayout.ts:4`)
- Layers panel: `src/LayersPanel.tsx`, `src/core/layerStack.ts` (rows are `layerStackAt`; shape row at line 57)
- Inspectors: `src/ShapeInspector.tsx`, the text inspector used for `text-update`

## Steps
1. `Selection`: add `{ kind: 'group', id }` and a `multi` selection of item ids only if selection is already multi; otherwise provide a marquee-free path: Ctrl/Shift-click on stage items or timeline clips adds to a temporary "pending group selection" state that the Group action reads. Clicking a grouped member selects the group; double-click (or Alt-click) selects the part.
2. Stage: group selection shows ONE `RectStageEditor` over the union bounding box (shape boxes + measured text boxes); drag = `group-translate`, resize handles = `group-scale`. Reuse the same drag-commit-on-release pattern as existing editors so undo is one step per gesture.
3. Timeline: grouped members show a shared accent colour/label and a group chip; dragging or trimming a member with the group selected issues `group-move`; dragging a member alone (Alt) moves just that member.
4. Layers panel: group row (name, expand/collapse, eye-free) containing member rows; a group row shows the shared time range; renaming via double-click (`group-rename`).
5. Inspector: group selection shows name, start/duration (moves the group), a "Ungroup" and "Duplicate" button; each member stays editable by selecting it from the Layers panel or by double-click on stage.
6. Actions: Ctrl+G, Ctrl+Shift+G, context-menu entries, Delete removes the group (`group-delete`).
7. Ensure exports are unaffected: groups are authoring-only, so `buildExportManifest` ignores them.

## Out of scope
Nested groups, group-level effects/opacity/animation, templates.


## Done when
- [ ] `npx tsc --noEmit -p .` clean
- [ ] STATUS.md entry (say plainly: not tested, typecheck only; next = 08)
- [ ] Commit only this slice's files. Stop.
