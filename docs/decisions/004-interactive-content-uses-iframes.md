# ADR 004 — Interactive content uses iframe entry points

## Status
Accepted.

## Context
Teaching slides need self-contained JavaScript demonstrations without coupling each demo to the editor runtime.

## Decision
Interactive content is represented by `::: interactive` and rendered as a local iframe entry point. The WYSIWYG editor disables iframe pointer interaction so the block can be selected/resized; Present mode restores interaction.

Thumbnail rendering never executes interactive iframes.

## Consequences
Interactive examples can be developed independently in ordinary HTML/CSS/JS directories. Standalone export can inline simple demos, while complex module/fetch/worker-based apps may require bundling.
