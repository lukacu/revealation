# Layout extensions

`custom.js` is loaded automatically after Revealation's built-in layout definitions.

Register additional layouts with `Revealation.layout.register({...})`. The picker, Markdown validator, WYSIWYG renderer, preview and exporters consume the registry automatically.

Each slot needs a stable semantic `id`; exactly one slot must declare `master: true`. Layout switching matches fields by those ids, then places all unmatched source content into the target master field in source order. Use `initialBlock: 'h1'` (or another supported heading level) when an empty field should begin with heading semantics instead of the default paragraph.

The stable contract and examples are documented in [`../../docs/LAYOUTS.md`](../../docs/LAYOUTS.md).

Important: once a layout id is used by presentations, do not repurpose slot ids or change slot order/count. Create a new id for a structurally different or semantically incompatible version.
