# Storage contract

Revealation separates **persistence mechanics** from deck/editor semantics.

A storage backend is responsible for bytes and backend protocol, not for interpreting slides, Markdown or undo history.

Conceptually, a storage backend may provide operations such as:

```text
detect?()
loadDeck()
getWorkspaceState?()
saveDeck(project, markdown, { expectedRevision })
listFiles?()
uploadFile?(file, subdir)
readFile?(path)
```

The Python filesystem workspace, browser-directory workspace and browser IndexedDB have different capabilities, so the current implementations do not force an artificial identical runtime API. The important boundary is that storage-specific HTTP/File System Access/transaction code stays under `src/storage/`.

`workspace.js` and `directory.js` deliberately expose the same deck/file operations where possible. The browser-directory adapter stores only its serializable directory handle in IndexedDB; deck content and assets remain ordinary files.

Core code remains responsible for:

- project normalization;
- dirty tracking;
- save timing;
- Markdown serialization;
- current-project/library policy.

Filesystem adapters may return a revision with `deckToken` and `assetsToken`.
The editor keeps the loaded `deckToken` and passes it back to `saveDeck()`;
the backend must reject a stale write with `code = WORKSPACE_CONFLICT` (the
Python backend uses HTTP 409, while the directory adapter performs the same
check immediately before writing). Asset revisions are metadata-only snapshots
used to refresh externally changed media without rewriting Markdown.

GitHub Gist is currently treated as **synchronization**, not the primary local storage backend. If it later becomes a true storage mode, it should move behind this same boundary.
