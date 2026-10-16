# ADR 010 — Hosted PWA uses direct directory workspaces

## Status
Accepted

## Context

Revealation needs a static hosted/PWA deployment while preserving its local-first
workspace model: readable `deck.md`, `deck.json` metadata, assets and interactive
content should remain normal files rather than being copied into an opaque web
application database.

The local Python server already exposes a presentation directory at ordinary
relative URLs and application resources under a reserved `__app__/` namespace.
A hosted static site cannot access arbitrary local files through HTTP.

## Decision

Revealation has two filesystem workspace adapters selected by launch mode:

- local-server launches use the existing HTTP adapter and Python `/api/...`
  protocol;
- hosted/PWA launches use a `FileSystemDirectoryHandle` selected with the File
  System Access API.

The directory handle may be remembered in IndexedDB, but the presentation itself
is not mirrored into IndexedDB. The PWA service worker resolves ordinary
presentation-relative requests against the selected directory handle while the
`__app__/` namespace remains the installed application shell.

The static deployment must be subdirectory-safe. All application resources,
manifest scope and service-worker scope therefore derive from the deployment URL
rather than assuming `/`.

PWA updates are explicit while editing: a new worker waits until the user accepts
the update, at which point pending changes are saved before activation/reload.

## Consequences

- Hosted and Python modes use the same on-disk presentation format and relative
  asset paths.
- Iframe-backed interactive content can continue to use sibling relative files.
- Hosted direct-directory mode requires a secure context and a browser that
  supports directory picking; other browsers retain browser-storage fallback.
- Directory permission can expire and may require a user gesture to restore.
- Development remains build-free, while deployment has a small deterministic
  assembly step for service-worker/version metadata.
