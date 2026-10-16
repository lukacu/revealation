# ADR 001 — Revealation is the product boundary

## Status
Accepted.

## Context
Revealation started as a heavily modified Small Reveal codebase. Treating every later feature as a "module around Small Reveal" made the architecture reflect development history instead of the current product.

## Decision
Revealation is the architectural product. Small Reveal remains credited as upstream/history in README/LICENSE/changelog, but it is not a runtime or source-code layer.

Subsystems are organized by responsibility: core, UI, storage, content, serialization, rendering, editor and export.

## Consequences
- core features such as sidebar/navigation are first-class Revealation UI;
- future files are placed by responsibility, not by whether they were inherited or added later;
- historical attribution remains explicit without shaping current APIs.
