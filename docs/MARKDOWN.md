# Revealation Markdown

Workspace mode stores the human-readable slide content in `deck.md`. Most of
that file is ordinary Markdown. Revealation adds only a few deliberately
small extensions for structures that the visual editor itself generates.

The design rule is strict: **known editor patterns get readable syntax; unknown DOM is a conversion error**. Literal HTML is allowed only inside an explicit `::: html` block. Revealation never silently falls back to arbitrary HTML during a WYSIWYG → Markdown round-trip.

## Slides and slide metadata

Slides are separated by:

```markdown
---
```

Subslides use:

```markdown
--
```

A layout is slide-level metadata and is written directly on the separator:

```markdown
--- layout=two-columns
```

or for a subslide:

```markdown
-- layout=header-body
```

Other semantic slide-wide presentation properties use the same separator metadata. A curated background extension is referenced by id:

```markdown
--- background=grid
```

Visual parameters such as arbitrary colors, fonts, spacing, or background CSS are intentionally not part of the normal Markdown format. Presentation theme selection is deck-level metadata stored in `deck.json`, not repeated on slides in `deck.md`.

For backwards compatibility Revealation still reads legacy reveal.js presentation metadata such as:

```markdown
--- transition=fade
--- background-color=black
--- background-image="images/title background.jpg"
```

Those legacy values are preserved when an old deck is loaded/saved, but the normal editor offers presentation-wide transitions in Deck settings and installed background extensions instead. Values containing spaces or other separator characters may be quoted as shown above.

Slides that are still being prepared can be marked with:

```markdown
--- under-construction=true
```

The editor shows these slides with a `WIP` badge in the sidebar. Toggle the
flag from the slide menu or with `Ctrl/Cmd + Alt + U`. The flag is metadata only
and does not change the rendered presentation.

Slides can also be kept in the authoring deck but omitted from presentation output:

```markdown
--- hidden=true
```

A hidden slide remains visible/editable in Revealation and is marked with an eye-slash badge in the slide list. The same flag is available from the slide context menu and the Notes sidebar. Hidden slides are omitted from Present mode, PDF export, standalone HTML, and the generated presentation HTML inside ZIP packages. Markdown/JSON authoring exports retain the slide and its `hidden=true` metadata so it can be restored later.

Semantic backgrounds and auto-animate settings belong on the separator. Legacy per-slide `transition=...` metadata is accepted for compatibility, but normal authoring uses the presentation-wide transition in Deck settings. Content-attached animation uses readable directives:

```markdown
::: fragment effect=fade-up
This appears after the previous content.
:::

::: animate id=diagram
![Diagram](images/diagram.svg)
:::
```

The `fragment` directive marks content within one slide. The `animate` id is a
stable match for Reveal.js auto-animation across adjacent slides; it is not a
CSS selector and does not depend on generated DOM positions.

The first slide may omit its separator when it uses the default `single` layout. A first slide with a multi-block layout starts with its normal `--- layout=...` declaration.

## Speaker notes

Speaker notes are explicit non-visual slide content and use one optional final top-level block:

```markdown
## Slide title

Visible slide content.

::: notes
Remind the audience why this result matters.
Pause before advancing.
:::
```

The `::: notes` block belongs to the slide immediately containing it, is excluded from layout/block validation, and is rendered to Reveal.js speaker notes in Present/export. It must appear at most once and after all visible slide content. Notes are stored as plain text; nested Revealation directives are not interpreted inside the block.

The historical `Note:` prefix is **not** recognized. A line beginning with `Note:` is ordinary visible Markdown content. This is intentional because the notes feature had not yet been used in released decks and therefore does not carry a compatibility path.

A horizontal rule inside a slide is emitted as `***` so it is not confused with a slide separator.

## Layouts and blocks

The default `single` layout is ordinary Markdown with no wrapper. Multi-block layouts contain only generic positional blocks; their layout id comes from the separator:

```markdown
--- layout=two-columns-60-40

::: block
## Left side

Normal **Markdown**, equations, code, images, and media can live here.
:::

::: block align=center
![Diagram](images/diagram.svg){width=80%}
:::
```

Block order determines slot semantics from the registered template. Slot names are not written into Markdown. The number of blocks must match the template exactly; otherwise Revealation reports an error and refuses the round-trip.

There is exactly one layout per slide and layouts cannot be nested. The old `::: layout <id>` wrapper and `::: columns` syntax remain readable only for migration and are rewritten to separator metadata on the next successful write.

Built-in layouts and the extension API are documented in [`LAYOUTS.md`](LAYOUTS.md).

## Semantic block styles and tables

The paragraph-style control includes four presentation semantics in addition to ordinary headings/body text:

- **Emphasis** — an important statement that should stand out;
- **Muted** — secondary/supporting information;
- **Callout** — a highlighted standalone point;
- **Quote** — a semantic Markdown blockquote.

Emphasis, Muted, and Callout are readable fenced blocks. Their contents can be
ordinary Markdown, including headings, lists, links, and inline formatting:

```markdown
::: emphasis
This is the result to remember.
:::

::: muted
Additional methodological detail.
:::

::: callout
The dataset split must be fixed before evaluation.
:::
```

Quote remains ordinary Markdown, using the normal blockquote syntax:

```markdown
> A model is useful when its assumptions are visible.
```

Themes own the visual rendering of all four semantics. Changing the deck theme therefore never changes their meaning or inserts arbitrary per-slide CSS. Older `.element` comments for these styles remain readable and are rewritten to fenced blocks on the next save.

Tables use normal GitHub-style pipe Markdown and are also styled by the active theme:

```markdown
| Model | mIoU |
| --- | ---: |
| Baseline | 0.57 |
| Proposed | 0.76 |
```

Simple tables round-trip through WYSIWYG/Markdown. Cell alignment from the separator row is preserved and themes provide the presentation treatment.

## Sized images

An image resized with the visual media handle is written as:

```markdown
![Diagram](images/diagram.png){width=63%}
```

A natural-size image remains ordinary Markdown:

```markdown
![Diagram](images/diagram.png)
```

An image caption uses the standard Markdown image title. Revealation renders
it as a semantic `<figcaption>` and preserves it when converting back to
Markdown:

```markdown
![Diagram](images/diagram.png "A short description")
```

For videos, captions are stored as a directive field:

```markdown
::: video
src: media/example.mp4
caption: A short description
controls: true
:::
```

Captioned images and videos are represented in HTML by a `figure` with a
`figcaption`. Themes can style `.sr-media-caption figcaption` without changing
the Markdown source.

The width form also works inline. Revealation only recognizes the `width=N%`
attribute that it generates itself; richer image HTML remains HTML.

## Video

Videos use a readable directive:

```markdown
::: video
src: videos/example.mp4
width: 80%
controls: true
autoplay: true
loop: false
muted: true
:::
```

`width` is omitted when the video uses its natural size. `autoplay` maps to
reveal.js `data-autoplay`, meaning the video starts when its slide becomes
active rather than while it is being edited.

## Audio

Audio inserted from the workspace uses:

```markdown
::: audio
src: audio/example.ogg
controls: true
:::
```

## Code

Code remains standard fenced Markdown with a language:

````markdown
```python
img = cv2.imread("image.png")
```
````

## Mathematics

Inline mathematics:

```markdown
\(x' = K[R|t]X\)
```

Display mathematics:

```markdown
\[
x' = K[R|t]X
\]
```

In the WYSIWYG editor the LaTeX source is stored atomically on the math element
and KaTeX output is treated as runtime decoration only. This is important for
multiline environments such as `cases`, `aligned`, or arrays: row separators
(`\\`) and commands containing backslashes must never be reconstructed from
rendered HTML. The HTML ↔ Markdown codec therefore serializes the original TeX
source directly. Both inline `\(...\)` and display `\[...\]` forms may span
source lines; Revealation protects the complete math payload before the general
Markdown parser sees it. Display style is usually the more readable choice for
large environments such as `cases`, but multiline inline source remains a valid
round-trip representation.


## Alignment blocks and modifiers

Normal slide content is left-aligned. Alignment uses the same modifier model
as columns. For a standalone aligned region use:

```markdown
::: align center
# Centered title

A short centered message.
:::
```

or:

```markdown
::: align right
Right-aligned content.
:::
```

For a layout block, put the modifier directly on `::: block`:

```markdown
--- layout=two-columns

::: block
- left by default
- good for bullets
:::

::: block align=center
![Diagram](images/diagram.svg){width=70%}
:::
```

The older shorthands `::: center`, `::: right`, `::: left` and legacy aligned
columns are still accepted when reading Markdown. Revealation writes canonical
`::: block align=...` inside layouts and `::: align ...` for standalone
regions. A slide may contain only one layout; layouts cannot be nested.

In WYSIWYG mode the left/center/right toolbar buttons modify the current layout
block or alignment block. If no such container is active, center/right create a
new aligned block; left remains the slide default.

## Explicit raw HTML

Raw HTML is allowed only through an explicit block:

```markdown
::: html
<div class="my-special-layout">
  <p>Intentional HTML</p>
</div>
:::
```

The block is protected in WYSIWYG mode. Revealation stores its exact source separately and writes it back as `::: html`. Raw tags written directly into ordinary Markdown are validation errors.

Likewise, if WYSIWYG content contains DOM that has no canonical Markdown representation (for example an unexpected styled heading or unknown `<div>`), conversion stops with an error instead of emitting raw HTML.

If conversion cannot open Markdown mode, open **Help → Recover Markdown**. Revealation opens a lossy recovery document: valid slides keep their normal Markdown, while failing slides are reduced to safe plain text with a warning comment. Review the recovered slide before applying it.

### Editing workflow

Open the whole-deck source editor with **Help → Edit deck Markdown** or `Ctrl/Cmd+Shift+M`. Markdown editing is deliberately buffered rather than live: changes do not affect the slide model until they are applied.

- **Apply** (or `Ctrl/Cmd+S`) applies valid source and returns to slide editing.
- **Close**, `Esc`, or `Ctrl/Cmd+Shift+M` returns without applying; if the buffer was edited, Revealation asks for confirmation before discarding those changes.
- Parse or layout errors prevent Apply from closing the editor, leaving the source visible for correction.


## Interactive content

```markdown
::: interactive
src: interactive/example/index.html
width: 100%
height: 480
interactive: true
preload: false
border: false
scrollbars: false
:::
```

The `src` path is relative to the workspace root. Hand-authored iframe HTML must be placed inside an explicit `::: html` block.


### Legacy compatibility

Older decks that use `::: demo` are still accepted. Revealation normalizes them to the canonical `::: interactive` form on the next Markdown round-trip. Legacy generated HTML using `class="sr-demo"` is likewise accepted and rewritten as `sr-interactive` when edited.
