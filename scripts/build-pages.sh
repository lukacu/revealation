#!/usr/bin/env sh
# Assemble the static/PWA GitHub Pages artifact without introducing a front-end bundler.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
DIST=${1:-"$ROOT/dist"}
cd "$ROOT"
rm -rf "$DIST"
mkdir -p "$DIST/__app__"

# Root deployment shell. Presentation-relative paths intentionally remain free
# for the directory workspace and are served by the service worker.
# Mark the generated artifact so the runtime skips the Python-only
# /api/workspace probe on static hosts such as GitHub Pages.
sed 's/data-revealation-static="false"/data-revealation-static="true"/' index.html > "$DIST/index.html"
cp manifest.webmanifest "$DIST/"
touch "$DIST/.nojekyll"

# App resources are namespaced exactly like the Python workspace server.
cp preview.html "$DIST/__app__/"
cp -R icons "$DIST/__app__/icons"
cp -R logo "$DIST/__app__/logo"
for dir in src styles docs extensions themes vendor; do
  cp -R "$dir" "$DIST/__app__/$dir"
done

APP_VERSION=$(sed -n "s/.*app.version = '\([^']*\)'.*/\1/p" src/core/revealation.js | head -n 1)
FULL_SHA=${GITHUB_SHA:-$(git rev-parse HEAD 2>/dev/null || printf local)}
CONTENT_HASH=$(python3 - "$DIST" "$ROOT/pwa/sw.template.js" <<'PYHASH'
import hashlib, os, sys
root = os.path.abspath(sys.argv[1])
worker_template = os.path.abspath(sys.argv[2])
digest = hashlib.sha256()
for current, dirs, files in os.walk(root):
    dirs.sort(); files.sort()
    for name in files:
        path = os.path.join(current, name)
        rel = os.path.relpath(path, root).replace(os.sep, '/')
        digest.update(rel.encode('utf-8') + b'\0')
        with open(path, 'rb') as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b''):
                digest.update(chunk)
digest.update(b'\0service-worker-template\0')
with open(worker_template, 'rb') as source:
    digest.update(source.read())
print(digest.hexdigest()[:12])
PYHASH
)
BUILD_ID=${REVEALATION_BUILD_ID:-$CONTENT_HASH}
BUILT_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)

python3 - "$DIST/version.json" "$APP_VERSION" "$BUILD_ID" "$FULL_SHA" "$BUILT_AT" <<'PY'
import json, sys
path, version, build, commit, built_at = sys.argv[1:]
with open(path, 'w', encoding='utf-8') as f:
    json.dump({
        'version': version or '0.0.0',
        'build': build,
        'commit': commit,
        'builtAt': built_at,
    }, f, indent=2)
    f.write('\n')
PY

# Every deployment gets a different worker body, so the browser's normal
# service-worker update algorithm reliably discovers new application versions.
sed "s/__BUILD_ID__/$BUILD_ID/g" pwa/sw.template.js > "$DIST/sw.js"

# Precache all immutable application resources, but keep update metadata and the
# worker itself network-driven. User workspace files never enter this manifest.
python3 - "$DIST" <<'PY'
import json, os, sys
root = os.path.abspath(sys.argv[1])
exclude = {'sw.js', 'version.json', 'precache-manifest.json', '.nojekyll'}
paths = []
for current, dirs, files in os.walk(root):
    dirs.sort(); files.sort()
    for name in files:
        rel = os.path.relpath(os.path.join(current, name), root).replace(os.sep, '/')
        if rel in exclude:
            continue
        paths.append(rel)
with open(os.path.join(root, 'precache-manifest.json'), 'w', encoding='utf-8') as f:
    json.dump(paths, f, indent=2)
    f.write('\n')
PY

printf 'Built Revealation %s (%s) -> %s\n' "${APP_VERSION:-0.0.0}" "$BUILD_ID" "$DIST"
