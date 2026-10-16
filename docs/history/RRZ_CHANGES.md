# RRZ additions

This build is based directly on the user-provided `small-reveal-master.zip`.

Added without introducing a Node/npm build:

- two-column 50/50, 60/40 and 40/60 layouts
- reusable per-project image/video/audio asset library
- LaTeX equation insert/edit dialog with KaTeX preview
- reveal.js Math/KaTeX plugin in preview, HTML export and PDF preview
- code insert/edit dialog with language selection
- reveal.js Highlight plugin + Monokai theme in preview, HTML export and PDF preview
- editor-side code highlighting via highlight.js
- Markdown round-tripping for fenced code languages and LaTeX delimiters

The original Small Reveal license and source files are retained.

## Readable Markdown workspace source

- Workspace projects now save slide content to `deck.md` alongside `deck.json` metadata.
- Added conservative Revealation Markdown extensions for generated columns, resized images, video options, and audio.
- Unsupported/custom HTML remains raw HTML for lossless round trips.
- `deck.md` is preferred on reload when it is the current/newer content source.

## Markdown column parser tolerance

- Accepts a closing `:::` at the end of a content line inside Revealation directives.
- Keeps fenced code and ordinary text outside directives untouched.
- Prevents one inline closer from causing a whole columns block to render as literal `:::` text.
