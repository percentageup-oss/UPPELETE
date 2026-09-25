# 09: Overlay templates: chat and callouts, plus the Templates UI

## Goal
The Overlays panel gets a "Templates" section with category tabs and thumbnails. This brief ships the
Chat & messaging and Callouts & speech families. Each template inserts as one group at the playhead in a
single undo step, with editable text and colours.

Project rules: `README.md` "Rules every brief carries". Read STATUS.md briefs 06-08 first (groups, `bubble`, `fitShapeToText`, `template-insert`, `overlayTemplates.ts` registry).

## Findings
- Panel: `src/OverlaysPanel.tsx` (56 lines; Shapes tiles from `SHAPE_TILES`, thumbnails `SHAPE_PREVIEWS` in `src/ShapeIcons`). `onAddShape` is wired in `src/App.tsx` (search `onAddShape`).
- Shape building blocks: `defaultShape`, colours, `draw()`/`fade` animations `src/core/shapeCommands.ts:20-45`; text: `defaultTextOverlay`/`PLAIN_TEXT_STYLE` `src/core/textCommands.ts:22`; caption template style helpers `src/captions/templates.ts` (`make`, `titleTreatment`; fonts resolve locally with Malayalam fallbacks: keep `Anek Malayalam` in the fallback stack).
- Glass options exist after brief 03/04: variants may set `glass` on the bubble.

## Templates (each is a pure builder; sequence-timed 4 s default, enter `pop`/`slide`, exit `fade`)
Chat & messaging:
1. iMessage sent (blue #0A84FF bubble, white text, tail bottom-right)
2. iMessage received (grey #E9E9EB bubble, black text, tail bottom-left)
3. WhatsApp bubble (green #D9FDD3 with small timestamp text + double tick glyph shapes)
4. Typing indicator (grey pill with 3 dots; dots pop in staggered by 150 ms using per-shape `pop` enter delays via `startUs` offsets)
5. Chat thread (3 bubbles alternating, staggered 600 ms)
6. DM notification banner (rounded rect, avatar circle, name + message titles)
Callouts & speech:
7. Speech bubble (white, dark text, tail)
8. Thought bubble (ellipse + two shrinking circles)
9. Callout box with pointer line (rect + line with dot arrowhead)
10. Quote card (large opening quote glyph shape/text, body + attribution)
11. Sticky note (yellow, slight -3 degree rotation, folded-corner path)

Malayalam: sample text uses the user text; default sample copy is English; ensure bubbles refit for Malayalam via the shared measurer (brief 08).

## Steps
1. `src/core/overlayTemplates.ts`: builder signature `(ctx: { ids, startUs, endUs, center, compositionHeight, measure, text? }) => { group, shapes, textOverlays }`; register the 11 templates with `{ id, category, name, description }`. Colours as constants; fonts use `Helvetica Neue`/`Arial` with Malayalam fallback like `templates.ts`.
2. Thumbnails: generate a static SVG thumbnail from the builder itself (render its shapes with `ShapeActor`/`shapePathD` at 1 time point, title text as plain SVG text) so every template gets an accurate tile with no hand-drawn icons to maintain.
3. `OverlaysPanel.tsx`: "Templates" section below Shapes: category tabs (Chat, Callouts; more in brief 10), a grid of thumbnail tiles, `title` tooltip, click inserts at the playhead via `template-insert`. Wire through `App.tsx` (measurement via the DOM measurer, ids, playhead).
4. Optional "Glass" toggle at the top of the section: when on, templates that support it get `glass` (only enabled if brief 04 shipped; check STATUS).
5. Docs: `docs/EDITING.md` "Overlay templates"; MCP: `list_creative_options` lists template ids; add an MCP tool or `edit` command doc for `template-insert`.

## Out of scope
Cards/labels (brief 10), user-saved templates, template import/export.


## Done when
- [ ] `npx tsc --noEmit -p .` clean
- [ ] STATUS.md entry (say plainly: not tested, typecheck only; next = 10)
- [ ] Commit only this slice's files. Stop.
