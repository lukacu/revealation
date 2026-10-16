# Interactive content support

Added a first-class local HTML/JavaScript interactive embed.

- `Interactive` toolbar button with a workspace-aware HTML entry-point picker.
- `Workspace files` shows **Embed interactive** for `.html` / `.htm` files.
- Canonical Markdown directive: `::: interactive` with `src`, `width`, `height`, `interactive`, `preload`, and `border`.
- WYSIWYG interactive frames can be selected, resized, aligned, moved into columns, deleted with Delete, and edited by double-clicking.
- The selected-media inspector exposes height, interaction, preload, and border controls.
- In Markdown mode, invoking Interactive while the caret is inside an existing `::: interactive` edits that block instead of inserting a duplicate.
- Preview uses the workspace iframe directly. `interactive: false` disables pointer input.
- Standalone HTML export attempts to inline the interactive document, local stylesheets, plain external script files, and direct image/video/audio resources into the exported file.

## Standalone export limitation

The inliner is intentionally small and dependency-free. Interactive apps built around relative ES-module imports, dynamic imports, runtime `fetch()`, workers, WebSockets, or server endpoints may need to be bundled to a single HTML/JS artifact before standalone export. They continue to work normally in the workspace preview.

## Compatibility

Legacy `::: demo` directives and `sr-demo` HTML are still accepted on input; new output uses `::: interactive` and `sr-interactive`.
