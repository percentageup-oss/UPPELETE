#!/usr/bin/env bash
# Converts a community Hugging Face Whisper fine-tune (safetensors) to whisper.cpp GGML F16, for
# local benchmarking only (T5/Malayalam ASR selection). This is a dev-only tool: its output is
# never downloaded, referenced or trusted by the app itself. A converted file only becomes a real
# catalog candidate after a human inspects the source repo, reviews its license, and re-verifies
# the printed SHA-256 before pinning it into src/core/modelCatalog.ts (see docs/MODELS.md).
#
# Deliberately not pinned to one repo/revision: benchmarking is exploratory across several
# community fine-tunes, unlike the exact single artifacts scripts/build-whisper.sh builds. Every
# file this script fetches is still checked against the expected byte size from the caller
# (read off the Hugging Face repo's file listing beforehand) before being trusted; it prints, but
# does not itself pin, the resulting SHA-256.
#
# Usage:
#   scripts/convert-hf-whisper.sh <hf-repo> <revision> <out-dir> \
#     <config.json-bytes> <vocab.json-bytes> <added_tokens.json-bytes> <model.safetensors-bytes> \
#     [subpath-inside-repo]
#
# Example (vrclc/Whisper-medium-Malayalam @ 5195c667d390cdabb56d0e9fce5efbe3a638cd03):
#   scripts/convert-hf-whisper.sh vrclc/Whisper-medium-Malayalam \
#     5195c667d390cdabb56d0e9fce5efbe3a638cd03 .tools/converted/vrclc-medium-ml \
#     1320 34604 493869... # (see: scripts/convert-hf-whisper.sh with no args for the field list)
set -euo pipefail
cd "$(dirname "$0")/.."

log() { echo "$@" >&2; }

if [ "$(uname -s)" != "Darwin" ] || [ "$(uname -m)" != "arm64" ]; then
  log "scripts/convert-hf-whisper.sh only supports the verified macOS arm64 development configuration."
  exit 1
fi

REPO=${1:-}
REVISION=${2:-}
OUT_DIR=${3:-}
CONFIG_BYTES=${4:-}
VOCAB_BYTES=${5:-}
ADDED_TOKENS_BYTES=${6:-}
SAFETENSORS_BYTES=${7:-}
SUBPATH=${8:-}
if [ -z "$REPO" ] || [ -z "$REVISION" ] || [ -z "$OUT_DIR" ] || [ -z "$CONFIG_BYTES" ] || [ -z "$VOCAB_BYTES" ] || [ -z "$ADDED_TOKENS_BYTES" ] || [ -z "$SAFETENSORS_BYTES" ]; then
  log "Usage: scripts/convert-hf-whisper.sh <hf-repo> <revision> <out-dir> <config.json-bytes> <vocab.json-bytes> <added_tokens.json-bytes> <model.safetensors-bytes> [subpath-inside-repo]"
  log "Byte sizes are the caller's own pinned expectation (read from the repo's file listing before running this), verified against what is actually downloaded."
  exit 1
fi
WHISPER_CPP_VERSION=1.9.4
CONVERT_SCRIPT=.tools/whisper.cpp-${WHISPER_CPP_VERSION}/models/convert-h5-to-ggml.py
if [ ! -f "$CONVERT_SCRIPT" ]; then
  log "$CONVERT_SCRIPT is missing. Run ./dev.sh or npm run tools:whisper first to fetch the pinned whisper.cpp ${WHISPER_CPP_VERSION} source."
  exit 1
fi

# openai/whisper's convert script only needs whisper/assets/mel_filters.npz from the reference
# repo, not a full clone. Pinned to tag v20250625; size/hash measured directly from that tag.
WHISPER_ASSET_URL=https://raw.githubusercontent.com/openai/whisper/v20250625/whisper/assets/mel_filters.npz
WHISPER_ASSET_SHA256=7450ae70723a5ef9d341e3cee628c7cb0177f36ce42c44b7ed2bf3325f0f6d4c
WHISPER_ASSET_BYTES=4271

ROOT=.tools
DOWNLOADS=$ROOT/downloads/hf-whisper
VENV_DIR=$ROOT/convert-venv
ASSET_ROOT=$ROOT/openai-whisper-assets
mkdir -p "$DOWNLOADS" "$ASSET_ROOT/whisper/assets"

file_size() { stat -f%z "$1" 2>/dev/null || stat -c%s "$1"; }

# fetch_sized <url> <expected bytes> <dest>: downloads (or reuses an exact-size cached copy),
# rejects a mismatched size outright, and never trusts a redirected response we did not ask for.
fetch_sized() {
  local url=$1 expected=$2 dest=$3 actual
  if [ -f "$dest" ] && actual=$(file_size "$dest") && [ "$actual" = "$expected" ]; then
    log "Using cached $(basename "$dest") ($actual bytes)."
    return 0
  fi
  log "Downloading $(basename "$dest") (expecting $expected bytes) from $url"
  curl -fL --retry 3 -o "$dest.part" "$url"
  actual=$(file_size "$dest.part")
  if [ "$actual" != "$expected" ]; then
    rm -f "$dest.part"
    log "Size mismatch for $(basename "$dest"): expected $expected bytes, got $actual. Refusing to use it — re-check the pinned size against the repo's current file listing."
    exit 1
  fi
  mv "$dest.part" "$dest"
}

fetch_sha256_verified() {
  local url=$1 expected_sha=$2 dest=$3 actual
  if [ -f "$dest" ] && actual=$(shasum -a 256 "$dest" | cut -d' ' -f1) && [ "$actual" = "$expected_sha" ]; then
    log "Using cached $(basename "$dest")."
    return 0
  fi
  log "Downloading $(basename "$dest") from $url"
  curl -fL --retry 3 -o "$dest.part" "$url"
  actual=$(shasum -a 256 "$dest.part" | cut -d' ' -f1)
  if [ "$actual" != "$expected_sha" ]; then
    rm -f "$dest.part"
    log "SHA-256 mismatch for $(basename "$dest"): expected $expected_sha, got $actual"
    exit 1
  fi
  mv "$dest.part" "$dest"
}

fetch_sha256_verified "$WHISPER_ASSET_URL" "$WHISPER_ASSET_SHA256" "$ASSET_ROOT/whisper/assets/mel_filters.npz"

# --- Python conversion environment (idempotent: reused if already provisioned) ---------------
TORCH_VERSION=2.9.1
TRANSFORMERS_VERSION=5.9.0
NUMPY_VERSION=2.5.3
SAFETENSORS_VERSION=0.8.0
STAMP="$VENV_DIR/.versions-${TORCH_VERSION}-${TRANSFORMERS_VERSION}-${NUMPY_VERSION}-${SAFETENSORS_VERSION}"
if [ ! -f "$STAMP" ]; then
  log "Provisioning conversion environment (torch ${TORCH_VERSION}, transformers ${TRANSFORMERS_VERSION}, numpy ${NUMPY_VERSION}, safetensors ${SAFETENSORS_VERSION})."
  rm -rf "$VENV_DIR"
  uv venv "$VENV_DIR" >&2
  uv pip install --python "$VENV_DIR/bin/python" \
    "torch==${TORCH_VERSION}" "transformers==${TRANSFORMERS_VERSION}" "numpy==${NUMPY_VERSION}" "safetensors==${SAFETENSORS_VERSION}" >&2
  touch "$STAMP"
fi
PYTHON="$VENV_DIR/bin/python"

# --- Download the pinned HF model files (minimal set convert-h5-to-ggml.py actually reads) ---
REPO_SLUG=$(echo "$REPO" | tr '/' '_')
MODEL_DIR=$DOWNLOADS/${REPO_SLUG}_${REVISION}
PREFIX=""
[ -n "$SUBPATH" ] && PREFIX="${SUBPATH%/}/"
mkdir -p "$MODEL_DIR"
BASE_URL="https://huggingface.co/${REPO}/resolve/${REVISION}"
fetch_sized "${BASE_URL}/${PREFIX}config.json" "$CONFIG_BYTES" "$MODEL_DIR/config.json"
fetch_sized "${BASE_URL}/${PREFIX}vocab.json" "$VOCAB_BYTES" "$MODEL_DIR/vocab.json"
fetch_sized "${BASE_URL}/${PREFIX}added_tokens.json" "$ADDED_TOKENS_BYTES" "$MODEL_DIR/added_tokens.json"
fetch_sized "${BASE_URL}/${PREFIX}model.safetensors" "$SAFETENSORS_BYTES" "$MODEL_DIR/model.safetensors"

MODEL_SHA256=$(shasum -a 256 "$MODEL_DIR/model.safetensors" | cut -d' ' -f1)
log "Downloaded model.safetensors SHA-256: $MODEL_SHA256 (record this in docs/DEPENDENCIES.md if this candidate is later pinned into the catalog)."

# --- Convert -----------------------------------------------------------------------------------
mkdir -p "$OUT_DIR"
log "Converting to GGML F16 (this loads the full model in torch; expect it to take a few minutes and several GB of RAM)."
"$PYTHON" "$CONVERT_SCRIPT" "$MODEL_DIR" "$ASSET_ROOT" "$OUT_DIR"

OUTPUT_FILE="$OUT_DIR/ggml-model.bin"
if [ ! -f "$OUTPUT_FILE" ]; then
  log "Conversion finished but $OUTPUT_FILE was not produced."
  exit 1
fi
OUTPUT_SHA256=$(shasum -a 256 "$OUTPUT_FILE" | cut -d' ' -f1)
OUTPUT_BYTES=$(file_size "$OUTPUT_FILE")
log "Wrote $OUTPUT_FILE ($OUTPUT_BYTES bytes, SHA-256 $OUTPUT_SHA256)."
printf '%s\n' "$(cd "$(dirname "$OUTPUT_FILE")" && pwd)/$(basename "$OUTPUT_FILE")"
