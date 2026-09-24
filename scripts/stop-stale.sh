#!/usr/bin/env bash
# Stops leftover dev processes of THIS checkout (concurrently, vite, cross-env, Electron and its helpers)
# so a new `npm run dev` can bind Vite's strict port. Only processes whose command line contains this
# project's node_modules path, or a port-5173 listener whose cwd is this project, are touched.
cd "$(dirname "$0")/.."
root=$PWD
port=5173

# Exclude ourselves and our ancestors (the npm/dev.sh that invoked us).
protected=" $$ "
p=$$
while [ "${p:-0}" -gt 1 ]; do
  p=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')
  [ -n "$p" ] && protected="$protected$p "
done

collect() {
  local pid cwd
  for pid in $(pgrep -f "$root/node_modules/" 2>/dev/null || true); do
    case "$protected" in *" $pid "*) continue ;; esac
    echo "$pid"
  done
  for pid in $(lsof -ti tcp:$port -sTCP:LISTEN 2>/dev/null || true); do
    case "$protected" in *" $pid "*) continue ;; esac
    cwd=$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')
    case "$cwd" in
      "$root"|"$root"/*) echo "$pid" ;;
      *) echo "Port $port is used by another project (pid $pid, cwd ${cwd:-unknown}); not touching it." >&2 ;;
    esac
  done
}

pids=$(collect | sort -un | tr '\n' ' ')
[ -z "${pids// /}" ] && exit 0
echo "Stopping stale dev processes: $pids"
kill $pids 2>/dev/null || true
for _ in $(seq 1 20); do
  sleep 0.25
  alive=""
  for pid in $pids; do kill -0 "$pid" 2>/dev/null && alive="$alive $pid"; done
  [ -z "$alive" ] && break
done
[ -n "${alive:-}" ] && { echo "Force-killing:$alive"; kill -9 $alive 2>/dev/null || true; sleep 0.3; }
exit 0
