# 03: Shape blend: parity stage, a real export, docs

## Goal
Prove preview and export agree for blending shapes, run a real export, record the cost, and document it.
Read `docs/STATUS.md` first: briefs 01 and 02 log what shipped and any limitations there.

## Constraints that matter here
- Report only platforms actually tested (Windows here). This machine may have no H.264 encoder (see
  the shapes parity note in `docs/EDITING.md`); if so say so and use whatever encoder the export uses,
  do not claim an untested one.
- Evidence files go in `docs/decisions/evidence/`; no media or exports committed.

## Read only
- `scripts/export-parity.mjs`: `shapeLayerParity` (~287-330), `layerBlendParity` (~649-732), stage wiring
  (~33-35, ~745, ~800-820); `scripts/blend-parity-harness.tsx`; `scripts/export-parity-helpers.ts`
- `src/core/graphicsPasses.ts`, `workers/media/exportArguments.ts` (K > 1 branch from brief 02)
- `docs/EDITING.md` "Shapes (schema 17)" and "Layer opacity and blend" sections; `docs/ARCHITECTURE.md` export host paragraph

## Steps
1. Add a `--only shape-blend` stage to `export-parity.mjs`. Scene at 540x540: smptebars picture; a title
   below (layerOrder < 0); a Multiply box and a Screen highlighter above the title. Preview side: the
   preview window with CSS blend. Export side: the real passes through the offscreen host and
   `exportFilterGraphV3` (output swapped to rgb24 like `layerBlendParity`). Compare per channel:
   tolerance 3/255 on flat regions; report max and mean; also assert the blend visibly differs from
   Normal (as `shapes` does with its >2000-byte check). Evidence to
   `docs/decisions/evidence/x3-parity-shape-blend-<date>.json` (single-stage runs already get their own name).
2. Real export of a short project with two blending shapes (raw and PNG transport if both available).
   Verify the encoded frame count equals `exportFrameCountFor(...)`. Time it with and without the blending
   shapes and record both numbers.
3. Docs: `docs/EDITING.md` (shape blend semantics, the pass model, the 8-shape cap, the export cost,
   remove "shapes have no blend mode" wording); `docs/ARCHITECTURE.md` export host/pass paragraph;
   `docs/ROADMAP.md` only if it lists this; `docs/STATUS.md` with platforms actually tested.

## Out of scope
New features. If parity fails, record the numbers and the cause in STATUS.md and fix only obvious bugs
in the brief 01/02 code; anything larger becomes a follow-up note.

## Tests / verify
- `npm run parity:export -- --only shape-blend`, then `--only shapes` and `--only layer-blend` (unchanged).
- `npx vitest run src electron workers`, `npm run typecheck`.

## Done when
- [ ] Parity stage passes (or the failure is documented with numbers)
- [ ] Real export result and timings in `docs/STATUS.md`, platforms stated honestly
- [ ] Docs updated, committed. Stop.
