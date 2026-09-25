# 02: Liquid Glass spike: two go/no-go checks before building

## Goal
Answer the two questions that decide the glass design. **No product code, no tests.** Keep it short: a
throwaway script under `scripts/spikes/` and a STATUS.md entry with the answers and the chosen formulas.
No evidence JSON, no benchmarks.

Project rules: see `README.md` "Rules every brief carries".

## Context
Shapes are SVG in `src/captions/ShapeActor.tsx`. Preview mounts them in the same DOM as the video (`src/App.tsx:2394-2435`), so CSS `backdrop-filter` can blur the video there. The export host (`scripts/export-host.mjs`, `src/export/frameHarness.tsx:52-75`) is a transparent offscreen window with no video; FFmpeg composites (`workers/media/exportArguments.ts`: `blurPictureChain` 62-80; `compositeGraphicsPasses` 290-316). `src/captions/maskStyle.ts:12-13` warns that wrappers/masks become backdrop roots that break `backdrop-filter`. `scripts/blend-parity-harness.tsx` shows how to open an offscreen Electron window and read pixels.

## Questions
1. In Electron's Chromium, does `backdrop-filter: blur(σ) saturate(s) url(#svgfilter)` work with an SVG `feImage` + `feDisplacementMap` filter (with `color-interpolation-filters="sRGB"`)? Which ancestors (opacity < 1, mask, filter, mix-blend-mode, will-change) stop the backdrop from seeing the video? If `url()` does not work, name the fallback (e.g. drop refraction to a static rim highlight).
2. Displacement mapping: find the encoding (map byte = 128 + 127 * d / maxShift) and `feDisplacementMap` `scale` that give the same pixel shift as FFmpeg `displace` (128 = no shift). One eyeballed comparison on a still (SMPTE bars) is enough.

Use these without measuring: CSS spec `saturate()` matrix (Rec.709 luma) in FFmpeg `colorchannelmixer`; blur sigma = CSS px = `gblur` sigma (as blur regions already do); PNG transport for the opaque map sub-frame (raw has a documented un-premultiply bug, STATUS 2026-09-25); FFmpeg crop margin of 3σ before `gblur`.

## Out of scope
Any change to `src/`, `workers/`, schema or UI. Benchmarks, pixel-delta reports.

## Done when
- [ ] STATUS.md entry: yes/no for question 1 (plus fallback if no), the formulas from question 2, and the "use without measuring" list above, so briefs 03 and 04 copy them verbatim
- [ ] Commit only the spike script and STATUS. Stop.
