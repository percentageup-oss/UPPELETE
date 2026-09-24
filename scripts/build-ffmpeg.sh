#!/usr/bin/env bash
# Builds the project-pinned FFmpeg + ffprobe (9.0.1, LGPL-2.1+ profile) for macOS arm64 into
# .tools/ffmpeg-9.0.1/bin. libvpx and libopus (both BSD-3-Clause) are built as static libraries first,
# so the result links only system libraries. Idempotent. Profile: docs/DEPENDENCIES.md (M2/M4/export).
set -euo pipefail
cd "$(dirname "$0")/.."

log() { echo "$@" >&2; }

if [ "$(uname -s)" != "Darwin" ] || [ "$(uname -m)" != "arm64" ]; then
  log "scripts/build-ffmpeg.sh only builds the macOS arm64 configuration."
  exit 1
fi

FFMPEG_VERSION=9.0.1
FFMPEG_URL=https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz
FFMPEG_SHA256=cf38e0e28c7e5605942c4a77755349b0145804a397af37eb1fb4c77cb237f635
LIBVPX_URL=https://github.com/webmproject/libvpx/archive/refs/tags/v1.15.0.tar.gz
LIBVPX_SHA256=e935eded7d81631a538bfae703fd1e293aad1c7fd3407ba00440c95105d2011e
OPUS_URL=https://downloads.xiph.org/releases/opus/opus-1.5.2.tar.gz
OPUS_SHA256=65c1d2f78b9f2fb20082c38cbe47c951ad5839345876e46941612ee87f9a7ce1

ROOT=$PWD/.tools
DOWNLOADS=$ROOT/downloads
PREFIX=$ROOT/ffmpeg-deps
OUT=$ROOT/ffmpeg-${FFMPEG_VERSION}
JOBS=$(sysctl -n hw.ncpu)
mkdir -p "$DOWNLOADS" "$PREFIX"
export COPYFILE_DISABLE=1

if [ -x "$OUT/bin/ffmpeg" ] && "$OUT/bin/ffmpeg" -version 2>&1 | grep -q "ffmpeg version ${FFMPEG_VERSION}"; then
  log "ffmpeg ${FFMPEG_VERSION} already built."
  exit 0
fi

# fetch_verified <url> <sha256> <file>
fetch_verified() {
  local url=$1 expected=$2 dest=$3
  if [ ! -f "$dest" ] || [ "$(shasum -a 256 "$dest" | cut -d' ' -f1)" != "$expected" ]; then
    log "Downloading $(basename "$dest")"
    curl -fL --retry 3 -o "$dest.part" "$url"
    if [ "$(shasum -a 256 "$dest.part" | cut -d' ' -f1)" != "$expected" ]; then
      rm -f "$dest.part"; log "SHA-256 mismatch for $(basename "$dest")"; exit 1
    fi
    mv "$dest.part" "$dest"
  fi
}

fetch_verified "$LIBVPX_URL" "$LIBVPX_SHA256" "$DOWNLOADS/libvpx-1.15.0.tar.gz"
fetch_verified "$OPUS_URL" "$OPUS_SHA256" "$DOWNLOADS/opus-1.5.2.tar.gz"
fetch_verified "$FFMPEG_URL" "$FFMPEG_SHA256" "$DOWNLOADS/ffmpeg-${FFMPEG_VERSION}.tar.xz"

BUILD=$ROOT/ffmpeg-build
rm -rf "$BUILD"; mkdir -p "$BUILD"

log "Building libopus"
tar -xzf "$DOWNLOADS/opus-1.5.2.tar.gz" -C "$BUILD"
( cd "$BUILD/opus-1.5.2" && ./configure --prefix="$PREFIX" --disable-shared --enable-static --disable-doc --disable-extra-programs >/dev/null && make -j"$JOBS" >/dev/null && make install >/dev/null )

log "Building libvpx"
tar -xzf "$DOWNLOADS/libvpx-1.15.0.tar.gz" -C "$BUILD"
( cd "$BUILD/libvpx-1.15.0" && ./configure --prefix="$PREFIX" --disable-shared --enable-static --disable-examples --disable-tools --disable-docs --disable-unit-tests --enable-vp8 --enable-vp9 --enable-pic >/dev/null && make -j"$JOBS" >/dev/null && make install >/dev/null )

log "Building FFmpeg ${FFMPEG_VERSION}"
tar -xJf "$DOWNLOADS/ffmpeg-${FFMPEG_VERSION}.tar.xz" -C "$BUILD"
(
  cd "$BUILD/ffmpeg-${FFMPEG_VERSION}"
  export PKG_CONFIG_PATH="$PREFIX/lib/pkgconfig"
  ./configure --prefix="$OUT" \
    --disable-gpl --disable-version3 --disable-nonfree --disable-autodetect --disable-network \
    --disable-doc --disable-debug --disable-ffplay \
    --enable-videotoolbox --enable-zlib --enable-libvpx --enable-libopus \
    --pkg-config-flags=--static
  make -j"$JOBS"
  make install
)
rm -rf "$BUILD"
"$OUT/bin/ffmpeg" -version | head -3 >&2
