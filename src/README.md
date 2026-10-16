# Revealation source tree

Revealation is organized by **application responsibility**, not by the history of which feature was added when.

```text
src/
├── core/           deck model and application orchestration
├── ui/             core application UI components
├── editor/         WYSIWYG editing/selection mechanics
├── rendering/      reveal.js presentation runtime
├── serialization/  readable Revealation Markdown primitives
├── storage/        persistence/backend adapters
├── content/        content-type semantics
├── layout/         semantic slide layout registry and block model
├── theme/          curated presentation-theme manifest registry
├── background/     background manifest registry and presentation lifecycle
├── export/         export transports
└── config/         hand-editable UI layout configuration
```

There is intentionally no bundler. Files register a small public API under `window.Revealation` and are loaded in dependency order from `index.html`.

## Rule of ownership

Put code where the *responsibility* lives:

- sidebar navigation belongs to `ui/` even though it is core functionality;
- filesystem HTTP calls belong to `storage/`, never to editor UI;
- `::: interactive` parsing/rendering semantics belong to `content/interactive.js`;
- deck mutation/history policy stays in `core/application.js`; deterministic browser editing mechanics belong in `editor/`;
- pure Markdown directive mechanics belong to `serialization/`; `serialization/notes.js` owns the canonical final `::: notes` slide block.
- curated theme lookup belongs to `theme/`; animation lifecycle glue belongs to `background/`;
- HTML/ZIP artifact construction belongs to `export/`; core only prepares current state and coordinates the UI.

A new file is justified by a coherent responsibility and a stable boundary, not merely by file size.
## Temporary compatibility code

Compatibility-only paths are marked `RV-COMPAT(<id>)` and inventoried in [`../docs/COMPATIBILITY_DEBT.md`](../docs/COMPATIBILITY_DEBT.md). These markers are intentional deletion targets before the first public release, not a permanent deprecation mechanism.
