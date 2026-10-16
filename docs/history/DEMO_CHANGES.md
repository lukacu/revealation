# Interactive demo support

Added a first-class local HTML/JavaScript demo embed.

- `Demo` toolbar button with a workspace-aware HTML entry-point picker.
- `Workspace files` shows **Embed demo** for `.html` / `.htm` files.
- Canonical Markdown directive: `::: demo` with `src`, `width`, `height`, `interactive`, `preload`, and `border`.
- WYSIWYG demo frames can be selected, resized, aligned, moved into columns, deleted with Delete, and edited by double-clicking.
- The selected-media inspector exposes height, interaction, preload, and border controls.
- In Markdown mode, invoking Demo while the caret is inside an existing `::: demo` edits that block instead of inserting a duplicate.
- Preview uses the workspace iframe directly. `interactive: false` disables pointer input.
- Standalone HTML export attempts to inline the demo document, local stylesheets, plain external script files, and direct image/video/audio resources into the exported file.

## Standalone export limitation

The inliner is intentionally small and dependency-free. Demos built around relative ES-module imports, dynamic imports, runtime `fetch()`, workers, WebSockets, or server endpoints may need to be bundled to a single HTML/JS artifact before standalone export. They continue to work normally in the workspace preview.
