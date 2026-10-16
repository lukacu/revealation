# WYSIWYG rendering pass

This build removes the old intentionally-dense editor preview and makes the
editing canvas follow reveal.js slide geometry much more closely.

## What changed

- The editor no longer renders body text at 55% of the reveal.js theme size.
- The editor uses the deck's reveal.js `width` and `height` settings (960x700
  by default) as its logical canvas.
- The canvas is uniformly scaled to fit the available editor area. Font sizes,
  slide dimensions and layout geometry therefore scale together, preserving
  line wrapping.
- The editor frame participates in the selected reveal.js theme (`reveal`
  class), so theme typography rules apply to the WYSIWYG surface as well.
- The editor now mirrors reveal.js' centered text baseline and approximates
  Reveal's vertical centering when `center: true`.
- Column editor guides use `outline` instead of border + padding, so the guides
  no longer consume layout space that is absent in preview/export.
- A red `Content overflows slide` warning appears when content exceeds the
  actual rendered slide area.
- Changing reveal.js slide width, height or centering updates the editor
  immediately.

## Why existing slides may look different

Older builds intentionally made the editor denser than the exported deck. A
slide that looked comfortable in the editor could therefore overflow in
preview. In this build, crowded slides should look crowded while editing too.
That is intentional: preview/export should no longer reveal a surprise font
size or line wrapping change.
