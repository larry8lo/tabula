#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="$HOME/.tabula"
PID_FILE="$STATE_DIR/tabula.pid"
LOG_FILE="$STATE_DIR/tabula.log"
VENV_DIR="$APP_DIR/.venv"
VENV_PYTHON="$VENV_DIR/bin/python3"

mkdir -p "$STATE_DIR"

if [[ -f "$PID_FILE" ]]; then
  PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "$PID" ]] && kill -0 "$PID" 2>/dev/null; then
    echo "tabula is already running (PID $PID)." >&2
    exit 1
  fi
  rm -f "$PID_FILE"
fi

# Use a project-local virtualenv so this works unmodified on externally
# managed Python installs (PEP 668) where `pip install` at the system level
# is blocked (Homebrew Python, Debian/Ubuntu system Python, etc.).
NEED_INSTALL=0
if [[ ! -x "$VENV_PYTHON" ]]; then
  echo "Creating virtual environment at $VENV_DIR..."
  python3 -m venv "$VENV_DIR"
  NEED_INSTALL=1
fi

if [[ "$NEED_INSTALL" -eq 1 ]] || ! "$VENV_PYTHON" -c "import flask" >/dev/null 2>&1; then
  echo "Installing dependencies into $VENV_DIR..."
  "$VENV_DIR/bin/pip" install -q -r "$APP_DIR/requirements.txt"
fi

echo "----- $(date) -----" >> "$LOG_FILE"

set -m
(cd "$APP_DIR" && exec "$VENV_PYTHON" app.py) < /dev/null >> "$LOG_FILE" 2>&1 &
PID=$!
set +m
disown "$PID" 2>/dev/null || true

echo "$PID" > "$PID_FILE"
echo "tabula started (PID $PID). Logs: $LOG_FILE"
