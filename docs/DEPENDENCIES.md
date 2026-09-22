# Dependency inventory

## Optional Gemini alignment SDK

`@google/genai` 2.23.0 is the official Gemini JavaScript/TypeScript SDK and is bundled in Electron main only; it is Apache-2.0 licensed. It supports the optional user-initiated `gemini-3.5-transcribe` requests (imported-caption alignment and cloud transcription) and Files API cleanup. The dependency does not make cloud inference mandatory: the local editor, SRT import, estimated timing, local transcription and export remain functional without a key or connection. Before redistribution, retain the SDK's Apache-2.0 license/notice and regenerate the npm production dependency/license report from the committed lockfile. Provider service terms, API availability and user charges are operational concerns rather than redistributed software licenses.

Initial application dependencies were checked against the npm registry on 2026-09-14.

R1 adds no npm dependency or font binary; the lockfile is unchanged. Unicode grapheme segmentation
uses the maintained standards-based `Intl.Segmenter` already supplied by the locked runtime.
[Caption renderer/font inventory](CAPTION_RENDERER.md#font-readiness-and-redistribution) records
the offline system-font stack, actual macOS fallback faces, Noto OFL candidate and unresolved exact
redistributable artifacts. System font availability does not authorize font redistribution; no font
is copied, bundled or release-approved here.

| Dependency | Version | License | Purpose |
| --- | ---: | --- | --- |
| Electron | 44.3.0 | MIT | Desktop shell and native file dialogs |
| React / React DOM | 19.3.0 | MIT | Renderer UI |
| Vite | 8.3.0 | MIT | Renderer development and build |
| TypeScript | 7.0.2 | Apache-2.0 | Static types |
| Zod | 4.6.5 | MIT | Project-file validation |
| Vitest | 4.1.11 | MIT | Unit tests; supports the local Node 25 runtime |
| esbuild | 0.28.2 | MIT | Electron main/preload bundling |
| @modelcontextprotocol/sdk | 1.30.0 | MIT | Local MCP server ([MCP.md](MCP.md)): `McpServer` + `StreamableHTTPServerTransport` in Electron main only. Not in the renderer bundle (verified: `dist-electron/preload.cjs` contains no reference to it). Its `zod` peer range (`^3.25 \|\| ^4.0`) is satisfied by the project's existing Zod 4.6.5 — no second copy. |

Build-only helper packages are recorded in `package-lock.json`. M1 adds no npm dependency and does not change the locked dependency graph. Existing Zod validates the worker protocol and existing esbuild bundles the separate process. T2 selects the download-only model artifacts recorded below. Native transcription engine builds, bundled fonts and installer tooling remain unselected; record their builds and redistribution terms before bundling.

## FFmpeg/ffprobe — M1 decision, 2026-09-14

[ADR 0001](decisions/0001-media-worker-and-ffmpeg.md) records primary-source distribution research, platform coverage, licensing, build visibility, measured/download sizes, updates and offline redistribution. **Selected: project-controlled builds of FFmpeg and ffprobe from the same upstream 9.0.1 source**, with an LGPL-2.1-or-later profile. Invoke standalone executables in a separate media worker; no libav linking into Electron. No Remotion or binary-downloader package is adopted.

| Inventory field | Current evidence / release requirement |
| --- | --- |
| Upstream | [FFmpeg 9.0.1 source](https://ffmpeg.org/releases/ffmpeg-9.0.1.tar.xz); [license at n9.0.1](https://github.com/FFmpeg/FFmpeg/blob/n9.0.1/LICENSE.md) |
| Source checksum | Measured SHA256 `cf38e0e28c7e5605942c4a77755349b0145804a397af37eb1fb4c77cb237f635`; 12,036,420 compressed bytes. PGP verification still required for release artifacts. |
| License/profile | LGPL-2.1-or-later with `--disable-gpl --disable-version3 --disable-nonfree --disable-autodetect --disable-network`. No libx264/libx265, external font/rendering libraries or third-party codecs in the M1 local build. This does not select an MP4 export encoder. |
| Configuration | Full exact local configure command, compiler and binary hashes in ADR 0001. WAV/PCM-only diagnostic profile; not production video codec coverage. Both real tools reported the expected configuration and LGPL 2.1-or-later text. |
| macOS arm64 | Local build executed under Node 25.6.1 and Electron 44.3.0's Node 24.20.0. ffmpeg 1,752,088 bytes + ffprobe 1,592,616 bytes. Production pair/linked libraries, minimum OS and signing remain unverified. |
| Windows x64 | Native upstream build route selected (MinGW-w64/MSYS2 UCRT64); not built or executed here. Exact toolchain version, installed/compressed size, runtime DLL inventory and signing are pending D1/D2. |
| Distribution state | **Nothing bundled, installed by npm or redistributed.** Development binaries and sources are outside the repository in temporary storage. Main accepts explicit absolute executable paths; no PATH lookup or automatic downloads. |
| Release obligations | Archive matching source/patches/build instructions, license texts and component notices (including applicable IJG notice), target manifest, executable checksums, build configuration and runtime dependency inspection. Include corresponding materials in offline distribution and source alongside online binaries. |
| Updates | Project review at least monthly while active and before releases; reviewed/rebuilt matching pair and regression checks. No runtime polling or floating `latest` downloads. |

Rejected alternatives include BtbN's LGPL-3.0-or-later Windows-only coverage for our target pair, GPLv3 Mac/Windows vendor profiles, and stale npm binary wrappers. The sampled `ffmpeg-static` b6.1.1 macOS arm64 FFmpeg executable contains `--enable-nonfree`, so it is not an acceptable redistribution artifact; the wrapper's license does not override that build configuration. See the ADR for exact evidence and sizes.

Before D1/D2 can approve shipping, complete **both** target artifact manifests and production codec tests. Models, fonts and recordings remain outside Git.

## M2 probe-capable development build, 2026-09-14

M2 rebuilt the same verified upstream 9.0.1 source on macOS arm64 with Apple clang 21.0.0 using `--disable-gpl --disable-version3 --disable-nonfree --disable-autodetect --disable-network --disable-doc --disable-debug --disable-ffplay`. This enables FFmpeg's built-in demuxers/decoders for development metadata validation while retaining the selected LGPL-2.1-or-later/no-network profile. The external temporary executables were 21,469,704 bytes (ffmpeg, SHA256 `fc833c1a1c728491f5365e68807d60f8b4407177806a83235c07d00b1566a5ca`) and 21,277,976 bytes (ffprobe, SHA256 `d44040bf560a7cdee1aed2b41cbc55d2168de599f05c44a325efccf1c4adcab3`). They are not committed, bundled or release-approved.

The real smoke input was a locally generated 2.002-second 320×180 MP4/M4V with 30000/1001 H.264 video, AAC 48 kHz mono audio and a 90° display matrix. Generation used the selected build for synthetic MPEG-4/AAC source and rotation metadata plus macOS `avconvert` for a Chromium-playable H.264 transcode. No user recording was read. This verifies the development integration, not a final codec matrix or Windows build.

## M4 thumbnail/proxy-capable development build, 2026-09-14

M4 rebuilt the same verified upstream 9.0.1 source on macOS arm64 with Apple clang 21.0.0 using `--disable-gpl --disable-version3 --disable-nonfree --disable-autodetect --disable-network --disable-doc --disable-debug --disable-ffplay --enable-libvpx --enable-libopus`. `libvpx` (BSD-3-Clause, Homebrew `libvpx` 1.17.0) and `libopus` (BSD-3-Clause, Homebrew `opus` 1.6.1) are both permissively licensed, so adding them keeps the selected LGPL-2.1-or-later/no-GPL/no-nonfree profile from ADR 0001 unchanged; they are the encoder libraries the local proxy-conversion path (WebM/VP8/Opus, chosen because it needs no GPL encoder and Chromium's embedded `<video>` element decodes it natively) requires, and thumbnail extraction uses FFmpeg's own built-in `mjpeg` encoder, needing neither library. The external temporary executables were 21,522,520 bytes (ffmpeg, SHA256 `2602bab5043324d7fea34e67fd9eacae0107e0e6c0d36b8c4fb41f10cbdfa6e8`) and 21,330,808 bytes (ffprobe, SHA256 `7f56e2d8508b8cbf821f7f7f529773a55489eb851cad3b612ceae6d7917ecc2f`). Homebrew-installed `libvpx`/`opus`/`pkgconf` were used only to locate and link these two libraries at local build time via `pkg-config`; nothing from Homebrew is bundled, redistributed or referenced by the shipped application. Neither this pair nor the M2 pair is committed, bundled or release-approved; D1/D2 must decide the final release build's exact `--enable-*` set (this profile is a superset of M1/M2's, so it remains draft, not the release manifest).

Real smoke input: two locally generated 3.003-second 320×180 clips sharing one H.264/AAC-capable synthetic MPEG-4/AAC source (built with this pair's `mpeg4`/`aac` encoders) — `supported-h264.mp4`, transcoded to real H.264/AAC via macOS `avconvert` (Chromium-playable), and `unsupported-mpeg4.mp4`, the untranscoded native MPEG-4 Part 2/AAC MP4 (not decodable by Chromium's embedded player, despite the identical container). No user recording was read or modified; the fixtures were not committed. See `docs/STATUS.md` for the M4 verification this pair produced.


## T2 download-only model catalog — evidence checked 2026-09-15

No npm dependency, lockfile change, model weight bundle or whisper.cpp executable is added.
Node/Electron's existing built-in fetch, asynchronous filesystem I/O and SHA-256 provide the
manager. The initial catalog is deliberately limited to three exact unquantized GGML artifacts;
it makes no promise about arbitrary GGUF, PyTorch, community, quantized or Core ML files.

Publisher: `ggerganov/whisper.cpp`, immutable revision
`5359861c739e955e79d9a303bcbc70fb988958b1`. Exact sizes and SHA-256 values below were read
from the publisher's [revision LFS metadata](https://huggingface.co/api/models/ggerganov/whisper.cpp/revision/5359861c739e955e79d9a303bcbc70fb988958b1?blobs=true)
over HTTPS, rather than measured by downloading weights. These reviewed pins are compiled
into the app and never replaced with a response-supplied checksum. This is publisher trust,
not a signed-artifact verification claim. Automated verification used local fixtures; this task did not initiate a weight-download action.

| Exact artifact | Download / installed bytes | Trusted SHA-256 | Language capability |
| --- | ---: | --- | --- |
| `ggml-base.bin` | 147,951,465 | `60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe` | Multilingual, including Malayalam/English; 99-language Whisper tokenizer |
| `ggml-base.en.bin` | 147,964,211 | `a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002` | English only |
| `ggml-small.bin` | 487,601,967 | `1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b` | Multilingual, including Malayalam/English; 99-language Whisper tokenizer |
| `ggml-large-v3-turbo.bin` | 1,624,555,275 | `1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69` | Multilingual, including Malayalam/English; 99-language Whisper tokenizer; much stronger than base/small on lower-resource languages |
| `ggml-large-v3.bin` | 3,095,033,483 | `64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2` | Multilingual, including Malayalam/English; 99-language Whisper tokenizer; the strongest catalog size for lower-resource languages |

The publisher [model card at the pinned revision](https://huggingface.co/ggerganov/whisper.cpp/blob/5359861c739e955e79d9a303bcbc70fb988958b1/README.md)
declares MIT. OpenAI explicitly releases both code and weights under MIT in its
[Whisper license section](https://github.com/openai/whisper/blob/main/README.md#license)
and [license text](https://github.com/openai/whisper/blob/main/LICENSE).
Retain OpenAI's copyright/license notice with redistributed weights; T2 includes it in
[the model license record](licenses/whisper-MIT.md). These artifacts are downloadable only
by explicit user choice into Electron user data, never project JSON or Git.

Upstream whisper.cpp latest release observed: **v1.9.4**, a maintained candidate, not an
integrated or bundled runtime pin. Its [model documentation at v1.9.4](https://github.com/ggml-org/whisper.cpp/blob/v1.9.4/models/README.md)
identifies the publisher/custom GGML format and distinguishes multilingual models from `.en`.
The [v1.9.4 README](https://github.com/ggml-org/whisper.cpp/blob/v1.9.4/README.md) documents
CPU-only execution, Apple Metal, CUDA build requirements and Mac/Windows build routes.
The catalog shows CPU fallback and conditional Metal/CUDA modes; none are claimed detected
or usable in this app yet. Core ML encoder packages and other accelerators are outside the
catalog. whisper.cpp's [v1.9.4 license](https://github.com/ggml-org/whisper.cpp/blob/v1.9.4/LICENSE)
is MIT (notice retained in the model license record). T3 must select/verify actual executable
builds, GGML load compatibility and device detection on the target platforms. Malayalam
recognition quality and alignment support remain unbenchmarked/unselected.

Updates: review upstream releases, artifact/source identity, metadata and license changes
before modifying the compiled catalog; run manager regression checks. No runtime polling,
automatic model updates or floating-`main` downloads. T3/D1/D2 must add exact engine source,
build configuration, platform binary hashes/notices/size and redistribution materials before
shipping the backend. FFmpeg and fonts retain their existing inventory status.

## T3 whisper.cpp engine and extraction builds — evidence checked 2026-09-15

**Selected: the `whisper-cli` executable from whisper.cpp v1.9.4, built by this project from the upstream tag source**
and run by the separate media worker with fixed argument arrays (`workers/media/whisper.ts`). No npm dependency,
native Node addon, lockfile change or bundled binary is added. A standalone executable keeps the same process
isolation, cancellation and reaping model as FFmpeg and avoids coupling a native addon to Electron's ABI.

| Inventory field | Evidence / decision |
| --- | --- |
| Upstream | [ggml-org/whisper.cpp release v1.9.4](https://github.com/ggml-org/whisper.cpp/releases/tag/v1.9.4), published 2026-09-11T05:31:55Z, tag commit `927cfce34f31707e17f2bff35c349632fb9e2c3a` — the latest non-prerelease in the GitHub releases API at check time; repository not archived, last push 2026-09-14. |
| Source checksum | [Tag archive](https://github.com/ggml-org/whisper.cpp/archive/refs/tags/v1.9.4.tar.gz): 9,353,438 bytes, measured SHA-256 `57e280cee375ab02425b806ad5146b99f6eb9357e3c2b31357c8a6af2e2e44ae`. A measured download checksum, not a signed release artifact. |
| License | [MIT](https://github.com/ggml-org/whisper.cpp/blob/v1.9.4/LICENSE), Copyright (c) 2023-2026 The ggml authors; covers the in-tree ggml. `whisper-cli` also compiles `examples/common-whisper.cpp`, which embeds miniaudio v0.11.24 (public domain or MIT-0) and stb_vorbis v1.22 (MIT or public domain). Notices: [licenses/whisper-MIT.md](licenses/whisper-MIT.md). |
| macOS arm64 build (executed) | Apple clang 21.0.0 (`clang-2100.3.34.2`), macOS SDK 27.0, CMake 4.4.3 from Kitware's `cmake-4.4.3-macos-universal.tar.gz` (SHA-256 `0c5d65251c14cc884bfa16bdbed3c263ce5bffe2e21c0d0d00962cb0610464fa`, matching the GitHub release digest; build tool only, BSD-3-Clause, not installed or committed). Configure: `cmake -B build-release -DCMAKE_BUILD_TYPE=Release -DWHISPER_BUILD_IS_DEV=OFF -DBUILD_SHARED_LIBS=OFF -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF -DWHISPER_BUILD_EXAMPLES=ON -DWHISPER_SDL2=OFF -DWHISPER_CURL=OFF -DWHISPER_COREML=OFF -DWHISPER_COMMON_FFMPEG=OFF -DGGML_NATIVE=OFF -DGGML_METAL=ON -DGGML_METAL_EMBED_LIBRARY=ON`, then `cmake --build build-release -j 12 --config Release --target whisper-cli`. Backends: Metal (embedded shader library) and CPU (NEON, Accelerate BLAS; OpenMP not found). |
| macOS arm64 artifact | `whisper-cli` 4,618,232 bytes, SHA-256 `e7df595a585dcca796d1be6521931d371617f7a54a170587792230072702f50d`; links only system libraries (Accelerate, Foundation, Metal, MetalKit, CoreFoundation, libc++, libobjc, libSystem). `--version` reports `whisper.cpp version: 1.9.4`. Upstream's default `WHISPER_BUILD_IS_DEV=ON` reports `1.9.4-dev`, so release builds must set it OFF. Deployment target, signing and notarization are unset/unverified. |
| Model compatibility | Executed: this build loads the T2 catalog's `ggml-base.bin` (SHA-256 matched the catalog) with Metal (`MTL0`) and CPU (`-ng`). `ggml-base.en.bin`, `ggml-small.bin`, `ggml-large-v3-turbo.bin` and `ggml-large-v3.bin` remain catalog entries not executed by T3. Multilingual models accept the 100 language codes in v1.9.4 `g_lang` plus `auto`; `.en` models accept only `en` (whisper-cli itself forces English for non-multilingual models). |
| Windows x64 strategy (not executed) | Build the same tag with MSVC and CMake: `-DBUILD_SHARED_LIBS=OFF -DGGML_NATIVE=OFF -DWHISPER_SDL2=OFF`, CPU first; add Vulkan/CUDA variants only after their device detection is verified on real hardware. For reference, upstream's `build-windows.yml` builds the release zips with MSVC, `-DGGML_NATIVE=OFF` and, for x64, `-DGGML_BACKEND_DL=ON -DGGML_CPU_ALL_VARIANTS=ON` (DLL backends); upstream `whisper-bin-x64.zip` is 8,573,270 bytes, digest `sha256:f9ec6c52a2e949b62ab51fa21d0d497958f9e41c3010c157c4e42932d5316f3c` — observed, not selected or executed. **Known risk:** v1.9.4 `whisper-cli` reads `argv` in the system ANSI code page on Windows (upstream comment in `cli.cpp` `main`), so non-ASCII model or temporary paths may fail; D2 must test this and either embed a UTF-8 `activeCodePage` manifest or keep engine paths ASCII. |
| FFmpeg used for extraction | Same verified FFmpeg 9.0.1 source and M2 profile (`--disable-gpl --disable-version3 --disable-nonfree --disable-autodetect --disable-network --disable-doc --disable-debug --disable-ffplay`), rebuilt for T3 with Apple clang 21.0.0 (`clang-2100.3.34.2`): ffmpeg 21,667,880 bytes, SHA-256 `0801e27f8ce528f95c84a95afef9893cc7d2b35473565fc2965ae5a4b493a2bd`; ffprobe 21,476,152 bytes, SHA-256 `c7a6219f380def41d399deb05106e586539e366a653bc4ec1ff0c7c17b44f514`. Extraction uses the built-in AAC decoder, `aresample` and the `pcm_s16le`/WAV muxer. The locally installed Homebrew FFmpeg (`--enable-gpl --enable-version3 --enable-libx264 …`) was not used. |
| Distribution state | **Nothing bundled in the app.** For development, `scripts/build-whisper.sh` (invoked automatically by `./dev.sh`, or directly via `npm run tools:whisper`) downloads and verifies the exact pinned source/CMake archives above by SHA-256 and builds this same configuration into the gitignored `.tools/` directory outside Git; the resulting `whisperCliPath` is written to `caption-studio.local.json`. `CAPTION_STUDIO_WHISPER_CLI_PATH` overrides it. The app itself performs no PATH lookup and no engine download. D1/D2 own release manifests, signing and Windows artifacts. |
| Updates | Review upstream releases at least monthly while active and before releases; rebuild, then rerun the parser tests (which include a real v1.9.4 JSON fixture) and `npm run smoke:transcription`. The JSON, `--version`, backend and progress parsers fail closed if upstream output changes. |

Not selected: Homebrew `whisper.cpp` (not a project-controlled pinned build configuration); upstream's macOS release asset (an 57,180,543-byte xcframework, not a CLI executable); npm wrappers or native addons (not evaluated beyond the ABI-coupling concern above).

## T5 dev-only HF→GGML conversion environment — evidence checked 2026-09-15

`scripts/convert-hf-whisper.sh` provisions a **Python** environment (via `uv venv`, Homebrew `uv`
0.12.11) to run the whisper.cpp-provided `models/convert-h5-to-ggml.py` against a community
Hugging Face Whisper fine-tune, so a candidate Malayalam model can be benchmarked
(`npm run bench:transcription`) before any catalog decision. This environment, and everything it
downloads, is **never bundled, shipped, or run by the app**; it exists only on the developer's
machine for T5 evaluation. This Mac's system Python (3.9.6) has no `torch`, so a dedicated venv is
required.

| Package | Version | License |
| --- | ---: | --- |
| torch | 2.9.1 | BSD-3-Clause |
| transformers | 5.9.0 | Apache-2.0 |
| numpy | 2.5.3 | BSD-3-Clause |
| safetensors | 0.8.0 | Apache-2.0 |

The conversion script also fetches `whisper/assets/mel_filters.npz` from `openai/whisper` at
pinned tag `v20250625`, verified by SHA-256 (`7450ae70723a5ef9d341e3cee628c7cb0177f36ce42c44b7ed2bf3325f0f6d4c`,
4,271 bytes) — the tag's own commit, not `main`, so re-running the script later fetches the same
bytes. It is the only file the conversion script needs from that repository (not a clone). The
`openai/whisper` project itself is MIT-licensed.

Unlike T2/T3's pinned single artifacts, the HF fine-tune inputs are **not** pinned in the script
itself: T5 is evaluating several candidate community repos, each fetched at an explicit
repo+revision the caller supplies, with every downloaded file checked against a caller-provided
expected byte size (read from the repo's own file listing beforehand) before being trusted. The
tool prints, but does not pin, the downloaded `model.safetensors`' SHA-256 and the converted
output's SHA-256 — pinning into `src/core/modelCatalog.ts` happens only after a human reviews the
source repo's license and re-verifies that hash, following the same review standard T2's catalog
entries already document above.

Not yet executed: no candidate has actually been downloaded/converted through this script in this
session (see `docs/STATUS.md`). Candidate licenses recorded so far:
`vrclc/Whisper-medium-Malayalam` is Apache-2.0; `Jithjacob123/whisper-small-Malayalam` carries no
license tag (its card claims "Apache 2.0, inherits" without a repo license file);
`Athulkrishna/BettySara-whisper-large-v3-malayalam-merged-afct` is Apache-2.0 on its own repo, but
its parent `BettySara/whisper-large-v3-malayalam-merged` (the actual trained weights) has no
license at all — a blocker for shipping that candidate publicly even if it wins the benchmark.

## X1 Chromium frame renderer — evidence checked 2026-09-16

[ADR 0003](decisions/0003-export-renderer.md) selects **the existing Electron 44.3.0 / Chromium
152.0.7977.78 GPU-accelerated offscreen CPU-bitmap path** with the actual shared React caption
painter. Real source-timestamp frames, same-mode state/pixel parity, alpha/PNG round trips,
font rejection/recovery, throughput and aggregate memory were measured on macOS arm64.
Software mode is faster but differs from the normal GPU preview; it is a fallback requiring an
explicit pixel-tolerance policy. Separate production export-host/worker integration remains X2.

No npm dependency, browser download, font binary, native addon or lockfile dependency graph
change is added. The prototype uses the locked React/React DOM, Zod, esbuild and Electron.
Electron is [MIT at the exact tag](https://github.com/electron/electron/blob/v44.3.0/LICENSE);
retain its copyright/license and the exact Chromium/component notices on redistribution.
Local notice artifacts (not copied into app assets by this ticket):

| Artifact in Electron's installed distribution | Bytes | SHA-256 |
| --- | ---: | --- |
| LICENSE | 1,096 | 5154e165bd6c2cc0cfbcd8916498c7abab0497923bafcd5cb07673fe8480087d |
| LICENSES.chromium.html | 20,111,209 | a62dabd1c6ef1327365b2a3fdffb806222684a746dcb8f4afd1c1f690eba5535 |

Do not label the entire Electron/Chromium distribution MIT; bundled component terms remain
part of the D1/D2 inventory. Review maintained runtime patches before distribution and rerun
fixtures after upgrades. This ticket deliberately does not upgrade the existing runtime pin.

Compared from primary sources, not installed: maintained Puppeteer-core 25.11.0 (Apache-2.0,
plus separately licensed/provisioned browser artifacts); Remotion 4.0.525 (conditional Free /
Company license with derivative/relicensing restrictions, unsuitable without downstream
redistribution clarification); Electron shared textures (native/experimental integration deferred).
Their sources, suitability, maintenance and redistribution implications are in ADR 0003.
**No Remotion adoption or subscription is required.**

Fonts remain local system faces; CDP observed Malayalam Sangam MN Bold, Arial BoldMT and Apple
Color Emoji. No redistribution rights are inferred for Apple/Microsoft faces. Exact Noto OFL
Malayalam/Latin artifacts are still unpinned/unbundled; readiness is not glyph-coverage proof.
The existing font inventory remains authoritative. FFmpeg's project-controlled LGPL-2.1-or-later
configuration stays unchanged; X1 selects no MP4 encoder, GPL library or FFmpeg build change.
X2 must validate PNG alpha/color compositing and a codec profile under a documented license
inventory before exposing working video export. Windows execution/signing remains unverified.

## X2 MP4 export profile and FFmpeg zlib rebuild — evidence checked 2026-09-16

[ADR 0004](decisions/0004-mp4-export-profile.md) selects **`h264_videotoolbox`/AAC-LC in one
documented `mp4-caption-renderer-v1` profile**, macOS-only until a Windows encoder route is measured.
`h264_videotoolbox` is FFmpeg's own `--enable-videotoolbox` configure flag — no separate library,
license or download beyond FFmpeg's existing LGPL terms and Apple's platform frameworks — keeping
ADR 0001's `--disable-gpl` profile unchanged (unlike `libx264`, GPL, or `libopenh264`'s separate
Cisco binary-distribution/patent notice, both rejected). AAC uses FFmpeg's own built-in encoder,
already used by T3's extraction path.

The M1/M2/M4/T3 profile has no PNG codec: `--disable-autodetect` suppresses FFmpeg's automatic
system-zlib detection, and PNG requires zlib. X2 rebuilt the same verified upstream 9.0.1 source on
macOS arm64 with Apple clang 21.0.0, configuration `--disable-gpl --disable-version3
--disable-nonfree --disable-autodetect --disable-network --disable-doc --disable-debug
--disable-ffplay --enable-videotoolbox --enable-zlib --enable-libvpx --enable-libopus`, explicitly
re-enabling zlib against the macOS SDK's system `zlib.h`/`libz.dylib` (zlib license; an implicit
system dependency already, not a new bundled or downloaded artifact) — the same explicit-opt-in
pattern M4 used for libvpx/libopus, which remain unchanged and still serve only the local proxy path.
The pair was built at the project root's `.tools/ffmpeg-9.0.1`: ffmpeg 21,991,192 bytes, SHA-256
`cba780efa231e0551766842304b6a6fc7bf31407e9e89630ce8ca5d82ddf0e84`; ffprobe 21,815,880 bytes,
SHA-256 `6bab2ed9c836aa0e78ba086e0ed57c98023f9170cb430999008e6741733d8222`. Not committed, bundled or
release-approved; the gitignored `caption-studio.local.json` now points at this pair for local
development. Confirmed present in `ffmpeg -encoders`/`-decoders`: `png`, `apng`, `h264_videotoolbox`,
`hevc_videotoolbox`, `aac`, alongside the existing `libvpx`/`libopus`.

Export uses a separate GPU export host process (ADR 0003) piping PNG frames (`image2pipe`) into this
pair; no new npm dependency, browser download or lockfile change. `src/export/ipc.ts` reuses the
existing Zod-validated protocol/job-snapshot pattern established by T1/T3's transcription bridge; no
new runtime dependency. `src/core/exportSupport.ts` gates the renderer's Export Video control on the
real configured tool's own reported `-version` output (mirroring `src/core/proxy.ts`'s established
pattern for the WebM proxy path), never a hardcoded or assumed capability. Full real-media
verification (a real 10 s H.264/AAC export with captions/audio, a real 30000/1001-rate export, and a
real mid-export cancellation) is recorded in ADR 0004 and `docs/STATUS.md`. Windows execution and a
rotated-source real export remain unverified this session; see ADR 0004's limits.
