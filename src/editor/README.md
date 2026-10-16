# Editor

WYSIWYG editing mechanics that are independent of project persistence and presentation rendering.

- `dom-selection.js` — browser Range → Revealation block/fragment/editing-host helpers.
- `content-normalization.js` — sanitizes **external** clipboard HTML, converts plain-text paste
  to canonical paragraphs, repairs list structure, preserves inline formatting for paste into
  headings/list items, and canonicalizes browser-generated rich-text wrappers before
  persistence/Markdown serialization.
- `rich-text.js` — deterministic browser editing behavior that `contenteditable` does not
  provide consistently. It owns Tab/Shift+Tab list indentation, field-scoped Ctrl/Cmd+A, and
  selection-to-semantic-block resolution used by block-level alignment.

## Clipboard policy

External clipboard HTML is intentionally sanitized. Copy/paste performed inside Revealation
uses an application clipboard MIME type in addition to `text/html`/`text/plain`, so canonical
rich-text and media wrappers can move between layout fields without being flattened. The
application validates that internal payload before insertion. Pasted image/video files snapshot
the destination Range before asynchronous asset processing, so changing focus while the file is
being stored cannot move the insertion to another field.

## List editing

While the caret is in a list item:

- `Tab` indents the item beneath its previous sibling;
- `Shift+Tab` outdents a nested item by one level;
- the editor consumes Tab even when indentation cannot change (for example the first item), so
  focus never escapes to the surrounding UI accidentally.

`Ctrl/Cmd+A` selects the complete current editing host (a semantic layout field, or the complete
single-layout body) rather than escaping to other fields or browser chrome. Selection/history
policy remains in core because mutations must participate in undo/redo consistently.
The focused real-browser regression suite is `tests/test_editor_regressions.js`.
