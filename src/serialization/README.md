# Serialization

Readable Revealation Markdown support.

- `directives.js` — low-level structured-directive parsing/validation primitives.
- `deck.js` — top-level slide/subslide separator metadata (`layout=<id>`), exact source ranges, validation and resilient fallback labels.

Whole-deck HTML ↔ Markdown conversion is still coordinated by `core/application.js`. As more of that codec becomes independent, move complete round-trip rules here rather than scattering tiny helpers across files.
