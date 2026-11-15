#!/usr/bin/env bash
# Launches the Tabula MCP server over stdio, for use from Claude.
#
# Register it with Claude Code:
#   claude mcp add tabula -- /absolute/path/to/tabula/mcp.sh
#
# Like start.sh it uses a project-local .venv, so it works on externally
# managed Python installs. stdout belongs to the MCP protocol, so all setup
# output below is sent to stderr.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$APP_DIR/.venv"
VENV_PYTHON="$VENV_DIR/bin/python3"

if [[ ! -x "$VENV_PYTHON" ]]; then
  echo "Creating virtual environment at $VENV_DIR..." >&2
  python3 -m venv "$VENV_DIR" >&2
fi

if ! "$VENV_PYTHON" -c "import mcp" >/dev/null 2>&1; then
  echo "Installing MCP server dependencies into $VENV_DIR..." >&2
  "$VENV_DIR/bin/pip" install -q -r "$APP_DIR/requirements-mcp.txt" >&2
fi

exec "$VENV_PYTHON" "$APP_DIR/tabula_mcp.py"
