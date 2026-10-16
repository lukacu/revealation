# Core

Core owns the presentation model and application-wide orchestration.

- `revealation.js` — global namespace and application version; it deliberately does not define a generic plugin/event system.
- `slide-model.js` — pure slide/subslide numbering and reveal position helpers.
- `history.js` — bounded opaque snapshot undo/redo mechanics.
- `application.js` — current orchestrator: project state, history, editor coordination, Present/export payloads, Markdown mode and Gist synchronization.

`application.js` remains the largest file because only responsibilities with a clean contract are extracted. Do not split it mechanically. When extracting a subsystem, first define what data it receives, what it returns/emits, and which mutations remain owned by core.
