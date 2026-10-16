# Polish pass: Markdown navigation, media delete, standalone HTML

This build adds three workflow improvements on top of the workspace + readable-Markdown version.

## Delete selected media

Click an image or video so the blue resize selection is visible, then press `Delete` to remove it. The removal is recorded in undo history and saved normally. `Backspace` keeps its native contenteditable behavior.

## Markdown editor highlighting and navigation

Deck Markdown is still a plain `<textarea>` (no CodeMirror/Monaco dependency), but a synchronized rendering layer underneath it adds lightweight syntax coloring for:

- slide separators (`---`) and vertical slide separators (`--`)
- headings
- Revealation directives (`::: columns`, `::: video`, ...)
- fenced code
- display math
- image/media lines
- speaker notes and HTML comments

The normal Slides sidebar becomes a Markdown table of contents while Markdown mode is open. Clicking an item moves the caret and scrolls to that slide's source. The index is rebuilt from the current buffer and keeps the last successfully parsed labels as a cache while the buffer is temporarily incomplete.

## Standalone HTML export

A new **Export HTML** button creates one HTML file intended to be opened directly in a browser without the workspace server. The exporter:

- embeds local image/video/audio assets used by the deck as data URLs
- embeds Reveal.js core CSS/JS and the selected Reveal theme
- embeds Highlight.js styling
- pre-renders syntax-highlighted code
- pre-renders KaTeX equations and embeds KaTeX CSS/fonts
- embeds generated custom-theme CSS

The export step currently fetches the Reveal.js/KaTeX distribution files from jsDelivr, so *building* a standalone file still requires network access in this version. The produced file itself does not need the workspace Python server. Custom Google web fonts are embedded when browser policy allows it; otherwise their configured system fallback is used.

## Markdown caret alignment

Fixed cumulative caret/highlight drift in the colored Markdown editor. Slide separators no longer change line geometry, and all syntax coloring is now metric-neutral so the overlay remains aligned with the underlying textarea both vertically and horizontally.
