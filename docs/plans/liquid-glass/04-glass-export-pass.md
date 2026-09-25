# 04: Glass shapes: export passes end to end

## Goal
Remove brief 03's refusal. A project with glass shapes exports the same picture as the preview: the video
(and anything below) is blurred, saturated and refracted under each glass shape. With no glass and no
blending shapes, FFmpeg args and host requests stay **byte-identical**.

Project rules: `README.md` "Rules every brief carries". Read `docs/STATUS.md` entries for briefs 02 and 03 and
the earlier "Shape blend 02/03" entries first; use brief 02's measured formulas verbatim.

## Findings (shape-blend export pass model this builds on)
- `src/core/graphicsPasses.ts`: `graphicsPasses(shapes)` -> `{ count: 2k+1, blendShapes }`, `passOf(entry, passes)`, `MAX_BLENDING_SHAPES`.
- `workers/media/exportArguments.ts`: `blurPictureChain` 62-80, `maskAlphaChain` 89-97, `blendChains` 270-278, `compositeGraphicsPasses` 290-316 (split=K, `select='eq(mod(n\,K)\,p)'`, even passes overlay, odd passes blend), `captionPipeRate` 319-323.
- `workers/media/export.ts`: `renderVideo` K > 1 branch (per-band `previous` cache, blank buffer for empty bands, all K written per output frame); `PreparedExport.passCount`.
- `src/export/plan.ts`: `frameRequestAtSequence(manifest, index, active, pass)`, `blankFrameRequest`; `src/core/layerPlan.ts`: `passSignatures`; `src/export/frameRequest.ts` (`hideCaption`); `src/export/frameHarness.tsx:52-75`.
- Transport: use PNG for pass sub-frames that must be opaque and exact; raw transport has the documented un-premultiply bug (STATUS 2026-09-25).

## Design
Generalise passes to `{ kind: 'blend' | 'glass', shape }` odd bands, sorted by `compareLayered`, K = 2k+1 for k pass shapes (blend + glass, cap `MAX_PASS_SHAPES = 8`). A glass shape uses ONE odd band = the *map sub-frame*: the host paints an OPAQUE frame (background rgb(128,128,0); R/G displacement; B coverage x shape opacity x motion opacity, from `glassMap.ts`; the map follows the shape motion transform for that frame). The glass *surface* (tint, rim, specular, shadow) is a normal graphic painted in the NEXT even band (`passOf` places it right after the map, so the surface lands on top of the glassed picture). FFmpeg glass chain for band p with shape bbox B (lifetime union bbox + margin = 3 sigma + refraction, clamped to frame):
`previous` -> `split` -> crop B with margin -> `gblur` (sigma per brief 02) -> `colorchannelmixer` saturation matrix -> `displace` with x/y maps from the map sub-frame (`extractplanes`) -> re-crop to B -> `alphamerge` with the B-channel coverage -> `overlay` onto `previous`, `enable` between shape start/end. Keep label indexes clear of blend/clip ones (offset like `GRAPHICS_BLEND_LABEL_OFFSET`). Both routes (flat and stacked) already share `compositeGraphicsPasses`.
Map must be regenerated only when it changes: put glass shape id + resolved motion (x, y, scale, opacity) into that band's `passSignatures` entry; a static glass shape reuses the previous buffer.

## Steps
1. `graphicsPasses.ts`: pass entries carry kind; `passOf` for surface vs map bands; helpers `glassShapes`, `MAX_PASS_SHAPES`.
2. `frameRequest.ts`/`plan.ts`: a request kind for the map pass (`mapShapeId` or the existing `pass` index is enough if the harness can derive it); remove the brief-03 guard.
3. `frameHarness.tsx`: map pass paints only the opaque map for its shape (use `glassMap.ts`, one shared code path with preview); surface pass paints `ShapeActor` with `glass={false}` (surface only).
4. `layerPlan.ts`: signatures/empty flags for glass bands.
5. `export.ts`: worker loop treats map bands like blend bands (K > 1 branch); the map band is never `empty` while the shape is visible; PNG only for map sub-frames (force PNG transport when any glass shape exists, or write the map band via PNG and others via raw only if the transport supports mixing; simplest: disable raw transport when glass is present and say so).
6. `exportArguments.ts`: glass chain in `compositeGraphicsPasses`; K = 1 untouched.
7. Docs (folded in from the old brief 05): `docs/EDITING.md` "Glass" (fields, limits: closed geometry, no mask/blend/draw, cap 8 shared with blend, PNG transport forced, preview/export not pixel-compared); `docs/ARCHITECTURE.md` glass pass paragraph next to "Shape blend passes"; `docs/MCP.md`.

## Out of scope
Parity stages, export smoke runs, groups/templates.


## Done when
- [ ] `npx tsc --noEmit -p .` clean
- [ ] STATUS.md entry (say plainly: not tested, typecheck only; next = 06)
- [ ] Commit only this slice's files. Stop.
