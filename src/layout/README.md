# Layout domain

`src/layout/` is a **core Revealation domain**, not a plugin folder.

A layout is an ordered collection of semantic slots owned by a slide. Markdown writes the layout id on the slide separator (`--- layout=<id>` / `-- layout=<id>`) and generic positional `::: block` children in the slide body. The registered template assigns slot semantics by order.

## Files

- `registry.js` — public extension API, immutable template catalog and semantic layout-transfer plan.
- `builtins.js` — layouts shipped with Revealation. Uses the same API as extensions.
- `blocks.js` — Markdown validation, persistent block ↔ canonical DOM projection, protected WYSIWYG behavior, empty-field scaffolds and content-preserving layout transfer.

## Slot contract

Every slot has a stable semantic `id`. Exactly one slot in every layout is marked `master: true`.
When changing layouts, same-named fields transfer directly and any source fields that do not have a
match are appended, in source order, to the target master field. This is deliberately independent of
visual grid position.

A slot can also declare `titleSource: true`. At most one slot per layout may do so; that slot is the only source used for the slide-list label. Empty or non-textual title-source content falls back to `Slide N`.

A slot can also declare `initialBlock` (`p`, `h1` … `h6`). It controls only the empty WYSIWYG
scaffold. For example, built-in header fields use `initialBlock: 'h1'`, so typing into a fresh header
starts as a title rather than a paragraph. Empty scaffolds are not persisted as meaningful Markdown
content.

## Invariants

1. Slot ids are stable semantic transfer keys; changing their meaning for an existing layout id is a breaking change.
2. Slot order is the persisted positional Markdown contract; changing count/order for an existing id is also breaking.
3. Every layout has exactly one master slot and at most one title-source slot.
4. A valid layout contains exactly one direct block for every registered slot.
5. Invalid layout Markdown is never guessed, repaired or round-tripped.
6. In WYSIWYG, the layout wrapper is structural and non-editable. Only slot contents are editing hosts.
7. Presentation/export markup never contains editor-only `contenteditable` attributes.
8. In-memory `slide.blocks` is authoritative for multi-block serialization; `.sr-layout` DOM and `slide.content` are runtime projections, not workspace persistence.

See `docs/LAYOUTS.md` for author syntax, switching behavior and extension examples.
