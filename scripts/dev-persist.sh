#!/usr/bin/env bash
# Restart next if it exits. Stop with Ctrl-C or: kill "$(cat data/.dev-persist.pid)"
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
mkdir -p "$ROOT/data"
PIDFILE="$ROOT/data/.dev-persist.pid"
echo $$ > "$PIDFILE"

CHILD=""
stop() {
  if [[ -n "$CHILD" ]] && kill -0 "$CHILD" 2>/dev/null; then
    kill "$CHILD" 2>/dev/null || true
    wait "$CHILD" 2>/dev/null || true
  fi
  rm -f "$PIDFILE"
  exit 0
}
trap stop INT TERM

echo "[dev:persist] pid $$ — Next.js on 0.0.0.0:43147 (http://127.0.0.1:43147/)"
while true; do
  npm run dev &
  CHILD=$!
  wait "$CHILD" || true
  CHILD=""
  echo "[dev:persist] next exited; restarting in 2s"
  sleep 2
done
