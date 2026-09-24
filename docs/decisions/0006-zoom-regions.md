# ADR 0006 — Zoom regions

Date: 2026-09-22

## Decision

Use one sequence-timed, non-overlapping zoom-region lane with a static target rectangle and eased
entry/exit ramps. The transform affects the FFmpeg-composed picture only; captions and host-painted
image overlays are applied after it and remain pinned.

Manifest v3 resolves target rectangles to output pixels. On FFmpeg 9.0.1, encode the effect as a
dynamic `scale=…:eval=frame` followed by a fixed output-sized `crop`, placed after the flat/stacked
picture chain and before the transparent export-host layer.

## Rationale

`crop` has no `eval=frame` option in FFmpeg 9.0.1, and a variable crop size cannot safely feed a
fixed encoder output. `zoompan` is unnecessary and imposes its own frame-count/zoom constraints.
Dynamic scale plus fixed crop emitted all expected frames with no warnings in the feasibility spike.

## Consequences

Browser CSS and FFmpeg resampling use different pixel grids, so parity is measured at fixed frames
rather than claimed byte-identical. Zoom magnifies the composed output canvas; it does not preserve
extra detail from a higher-resolution original. The documented preview/export frame-diff tolerance
is recorded with each real-encode verification run.
