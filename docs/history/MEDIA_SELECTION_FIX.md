# Media-aware selection editing

This build fixes selection-aware alignment/layout operations for images and videos.

## WYSIWYG

Clicking an image or video now makes that media element the active editing target for the alignment and layout controls.

- **Center / Right** wraps standalone media in the corresponding alignment block.
- If the media is already inside a `column` or `align` block, the existing block is updated instead of nesting another block.
- Choosing a two-column layout with standalone media selected places that media into the first column.
- If the media is already inside a columns layout, choosing another ratio only changes the existing ratio.
- Clickable images keep their anchor together with the image when they are moved/wrapped.

## Markdown

With no text selection, alignment/layout actions detect generated media under the caret:

```markdown
![](images/camera.png){width=70%}
```

and complete generated `::: video` / `::: audio` directives.

For example, putting the caret anywhere on the image line and pressing **Center** produces:

```markdown
::: align center

![](images/camera.png){width=70%}

:::
```

Choosing a 60/40 layout produces:

```markdown
::: columns 60/40

::: column
![](images/camera.png){width=70%}
:::

::: column

:::

:::
```

The existing HTML-to-Markdown serializer already understands generated images/videos inside these known blocks, so their source, authored width, and video options survive the round trip.
