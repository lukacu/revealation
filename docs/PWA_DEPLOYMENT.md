# PWA deployment

Revealation's primary deployment is a static HTTPS PWA. It uses the browser
File System Access API to work directly in a user-selected presentation
directory. Only the directory handle is remembered in IndexedDB; presentation
data remains in ordinary files in that directory. When local-directory access
is unavailable or declined, the PWA falls back to browser-backed storage.

The local Python workspace server is a development and offline fallback. It is
useful for testing the filesystem adapter or running the editor from a local
checkout without a hosted PWA deployment:

```bash
./start.sh /path/to/presentation
```

Then open `http://127.0.0.1:8000/`. It requires Python 3 and uses only the
standard library.

The hosted PWA is intended primarily for Chromium-family browsers because
`showDirectoryPicker()` is not implemented consistently across browsers. When
local-directory access is unavailable or declined, Revealation falls back to
its existing browser storage mode.

## PWA artifact layout

The deployment build creates the static PWA artifact:

```text
<deployment root>/
├── index.html
├── manifest.webmanifest
├── sw.js
├── version.json
└── __app__/
    ├── icons/
    ├── preview.html
    ├── src/
    ├── styles/
    ├── themes/
    ├── extensions/
    └── vendor/
```

Application files live under `__app__/`; presentation-relative URLs such as
`assets/diagram.svg` or `interactive/demo/index.html` remain rooted at the
workspace. The deployment root itself reserves the small PWA shell
namespace (`index.html`, `manifest.webmanifest`, `sw.js`, `version.json` and
`precache-manifest.json`). `.nojekyll` is a Pages deployment marker and is intentionally not
pre-cached. In hosted mode the service worker resolves those workspace requests
against the selected local directory. This also lets iframe-backed interactive
content load sibling JavaScript, CSS, images and other files by relative path.

All application URLs are relative to the deployment root, so the same artifact
works at a domain root or a GitHub Pages project subdirectory such as
`https://example.github.io/revealation/`.

## Build the static artifact locally

Development still has no compilation/bundling step. The deployment script only
assembles the browser-ready source into the Pages layout and generates PWA
metadata:

```bash
./scripts/build-pages.sh
```

The default output is `dist/`. A different output directory can be supplied as
the first argument:

```bash
./scripts/build-pages.sh /tmp/revealation-pages
```

The script generates:

- `version.json` with the Revealation version, Git commit and content build id and
  build timestamp;
- `precache-manifest.json` containing the application shell files;
- `sw.js` from `pwa/sw.template.js`, with the build id embedded in the cache
  name.

## GitHub Actions deployment

`.github/workflows/pages.yml` runs on pushes to `main` and can also be started
manually. It:

1. checks out the repository;
2. runs `./tests/check.sh`;
3. builds `dist/` with `./scripts/build-pages.sh`;
4. uploads the Pages artifact;
5. deploys it to the `github-pages` environment.

In the GitHub repository settings, configure **Pages → Build and deployment →
Source** to **GitHub Actions**. The workflow intentionally contains no hardcoded
repository path; Pages provides the final project subdirectory and Revealation
uses relative URLs.

## Installation and update behavior

`manifest.webmanifest` uses relative `id`, `start_url` and `scope` values so an
installed PWA is scoped to its actual deployment directory.

The generated worker embeds a content-derived build id (including the worker
template itself), so even local/uncommitted deployment builds change worker
identity when application files change. Repository-only changes that do not
alter the deployed app do not force an unnecessary update. The service worker
precaches the immutable application shell and keeps user workspace files out of
Cache Storage. Root navigation is network-first, while
application assets are served cache-first after installation. Consequently an
installed presentation editor can start offline after it has been loaded once.

On every startup Revealation registers the worker and checks for an update. It
also checks periodically and after returning to the window. `version.json` is
always fetched with `cache: "no-store"` so the UI can see current build metadata.

The About dialog shows the running application version and content build id.
Use **Verify now** there to compare the loaded build with the published
`version.json` metadata and perform an immediate service-worker update check.
A match confirms that the loaded application corresponds to the deployment;
a mismatch identifies the running and published build ids and surfaces the
normal update action when a new worker is waiting.

A newly installed worker does **not** immediately replace an existing one.
Revealation shows an **Update** banner, saves pending deck changes, sends
`SKIP_WAITING` only after the user accepts the update, and reloads when the new
worker takes control. This avoids an unsolicited reload while editing.

## Local-directory permissions and recent projects

A hosted Revealation instance cannot silently obtain a directory. The initial
PWA screen therefore acts as a small project launcher. It lists previously
opened presentation folders, offers **Open another folder…**, and also lets the
user continue with IndexedDB-backed browser storage.

Revealation can remember multiple `FileSystemDirectoryHandle` objects in
IndexedDB. Each recent entry stores only the handle, display name and last-opened
time; the presentation itself remains in ordinary files. Exactly one handle is
also stored under the `active` key used by the service worker to resolve
workspace-relative URLs.

Browsers may revoke directory permission between sessions. Listing the recent
projects only queries permission and never prompts. Clicking **Open** calls
`requestPermission()` directly from that user gesture and activates the folder
only after read/write access is granted. Removing a recent item only removes its
remembered handle; it never deletes files from disk.

Choosing **Browser storage** clears the active directory bridge but keeps the
recent-folder history, so switching back is easy. Changing projects while a
local folder is open first flushes the current deck; the splash is shown only
when that save succeeds.

## Portable presentations

The Projects view exports the current presentation as a `.revealation` file.
It is a storage-independent ZIP containing `mimetype`, `manifest.json`,
`deck.json`, and local assets. Import uses a standard file input and validates
the complete archive before changing the active project, so it works in
Firefox without directory access.
