#!/usr/bin/env sh
# Revealation dependency-free pre-release checks.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"

find src -name '*.js' -print0 | sort -z | xargs -0 -n1 node --check
node --check pwa/sw.template.js
python3 -m py_compile server.py
sh -n start.sh
sh -n scripts/build-pages.sh
rm -rf __pycache__
python3 tests/check_structure.py
python3 tests/check_compatibility_debt.py
node tests/test_modules.js
node tests/test_directory_registry.js
node tests/test_storage_roundtrip.js
node tests/test_native_package.js
python3 tests/test_server.py
python3 tests/test_pwa_build.py

# Optional real-browser regressions. The core suite remains dependency-free;
# contributors without Chromium/Xvfb still get all static/module/server checks.
if command -v chromium >/dev/null 2>&1 && command -v xvfb-run >/dev/null 2>&1; then
  node tests/test_editor_regressions.js
  node tests/test_browser_regressions.js
else
  echo "browser regressions: SKIPPED (chromium/xvfb-run not available)"
fi

echo "Revealation checks: OK"
