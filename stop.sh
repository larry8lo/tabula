#!/usr/bin/env bash
set -euo pipefail

STATE_DIR="$HOME/.tabula"
PID_FILE="$STATE_DIR/tabula.pid"

if [[ ! -f "$PID_FILE" ]]; then
  echo "tabula is not running (no PID file)." >&2
  exit 1
fi

PID="$(cat "$PID_FILE")"

if ! kill -0 "$PID" 2>/dev/null; then
  echo "tabula is not running (stale PID $PID)." >&2
  rm -f "$PID_FILE"
  exit 1
fi

kill -TERM -"$PID" 2>/dev/null || kill -TERM "$PID" 2>/dev/null || true

for _ in $(seq 1 20); do
  kill -0 "$PID" 2>/dev/null || break
  sleep 0.25
done

if kill -0 "$PID" 2>/dev/null; then
  echo "tabula did not stop gracefully, killing (PID $PID)." >&2
  kill -KILL -"$PID" 2>/dev/null || kill -KILL "$PID" 2>/dev/null || true
fi

rm -f "$PID_FILE"
echo "tabula stopped."
