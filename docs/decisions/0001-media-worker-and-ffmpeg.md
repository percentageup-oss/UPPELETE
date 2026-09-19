# ADR 0001 — Local media worker and FFmpeg/ffprobe distribution

Date: 2026-09-14. Status: accepted for M1; no binary redistribution in this ticket.

## Decision

Use FFmpeg and ffprobe as **separate command-line executables**, behind a validated TypeScript worker process. Select **project-controlled builds from the same upstream FFmpeg source release**, initially **9.0.1**, with `--disable-gpl --disable-version3 --disable-nonfree --disable-autodetect --disable-network`. The intended aggregate FFmpeg license is **LGPL-2.1-or-later**. Do not install an npm binary downloader, depend on a user's PATH, or adopt Remotion. Renderer code does not import the worker client or choose executable paths.

For development, main explicitly supplies absolute paths to local tools (from `CAPTION_STUDIO_*` variables or, in unpackaged runs only, the gitignored `caption-studio.local.json`; see [MEDIA_WORKER.md](../MEDIA_WORKER.md)). M1 includes no runtime downloads or bundled tools. D1/D2 must build, inventory and package the matching pair for each target outside ASAR; users of the eventual packaged app must not need Homebrew, npm, an account or a network connection. This selects the build owner, source baseline, licensing profile and integration method now; it does not claim that a production codec matrix or release artifacts have been validated.

This costs build/release maintenance. It gives us the same source baseline on macOS arm64 and Windows x64, inspectable configuration, a small feature set, and control over network protocols and external libraries. FFmpeg distributes source rather than official binaries. The published current stable release is 9.0.1 (2026-08-12); upstream describes roughly six-month major releases and selective fixes on release branches. [Upstream downloads and release policy](https://ffmpeg.org/download.html)

## Primary-source comparison

Evidence checked on 2026-09-14. Sizes below are **bytes**, except explicitly labelled publisher MB figures. Compressed downloads are not installed sizes; archives containing ffplay, DLLs and documentation are not comparable to a two-executable pair. Rolling URLs are observations, not artifact pins.

| Option | Target support and maintenance | Licensing and build visibility | Size evidence and offline redistribution |
| --- | --- | --- | --- |
| Upstream source, built by this project — selected | Native Apple toolchain; Windows x64 via MinGW-w64/MSYS2 UCRT64 or MSVC. Both target build routes are documented, but only arm64 was executed here. | Selected flags produce LGPL-2.1-or-later; configuration/logs/source are under our control. No external codec libraries in the M1 smoke build. | 9.0.1 source archive: **12,036,420** downloaded bytes. Minimal local arm64 executables: **1,752,088** ffmpeg + **1,592,616** ffprobe, total **3,344,704**. These are a WAV-only diagnostic build, not a product size estimate. Windows/product size remains unmeasured. Offline redistribution requires the license/source/build materials described below. [Source](https://ffmpeg.org/releases/ffmpeg-9.0.1.tar.xz), [platform build instructions](https://ffmpeg.org/platform.html) |
| BtbN FFmpeg-Builds — viable Windows alternative | Windows x64, Windows arm64 and Linux; **no macOS** autobuild. Daily at 12:00 UTC; retains 14 daily builds and monthly final builds for two years. Windows minimum supported version: 10 22H2. | `lgpl` is **LGPL-3.0-or-later**, not LGPL 2.1: defaults enable version3 and package `COPYING.LGPLv3`. GPL-only libraries omitted. Public scripts, dependency recipes and patches; inspect the actual binaries too. | Observed 2026-09-13 release-branch `ffmpeg-n9.0-latest-win64-lgpl-9.0.zip`: **170,475,752**; shared variant **76,391,676**. These are whole ZIPs, not installed pair sizes. Redistributable under LGPLv3 plus component terms with matching source; archive the exact revision and sources ourselves because retention expires. [README](https://github.com/BtbN/FFmpeg-Builds/blob/3e6685eda92f9288c15ac320139622dcedca09a4/README.md), [license defaults](https://github.com/BtbN/FFmpeg-Builds/blob/3e6685eda92f9288c15ac320139622dcedca09a4/variants/defaults-lgpl.sh), [release asset metadata](https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/latest) |
| Martin Riedl builds — native Mac alternative | macOS arm64 and Intel plus Linux; **no Windows** offering. Release 9.0.1 arm64 built 2026-08-18; arm64 snapshot dated 2026-09-12. Site offers both snapshot/release tracks; no fixed security-update SLA found. | Published 9.0.1 arm64 configuration enables GPL and version3, giving **GPL-3.0-or-later** for FFmpeg (inference from those flags); no nonfree flag. Public build scripts and per-build external-library versions. ZIP binaries signed; installers notarized. | Versioned arm64 ZIP HEAD lengths: **28,447,413** ffmpeg + **28,370,930** ffprobe. Installed sizes not measured. Offline GPL redistribution needs matching source/build details and third-party notices; a signed ZIP alone is not a compliance bundle. [Build server](https://ffmpeg.martin-riedl.de/), [specific configuration](https://ffmpeg.martin-riedl.de/download/macos/arm64/1787073674_9.0.1/versions.txt), [build scripts](https://git.martin-riedl.de/ffmpeg/build-script) |
| `ffmpeg-static` / `@derhuerst/ffprobe-static` — rejected installer wrappers | macOS arm64 and Windows x64 assets available, but current repository pins FFmpeg **6.1.1** (`b6.1.1`, release metadata dated 2025-11-14), behind upstream maintenance releases. Wrapper SemVer does not track FFmpeg compatibility; no binary-update SLA found. | Wrapper repository declares **GPL-3.0-or-later**; binary terms are separate. Windows vendor is Gyan; arm64 vendor is OSXExperts. Sampled arm64 FFmpeg executable embeds `--enable-gpl --enable-version3 --enable-nonfree`: **nonredistributable FFmpeg configuration**, despite its generic LICENSE file. Windows vendor profile is GPL-3.0-or-later. Build/source provenance must be checked per artifact. | arm64 raw pair **91,097,024**, gzip pair **38,453,275**; Windows raw pair **165,465,600**, gzip pair **59,102,951**. Install downloads a platform-specific asset; the inspected arm64 FFmpeg artifact is rejected for redistribution. Windows offline packaging would require GPL compliance. Avoid installation-time network coupling and stale binary pins. [Package README](https://github.com/eugeneware/ffmpeg-static/blob/master/packages/ffmpeg-static/README.md), [package metadata](https://github.com/eugeneware/ffmpeg-static/blob/master/package.json), [asset metadata](https://api.github.com/repos/eugeneware/ffmpeg-static/releases/tags/b6.1.1) |

Other maintained options checked:

- **Gyan**: Windows x64 only; publisher labels its FFmpeg/ffprobe builds GPLv3 (the FFmpeg version3 profile is GPL-3.0-or-later). Full/shared and essentials packages, SHA256 files, source commit links, library versions and configuration in README. Latest build date 2026-09-14; next shown as 2026-09-17. Publisher's older 8.1.2 essentials archive example is 32 MB (7z) / 104 MB (ZIP); installed pair not measured. GPL redistribution/source obligations still apply offline. Not selected because of the GPL profile and missing native Mac counterpart. [Publisher](https://www.gyan.dev/ffmpeg/builds/)
- **Evermeet**: current snapshots/releases, public configuration and signatures, but explicitly **no native Apple Silicon binaries planned**. Configuration includes GPL and version3: GPL-3.0-or-later. No Windows build. Not a native target candidate; download/installed sizes were not measured after the architecture exclusion. Rosetta is not our Apple Silicon strategy. [Publisher, configuration and ARM policy](https://evermeet.cx/ffmpeg/)

Direct inspection of the [b6.1.1 arm64 FFmpeg asset](https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-darwin-arm64), downloaded only to external temporary storage, found the three flags `--enable-gpl --enable-version3 --enable-nonfree` in its embedded configure string and the embedded library-license value `nonfree and unredistributable`. Measured SHA256: `a90e3db6a3fd35f6074b013f948b1aa45b31c6375489d39e572bea3f18336584`, size 45,568,216 bytes. Inspection used `/usr/bin/strings`; this rejected vendor binary was not executed. This evidence concerns that exact FFmpeg artifact, not every version of OSXExperts or the npm wrappers.

The comparison deliberately does not assign a fabricated universal license to every dependency in a vendor bundle. The aggregate FFmpeg license is given where flags/publisher evidence identify it; each bundled library still needs its own inventory. Missing source provenance or measured installed size is a release acceptance gap, not implicit approval.

## Redistribution and update policy

FFmpeg's source license distinguishes LGPL-2.1-or-later, optional GPL code, the version3 switch, and nonfree combinations that cannot be redistributed. Disabling GPL excludes libx264/libx265; codec export selection must be revisited in X1 without silently changing this profile. Some source files also require notices such as IJG attribution. [Pinned FFmpeg license](https://github.com/FFmpeg/FFmpeg/blob/n9.0.1/LICENSE.md)

Our release process must retain exact source and patches, configure arguments, compiler/SDK versions, dependency versions/licenses, `-version`, `-buildconf`, `-L`, linked-library inspection, per-file SHA256, compressed and installed byte counts, and architecture/minimum OS. Ship license/attribution and corresponding source/build materials with offline distributions and mirror the matching source alongside online binaries. Preserve the ability to replace/rebuild the tools and applicable LGPL rights. The separate-process design does not waive redistribution obligations. No FFmpeg library is linked into Electron. [FFmpeg's compliance guidance](https://ffmpeg.org/legal.html), [LGPL 2.1 text in the pinned source](https://github.com/FFmpeg/FFmpeg/blob/n9.0.1/COPYING.LGPLv2.1)

Project policy: review upstream/security changes before every app release and at least monthly during active development; patch serious applicable issues before the next distribution. Updates are reviewed artifact changes with codec/timing regression tests, not downloads from `latest` on application startup. Keep previous manifest/source artifacts for rollback. Pin source and platform artifact checksums, verify upstream release signatures, and rebuild both tools together. No periodic network activity or automatic updating is added to the application by M1. [Upstream security advisories](https://ffmpeg.org/security.html)

## M1 local build evidence

Built from `https://ffmpeg.org/releases/ffmpeg-9.0.1.tar.xz`, downloaded SHA256:
`cf38e0e28c7e5605942c4a77755349b0145804a397af37eb1fb4c77cb237f635`.
This is a measured download checksum; upstream PGP verification was **not** performed in M1. It is not a signed production artifact pin.

On macOS arm64, Apple clang 21.0.0 (`clang-2100.1.1.101`), in an external temporary build directory:

```sh
./configure --disable-gpl --disable-version3 --disable-nonfree \
  --disable-autodetect --disable-network --disable-doc --disable-debug \
  --disable-ffplay --disable-everything --enable-protocol=file,pipe \
  --enable-demuxer=wav --enable-decoder=pcm_s16le --enable-muxer=wav \
  --enable-encoder=pcm_s16le --enable-filter=aresample --enable-small
make -j8
```

Both executables returned 9.0.1, the above configuration and LGPL version 2.1-or-later through the real worker. Measured binary SHA256:

- ffmpeg: `c1a8262e8c918b4e36a3c0d708ec462069b114b6a3e5ce87644d9e66e74812d6`
- ffprobe: `1239285e57630b7c1da60cd81b418598fc92e1b04836cc395d5583ec845e2131`

No media was opened or modified for this diagnostic; only `-version` and `-L` ran. Source, binaries and build outputs stay outside Git. CPU-only diagnostic success says nothing about GPU acceleration, video codec coverage or Windows runtime support. Production profiles, signing, source-package verification and Windows size/execution measurements remain D1/D2 work; M2 must enable/test real input formats before claiming metadata support.

## Worker contract and consequences

The executable contract is in `workers/media/protocol.ts`; usage and lifecycle details are in [MEDIA_WORKER.md](../MEDIA_WORKER.md). Main owns process creation and configuration. M1 implements `runtime` and `inspectToolchain`; probe, waveform, thumbnails, audio extraction and export are validated reserved operations returning `UNSUPPORTED_OPERATION`. No media controls or fake progress were added.

The protocol carries source microseconds, rational rates, explicit source offsets, structured failures, measured-or-indeterminate progress and cancellation. It cannot carry arbitrary executable names or FFmpeg arguments. Future export receives a manifest from the shared caption renderer; this does not select a render engine or bypass Malayalam shaping. M2/M3/M4 and X1/X2 must implement their real operations and output safety before exposing them to the UI.
