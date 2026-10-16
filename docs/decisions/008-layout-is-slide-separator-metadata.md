# ADR 008 — Layout is slide-separator metadata

## Status
Accepted.

## Context

After ADR 007 restricted each slide to exactly one layout, keeping a separate `::: layout <id>` content wrapper duplicated structure: the slide already owned the layout concept, while Markdown represented it as another nested block. This made authoring noisier and encouraged the mental model that a layout was ordinary content.

## Decision

Layout identity is a slide-level property and is serialized on the slide/subslide separator:

```markdown
--- layout=header-two-columns
```

or:

```markdown
-- layout=two-columns
```

The default `single` layout omits `layout=`. Multi-block slide bodies contain only the exact ordered `::: block` children required by the registered template.

Revealation deliberately uses its own minimal `key=value` separator syntax and does not use Pandoc/Quarto `{...}` attribute braces.

The protected `.sr-layout` wrapper remains an internal WYSIWYG/rendering representation. It is not the document-level Markdown representation.

Legacy `::: layout <id>` and `::: columns` syntax remain readable for migration only; the canonical writer never emits them.

## Consequences

- layout is unambiguously owned by the slide model;
- Markdown loses one redundant nesting level;
- changing layouts is a whole-slide structural operation rather than a caret insertion;
- first slides with a non-default layout use a leading `--- layout=...` declaration;
- separator parsing/validation becomes part of the serialization contract;
- extension layouts still require no parser changes because only the registered id appears in metadata.
