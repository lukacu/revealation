# Modifier syntax

Revealation Markdown now treats alignment as a modifier that can be attached to supported structural directives.

```markdown
::: columns 60/40

::: column
Left is the default.
:::

::: column center
This entire column is centered.
:::

:::
```

Supported column alignment modifiers are `left`, `center`, and `right`. `left` is omitted by the serializer because it is the default.

Standalone alignment uses:

```markdown
::: align center
...
:::

::: align right
...
:::
```

For backwards compatibility, `::: center`, `::: right`, and `::: left` are accepted when parsing. New serialization always emits `::: align ...`.

The WYSIWYG left/center/right buttons use the same model. If the caret is inside a column, they change the column modifier. If it is inside an alignment block, they change that block. Center/right outside such a container insert a new aligned block.

Unsupported combinations or HTML with extra classes/styles still fall back to raw HTML rather than being guessed at.
