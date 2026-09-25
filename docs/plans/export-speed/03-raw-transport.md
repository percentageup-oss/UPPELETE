# 03: Send raw pixels instead of PNG

## Goal
The host spends most of each frame PNG-encoding (ADR 0003: ≈7 ms paint vs 11–16 ms PNG at 1080p), and
FFmpeg decodes it again. Send the premultiplied BGRA bitmap as-is.

## Constraints that matter here
- **Preview/export parity** (ADR 0003): caption pixels must match. Malayalam shaping is unaffected
  (same renderer) but must be confirmed by the parity run.
- The frame size is fixed and known (W×H×4). Reject anything else. Keep bounded memory.
- Keep a PNG fallback. Don't delete the PNG path.
- Mask rasterization (`version: 5` requests, written to disk as `mask-N.png`) **stays PNG**.

## Facts already established
- `scripts/export-frame-transport.mjs` `markedBitmap()` returns Chromium's paint bitmap. The marker
  check shows byte order **BGRA**, and Chromium paint bitmaps are **premultiplied**. `toPng()` is where
  the PNG cost lives.
- The caption layer (`[1:v]` / `${layer}`) enters the FFmpeg graph only at the final
  `overlay=0:0:alpha=straight:format=auto:…` in `workers/media/exportArguments.ts` (≈lines 175, 545, 580).
  With premultiplied input this becomes `alpha=premultiplied`.
- The pipe input is `'-f', 'image2pipe', '-framerate', rate, '-c:v', 'png', '-i', 'pipe:0'` (≈230, ≈625).

## Read only
- `scripts/export-host.mjs` (≈87 lines) and `scripts/export-frame-transport.mjs` (≈75 lines)
- `workers/media/exportProcesses.ts`: `PngReader`
- `workers/media/export.ts`: host spawn args, mask loop, frame loop
- `workers/media/exportArguments.ts`: the lines above, plus the `exportArguments` / `exportArgumentsV3` signatures
- `src/export/frameRequest.ts`: only to see where request `version` 5 (mask) is defined
- Tests: `workers/media/exportArguments*.test.ts`, `workers/media/export.test.ts`, `scripts/export-frame-transport.test.mjs`
- `scripts/export-parity.mjs`: top comment only, to know how to run it (`npm run parity:export`)

## Steps
1. Add `type FrameTransport = 'png' | 'raw'`. The worker picks it: `raw` by default, and
   `CAPTION_STUDIO_EXPORT_TRANSPORT=png` forces PNG, mirroring `CAPTION_STUDIO_EXPORT_ENCODER` in
   `exportEncoderSelect.ts`. Pass it to the host as argv `--transport raw|png`.
2. Host: for non-mask requests under `raw`, write `[4-byte BE length][bitmap]` directly (skip `toPng`).
   Mask requests always go through `toPng`.
3. Reader: generalise `PngReader` into a frame reader with `frame(expect: 'png' | { rawBytes: number })`.
   For raw, require `size === W*H*4` exactly. Keep the Windows `\r\n` quirk handling and the 64 MiB cap
   (a 4K frame is ~33 MiB, which fits).
4. Arguments: add a `transport` parameter to both builders. For raw, the pipe input becomes
   `'-f', 'rawvideo', '-pix_fmt', 'bgra', '-s', `${W}x${H}`, '-framerate', rate, '-i', 'pipe:0'`, and the
   final overlay uses `alpha=premultiplied`. The PNG path must produce **byte-identical** arguments to
   today (existing snapshots unchanged); add new snapshots for raw.
5. Rebuild, run the brief-01 smoke at 1080p (and 4K if available) with raw and with `…TRANSPORT=png`.
   **If raw is slower at 2160p**, pick PNG above a pixel-count threshold and note why in a code comment.

## Out of scope
Multiple hosts (04), UI, the encoder choice.

## Tests / verify
- Reader unit tests: a wrong raw size fails, and a correct size round-trips.
- Argument snapshots: PNG unchanged, raw added (v2 and v3).
- `npx vitest run workers/media scripts` then `npm run typecheck`.
- **Parity:** `npm run parity:export` with raw, then with PNG. Compare the composited-frame deltas it
  reports. Accept only if the difference is ≤1 per channel and limited to partially transparent caption
  edge pixels. Record both numbers.
- Real smoke: valid MP4, same frame count, fps vs brief 02.

## Done when
- [ ] Tests, typecheck, parity and smoke pass
- [ ] `docs/STATUS.md` entry: fps and hostWaitMs before/after, parity deltas, platform. **State
      whether hostWaitMs is still larger than encoderWaitMs**, since brief 04 runs only if it is.
- [ ] Add a short "Follow-up: raw transport" paragraph at the end of `docs/decisions/0003-export-renderer.md`
- [ ] Committed. Stop.
