# Selection-aware block editing

Toolbar block actions edit semantic context instead of blindly styling the complete slide.

## Alignment

Alignment is block-level rather than character-level.

In the **WYSIWYG editor**:

1. If a media item is explicitly selected, only that image/video (including its caption/crop wrapper) is aligned.
2. If text is selected, Revealation aligns the complete paragraph-like units touched by the selection. Selecting a single word therefore aligns its paragraph; selecting across several paragraphs aligns only those paragraphs.
3. If there is only a caret, alignment applies to the complete current editing field. In a semantic layout that means the current slot; in the `single` layout it means the complete slide body.
4. Partial alignment is represented by canonical `sr-align-*` wrappers and therefore survives WYSIWYG ↔ Markdown round-trips.
5. A whole-field alignment intentionally supersedes direct partial-alignment wrappers in that field.

`Ctrl/Cmd+A` is scoped to the current editing field. In a multi-field layout it selects the complete current slot, not the other slots or the surrounding application UI.

In **Markdown mode**:

1. If the caret/selection is already inside `::: block ...`, legacy `::: column ...`, or `::: align ...`, the existing directive header is updated.
2. Otherwise, selected Markdown is wrapped in `::: align <alignment> ... :::`.
3. With no selection, center/right insert an empty aligned block; left remains the default.

## Layouts

A layout is a property of the **current slide**, not a wrapper inserted at the caret.

When switching layouts, content is transferred semantically:

1. fields with matching slot IDs move directly to the corresponding field;
2. unmatched source fields are merged, in source order, into the target layout's explicit master field;
3. genuinely new empty fields receive their declared initial block structure (for example an `h1` scaffold for a header);
4. no populated field is silently discarded simply because the target layout has fewer slots.

The WYSIWYG and whole-deck Markdown paths use the same transfer rules. Normal editing can change content inside a field but cannot delete or merge the protected layout structure accidentally.

Legacy `::: layout` and two-column DOM/Markdown remain importable and migrate to separator metadata on a successful round-trip.

## Media selection

Images and videos use the editor's visual media selection rather than relying on a browser text range. Alignment recognizes that selection directly. The media toolbar also provides a caption field for images and videos; changing it creates or removes the semantic caption widget and persists the caption in Markdown. In Markdown mode, the same actions recognize a canonical image line or video/audio directive under the caret even when no text is selected.
