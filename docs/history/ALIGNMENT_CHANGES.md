> **Updated in 1.6.3:** alignment is now generalized as a modifier. The canonical forms are `::: column center`, `::: column right`, and standalone `::: align center/right`. The older `::: center` form described below remains accepted for backwards compatibility.

# Text alignment changes

This version makes slide content left-aligned by default in all render paths:

- WYSIWYG editor
- reveal.js preview
- standalone HTML export

Centered composition is now explicit and round-trippable through Revealation Markdown:

```markdown
::: center
# Centered title

A short centered callout.
:::
```

The editor represents this as `<div class="sr-center">...</div>`. The serializer only emits `::: center` for that exact generated structure. If the div carries additional classes, styles, or attributes it remains raw HTML, preserving the lossless fallback rule.

`::: center` can be nested inside a column and can itself contain a columns block.
