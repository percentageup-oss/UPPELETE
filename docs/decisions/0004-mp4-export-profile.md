# ADR 0004 — MP4 export encoding profile and pipeline

Date: 2026-09-16. Status: accepted for X2, macOS arm64 only; Windows validation remains required. Amended by [ADR 0007](0007-windows-export-encoders.md) (Windows encoders).
Scope: X2. Builds on [ADR 0003](0003-export-renderer.md)'s GPU offscreen caption-frame renderer and
[ADR 0001](0001-media-worker-and-ffmpeg.md)'s project-controlled FFmpeg/ffprobe build decision.

## Decision

Implement one documented encoding profile, `mp4-caption-renderer-v1`, as the media worker's real
`export` operation (`workers/media/export.ts`): H.264 High profile via the platform hardware encoder
(`h264_videotoolbox` on macOS; no Windows equivalent is enabled in this ticket), `yuv420p`, constant
frame rate at the source's own rational rate (nominal preferred, average as fallback, halved when
above 60 fps, `30/1` only when neither is usable), output dimensions computed from the source's
coded size, sample aspect ratio and rotation (`src/export/plan.ts`'s `planFromMedia`), capped at
3840px on the longest side and always even. Audio is always transcoded to AAC-LC 48 kHz stereo
192 kb/s (never copied) so its exact sample rate/duration match the video's requested range
regardless of the source's own audio codec/timing; a source with no audio stream emits `-an`.
Bitrate is a deterministic function of output pixel count (`exportBitrate`): 5 Mb/s at ≤720p,
8 Mb/s at ≤1080p, 16 Mb/s above that. `-movflags +faststart` and `-map_metadata -1` strip
non-reproducible container metadata; `-metadata:s:v:0 rotate=0` is explicit because the output
frame is already upright (rotation was resolved into the plan's swapped width/height, not left for
a player to reinterpret).

Frames are rendered by ADR 0003's separate GPU export host (one Electron process per job, its own
job-owned profile directory) and piped as PNG (`image2pipe`) into FFmpeg alongside the real
`-autorotate` input flag on the source so FFmpeg's own decoder presents already-upright frames
matching the plan's swapped dimensions. **`-autorotate` takes no explicit value in FFmpeg 9.0.1's
CLI** — an earlier draft of this code passed `-autorotate 1`, which this ticket's own real-media
smoke test caught: the stray `1` token is not consumed as the flag's argument, and FFmpeg's parser
only reports the resulting confusion once it reaches the output file ("cannot be applied to output
url 1"). Fixed to the bare flag; `workers/media/exportArguments.test.ts` now asserts the exact
argument array, including this form. A frame with no active cue is always fully transparent and
identical (the placeholder cue's `endUs` is pinned at 1, before any real source timestamp), so
`export.ts` renders it once and reuses that PNG for every subsequent gap frame rather than
round-tripping the export host again — halving host round trips on caption-sparse video and adding
no per-cue-boundary correctness risk, since the reused bytes are provably the same request's output.

Export runs as a `kind: 'export'` job on the **same shared `JobScheduler` instance** as
transcription (`electron/jobs.ts`, `getJobScheduler()`), not a private scheduler — every job kind
was already declared `'heavy'` in `src/core/jobs.ts`'s `JOB_RESOURCE_CLASS`, but T1's arbitration is
only real if callers share one scheduler; `transcriptionIpc.ts` was updated to use the same shared
instance so a running transcription and an export never run concurrently by default, matching
`docs/ARCHITECTURE.md`'s existing "Jobs and failures" contract instead of quietly building a second
promise of arbitration this ticket would have broken. `electron/exportService.ts` mirrors
`TranscriptionService`: a job-owned `mkdtemp` directory holds the render manifest, the worker writes
to `<destination>.<uuid>.tmp` beside the user's chosen destination (never the source path — checked
before enqueueing), and only `ctx.enterCommit()` returning `true` triggers the atomic
`rename()` onto the destination; a cancellation that arrives after a valid encode exists but before
that rename still discards the completed file, matching T1's existing commit-gate contract exactly.
The job directory and any leftover temp output are removed in `finally` regardless of outcome.

`src/core/exportSupport.ts`'s `exportSupportFromConfiguration` is the single source of truth for
"is export usable right now": exact pinned FFmpeg 9.0.1, the selected LGPL/no-network/no-GPL/no-nonfree
profile, `--enable-zlib` (needed for the PNG codec) and `--enable-videotoolbox`, and — until a Windows
encoder route is measured — `process.platform === 'darwin'`. It is called both by `electron/exportIpc.ts`
(cached per app session, gating whether the renderer's **Export Video** control appears at all — the
control is never shown as a nonfunctional placeholder) and by the worker's own `exportSupport` before
touching any process, so a stale main-process cache can never make it spawn FFmpeg on a build outside
the profile.

## FFmpeg build change: `--enable-zlib`

The M1/M2/M4/T3 profile (`--disable-gpl --disable-version3 --disable-nonfree --disable-autodetect
--disable-network --disable-doc --disable-debug --disable-ffplay`, plus M4's `--enable-libvpx
--enable-libopus`) has no PNG codec: `--disable-autodetect` suppresses FFmpeg's automatic system-zlib
detection, and PNG's encoder/decoder both require zlib. X2 rebuilt the same verified upstream 9.0.1
source on macOS arm64 with Apple clang 21.0.0, configuration
`--disable-gpl --disable-version3 --disable-nonfree --disable-autodetect --disable-network
--disable-doc --disable-debug --disable-ffplay --enable-videotoolbox --enable-zlib --enable-libvpx
--enable-libopus`, explicitly re-enabling zlib against the macOS SDK's system `zlib.h`/`libz.dylib`
(zlib license; already an implicit system dependency of the OS itself, not a new bundled or
downloaded artifact) — the same explicit-opt-in pattern M4 used for libvpx/libopus. The resulting
`ffmpeg -encoders`/`-decoders` report `png`, `apng`, `h264_videotoolbox`, `hevc_videotoolbox` and
`aac` alongside the unchanged `libvpx`/`libopus` proxy encoders. The pair was built at the project
root's `.tools/ffmpeg-9.0.1`: ffmpeg 21,991,192 bytes, SHA-256
`cba780efa231e0551766842304b6a6fc7bf31407e9e89630ce8ca5d82ddf0e84`; ffprobe 21,815,880 bytes, SHA-256
`6bab2ed9c836aa0e78ba086e0ed57c98023f9170cb430999008e6741733d8222`. Neither binary is committed,
bundled or release-approved; this remains a local developer build, matching every prior FFmpeg
rebuild in this project. The gitignored `caption-studio.local.json` now points at this pair.

## MP4 encoder selection

`h264_videotoolbox` (Apple's native hardware H.264 encoder, exposed by FFmpeg's own `--enable-videotoolbox`
configure flag — no separate library, download or license beyond FFmpeg's own LGPL terms and Apple's
platform frameworks) keeps the project's `--disable-gpl` profile intact, unlike `libx264` (GPL) or
`libopenh264`\'s [BSD license with a separate Cisco binary-distribution/patent notice](https://github.com/cisco/openh264/blob/master/LICENSE)
that ADR 0001 already flagged as unresolved. It requires no new dependency, matches ADR 0003's
already-selected macOS hardware acceleration story, and needs no incompatible license decision. It
is macOS-only: the equivalent Windows Media Foundation encoder (`h264_mf`) or a software GPL-free
encoder is unmeasured and undecided, so `exportSupportFromConfiguration` reports Windows as
unsupported today rather than silently attempting an unverified encode path. AAC uses FFmpeg's own
built-in encoder (already used for T3's WAV extraction on the decode side); no new dependency.

## Real-media verification

Machine: Apple M4 Pro (12 logical cores, 24 GiB), native macOS arm64, macOS 26.6.2 (Darwin 25.6.0),
Electron 44.3.0 / Chromium 152.0.7977.78, Node 24.20.0 (Electron's bundled runtime). Ran through the
real production path (`electron . --export-smoke`, exercising `ExportService` → the shared
`JobScheduler` → `MediaWorkerClient` → a real separate worker process → the real separate export host
Electron process → the pinned FFmpeg pair), never a mocked encoder:

- A synthesized 10 s 1920×1080 30 fps H.264 (`h264_videotoolbox`)/AAC source (`testsrc2` pattern +
  440 Hz sine tone) with a 3-cue mixed Malayalam/English SRT (`Hello, this is a caption test.` /
  `മലയാളം ക്യാപ്ഷൻ ടെസ്റ്റ്` / `Mixed Malayalam/English: React API cafe`) exported to a real MP4 in
  ~5 s. Output verified with the pinned `ffprobe`: H.264 High profile, `yuv420p`, exactly 1920×1080,
  CFR 30/1, AAC-LC 48 kHz stereo, duration exactly 10.000000 s, `faststart` present, 300 encoded
  frames matching the planned frame count. `ffmpeg -af volumedetect` reported mean −24.1 dB / max
  −20.8 dB (a real, non-silent decoded tone, not a copied/looped source or silence). Frames extracted
  at 0.5 s (before the first cue: plain video, no caption — the gap-frame path), 2.0 s, 5.0 s and
  8.5 s were visually inspected: all three captions render in the correct position/style with
  correct text, the Malayalam conjuncts/vowel signs in "ക്യാപ്ഷൻ" and "ടെസ്റ്റ്" are intact and
  unfragmented, and the mixed-script cue wraps onto two lines exactly as the shared renderer does in
  preview. The source file's SHA-256 was unchanged after export.
- A second export of a real, separately generated 30000/1001 (NTSC) 1280×720 4 s H.264/AAC source
  (no captions) produced an output whose `ffprobe`-reported `avg_frame_rate`/`r_frame_rate` are
  **exactly `30000/1001`**, not rounded to `30/1`, with a duration of exactly 4.004000 s (120 frames
  at the true rational rate) — confirming `fittedFrameRate` preserves an already-in-band rational
  rate exactly, as `src/export/plan.test.ts` asserts in isolation.
- Cancellation was exercised against the real pipeline (not only the unit-test double in
  `workers/media/export.test.ts`): a job was cancelled ~1.5 s into a 10 s export. The outcome was
  `{state: 'cancelled'}`, the chosen destination was never created, and no `caption-studio-export-*`
  job directory was left in the OS temp directory afterward — both the export host and encoder
  processes were reaped.
- The renderer's real **Export Video** control was confirmed to appear (styled identically to the
  existing Export SRT control) in the actual built app (`dist/index.html` loaded through the real
  preload/IPC bridge and main process, screenshotted via `capturePage`), proving
  `checkExportSupport()`'s real round trip through `inspectToolchain` resolves `supported: true`
  against the rebuilt FFmpeg pair rather than only being asserted in a unit test.
- A rotated-source real export was **not** completed this session: synthesizing a genuinely rotated
  fixture requires either the GPL `libx264` (excluded by this project's profile) to bake pixel
  rotation, or a container-level display-matrix/`rotate` tag, and the `-metadata:s:v:0 rotate=90`
  approach tried here did not persist into a `tkhd` matrix or side-data rotation that `ffprobe`
  reported. `planFromMedia`'s dimension-swap logic itself is verified in `src/export/plan.test.ts`
  against `tests/fixtures/ffprobe-rotated.json`, a real ffprobe capture of genuinely rotated media
  from M2, and the real `-autorotate` flag is wired into the encoder arguments and covered by
  `exportArguments.test.ts`; only the full real-rotated-source *encode* was not exercised. This is a
  named limitation for the next real-media pass, not a claim of rotation being fully validated.

## Limits and next gate

Only macOS arm64 was measured; no Windows encoder path exists yet (`exportSupportFromConfiguration`
reports it unsupported rather than guessing). Long-form sync (long pauses, VFR decode-side mapping),
exact preview/export pixel parity for all five presets, and clean-machine packaging of the export
host (`dist-export/` is a local-only build artifact, `D2`'s job) remain out of scope, per ADR 0003.
**X3** is the ticket for the expanded parity/sync suite this ADR's evidence feeds into; **D1/D2**
must account for the export host and rebuilt FFmpeg pair in the release dependency inventory and
packaging before either is redistributed.

**Update (X3, 2026-09-17):** the rotated-source gap above is resolved — the pinned FFmpeg 9.0.1
accepts `-display_rotation <degrees>` as an **input** option (placed before `-i`, not after the
output path; passing it as an output option is rejected by this build) and writes real rotation side
data through a stream copy, no GPL encoder needed. `ffprobe`'s `stream_side_data.rotation` confirms
it, and a real export of that source produced the expected swapped output dimensions
(`docs/CAPTION_RENDERER.md`'s "Preview/export tolerance (X3)" section has the full run). A
genuinely variable-rate source (measured `avg_frame_rate` diverging from a constant `r_frame_rate`,
via `setpts`+`-fps_mode passthrough` rather than a claimed real capture) and a 240 s long-pause/beep
source were also exercised there, closing every gap this ADR named above except Windows.
