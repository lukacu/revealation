# ADR 002 — Storage is an adapter boundary

## Status
Accepted.

## Context
Revealation can operate on a Python-backed filesystem workspace and retains a browser/IndexedDB mode. Storage-specific fetch/transaction code had been mixed into the editor core.

## Decision
Persistence mechanics live under `src/storage/`.

- `workspace.js` owns the `/api/...` HTTP protocol.
- `indexeddb.js` owns browser database transactions.
- core owns deck/library policy, dirty tracking and save timing.

GitHub Gist is currently synchronization, not the primary local storage backend.

Filesystem adapters also expose a lightweight workspace revision. Deck files
are protected with compare-before-save semantics, and asset revisions are
based on path, size and modification time. The editor polls these revisions
while visible, reloads clean decks automatically, pauses dirty saves on a
conflict, and adds a runtime cache-busting revision to changed workspace media.

## Consequences
New storage modes should expose persistence primitives instead of requiring UI/editor code to know backend details.
