# ADR 003 — Readable Markdown is the primary workspace slide content

## Status
Accepted.

## Context
A filesystem-backed teaching workflow benefits from Git-friendly, hand-editable slide content. Raw generated HTML is difficult to review and maintain.

## Decision
In workspace mode, `deck.md` is the complete human-readable presentation source, including slide-level presentation metadata. `deck.json` carries project metadata, reveal configuration, theme state and stable slide identities; generated slide HTML is not persisted there.

Revealation uses a small explicit grammar: slide-level layout metadata lives on `---` / `--` separators, while structured content uses directives such as `::: block`, `::: align`, `::: interactive` and `::: html`. Unknown structures are rejected rather than silently converted.

## Consequences
Every content/layout feature must define reliable Markdown ↔ DOM round-trip behavior. Literal HTML is permitted only through the explicit `::: html` content block (ADR 007).
