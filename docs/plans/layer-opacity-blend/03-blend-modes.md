# 03: Blend modes on clips (preview + FFmpeg export)

## Goal
Blend modes for video / image / color clips, honoured identically by preview (CSS `mix-blend-mode`) and
export (FFmpeg `blend`). Enable the blend select in the Layers header for clip rows.

## Constraints that matter here
- A normal-only project's FFmpeg args must stay byte-for-byte unchanged (snapshots in `workers/media/__snapshots__`).
- FFmpeg operand order differs from W3C for some modes. Verify against real FFmpeg; drop modes that fail.
- Host-painted images sit on a transparent layer and cannot blend: an image with a non-normal blend must go through FFmpeg.

## Read only
- `workers/media/exportArguments.ts` ~245-260 (`v3Route`), ~524-600 (stacked chain)
- `src/export/plan.ts` ~131 (ManifestClip schema), ~505-515 (v2 shortcut), ~593-663 (v3 clips/hostImages)
- `src/captions/CompositionLayers.tsx` (layer types ~18-40, video/image/color styles ~164-255)
- `src/App.tsx` ~2337-2370 (visualLayers, hostPaintedImages), `src/core/layerStack.ts` ~80-100
- `workers/media/exportArgumentsV3.test.ts` (style of graph assertions)

## Steps
1. Shared rule: extract `imagesHostPainted(clips, tracks, { adjustments })` into core (e.g. `src/core/layerPlan.ts`); false when any image clip has a non-normal `blendMode`. Use it in App.tsx, plan.ts and layerStack.ts (this also fixes layerStack ignoring adjustments).
2. Preview: add `blendMode?` to the video/image/color layer types; set `mixBlendMode` in each style; wrap picture layers in a container with `isolation: isolate` and an opaque black background (matches FFmpeg's black canvas). Pass it from App.tsx visualLayers.
3. Manifest: `blendMode?` on `ManifestClip`, emitted only when not normal. Force the stacked route when any clip blends (`v3Route` and the plan.ts v2 shortcut treat it like `opacity !== 1`).
4. FFmpeg (stacked loop), blended clips only: prepare the clip as now (fit, mask, opacity via `colorchannelmixer`), expand to full frame with `pad=W:H:x:y:color=black@0`, pad in time at both ends with transparent `tpad` so it spans the sequence. Then `[prev]split[pa][pb]`; `[clip]format=gbrap[ct]`; `[pa]format=gbrap[pt]`; `[ct][pt]blend=c0_mode=M:c1_mode=M:c2_mode=M:c3_mode=normal:shortest=1[bl]`; `[pb][bl]overlay=0:0:format=auto[b_i]`. Put the mode names in an explicit `BLEND_FFMPEG: Record<BlendMode,string>` table.
5. Verification test (real bundled FFmpeg): solid-colour grids through the exact chain, compared per pixel with a TS implementation of the W3C Compositing formulas (+-2/255). Remove failing modes (likely `soft-light`) from `BLEND_MODES` and the UI list; record the results in STATUS.md.
6. Enable the blend select for clip rows in `LayersPanel`; show a `· Multiply` suffix in the row detail (from brief 01).
7. Docs: add "Blend modes" to docs/EDITING.md; update docs/ARCHITECTURE.md where the stacked route is described.

## Out of scope
Blend on captions/titles/shapes/effects/blur; non-separable modes.

## Tests / verify
- Graph string tests for a blended stacked export; normal-only snapshots unchanged.
- The formula-vs-FFmpeg pixel test for every shipped mode.
- `scripts/export-parity.mjs` + helpers: Multiply PiP, Screen image over video (forces the FFmpeg path), Overlay colour clip at 60 %; save evidence JSON under `docs/decisions/evidence/`.
- `npx vitest run` then `npm run typecheck`. Manual export with a Multiply PiP matches the preview.

## Done when
- [ ] Tests, typecheck, parity pass; Windows only reported
- [ ] `docs/STATUS.md` entry (shipped modes, dropped modes and why)
- [ ] Committed. Stop.
