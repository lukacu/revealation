# Architecture decision records

These ADRs record **why** Revealation uses its current boundaries. They are intentionally short. Add a new numbered record when a decision has project-wide consequences that would be hard to reconstruct from code alone.

| ADR | Decision |
|---|---|
| [001](001-revealation-is-the-product.md) | Revealation is the architectural product; Small Reveal is historical upstream. |
| [002](002-storage-adapters.md) | Storage mechanisms are isolated behind adapter boundaries. |
| [003](003-readable-markdown-is-primary-workspace-content.md) | `deck.md` is the human-readable workspace content source. |
| [004](004-interactive-content-uses-iframes.md) | Interactive content uses local iframe entry points. |
| [005](005-no-build-step.md) | Browser-ready source files are used without a mandatory build step. |
| [006](006-layouts-are-validated-positional-block-trees.md) | Layout blocks are positional and strictly validated. |
| [007](007-one-layout-and-explicit-html.md) | Each slide has one layout and raw HTML is explicit. |
| [008](008-layout-is-slide-separator-metadata.md) | Layout identity belongs to slide/subslide separator metadata. |
| [009](009-curated-visual-systems.md) | Visual appearance uses curated themes and independent background extensions. |
| [010](010-pwa-directory-workspace.md) | Hosted PWA mode uses direct local-directory workspaces and subdirectory-safe application URLs. |

## ADR template

```markdown
# ADR NNN — Decision title

## Status
Accepted / Superseded / Deprecated

## Context
What problem or pressure required a decision?

## Decision
What rule did Revealation adopt?

## Consequences
What becomes easier, harder, required or intentionally unsupported?
```
