# Layouts and structural blocks

Revealation uses exactly one logical layout per slide. The layout is **slide metadata**, not a nested content directive.

## Slide layout model

Every slide has one layout id:

- `single` — the implicit default; the whole slide is one editable body and no block wrappers are required;
- a registered multi-block layout — the slide body consists only of the exact ordered `::: block` children required by that layout.

Layouts cannot be nested. A slide cannot contain two layouts, and a multi-block slide cannot contain ordinary visual content beside its blocks.

Internally, a multi-block slide persists its positional content separately from the rendered DOM:

```js
{
  layout: 'header-body',
  blocks: [
    { html: '<h1>Title</h1>', align: 'left' },
    { html: '<p>Body</p>', align: 'left' },
  ]
}
```

The `.sr-layout` / `.sr-layout-slot` DOM is a WYSIWYG and rendering projection of this model, **not the source of truth for serialization**. This prevents a stale or browser-modified DOM cache from making Markdown export fail merely because the slide uses a non-default layout.

## Author syntax

The layout id is written next to the slide or subslide separator.

A normal slide uses the implicit `single` layout:

```markdown
---

# Project overview

Normal slide content.
```

The first slide may omit the initial `---` when it uses the default layout.

Two columns:

```markdown
--- layout=two-columns

::: block
Left content.
:::

::: block
Right content.
:::
```

Header plus two columns:

```markdown
--- layout=header-two-columns

::: block
# Project overview
:::

::: block
Text on the left.
:::

::: block align=center
![](images/diagram.svg){width=75%}
:::
```

Header plus three columns:

```markdown
--- layout=header-three-columns

::: block
# Project overview
:::

::: block
Left content.
:::

::: block
Center content.
:::

::: block
Right content.
:::
```

Header, two columns, and footer:

```markdown
--- layout=header-two-columns-footer

::: block
# Project overview
:::

::: block
Left content.
:::

::: block
Right content.
:::

::: block align=center
Source or other footer content.
:::
```

A subslide uses the same metadata syntax:

```markdown
-- layout=two-columns

::: block
A
:::

::: block
B
:::
```

There are deliberately no `{...}` attribute braces. Revealation owns this small separator grammar directly.

## Positional storage and semantic fields

Markdown stays intentionally simple and positional: block order assigns each `::: block` to the registered slot at the same position. For `header-two-columns`:

1. block 1 → `header`;
2. block 2 → `left`;
3. block 3 → `right`.

For `header-three-columns`, the four blocks are `header`, `left`, `center`,
and `right`, in that order. For `header-two-columns-footer`, they are
`header`, `left`, `right`, and `footer`.

Slot names are internal and do not need to be written in Markdown. They are nevertheless stable **semantic field names** inside the layout registry. Revealation uses those names when changing layouts, so `header` content stays `header`, `body` stays `body`, and so on even when their visual positions differ.

The number of persisted blocks must match the registered template exactly. Missing or extra blocks are errors; Revealation never guesses their meaning while parsing Markdown.

## Changing layouts without losing content

Changing a slide layout is a deterministic semantic transfer, not a positional rewrite:

1. target fields first receive content from a source field with the same slot id;
2. every source field that has no name match is collected in original source order;
3. that unmatched content is appended to the target layout's single **master** field;
4. empty target fields receive their declared WYSIWYG scaffold, such as an `h1` for a header.

For example, switching `header-two-columns` (`header`, `left`, `right`) to `header-body` (`header`, `body`) keeps `header` unchanged and merges `left` then `right` into the master `body` field. Switching back keeps the body content rather than deleting it: because `body` has no matching target field, it is routed to the target layout's master field.

Formatting is transferred as canonical HTML, so nested lists, inline emphasis, links and media are not flattened merely because the layout changed. Alignment is retained when all content merged into a field agrees on the same alignment; otherwise the merged master falls back to left alignment.

## WYSIWYG safety

In the default layout the editor root is the single `body` editing block.

When a multi-block layout is active, WYSIWYG contains one protected `.sr-layout` DOM root. That wrapper is an **editor/rendering implementation detail**; it is not serialized as a Markdown layout block. Each slot is an independent `contenteditable` host, so typing, paste, Backspace and Delete cannot cross slot boundaries or create content beside the layout. A slot may declare an `initialBlock` (`p`, `h1` … `h6`); built-in header slots use `h1`, so a fresh header starts with title semantics rather than a plain paragraph. The scaffold is only an editing affordance and is not meaningful persisted content until the user types into it.

A layout may also mark at most one slot with `titleSource: true`. The slide sidebar derives the slide label **only** from that slot. If the slot has no textual content (for example it is empty or image-only), the label falls back to `Slide N`. Other slots, media, and backgrounds never contribute to the label. Header-based built-ins use the header as their title source; layouts without a header use one explicitly chosen content slot.

Editor outlines and slot labels are paint-only and do not consume slide geometry. The layout id itself is intentionally **not** painted over the slide; the current layout is highlighted in the Layout picker instead. First/last child margins are collapsed at slot boundaries to avoid theme-generated gutters.

## Invalid Markdown is non-destructive

Before Markdown is applied, Revealation validates:

- separator metadata syntax;
- that the referenced layout exists;
- exact block count;
- that no visual content lives outside blocks on a multi-block slide;
- that blocks are structurally closed.

When invalid:

- Apply is rejected;
- the Markdown buffer is not rewritten;
- the deck is not replaced by a best-effort parse;
- the status reports the first failing line.

## Built-in layouts

- `single` — implicit one-block/default slide;
- `header-body`;
- `two-columns`;
- `two-columns-60-40`;
- `two-columns-40-60`;
- `header-two-columns-60-40`;
- `header-two-columns-40-60`;
- `header-two-columns`;
- `header-three-columns`;
- `header-two-columns-footer`;
- `grid-2x2`.

The picker is generated from the registry, so registered extensions appear automatically.

## Legacy migration

Revealation still reads older forms:

```markdown
::: layout two-columns
...
:::
```

and the older `::: columns` / `::: column` syntax.

They are **input-only compatibility formats**. On the next successful Markdown write, layout identity moves to the slide separator and the body is written as positional `::: block` directives.

## Adding a custom layout

Layouts are an extension boundary, not a plugin architecture for the whole application. A custom layout needs a stable id, ordered slots and CSS Grid geometry:

```javascript
Revealation.layout.register({
  id: 'title-wide-media',
  label: 'Title + wide media',
  description: 'Title above a large media region.',
  slots: [
    { id: 'title', label: 'Title', titleSource: true, initialBlock: 'h1' },
    { id: 'media', label: 'Media', master: true, initialBlock: 'p' },
  ],
  grid: {
    areas: '"title" "media"',
    columns: 'minmax(0, 1fr)',
    rows: 'auto minmax(0, 1fr)',
    gap: '0.25em',
  },
});
```

The simplest local extension point is `extensions/layouts/custom.js`, loaded after the built-ins. Knowledge of JavaScript, CSS Grid and reveal.js layout behavior is sufficient; the Markdown parser does not need to be modified.

Every layout must declare exactly one `master: true` slot. A layout may declare at most one `titleSource: true` slot. `initialBlock` defaults to `p` when omitted.

Slot ids and order are both part of the layout contract: ids are semantic transfer keys, while order maps those fields to positional Markdown blocks. Changing either meaning for an already-used layout id should normally use a new layout id.
