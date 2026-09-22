# ADR 0005 — Exporting a stacked multi-track timeline (manifest v3)

Date: 2026-09-19. Status: accepted; macOS arm64 only, like ADR 0004. Partially supersedes
[ADR 0003](0003-export-renderer.md)'s "images are painted by the export host, exact parity, no FFmpeg
work" for one case only (below). Builds on [ADR 0004](0004-mp4-export-profile.md)'s encoding profile,
which is unchanged.

## Context

Schema 5 (`docs/EDITING.md` "Schema 5") replaced one source video with named tracks, clips at absolute
sequence positions, gaps, picture-in-picture and stacked video tracks. Manifest v2 describes one input
with kept source segments; it cannot express a second file, a gap, a picture-in-picture rect, an
image under a video, or sound from several videos.

## Decision

1. **Keep manifest v2 as the exact route.** `buildExportManifest` emits v2 whenever the sequence is
   flat (`flatSequence`: one video's clips on one visible unmuted track, gapless from 0, full frame,
   opaque, `contain`, unity gain; images only for the identity edit). Every project that existed before
   schema 5 with one video is flat, so its export arguments stay byte-identical — pinned by the existing
   snapshot tests, not re-verified by coincidence. Both routes are kept permanently.
2. **Manifest v3 for everything else.** Inputs, clips with stacking index, sequence position, source
   range, output-pixel rect, opacity, fit and gain; host-painted images; blur; the sequence length.
3. **One FFmpeg input per clip, opened with `-ss`/`-t`.** Sharing one decoder between clips (per-clip
   `trim` of a shared input) makes a reordered or repeated clip, or a picture-in-picture of the same
   file, buffer another consumer's decoded frames — gigabytes of RGBA at 1080p. Separate inputs give each
   clip an independent decoder, a fast accurate seek and a PTS origin of 0. One export reads at most
   250 clips.
4. **Two filtergraph routes.** *Flat* (one video track end to end, full frame, opaque): fit each clip to
   the output frame, `concat`, one CFR conversion after it. *Stacked*: a black RGBA `color` canvas as long
   as the sequence; each visual clip back to front is fitted, given its opacity, `tpad`-ded with
   transparent frames to its timeline start, and `overlay`-ed with `eof_action=pass:repeatlast=0`; then
   the caption layer. `tpad` prevents the overlay from stalling before a clip; `pass` + `repeatlast=0`
   prevent a clip's last frame smearing across a following gap. `contain` letterboxes transparently, so
   what is below shows through — matching the preview's `object-fit: contain`.
5. **Images stay host-painted whenever every image track is above every video track.** The caption layer
   always sits on top of FFmpeg's picture, so this keeps ADR 0003's exact parity for titles, logos and
   watermarks — effectively every real project. **Only an image genuinely under a video is composited by
   FFmpeg** (`-loop 1 -framerate R -t <length>` input, same chain as a video clip), and that case is held
   to a measured tolerance rather than byte parity, by the same method V4 plans for blur.
6. **Audio**: silence pinned to the sequence length, plus each video clip's own sound and each audio
   clip, `adelay`-ed to its position with its own gain, `amix=normalize=0:duration=first`.

## Verification

Real encodes with FFmpeg 9.0.1 and `h264_videotoolbox` on macOS arm64 (2026-09-19), using the
builder's own argument arrays (details in `docs/EDITING.md` and `docs/STATUS.md`): the flat route over
two different files is frame-exact at the seek and at the boundary; the stacked route shows black gaps,
no stall, no smear, transparent letterboxing and correct opacity at exact duration and frame count. The
v2 route's argument snapshots are unchanged and `npm run parity:export` reproduces the previous run's
figures. **Not yet measured**: the tolerance for an FFmpeg-composited image (no project in the parity
suite puts an image under a video), and any Windows encoder.

## Consequences

- A clip near the end of a long file is decoded from a keyframe near its start rather than from the
  file's beginning (input seeking) — faster than the plan's per-clip `trim`, at the cost of one decoder
  per clip.
- Blur remains refused by both routes until V4 adds its filtergraph branch.
