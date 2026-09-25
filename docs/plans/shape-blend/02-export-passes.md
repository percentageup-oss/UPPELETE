# 02: Shape blend: export passes end to end

## Goal
Remove brief 01's export refusal. Exporting a project with blending shapes produces the same picture as
the preview: each blending shape blends with everything beneath it in layer order. A project with no
blending shapes must produce **byte-identical** FFmpeg arguments and the same host requests as before.

## Design (decided; do not re-litigate)
Today the export host paints ALL host-painted content (pinned overlays/effects, graphics below captions,
the caption plane, graphics above, fade) onto one transparent frame; FFmpeg overlays it on the picture
(`captionLayerLabel` + `overlay` at `exportArguments.ts` ~574 flat / ~619 stacked). A transparent layer
cannot blend, so split it into K = 2k+1 passes for k blending shapes (k <= `MAX_BLENDING_SHAPES` = 8):
even passes are normal bands composited with `overlay`, odd passes are exactly one blending shape each,
composited with the existing `blendChains` (`exportArguments.ts:269`, `BLEND_FFMPEG` 257). Order comes
from `compareLayered` (`src/core/graphicsOrder.ts`) and `belowCaptions`, the same order
`src/export/frameHarness.tsx:52-73` uses. Pinned layers always land in band 0, fade in the last band; the
caption plane sits in the band at the `belowCaptions` boundary.
Each output frame sends K sub-frames in pass order on the same pipe at `-framerate rate*K`; FFmpeg
`select`s them apart. Output frames, `-frames:v`, progress and ETA stay in output frames (1:1 with
`exportFrameCountFor`, `plan.ts:244`). Empty passes are never rendered: reuse a cached blank frame.

## Constraints that matter here
- K = 1 must not change one byte of existing output/args (existing snapshot tests must pass untouched).
- Never block the UI thread; export stays in the worker + hosts. Spawn with argument arrays.
- Preview and export share `ShapeActor`; blend passes paint the shape with `blend={false}` (FFmpeg
  blends it), never with CSS blend on the transparent layer.
- Do not add fake progress; keep ETA/progress semantics in output frames.

## Read only
- `src/core/graphicsPasses.ts`, `src/core/graphicsOrder.ts` (whole)
- `src/export/frameHarness.tsx` (whole), `src/export/frameRequest.ts` ~55-75
- `src/export/plan.ts` ~355-385 (`frameRequestAtSequence`), ~440-460, 605-700 (manifest)
- `src/core/layerPlan.ts` ~100-183
- `workers/media/export.ts` ~130-356 (`renderVideo`), 413-461 (`prepareV3`); `workers/media/exportProcesses.ts` ~36-107
- `workers/media/exportArguments.ts` ~252-280 (`BLEND_FFMPEG`, `blendChains`), ~552-670
- `workers/media/exportTransport.ts` (whole), `workers/media/blend.test.ts`
- `scripts/export-host.mjs` (whole; note the raw transport ships the bitmap as-is)

## Steps
1. `graphicsPasses.ts`: `graphicsPasses(shapes)` returns `{ count: K, blendShapes: Shape[] }` sorted by
   `compareLayered`; `passOf(entry, passes)` maps pinned layers -> 0, a graphic/caption/fade to its band.
   Pure and unit-tested for every ordering (blend shape below captions, above captions, two adjacent
   blend shapes, blend shape with layerOrder ties).
2. `frameRequest.ts` v4: optional `hideCaption: true` (a pass without the caption plane) and an optional
   `pass` field only if the harness needs it. Harness (`frameHarness.tsx`): render only the entries of
   the requested pass; blend-shape pass paints its shape with `blend={false}`. Check what `CaptionPreview`
   needs to render an empty plane (`hideCaption`). Optional fields only, so old requests still parse.
3. `plan.ts`: `frameRequestAtSequence(manifest, index, active, pass?)` filters actors/overlays/effects to
   the pass. Remove brief 01's guard. Manifest carries blend shapes (schema already allows `blendMode` on
   `manifest.shapes`; confirm the manifest schema uses `shapeSchema`).
4. `layerPlan.ts`: compute per-pass signatures and an `empty` flag per pass; expose
   `passSignatures(index)`. Existing single `signature` stays for K = 1.
5. `workers/media/export.ts`: when K > 1 the unit of work is (index, pass); write K buffers per output
   frame in pass order; keep `previous`/`gap` reuse caches per pass; an empty pass writes the cached blank
   buffer (zeros for raw transport; for PNG render one empty request once). Frame loop bounds, `total`,
   stall messages, progress and ETA stay in output frames.
6. `exportArguments.ts`: when K > 1: pipe `-framerate` = rate*K (keep it a rational string), then
   `split=K`, per pass `select='eq(mod(n\,K)\,p)',setpts=N/(rate)/TB`, apply `captionLayerLabel` once
   before the split, then composite in order after `pictureEffectChain`: `overlay=0:0:alpha=straight`
   for even passes, `blendChains(previous, passLabel, mode, uniqueIndex, chains)` for odd ones; keep
   `eof_action=endall:shortest=1,format=yuv420p[outv]` at the end. Both routes (flat 574, stacked 619).
   `blendChains` label indexes must not collide with clip blend indexes.

## Out of scope
The `--only shape-blend` parity stage and docs (brief 03). Text/caption blend. Any change to picture-clip blend.

## Tests / verify
- Unit: pass model orderings; K = 1 graph string unchanged (existing snapshots untouched); K = 3 graph
  string; request filtering per pass; per-pass layer-plan signatures; worker loop with a fake host (K
  writes per frame in order, blank reuse, frame count unchanged).
- Real FFmpeg (extend `workers/media/blend.test.ts`): pipe 2 output frames x 3 raw passes (normal band with
  a colour square, blend-shape pass, empty band) over a solid picture; check pixels against the W3C
  formulas (+-2/255) and that exactly 2 frames are produced.
- `npx vitest run src electron workers`, `npm run typecheck`, and the existing `npm run parity:export --
  --only shapes` and `--only layer-blend` stages still pass.

## Done when
- [ ] Tests + typecheck pass (baseline failures noted, none new)
- [ ] `docs/STATUS.md` entry (changes, verification, limitations: what was and was not exercised; next = 03)
- [ ] Committed. Stop.
