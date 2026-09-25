# 03: Glass shapes: schema, map generator, preview, inspector

## Goal
Shapes get an optional `glass` look. The live preview shows real frosted, saturated, refracting glass with
a rim highlight and shadow. Export is not built yet, so it must **refuse** a project with a glass shape
with a clear message (brief 04 removes the refusal).

Project rules: see `README.md` "Rules every brief carries". Read `docs/STATUS.md` brief 02 entry first: it
fixes the formulas (blur sigma scaling, saturation matrix, displacement mapping, map encoding). Use them
verbatim. If it recommended dropping refraction, follow that.

## Findings
- Shape schema `src/core/edit.ts:369-397` (`shapeFieldsV18`, `shapeSchemaV18`, `shapeSchema` with `blendMode`). Current schema 20 after brief 01 (chain `src/core/model.ts:1079-1102`, pattern `migrateV18.ts`).
- Painter `src/captions/ShapeActor.tsx` (103 lines): wrapper div carries opacity + motion transform (63-68); an ancestor opacity/mask/transform breaks `backdrop-filter`, so the glass layer must be a sibling painted outside those (see `src/captions/maskStyle.ts:12-13`). Mounted in `src/App.tsx:2394-2435` below/above the caption by `compareLayered`.
- Motion frame `src/captions/shapeMotion.ts` (`shapeFrameAt`: x, y, scale, opacity, draw, sweep, grow).
- Commands `src/core/shapeCommands.ts` (`shape-add` 60, duplicate 70), blend cap `src/core/graphicsPasses.ts` (`MAX_BLENDING_SHAPES = 8`), layer look `src/core/layerLookCommands.ts`.
- Inspector `src/ShapeInspector.tsx` (Section/Row/Slide/HexColorField helpers; Fill section ~61-68).
- Frame reuse signature includes shape motion: `src/core/layerPlan.ts:155-156` (glass params must join it in brief 04).
- Existing blur analogue: `blurRegion` in `edit.ts:405`, preview `src/captions/CompositionLayers.tsx:184-186`.

## Design
`glass` (optional, absent = not glass): `{ blur: 0..60 (comp units, sigma), saturation: 0.5..3, refraction: 0..40 (max px shift), bezel: 2..80 (rim band width), tintOpacity: 0..1 (uses fill colour), rim: 0..1 (rim light), specular: 0..1, shadow: { blur 0..60, offsetY -40..40, opacity 0..1 } }`. Valid only on closed geometries: rect, ellipse, highlight, closed path (and `bubble` from brief 08). Commands reject glass with a `mask`, a `blendMode`, or an enter animation of `draw` (`draw` traces a stroke: not meaningful), and glass counts toward one shared cap (rename `MAX_BLENDING_SHAPES` -> keep the export name but add `MAX_PASS_SHAPES = 8` covering blend + glass shapes; keep the existing blend error wording for blend).
`src/core/glassMap.ts` (pure, deterministic): given the closed silhouette (from `shapePathD`/`resolveCornerRadii`), bezel and refraction, produce a displacement field (Euclidean distance to the edge; convex squircle profile inside the bezel; zero in the interior; direction = inward normal) as a Float32 grid at composition resolution/scale, plus an 8-bit RGB encoding exactly as brief 02 defined. Rasterise the silhouette with an offscreen canvas in the browser context; keep the maths (distance transform, profile, encode) in pure functions.

## Steps
1. Schema 21: `glassSchema` in `edit.ts` (optional on shape, `.superRefine` closed-geometry rule); `shapeSchemaV20` (without glass) keeps v17-v20 strict; `migrateV20.ts`; wire chain/version/fixtures. Strip defaults; never store `glass` absent-equivalents.
2. `src/core/glassMap.ts`.
3. `ShapeActor.tsx`: glass branch. Render, in order: (a) a sibling element at the shape box (translated/scaled by the same `frame` motion, but with the shape opacity applied through the filter/colour, NOT via ancestor `opacity`) with `clip-path` from the silhouette and `backdrop-filter: blur() saturate() url(#glass-id)` where the SVG filter is `feImage` (map data URL) + `feDisplacementMap`; (b) the SVG surface: tint fill, rim-light gradient stroke (bright top-left, dim bottom-right), specular arc highlight, inner glow, and a drop shadow clipped OUTSIDE the silhouette. Provide a `glass?: boolean` prop (default true) so the export host can paint the surface only (brief 04).
4. Commands + `editCommandSchema.ts`: `shape-update` accepts `glass` (null clears); rejections above return `value-range`/`unsupported` style failures like existing ones in `layerLookCommands.ts`.
5. `ShapeInspector.tsx`: "Glass" section (toggle + sliders for each field + "Liquid Glass" quick preset: blur 14, saturation 1.6, refraction 14, bezel 22, tint 0.10, rim 0.6, specular 0.5, shadow 24/12/0.25). Disable with a tooltip when the geometry is not closed, or the shape has a mask/blend.
6. `plan.ts` (`buildExportManifest`): throw `Exporting glass shapes is not supported yet.` when any shape has `glass`, like the shape-blend brief 01 guard (see `blendingShapes` guard history in STATUS 2026-09-25).
7. Add `glass` to `defaultShape` NOTHING (opt-in only). Add a "Glass panel" preset tile later in brief 10; here just the inspector toggle.
8. Docs: `docs/EDITING.md` Shapes gets a "Glass (preview only until brief 04)" note; `docs/MCP.md` + `creativeOptions.ts` list `glass`.

## Out of scope
Any export change beyond the guard. Groups, templates, `bubble`.


## Done when
- [ ] `npx tsc --noEmit -p .` clean
- [ ] STATUS.md entry (say plainly: not tested, typecheck only; next = 04)
- [ ] Commit only this slice's files. Stop.
