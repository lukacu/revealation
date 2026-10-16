# ADR 006 — Layouts are validated positional block trees

## Context

The original two-column feature was represented as editable HTML wrappers. Browser `contenteditable` could damage the wrapper structure, and malformed Markdown could then be round-tripped into a different slide.

We also want several layout shapes and an extension point that does not require changes to the Markdown parser.

## Decision

Revealation defines layouts in a registry. The enduring part of this decision is positional `::: block` content whose semantic slot names are assigned by template order. The original `::: layout <id>` wrapper syntax was later superseded by ADR 008: layout identity now belongs to slide-separator metadata.

Layout Markdown is validated before transformation. Missing/extra/orphaned blocks are errors and are never guessed or automatically repaired.

In WYSIWYG, layout wrappers are non-editable structural DOM and each block is an independent editing host. The later ADR 007 narrows this model to exactly one layout per slide and forbids nesting.

## Consequences

- layouts are extensible without parser changes;
- Markdown stays concise and does not expose internal slot names;
- malformed layout syntax cannot trigger a destructive round-trip;
- changing slot order/count for an existing layout id is a breaking format change;
- structural edits must be explicit commands rather than accidental contenteditable mutations.


> Partially superseded by ADR 007 (one layout per slide) and ADR 008 (layout metadata on slide separators). Positional blocks and strict validation remain in force.
