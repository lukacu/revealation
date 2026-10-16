# Rendering

Presentation runtime code.

- `preview.js` — reveal.js runtime used by in-editor Present mode and print/PDF mode. The filename is retained for now because the PDF path and temporary internal protocol still reference it.

The editor builds a presentation payload; the renderer consumes it. It does not know about workspace saving or editor history. Before calling `Reveal.initialize()`, the runtime waits for presentation-critical stylesheets and `document.fonts.ready`, then performs a double-animation-frame `Reveal.layout()` so vertical centering is based on final theme geometry rather than fallback browser styles.
