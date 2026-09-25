# 08: Bubble geometry, fit-to-text and template insertion

## Goal
The building blocks templates need: a parametric `bubble` shape (rounded rect + tail), a way to size a
shape to the text it holds, and one command that inserts a whole template (group + shapes + titles) as a
single undo step.

Project rules: `README.md` "Rules every brief carries". Read STATUS.md briefs 01 (per-corner radii, `resolveCornerRadii`) and 06/07 (groups) first.

## Findings
- Geometry union `shapeGeometrySchema` `src/core/edit.ts:353-360`; path building `src/core/shapePath.ts` (`shapePathD`, `shapeBox`, `shapeRotation`, `lineEnds`); painter `src/captions/ShapeActor.tsx` reads only these three plus `shapeBox`/`rotation`.
- Glass (brief 03) requires a closed silhouette: `bubble` must count as closed. Motion/stage editors treat `rect|ellipse|highlight` as box shapes (`src/App.tsx:2081-2088`); `bubble` must be added there as a box shape with a tail handle.
- Text: titles are `TextOverlay` with `style.appearance` (`src/captions/style.ts:32-71`: `fontSize` 20..120, `alignment`, `maxLines`, `padding`, `horizontal`, `vertical`, `backgroundEnabled`); layout/measurement lives in `src/captions/renderer.ts` (type `Size`) and `src/core/textLayout.ts`; the DOM measurer (`src/captions/` domMeasurer; its test file shows usage) does measurement. Malayalam shaping must be preserved: never measure by code units; use the existing measurer.
- `defaultTextOverlay` `src/core/textCommands.ts:22`; `defaultShape` `src/core/shapeCommands.ts:28`; id generation: see how App creates ids for `shape-add`.

## Steps
1. `bubble` geometry (schema bump to the next free number; strict old schemas): `{ kind: 'bubble', rect, cornerRadii? (reuse rect shape), tail: { side: 'left'|'right'|'top'|'bottom', offset: 0..1 along the side, width, length, curve: 0..1 }, rotation }`. `shapePathD` builds one closed path (rounded rect merged with a tail triangle/curved tail; corners next to the tail stay valid); `shapeBox` returns the rect; `shapeRotation` supports it. Add to `ShapeActor`, stage editor (box handles + a tail handle), inspector (Tail section), agent schema docs. Handle tail on each side, offset 0 and 1, tiny rects, huge radii.
2. Fit to text: `fitShapeToText(shape, text, style, measurer, paddings)` pure function in a new `src/core/fitToText.ts` returning the new rect (and tail offset kept), computed from measured text size + padding. Wrap width is a `maxWidth` input. Stored result only; never computed at render time.
3. `template-insert` command in `src/core/templateCommands.ts`: `{ type: 'template-insert', templateId, startUs, endUs, ids: {...}, at: { x, y } }` builds items via a template builder registry (`src/core/overlayTemplates.ts`, empty registry + one tiny sample template here), creates the group, adds shapes and text overlays, applies "fit" using data resolved by the caller (the UI measures, then passes measured sizes in the command so the command stays pure and replayable). Single history step; selection = the new group.
4. Editing a bubble title after insertion: when a text member of a group whose sibling shape is tagged `fitTo: <textId>` (optional stored field on the shape, `fitTo` + `fitPadding`) changes text, the UI recomputes the rect and issues ONE combined command. Keep this in the UI layer (measurement) and add a `shape-update`+`text-update` batch.

## Out of scope
Actual template catalogue (briefs 09, 10), glass variants, animations beyond existing shape/text ones.


## Done when
- [ ] `npx tsc --noEmit -p .` clean
- [ ] STATUS.md entry (say plainly: not tested, typecheck only; next = 09)
- [ ] Commit only this slice's files. Stop.
