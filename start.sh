#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="$HOME/.tabula"
PID_FILE="$STATE_DIR/tabula.pid"
LOG_FILE="$STATE_DIR/tabula.log"

mkdir -p "$STATE_DIR"

if [[ -f "$PID_FILE" ]]; then
  PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "$PID" ]] && kill -0 "$PID" 2>/dev/null; then
    echo "tabula is already running (PID $PID)." >&2
    exit 1
  fi
  rm -f "$PID_FILE"
fi

echo "----- $(date) -----" >> "$LOG_FILE"

set -m
(cd "$APP_DIR" && exec python3 app.py) < /dev/null >> "$LOG_FILE" 2>&1 &
PID=$!
set +m
disown "$PID" 2>/dev/null || true

echo "$PID" > "$PID_FILE"
echo "tabula started (PID $PID). Logs: $LOG_FILE"
