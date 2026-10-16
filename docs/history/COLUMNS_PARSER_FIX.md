# Markdown columns parser fix

This build makes Revealation Markdown directives more tolerant when edited by hand.

## What changed

The canonical form is still:

```markdown
::: columns 50/50

::: column
Left column
:::

::: column
Right column
:::

:::
```

However, a closing directive may now also appear at the end of a content line while a recognized Revealation directive is open:

```markdown
::: column
Last list item :::
```

This is normalized internally to:

```markdown
::: column
Last list item
:::
```

The normalization:

- accepts trailing whitespace after directive openers such as `::: column `;
- only recognizes an inline trailing `:::` when inside a Revealation directive;
- requires whitespace before the trailing `:::`;
- does not touch fenced code blocks;
- leaves ordinary `:::` text outside directives unchanged;
- does not change the serializer: generated `deck.md` continues to use one closing `:::` per line.

This fixes the failure mode where one missed column closer caused the entire `::: columns ...` block to fall through to ordinary Markdown and appear literally on the slide.
