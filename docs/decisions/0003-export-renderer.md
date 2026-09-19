# ADR 0003 — Chromium caption frame export

Date: 2026-09-16. Status: accepted for X1; macOS evidence supports the X2 path, Windows validation remains required.
Scope: X1 only. ADR 0002 is reserved for the planned Malayalam ASR evaluation.

## Decision

Use the app's pinned Electron/Chromium runtime to render transparent caption frames in an
isolated offscreen renderer, reusing `CaptionPreview`, `captionStyleInputs`, `createDomMeasurer`,
`layoutCaption`/`layoutCaptionWords`, `captionFrame` and `CaptionView`. Select GPU-accelerated CPU-bitmap readback
for the first X2 implementation, preserving the normal GPU preview rasterization mode and requiring
Windows measurements before release. Run the export host in a separate Electron process to keep
frame transport/PNG encoding off the editor main/UI threads. Keep one frame in flight and apply backpressure from the media worker.
This separate export-host integration is the X2 implementation path, not completed production code.

Use PNG caption frames as the first correctness baseline for FFmpeg compositing/encoding;
measure streaming PNG rather than storing an unbounded sequence. A raw bitmap optimization must
explicitly handle byte order, alpha association and color space and pass a compositing fixture.
Software bitmap mode is a measured fallback only with an explicit cross-mode pixel-tolerance policy;
its extra speed does not provide exact parity with the normal GPU preview. Shared GPU textures are deferred: they add native,
platform-specific encoder integration without addressing a measured first-release bottleneck.

Do not adopt Remotion. Do not render captions with an independent FFmpeg text/subtitle engine.
Do not add an Export Video control in X1. The media worker's production `export` operation remains
unsupported; video decode/compositing, an MP4 codec profile, audio mux, cancellation, safe destination
commit and source rotation/VFR handling belong to X2/X3.

## Executable prototype and parity contract

Run from the repository root after `npm ci`, without a dev server, media, model, network or font
download:

```sh
npm run prototype:export -- --frames 600
npm run prototype:export -- --software --frames 600
```

If the parent shell exports `ELECTRON_RUN_AS_NODE`, unset it for these Electron commands.
The script bundles the actual shared renderer with the locked esbuild, loads it from a new system
temporary directory, creates its own preview/export windows and writes PNGs plus `measurements.json`
there. No app IPC, source media or existing editor window is involved. No generated images go in Git.
The host uses Node integration off, context isolation, sandboxing, a restrictive CSP, ephemeral
separate sessions, denied window creation/navigation/permissions and no preload API.

`src/export/frameRequest.ts` validates a version-1 request with bounded integer dimensions,
absolute safe-integer source microseconds, cue text/word data and the real caption style schema.
It contains no paths, tool flags, media bytes or arbitrary CSS. To render your own frames, edit the
generated `portrait-request.json` and supply it, or a JSON array of at most 100 requests:

```sh
npm run prototype:export -- --frames 1 --request '/absolute/path/requests.json'
```

Each output `requested-N.png` is evaluated at that request's `timestampUs`; there is no playback
seek, elapsed clock or inferred alignment. Requested timestamps may be out of order and need not
be frame boundaries. The benchmark uses `startUs + floor(index * 1000000 * 1001 / 30000)` with BigInt,
then cycles within the authored cue. It does not accumulate rounded frame durations.

The small `parityFixture.ts` contains authored Malayalam conjuncts/vowel signs, a ZWJ chillu, Latin
and combining-accent/emoji text with explicitly manual word timings at an hour-long offset.
The interactive fixture changes primary color through a real DOM input event in React state;
export consumes that edited state. Separate onscreen and offscreen windows independently measure
and evaluate it. Editor controls/notices are excluded from caption pixels; timing notices and layout
warnings remain in the returned state. `parityState` removes only local font-cache revision strings,
retaining all text, geometry, font readiness, word rectangles, motion/opacity and elapsed source time.

The script checks 100 real frame comparisons: 5 motions × 2 aspects × 8 timestamp visits, plus
7 existing text fixtures and estimated/cue-only/gradient-effect fixtures in both aspects. Checks cover
half-open cue edges, fade opacity, an exact word-pop phase, backward seeking and repeated timestamps,
exact original text reconstruction, complete unsplit shaping runs, preview/export state equality and
byte equality of the full caption bitmaps. PNG encode/decode must reproduce the bitmap including
alpha. A real missing-local `FontFace` causes rejection before frame acceptance, followed by successful
recovery; fractional timestamps are also rejected. Custom request smoke covers a visible 640×360
frame at 3,600,625,007 µs and an entirely transparent 360×640 frame at the exact cue end.

Frame acceptance awaits the actual shared font/geometry readiness and a 1:1 projection. After
committing the request, a one-pixel RGB token is painted at the bottom-right corner outside the safe
caption area. The host attaches the paint listener before dispatch, ignores pre-commit/stale paints,
calls `invalidate()` (static pages do not generate frames by themselves), validates full-frame pixel
dimensions and accepts only the matching painted token. It clears that reserved pixel before PNG
output. This prototype correlation mechanism is explicitly tested; a production X2 bridge must retain
an equally strong committed-frame acknowledgement. It must never accept the next arbitrary paint.

Initial experiments found identical preview/export state and pixels but different word-pop raster
pixels when revisiting the same timestamp after other transforms. This occurred in both GPU and
software mode. Retained paint-node/layer history was the working diagnosis: rebuilding the shared
`CaptionView` nodes with a motion/timestamp key removed the observed discrepancy. Layout and shaped
metrics remain memoized. Both paths are measured with this fix; it is shared by interactive preview
and export, not an export-only math or typography workaround. The benchmark includes its DOM cost.

## Measurements

Machine: Apple M4 Pro, 12 logical cores, 24 GiB RAM, native macOS arm64 (Darwin 25.6.0).
Runtime: Electron 44.3.0 / Chromium 152.0.7977.78. Production React bundle, device scale 1;
transparent 1080×1920 and 1920×1080 windows, identical renderer source hashes in both runs.
Each aspect has 600 sequential measured word-pop frames (~20 seconds of 30000/1001 timestamp
mapping, cycled within the authored cue). No concurrently launched benchmark; ordinary desktop
background activity was not controlled. These are local observations, not universal performance.

| Mode / aspect | Raw frame fps | Raw mean / p95 ms | PNG encode mean / p95 ms | Raw + PNG fps | Sampled max aggregate working set MiB |
| --- | ---: | ---: | ---: | ---: | ---: |
| gpu-bitmap / portrait | 145.45 | 6.88 / 9.99 | 11.70 / 11.95 | 53.83 | 985.61 |
| gpu-bitmap / landscape | 131.73 | 7.59 / 10.22 | 16.38 / 17.00 | 41.71 | 1044.25 |
| software / portrait | 212.97 | 4.70 / 7.61 | 11.61 / 11.88 | 61.34 | 951.64 |
| software / landscape | 176.92 | 5.65 / 7.90 | 16.19 / 16.72 | 45.79 | 997.55 |

Raw timing includes request validation/dispatch, shared font/geometry readiness, React/DOM
painting, committed-token wait and full bitmap copy. PNG time includes `createFromBitmap` and
`toPNG`. PNGs are encoded then discarded during throughput measurement; disk writes, preview
capture, FFmpeg compositing, video decode, audio and final encoding are excluded. Thus these fps
figures do not claim real-time MP4 export. PNG encoding dominates the measured cost. The GPU path
has useful prototype headroom for a 30 fps pipeline; landscape PNG throughput already rules out
claiming a complete real-time 60 fps export from these measurements.

Each full 1080p bitmap is 8,294,400 bytes (7.91 MiB). Application memory samples are collected
with `app.getAppMetrics()` every 10 frames plus the final frame. The sum includes the prototype
Browser/GPU/Utility processes, **both preview and export renderers**, captures/PNG buffers and
shared pages counted by each process; it is not export-only private memory or a simultaneous
sum of per-process historical peaks. [Memory API units](https://www.electronjs.org/docs/latest/api/structures/memory-info)

GPU aggregate working set before→after: portrait 840.25→850.89 MiB, landscape
852.09→1032.42 MiB; software: portrait 799.42→927.88 MiB, landscape 874.78→920.11 MiB.
Software landscape samples at frames 0/300/599 were 914.61/915.67/920.11 MiB, but portrait ended
higher than it began, and GPU landscape grew. Garbage collection/readback caches and process
teardown affect this short sample. There is **no proven long-run memory bound or leak-free claim**.
X2 needs a longer export-only soak and bounded frame/encoder queues.

Within each mode: **100/100 independent preview/export state comparisons and full bitmap
comparisons passed with zero differing bytes**, as did repeated-timestamp bitmap hashes for all
five presets and both aspects. Transparent cue-exterior frames are all zero alpha/RGB. The software
portrait static sample has 1,894,392 clear, 161,002 partially transparent and 18,206 opaque pixels;
RGB under clear alpha is zero. All 80 motion-frame PNGs survive the native encode/decode bitmap
round trip. Tiny fade opacity near cue end can quantize to a fully clear 8-bit alpha frame.

Readiness sampled at request time: 0–3.4 ms software, 0–3.6 ms GPU, with FontFaceSet loaded before
acceptance. These are warm/local-system-face readiness observations, **not cold bundled-font load
measurements**. Real missing-local-font rejection took 3.06/2.97 ms (portrait/landscape software)
and 3.28/3.53 ms (GPU); neither request produced an accepted frame. The original stack then rendered
successfully. CDP identified Malayalam Sangam MN Bold, Arial BoldMT and Apple Color Emoji across
the mixed-script lines; Noto availability was not assumed.

A further cross-mode check decodes 40 corresponding saved PNGs using the same NativeImage API.
It finds identical renderer source hashes but **different pixels in every visible sample**:

| GPU vs software sample | Differing pixels (of 2,073,600) | Max channel delta (0–255) |
| --- | ---: | ---: |
| Portrait static | 10,741 | 4 |
| Landscape static | 30,090 | 3 |
| Landscape explicit multiline | 33,629 | 99 |
| Portrait gradient/glow/depth | 87,895 | 11 |
| Landscape gradient/glow/depth | 266,333 | 12 |

Alpha also differs at some edge/effect pixels. Most differences are small antialias/effect values,
but the multiline outlier makes an invented universal tolerance inappropriate. Same-mode equality
does not establish normal GPU preview vs software export equality. **This is why GPU bitmap mode
is selected despite software being faster.** Both GPU and software repeats are internally stable
with the shared paint-node fix. A fallback must use the same mode in preview/export or explicitly
accept and test a documented cross-mode tolerance; it must not claim byte parity.

Visually inspected portrait word-pop, decomposed signs and gradient/glow/depth plus landscape
vowel signs/conjunct PNGs: no observed detached vowel signs/tofu in the plain/word-pop fixtures.
The styled case exposes existing shared-painter effect crop edges and a gradient-colored emoji
silhouette. Pixel parity faithfully reproduces those artifacts; it is not proof that every style
is visually polished. This ticket records them instead of changing style design outside X1.

Durable raw evidence (case hashes/alpha/readiness, per-process memory samples, runtime/machine,
custom states and renderer source hashes): [GPU measurements](evidence/x1-gpu-bitmap-2026-09-16.json),
[software measurements](evidence/x1-software-2026-09-16.json),
[cross-mode pixels](evidence/x1-cross-mode-2026-09-16.json).
Generated PNGs remain in system temporary directories printed by the command (GPU `caption-x1-yGoe4r`,
software/custom `caption-x1-UAXfiA`); rerunning recreates them. Source hashes are rechecked after each
run, so source changes during a measurement fail the command rather than silently supporting a decision.
To reproduce the cross-mode inspection, pass the two printed output directories to
`electron scripts/export-renderer-compare.mjs <software-directory> <gpu-directory>`.


## Credible maintained alternatives and redistribution

Primary sources checked 2026-09-16. Alternatives below can paint the same React DOM/CSS; none is
given an invented throughput figure. Only the two Electron bitmap modes were benchmarked locally.

| Path | Suitability and maintained evidence | Redistribution / consequence |
| --- | --- | --- |
| Existing Electron offscreen software bitmap — measured fallback | Same Chromium and DOM painter as preview; explicit invalidation; no GPU-to-CPU readback. [Rendering modes](https://www.electronjs.org/docs/latest/tutorial/offscreen-rendering), [paint controls](https://www.electronjs.org/docs/latest/api/web-contents#contentsinvalidate) | Electron 44.3.0 is [MIT](https://github.com/electron/electron/blob/v44.3.0/LICENSE). Preserve Electron notices and the exact distribution's `LICENSES.chromium.html`; Chromium and its included components have separate notices. No additional browser/native addon or rendering subscription. |
| Electron GPU CPU-bitmap readback — selected | Same painter/runtime, CSS transforms supported; readback has an extra memory copy. Local measurements favor software speed, but GPU preserves exact same-mode preview pixels. [API documentation](https://www.electronjs.org/docs/latest/tutorial/offscreen-rendering) | Same runtime licensing. Keep GPU acceleration in the editor; validate driver-specific behavior before using this fallback on Windows. |
| Electron shared GPU texture — deferred optimization | Can avoid CPU readback, but external encoder consumers need native texture integration; transfer/import APIs are experimental. [Shared texture API](https://www.electronjs.org/docs/latest/api/shared-texture) | Same Electron terms plus any chosen addon/encoder dependencies. Handle texture lifetime and OS handles; native ABI/build/signing work on both platforms is unmeasured. |
| Puppeteer-core + explicitly provisioned Chromium — credible fallback, not selected | The same React bundle can accept absolute `timestampUs`; screenshots support transparent backgrounds. Maintained 25.11.0 release rolls Chrome 153, different from our Chromium 152 preview. [Release](https://github.com/puppeteer/puppeteer/releases/tag/puppeteer-v25.11.0), [screenshot options](https://pptr.dev/api/puppeteer.screenshotoptions), [browser provisioning](https://pptr.dev/guides/installation) | [Apache-2.0](https://github.com/puppeteer/puppeteer/blob/puppeteer-v25.11.0/LICENSE): retain license/notices and mark modifications. `puppeteer-core` avoids an automatic browser download, but an exact browser build and its component licenses still need packaging. Driving Electron CDP avoids a second browser but adds a wrapper we do not need. No local throughput or cross-runtime parity claim. |
| Remotion 4.0.525 — maintained, rejected for this product | React frame rendering could wrap our painter; font barriers still required. Its Chrome/frame/composition abstraction adds a second runtime and timing/encoding layer. [Renderer API](https://www.remotion.dev/docs/renderer), [renderFrames](https://www.remotion.dev/docs/renderer/render-frames), [browser management](https://www.remotion.dev/docs/renderer/ensure-browser) | [Exact tag license](https://github.com/remotion-dev/remotion/blob/v4.0.525/LICENSE.md) is conditional, not MIT/Apache: free use is limited to individuals, small for-profit organizations (up to 3 employees), nonprofits and evaluation; others require a Company License. It restricts relicensing/sublicensing derivatives. This does not establish unrestricted redistribution for our future open-source editor or all downstream commercial users. No adoption without explicit vendor clarification of downstream distribution and a fresh license review (5.0 changes are announced). |

Electron supports its latest three stable major lines; review applicable patches before shipping,
retain the lockfile/artifact provenance and rerun the same fixtures after runtime/font changes.
[Electron support policy](https://www.electronjs.org/docs/latest/tutorial/electron-timelines)

Remotion is a credible technical option, and a personal prototype could qualify for free use. That
qualification does not solve the product's offline, unrestricted downstream distribution goal.
It offers no measured advantage for this narrow caption-frame problem, so X1 installs none of its
packages and relies on none of its browser/FFmpeg provisioning.

FFmpeg continues to use ADR 0001's project-owned LGPL-2.1-or-later/no-GPL/no-nonfree build profile.
Compositing PNG frames with its [overlay filter](https://ffmpeg.org/ffmpeg-filters.html#overlay)
can reuse Chromium pixels; `drawtext`/libass would introduce a second caption implementation and
cannot satisfy shared layout/motion parity. PNG input is straight alpha; FFmpeg's overlay alpha and
color conversion must be verified in X2 rather than inferred from a bitmap round trip.

MP4 encoder selection is a separate remaining acceptance gate, not silently solved by this ADR.
The no-GPL profile excludes libx264/libx265. Native platform H.264 routes and permissive OpenH264
are candidates; inspect actual FFmpeg capabilities, quality, source/build/license and patent-related
distribution terms before choosing. Native macOS and Windows encoders must both be measured;
neither was executed here. [FFmpeg codec documentation](https://ffmpeg.org/ffmpeg-codecs.html),
[FFmpeg licensing/compliance](https://ffmpeg.org/legal.html). Do not change the FFmpeg license profile
to obtain an encoder without a separate documented decision.

System faces used here are not redistribution artifacts. Readiness does not prove an installed
face or glyph coverage. No Apple/Microsoft font is copied; Noto Malayalam/Latin exact OFL artifact
pins and cross-platform glyph validation remain D1/D2 requirements. See
[existing font inventory](../CAPTION_RENDERER.md#font-readiness-and-redistribution).

## Limits and next gate

Only macOS arm64, 1080p portrait/landscape caption overlays and the local system font set are
measured. Small custom dimensions exercise resizing, not a 4K performance claim. No Windows,
clean-machine/signing/distribution, long-duration memory soak, encoded video, audio sync, media
rotation, VFR decode mapping or export cancellation is validated. These results select a practical
first GPU implementation; they are not an MP4 export or release-readiness claim.

X2 must build the separate export host and validated bridge, arbitrate heavy jobs, stream a bounded
caption sequence into the separate media worker, measure real PNG/overlay/encode throughput and
memory, choose/test an MP4 profile, mux source audio with exact range offsets, support cancellation
and atomic new-file output, and rerun alpha/sync/parity fixtures on macOS and Windows. X3 expands
pixel/state fixtures to actual encoded-video frames, long pauses, rotation and VFR. D1/D2 pin and
ship font/runtime/tool notices and artifacts. Keep the final Export Video control absent until the
real X2 pipeline is functional.
