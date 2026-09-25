# 02: Opacity on titles and the caption plane (preview and export)

## Goal
Make the Opacity control work for text overlays and caption tracks, identically in preview and export.

## Constraints that matter here
- Preview and export share one painter: `CaptionPreview` / the text actor are used by the export harness.
- Multiply with existing per-frame opacity (fades etc.); never replace it.
- A manifest without any sub-1 opacity must stay byte-identical (only emit entries < 1).

## Read only
- `src/captions/CaptionPreview.tsx` ~288-310 (props) and ~350-385 (title visual, `captionMask` wrapper)
- `src/App.tsx` `TextOverlayActor` usage (~2379) and `captionMask=` (~2421)
- `src/export/plan.ts` ~177 (`captionMasks`), ~355-370, ~679; `src/export/frameRequest.ts`; `src/export/frameHarness.tsx` ~60-75
- `src/LayersPanel.tsx` (the disabled-opacity rule from brief 01)

## Steps
1. Text: apply `item.opacity ?? 1` on the text actor's wrapper (multiplied with the animation opacity).
2. Caption plane: add a `captionOpacity?: number` prop to `CaptionPreview`; wrap the plane in the same div as `captionMask` when either mask or opacity is active. Feed it from `captionTracks.find(...)?.opacity` in App.tsx.
3. Export: add `captionOpacities: z.record(trackId, number).default({})` to the manifest next to `captionMasks` (only entries < 1); add `captionOpacity` to `frameRequest`; set it in plan.ts like `captionMaskValue`; pass through `frameHarness`. Confirm text overlay `opacity` reaches the harness with the overlay item.
4. Enable the Opacity control for text and caption rows in the Layers header.

## Out of scope
Blend modes (03).

## Tests / verify
- plan.test: `captionOpacity` carried only when < 1; manifests without it unchanged (snapshots).
- Render tests: text actor and CaptionPreview markup carry the opacity.
- `scripts/export-parity.mjs`: add a 50 % title and 50 % caption plane case; preview vs export match.
- `npx vitest run` then `npm run typecheck`.

## Done when
- [ ] Tests, typecheck, parity run pass
- [ ] `docs/STATUS.md` entry; docs/EDITING.md mentions title/caption opacity
- [ ] Committed. Stop.
