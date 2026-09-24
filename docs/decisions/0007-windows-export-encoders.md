# ADR 0007 — Windows export encoders (NVENC, Media Foundation) and `dev.ps1`

Date: 2026-09-24. Status: implemented; **not validated on Windows** (written and unit-tested on macOS only).
Amends [ADR 0004](0004-mp4-export-profile.md), which limited MP4 export to macOS VideoToolbox.

## Decision

The export pipeline (Electron caption-frame host -> PNG pipe -> FFmpeg filter graph) was already portable;
only the `-c:v` block and the support gate were macOS-specific.

- `src/core/exportEncoder.ts` owns the encoder block. `h264_videotoolbox` is byte-identical to before.
  `h264_nvenc` (`-preset p5 -tune hq -rc vbr`, maxrate 1.5x, bufsize 2x the profile bitrate) is preferred on
  Windows; `h264_mf` (`-hw_encoding 1`, CBR) is the fallback and uses whatever hardware encoder Windows offers.
- `workers/media/exportEncoderSelect.ts` lists the build's encoders and runs a real 2-frame test encode per
  candidate; the first success is cached for the session. NVENC is often compiled in yet unusable without an
  NVIDIA GPU/driver, so listing alone is not trusted. `CAPTION_STUDIO_EXPORT_ENCODER` forces a candidate.
- `exportSupportFromConfiguration` keeps the strict pinned LGPL 9.0.1 profile on macOS. On Windows/Linux it
  accepts FFmpeg >= 7 with the PNG codec and a candidate encoder. A GPL build (gyan.dev, winget) is accepted
  there because the tool is a local developer configuration and nothing is redistributed; any release
  distribution still needs the licence review in `docs/DEPENDENCIES.md`.

**Not CUDA filters.** Overlays, grading LUTs and masks stay on the CPU filter graph. Moving them to
`*_cuda` filters would fork the graph from preview/export parity for a small gain; NVENC offloads the encode,
the dominant cost.

## `dev.ps1`

Finds FFmpeg (config, env, `.tools`, PATH, winget, Scoop, Chocolatey, `C:\ffmpeg`), accepts a candidate only if
it passes the same checks, else downloads BtbN `ffmpeg-n9.0-latest-win64-lgpl-9.0.zip` (rolling asset;
verified against BtbN's `checksums.sha256`, which guards corruption but is not a pinned hash). whisper-cli comes
from whisper.cpp's `b5130` build tag (v1.9.4 itself publishes no binaries): `whisper-cublas-12.4.0-bin-x64.zip`
with an NVIDIA GPU, `whisper-bin-x64.zip` otherwise, verified against the GitHub asset digest.

## Not done

- No Settings control for choosing the encoder (env override only).
- Windows on ARM and Linux NVENC are untested candidates.
