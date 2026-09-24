#!/usr/bin/env bash
# Development launcher for Caption Studio.
#   ./dev.sh            Vite dev server + Electron with hot reload
#   ./dev.sh electron   production build, then `npx electron .`
#   ./dev.sh smoke      Electron-hosted media-worker smoke
# On first run it asks for the local ffmpeg/ffprobe paths, builds the pinned whisper-cli (whisper.cpp
# 1.9.4) if needed, and saves everything to the gitignored caption-studio.local.json; afterwards it
# exports them as CAPTION_STUDIO_* and launches.
set -euo pipefail
cd "$(dirname "$0")"
# Inherited from Electron-hosted shells (e.g. editor extension hosts); it makes `electron .` run as plain Node.
# The media-worker client sets it only for the worker process it spawns.
unset ELECTRON_RUN_AS_NODE

CONFIG=caption-studio.local.json
mode="${1:-dev}"
case "$mode" in
  dev|electron|smoke) ;;
  *) echo "Usage: ./dev.sh [dev|electron|smoke]" >&2; exit 2 ;;
esac

command -v node >/dev/null || { echo "Node.js 22.12 or newer is required." >&2; exit 1; }
[ -d node_modules ] || npm install

# ask_tool <label> <command name> <required|optional>; prints the chosen absolute path (or nothing).
ask_tool() {
  local label=$1 suggestion answer hint
  suggestion=$(command -v "$2" || true)
  while true; do
    hint=""
    [ -n "$suggestion" ] && hint=" [$suggestion]"
    [ "$3" = optional ] && hint="$hint (type 'skip' to leave unset)"
    read -r -p "$label path$hint: " answer
    answer=${answer:-$suggestion}
    if [ "$3" = optional ] && { [ -z "$answer" ] || [ "$answer" = skip ]; }; then return 0; fi
    if [[ "$answer" != /* ]]; then echo "  Enter an absolute path." >&2
    elif [ ! -x "$answer" ] || [ -d "$answer" ]; then echo "  $answer is not an executable file." >&2
    else printf '%s\n' "$answer"; return 0
    fi
  done
}

if [ ! -f "$CONFIG" ]; then
  if [ ! -t 0 ]; then
    echo "$CONFIG is missing. Copy caption-studio.local.example.json to $CONFIG and set absolute tool paths." >&2
    exit 1
  fi
  echo "First run: choose the local media tools. They are saved to $CONFIG (gitignored)."
  ffmpeg=$(ask_tool ffmpeg ffmpeg required)
  ffprobe=$(ask_tool ffprobe ffprobe required)
  FFMPEG="$ffmpeg" FFPROBE="$ffprobe" CONFIG="$CONFIG" node -e '
    const config = { ffmpegPath: process.env.FFMPEG, ffprobePath: process.env.FFPROBE }
    require("node:fs").writeFileSync(process.env.CONFIG, JSON.stringify(config, null, 2) + "\n")'
  echo "Saved $CONFIG. Edit or delete it to change tools."
fi

# Build the pinned whisper-cli automatically when nothing usable is configured yet (unset, or the
# configured path no longer exists/isn't executable — e.g. it lived under a cleaned temp directory).
configured_whisper() { CONFIG="$CONFIG" node -e '
  const fs = require("node:fs")
  try { const c = JSON.parse(fs.readFileSync(process.env.CONFIG, "utf8")); if (typeof c.whisperCliPath === "string") process.stdout.write(c.whisperCliPath) } catch {}'
}
whisper_path="${CAPTION_STUDIO_WHISPER_CLI_PATH:-$(configured_whisper)}"
if [ -z "$whisper_path" ] || [ ! -x "$whisper_path" ]; then
  if [ "$(uname -s)" = Darwin ] && [ "$(uname -m)" = arm64 ]; then
    echo "No whisper-cli configured yet — building whisper.cpp 1.9.4 once (~70 MB download, a few minutes)…"
    if built=$(scripts/build-whisper.sh); then
      BUILT="$built" CONFIG="$CONFIG" node -e '
        const fs = require("node:fs")
        const config = JSON.parse(fs.readFileSync(process.env.CONFIG, "utf8"))
        config.whisperCliPath = process.env.BUILT
        fs.writeFileSync(process.env.CONFIG, JSON.stringify(config, null, 2) + "\n")'
      echo "whisper-cli ready at $built."
    else
      echo "whisper-cli build failed; continuing without transcription. Re-run ./dev.sh to retry, or see docs/DEPENDENCIES.md." >&2
    fi
  else
    echo "No whisper-cli configured and this platform isn't auto-built (see docs/DEPENDENCIES.md); continuing without transcription." >&2
  fi
fi

# Emit shell-quoted exports for configured keys; variables already set in the shell win, as in the app.
read -r -d '' EXPORT_JS <<'JS' || true
const fs = require('node:fs')
const file = process.env.CONFIG
let config
try { config = JSON.parse(fs.readFileSync(file, 'utf8')) } catch (error) {
  console.error(`${file} is not valid JSON: ${error.message}`); process.exit(1)
}
const names = { ffmpegPath: 'CAPTION_STUDIO_FFMPEG_PATH', ffprobePath: 'CAPTION_STUDIO_FFPROBE_PATH', whisperCliPath: 'CAPTION_STUDIO_WHISPER_CLI_PATH' }
for (const [key, variable] of Object.entries(names)) {
  const value = process.env[variable] || config[key]
  if (typeof value !== 'string' || !value) continue
  try { fs.accessSync(value, fs.constants.X_OK) } catch {
    console.error(`${key} (${value}) is not executable. Fix or delete ${file}.`); process.exit(1)
  }
  console.log(`export ${variable}='${value.replace(/'/g, `'\\''`)}'`)
}
JS
exports=$(CONFIG="$CONFIG" node -e "$EXPORT_JS")
eval "$exports"

case "$mode" in
  dev) scripts/stop-stale.sh; exec npm run dev ;;
  electron) npm run build && exec npx electron . ;;
  smoke) npm run build:electron && exec npx electron . --media-worker-smoke ;;
esac
