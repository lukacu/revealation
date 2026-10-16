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

## Consequences
New storage modes should expose persistence primitives instead of requiring UI/editor code to know backend details.
