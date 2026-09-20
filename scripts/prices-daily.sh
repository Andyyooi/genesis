#!/usr/bin/env bash
# Daily Yahoo EOD prices for the universe. Not live ticks. Not Cursor usage.
# Stop: kill "$(cat data/.prices-daily.pid)"
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
mkdir -p "$ROOT/data/logs"
PIDFILE="$ROOT/data/.prices-daily.pid"
LASTFILE="$ROOT/data/logs/prices-daily.last.json"
LOGFILE="$ROOT/data/logs/prices-daily.log"
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

log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" | tee -a "$LOGFILE"
}

seconds_until_next_slot() {
  python3 - <<'PY'
from datetime import datetime, timedelta
try:
    from zoneinfo import ZoneInfo
    tz = ZoneInfo("Asia/Kuala_Lumpur")
except Exception:
    tz = None
if tz is None:
    print(86400)
    raise SystemExit
now = datetime.now(tz)
min_wait = timedelta(hours=12)
target = now.replace(hour=18, minute=0, second=0, microsecond=0)
if target <= now:
    target += timedelta(days=1)
if target - now < min_wait:
    target += timedelta(days=1)
print(int((target - now).total_seconds()))
print(target.isoformat(), file=__import__("sys").stderr)
PY
}

run_prices() {
  local tmp errfile code next_iso
  tmp="$(mktemp)"
  errfile="$(mktemp)"
  log "starting Yahoo EOD ingest (npm run ingest:prices)"
  set +e
  npm run --silent ingest:prices >"$tmp" 2>"$errfile"
  code=$?
  local result
  result="$(python3 - "$tmp" "$errfile" "$code" "$LASTFILE" <<'PY'
import json, sys, datetime
from pathlib import Path
stdout_path, err_path, code, last_path = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4]
stdout = Path(stdout_path).read_text(encoding="utf-8", errors="replace")
stderr = Path(err_path).read_text(encoding="utf-8", errors="replace")
report = None
text = stdout.strip()
if text:
    try:
        report = json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            try:
                report = json.loads(text[start : end + 1])
            except json.JSONDecodeError:
                report = None
failed = []
if isinstance(report, dict):
    failed = report.get("failed") or []
ok = code == 0 and isinstance(report, dict) and len(failed) == 0
payload = {
    "ranAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "ok": ok,
    "exitCode": code,
    "failedCount": len(failed) if isinstance(failed, list) else None,
    "report": report,
    "stderr": stderr.strip()[:4000] if stderr.strip() else None,
    "note": "Missed Yahoo tickers stay listed; prices are never invented. Fundamentals are not fetched here.",
}
Path(last_path).write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
print("ok" if ok else "fail")
PY
  )"
  rm -f "$tmp" "$errfile"
  if [[ "$result" == "ok" ]]; then
    log "Yahoo EOD ingest ok — see $LASTFILE"
  else
    log "Yahoo EOD ingest FAILED or partial — see $LASTFILE (no prices invented)"
  fi
}

log "pid $$ — daily Yahoo EOD prices after 18:00 MYT (min 12h). Manual: npm run ingest:prices"
while true; do
  run_prices
  wait_s="$(seconds_until_next_slot 2>"$ROOT/data/logs/prices-daily.next.txt" || echo 86400)"
  if ! [[ "$wait_s" =~ ^[0-9]+$ ]]; then
    wait_s=86400
  fi
  next="$(tr -d '\n' < "$ROOT/data/logs/prices-daily.next.txt" 2>/dev/null || true)"
  python3 - "$LASTFILE" "$next" <<'PY' || true
import json, sys
from pathlib import Path
p = Path(sys.argv[1])
nxt = sys.argv[2] if len(sys.argv) > 2 else None
if p.exists():
    data = json.loads(p.read_text())
    data["nextWakeAt"] = nxt or None
    p.write_text(json.dumps(data, indent=2) + "\n")
PY
  log "sleeping ${wait_s}s until next slot ${next:-unknown} (not a live feed)"
  sleep "$wait_s" &
  CHILD=$!
  wait "$CHILD" || true
  CHILD=""
done
