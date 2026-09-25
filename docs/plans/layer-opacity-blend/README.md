# Layers tab: Opacity + Blend mode: session briefs

Each brief is one **fresh session**'s work. Open a new session and say:

> Implement docs/plans/layer-opacity-blend/0N-<name>.md

The session reads that brief and only the files it lists, implements, tests, appends a short entry to
`docs/STATUS.md`, commits, and stops. Briefs never rely on earlier conversation. Anything a later brief
needs from an earlier one is recorded in `docs/STATUS.md` or in the code.

## Goal
The Layers rail tab (`src/LayersPanel.tsx`) gets a Photoshop-style strip under the "Layers" heading for the
focused layer: a **blend-mode menu** and an **Opacity** field. Scope: opacity for every layer that can take
it; blend modes on video / image / color clips only. Captions, titles and shapes get opacity only (they are
painted on a separate transparent host layer in export, so they cannot blend against the picture).

## Order

| # | Brief | Depends on | Size |
|---|-------|-----------|------|
| 01 | [Schema 18 + Layers header (clip/shape opacity)](01-schema-and-header.md) | none | M |
| 02 | [Opacity on titles and the caption plane](02-text-caption-opacity.md) | 01 | M |
| 03 | [Blend modes on clips (preview + FFmpeg)](03-blend-modes.md) | 01 | L |

02 and 03 are independent of each other once 01 has landed.

## Shared findings
- Opacity exists on clips (`visualFields.opacity`, `src/core/edit.ts` ~162) and shapes (~370). NOT on text
  overlays (`textOverlaySchema`, ~312) or caption tracks (`captionTrackSchema`, ~119). Effects/blur have none.
- No blend modes exist anywhere in `src/` or `workers/`.
- Masks already travel the whole per-layer path and are the template to copy: `LayerRow.target: MaskTarget`
  (`src/core/layerStack.ts`) -> `mask-set` command (`src/core/maskCommands.ts`) -> `maskDraft`/`maskDrafted`
  live draft (`src/App.tsx` ~198, ~334) -> preview `CompositionLayers` / `CaptionPreview captionMask` ->
  export `manifest.captionMasks` (`src/export/plan.ts` ~177, ~360, ~679) -> `frameRequest.captionMask` ->
  `frameHarness`.
- Export compositing: the v3 stacked route (`workers/media/exportArguments.ts` ~552-576) overlays each clip
  on a black RGBA canvas; opacity is `colorchannelmixer=aa`. `v3Route` (~250) picks flat vs stacked.
- Images are "host-painted" when every image track is above every video track. That rule is duplicated in
  `App.tsx` ~2346, `plan.ts` ~601 and `layerStack.ts` ~84, and has drifted (layerStack ignores adjustments).

## Project rules that matter (from AGENTS.md)
- Preview and export share layout/animation logic; export parity must be tested.
- Never present a control as working before preview AND export honour it.
- Renderer has no Node integration; spawn tools with argument arrays.
- Test timing/edits/undo/migrations/export parity; report only platforms actually tested (Windows here).
- Update `docs/STATUS.md` after each slice: changes, verification, limitations, next task.
- Never commit media, models, caches, exports.

## Out of scope (all briefs)
Blend modes on captions/titles/shapes/effects/blur. Non-separable modes (hue, saturation, color,
luminosity). Opacity on effects and blur regions. Keyframed opacity.
