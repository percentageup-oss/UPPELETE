# Shape blend modes

Goal: the Blend dropdown in the Layers tab works for shapes, with preview and export matching. A blending
shape blends with **everything beneath it in layer order**: video, images, backgrounds, pinned effects,
and any captions, titles or shapes below it.

Why it is not a one-liner: the export host paints captions, titles and shapes onto ONE transparent layer
that FFmpeg overlays on the picture (`pipe:0`), and a transparent layer has nothing to blend with. The
preview needs only CSS `mix-blend-mode`. The export is split into **passes** at each blending shape:
normal band 0, blend shape 1, normal band 1, ... (K = 2k+1 passes for k blending shapes). Each output
frame sends K sub-frames on the same pipe; FFmpeg `select`s them apart and composites in order (`overlay`
for normal bands, the existing `blendChains` for blend shapes). With no blending shapes K = 1 and the
FFmpeg arguments must stay **byte-identical**. At most 8 blending shapes per project.

| Order | Brief | Outcome |
|---|---|---|
| 1 | `01-model-and-preview.md` | Schema 19, command, Layers panel, live preview. Export refuses blending shapes with a clear message. |
| 2 | `02-export-passes.md` | Pass model, worker loop, FFmpeg graph. Removes the refusal. |
| 3 | `03-parity-and-docs.md` | `--only shape-blend` parity stage, a real export, docs. |

Each brief is self-contained. Run them in order, one per fresh session. Data passes between briefs only
through `docs/STATUS.md`.

Project rules that apply to all three (from AGENTS.md): preview and export share layout and animation
logic; do not ship a control that only one of them honours; test high-risk timing/export parity; report
platforms actually tested (this machine is Windows; do not claim macOS); update `docs/STATUS.md` after each
slice.
