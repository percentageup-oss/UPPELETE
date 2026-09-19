#!/usr/bin/env bash
# Builds the project-pinned whisper-cli (whisper.cpp v1.9.4) for local development.
# Idempotent: reuses a previously verified build. Prints only the absolute binary path on stdout;
# all progress/log output goes to stderr. See docs/DEPENDENCIES.md for the pinned sources and hashes.
set -euo pipefail
cd "$(dirname "$0")/.."

log() { echo "$@" >&2; }
# This project directory can live on an ExFAT volume, where macOS represents each extracted file's
# extended attributes as a separate "._name" AppleDouble sidecar. CMake's own compiler-detection glob
# (Compiler/*-DetermineCompiler.cmake) matches those sidecars too and tries to parse them as scripts,
# which fails. COPYFILE_DISABLE stops tar from writing them going forward; the cleanup below removes
# any this project's own gitignored "._*" pattern already lets through (e.g. from a prior run).
export COPYFILE_DISABLE=1
strip_apple_doubles() { find "$1" -name '._*' -delete; }

if [ "$(uname -s)" != "Darwin" ] || [ "$(uname -m)" != "arm64" ]; then
  log "scripts/build-whisper.sh only builds the verified macOS arm64 configuration (see docs/DEPENDENCIES.md 'Windows x64 strategy')."
  exit 1
fi

WHISPER_VERSION=1.9.4
WHISPER_TAR_URL=https://github.com/ggml-org/whisper.cpp/archive/refs/tags/v${WHISPER_VERSION}.tar.gz
WHISPER_TAR_SHA256=57e280cee375ab02425b806ad5146b99f6eb9357e3c2b31357c8a6af2e2e44ae
CMAKE_VERSION=4.4.3
CMAKE_TAR_URL=https://github.com/Kitware/CMake/releases/download/v${CMAKE_VERSION}/cmake-${CMAKE_VERSION}-macos-universal.tar.gz
CMAKE_TAR_SHA256=0c5d65251c14cc884bfa16bdbed3c263ce5bffe2e21c0d0d00962cb0610464fa
# Reference only; a real clang/SDK difference legitimately changes this, so it is not enforced.
WHISPER_CLI_REFERENCE_SHA256=e7df595a585dcca796d1be6521931d371617f7a54a170587792230072702f50d

ROOT=.tools
DOWNLOADS=$ROOT/downloads
CMAKE_DIR=$ROOT/cmake-${CMAKE_VERSION}
SOURCE_DIR=$ROOT/whisper.cpp-${WHISPER_VERSION}
INSTALLED=$SOURCE_DIR/bin/whisper-cli
mkdir -p "$DOWNLOADS"

# already installed and verified?
if [ -x "$INSTALLED" ]; then
  if version=$("$INSTALLED" --version 2>&1) && [[ "$version" == "whisper.cpp version: ${WHISPER_VERSION}" ]]; then
    log "whisper-cli ${WHISPER_VERSION} already built."
    printf '%s\n' "$(cd "$(dirname "$INSTALLED")" && pwd)/$(basename "$INSTALLED")"
    exit 0
  fi
  log "Existing $INSTALLED did not report whisper.cpp version: ${WHISPER_VERSION} (got: ${version:-<none>}); rebuilding."
  rm -f "$INSTALLED"
fi

# fetch_verified <url> <expected sha256> <destination file>
fetch_verified() {
  local url=$1 expected=$2 dest=$3 actual
  if [ -f "$dest" ] && actual=$(shasum -a 256 "$dest" | cut -d' ' -f1) && [ "$actual" = "$expected" ]; then
    log "Using cached $(basename "$dest")."
    return 0
  fi
  log "Downloading $(basename "$dest") from $url"
  curl -fL --retry 3 -o "$dest.part" "$url"
  actual=$(shasum -a 256 "$dest.part" | cut -d' ' -f1)
  if [ "$actual" != "$expected" ]; then
    rm -f "$dest.part"
    log "SHA-256 mismatch for $(basename "$dest"): expected $expected, got $actual"
    exit 1
  fi
  mv "$dest.part" "$dest"
}

fetch_verified "$WHISPER_TAR_URL" "$WHISPER_TAR_SHA256" "$DOWNLOADS/whisper.cpp-${WHISPER_VERSION}.tar.gz"
fetch_verified "$CMAKE_TAR_URL" "$CMAKE_TAR_SHA256" "$DOWNLOADS/cmake-${CMAKE_VERSION}-macos-universal.tar.gz"

CMAKE_BIN=$CMAKE_DIR/CMake.app/Contents/bin/cmake
if [ ! -x "$CMAKE_BIN" ]; then
  log "Extracting CMake ${CMAKE_VERSION}."
  rm -rf "$CMAKE_DIR"
  mkdir -p "$CMAKE_DIR"
  tar -xzf "$DOWNLOADS/cmake-${CMAKE_VERSION}-macos-universal.tar.gz" -C "$CMAKE_DIR" --strip-components=1
  strip_apple_doubles "$CMAKE_DIR"
fi

rm -rf "$SOURCE_DIR"
mkdir -p "$SOURCE_DIR"
log "Extracting whisper.cpp ${WHISPER_VERSION} source."
tar -xzf "$DOWNLOADS/whisper.cpp-${WHISPER_VERSION}.tar.gz" -C "$SOURCE_DIR" --strip-components=1
strip_apple_doubles "$SOURCE_DIR"

BUILD_DIR=$(mktemp -d "$ROOT/build.XXXXXX")
trap 'rm -rf "$BUILD_DIR"' EXIT

log "Configuring (Metal + CPU, release, no shared libs)."
"$CMAKE_BIN" -S "$SOURCE_DIR" -B "$BUILD_DIR" \
  -DCMAKE_BUILD_TYPE=Release -DWHISPER_BUILD_IS_DEV=OFF -DBUILD_SHARED_LIBS=OFF \
  -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF -DWHISPER_BUILD_EXAMPLES=ON \
  -DWHISPER_SDL2=OFF -DWHISPER_CURL=OFF -DWHISPER_COREML=OFF -DWHISPER_COMMON_FFMPEG=OFF \
  -DGGML_NATIVE=OFF -DGGML_METAL=ON -DGGML_METAL_EMBED_LIBRARY=ON >&2

log "Building whisper-cli."
"$CMAKE_BIN" --build "$BUILD_DIR" -j "$(sysctl -n hw.ncpu)" --config Release --target whisper-cli >&2

BUILT=$(find "$BUILD_DIR" -type f -name whisper-cli -perm -u+x | head -1)
if [ -z "$BUILT" ]; then
  log "Build finished but whisper-cli was not found under $BUILD_DIR."
  exit 1
fi

version=$("$BUILT" --version 2>&1) || true
if [[ "$version" != "whisper.cpp version: ${WHISPER_VERSION}" ]]; then
  log "Built binary reported unexpected version (got: ${version:-<none>}); expected whisper.cpp version: ${WHISPER_VERSION}."
  exit 1
fi

actual_sha=$(shasum -a 256 "$BUILT" | cut -d' ' -f1)
if [ "$actual_sha" != "$WHISPER_CLI_REFERENCE_SHA256" ]; then
  log "Note: built whisper-cli SHA-256 ($actual_sha) differs from the documented reference build ($WHISPER_CLI_REFERENCE_SHA256); expected with a different clang/SDK."
fi

mkdir -p "$(dirname "$INSTALLED")"
cp "$BUILT" "$INSTALLED.tmp"
chmod +x "$INSTALLED.tmp"
mv "$INSTALLED.tmp" "$INSTALLED"
log "Installed whisper-cli ${WHISPER_VERSION} (SHA-256 $actual_sha)."
printf '%s\n' "$(cd "$(dirname "$INSTALLED")" && pwd)/$(basename "$INSTALLED")"
