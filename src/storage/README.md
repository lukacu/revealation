# Storage

Storage isolates persistence mechanisms from deck/editor semantics.

- `CONTRACT.md` — documented conceptual contract.
- `workspace.js` — HTTP adapter for the Python filesystem workspace server.
- `directory.js` — hosted/PWA adapter for a user-selected local directory via the File System Access API.
- `indexeddb.js` — low-level browser IndexedDB primitive, including atomic multi-store transactions.
- `backup.js` — versioned, lossless browser-library ZIP backup/restore format.
- `package.js` — storage-independent `.revealation` presentation archive format.

The core decides **when and what** to save. Adapters decide **how bytes are persisted**. Local-server launches prefer `workspace.js`; hosted/PWA launches can use `directory.js` while preserving the same `deck.md` / `deck.json` / relative-file workspace contract. Directory mode keeps a recent-project registry of handles in IndexedDB, but only one handle is active for the service worker at a time.

The portable presentation workflow uses `package.js`; it is separate from the
working-project persistence model and works with standard file inputs and Blob
downloads. `backup.js` remains only for migration and persisted browser-library
compatibility.

GitHub Gist remains a synchronization mechanism in the current core rather than a primary storage backend. If it becomes a true storage mode later, it should implement the same conceptual boundary here.
