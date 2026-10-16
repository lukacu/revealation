# 007 — One layout per slide and explicit raw HTML

## Context

Allowing nested/multiple layouts and arbitrary raw-HTML fallback made WYSIWYG structure ambiguous. Browser `contenteditable` artifacts could leak into Markdown as `<div>`/styled HTML, after which a later round-trip could permanently distort the slide.

## Decision

A slide has exactly one logical layout. The default layout is the implicit single body block. A multi-block layout replaces that editable body and is the only structural layout wrapper on the slide. Layouts cannot be nested.

Literal HTML is valid only inside `::: html`. WYSIWYG → Markdown conversion rejects unknown or non-canonical DOM rather than falling back to raw HTML.

## Consequences

- slide structure is easy to validate and protect;
- layout extensions remain simple registered templates;
- conversion failures are visible instead of destructive;
- advanced hand-authored HTML remains possible, but is explicit and isolated;
- some old decks containing arbitrary HTML must be moved into `::: html` before using Markdown round-trip editing.
