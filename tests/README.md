# Revealation tests

The project intentionally has no Node package/build dependency, so the permanent test suite also uses only tools already needed for development: **Node.js for JavaScript parsing/pure module tests and Python for static HTML/source checks**.

Run everything:

```bash
./tests/check.sh
```

The suite checks:

- JavaScript, Python and shell syntax;
- duplicate/missing DOM IDs and local app resources;
- the per-file documentation contract;
- slide/subslide numbering and reveal coordinates;
- bounded undo/redo behavior;
- structured directive normalization and `::: demo` compatibility;
- Markdown slide/subslide range parsing;
- supported Markdown directive heads, values, aliases, nesting and fence protection;
- slide metadata, positional layouts, interactive variants and canonical block writing;
- browser-level Markdown syntax coverage for formatting, media, math, code, alignment,
  fragments, animation and interactive content;
- inline/display math, complex `cases` round-trip/remount behavior, and recovery of previously emitted canonical math spans;
- canonical `::: interactive` serialization;
- PDF print payload defaults;
- workspace HTTP load/save/list/upload/static-file behavior.

Some OS/browser-integrated behavior (drag/drop edge cases and the native Save as PDF dialog) still benefits from a manual smoke test; see `docs/TESTING.md`.
## Browser regressions

When `chromium` is available, `check.sh` runs two headless Chromium suites through the DevTools protocol.

`test_editor_regressions.js` is intentionally small and should be the first command used while debugging WYSIWYG/layout behavior. It verifies:

- Tab/Shift+Tab list nesting without losing inline formatting or caret position;
- field-scoped Ctrl/Cmd+A and selection-to-semantic-block resolution;
- canonical repair of browser list markup;
- external inline-paste normalization;
- semantic layout transfer, master-field merging and initial heading scaffolds.

`test_browser_regressions.js` runs in standards mode and verifies those contracts through the full application plus the other fragile browser behaviors:

- browser-generated rich-text `<div>` wrappers in layout slots normalize to canonical blocks;
- Backspace cannot delete a protected layout at an editing boundary;
- nested lists survive the actual HTML ↔ Markdown codec;
- canonical text/list/image content can move between layout fields without flattening;
- async-style media insertion uses the snapshotted destination rather than later focus;
- partial text/image alignment stays scoped to the selected semantic block while a caret aligns the complete field;
- Ctrl/Cmd+A selects only the current semantic layout field;
- delayed intrinsic image/video sizing triggers editor recentering;
- dark-mode text/number controls maintain readable contrast in Deck/App/Interactive dialogs;
- all built-in themes style Markdown tables and Emphasis/Muted/Callout/Quote semantics;
- semantic block styles survive WYSIWYG ↔ Markdown round trips and clear cleanly when changed back to headings/body;
- both WYSIWYG and Markdown layout changes preserve semantic fields and merge unmatched content into the master field;
- thumbnail content is visible and uses reveal theme colors;
- a long Markdown document keeps the textarea and syntax-highlight textarea at the same aggregate text height.

The test uses no npm packages and does not need network access.


## Alignment/UI regressions

The Chromium suite also checks WYSIWYG alignment persistence for both the implicit single layout and named multi-block layout slots, resets stale selection state between slides, and verifies that direct per-slide HTML source editing is not exposed in the UI.

- WYSIWYG text persistence across slide switches for `single` and multi-block layouts;
- Chromium stray-`<br>` tolerance at the protected-layout boundary;
- editor affordances only on actual editable hosts;
- 22 px application-level presentation font default with custom-theme override.

- Multiline inline/display LaTeX round-trips, including exact `cases` source through workspace `deck.md` save/reload.
- PDF runtime coverage includes lazy interactive iframe readiness (`pdf-ready` is not sufficient on its own) and bounded highlighted-code geometry so PDF snapshots do not contain blank iframe blocks or oversized code.
