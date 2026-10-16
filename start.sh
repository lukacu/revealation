#!/usr/bin/env sh
# Revealation workspace launcher
# ==============================
#
# Purpose: resolve the installed Revealation directory and launch server.py
# against either the supplied workspace path or the current directory.
#
# Responsibilities: symlink-safe application discovery, workspace selection,
# and forwarding the PORT environment variable.
#
# Does not implement server behavior; keep all HTTP/filesystem policy in
# server.py so the launcher stays portable and easy to inspect.

set -eu
SELF=$0
if command -v readlink >/dev/null 2>&1; then
  RESOLVED=$(readlink -f "$SELF" 2>/dev/null || true)
  if [ -n "${RESOLVED:-}" ]; then SELF=$RESOLVED; fi
fi
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$SELF")" && pwd)
PROJECT_DIR=${1:-"$PWD"}
PORT=${PORT:-8000}
exec python3 "$SCRIPT_DIR/server.py" "$PROJECT_DIR" --port "$PORT"
