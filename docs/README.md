# Revealation documentation

Start here when changing the project.

## Architecture and development

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — responsibility boundaries and source-tree model.
- [`CORE_MAP.md`](CORE_MAP.md) — map of the remaining large core orchestrator and safe future extraction candidates.
- [`DEVELOPMENT.md`](DEVELOPMENT.md) — where to make common changes, documentation rules and pre-release checks.
- [`TESTING.md`](TESTING.md) — static and workspace smoke-test procedure.
- [`COMPATIBILITY_DEBT.md`](COMPATIBILITY_DEBT.md) — temporary internal backwards-compatibility inventory and the `RV-COMPAT(...)` removal markers.

## User-facing subsystems

- [`LAYOUTS.md`](LAYOUTS.md) — slide-level layout metadata, protected positional blocks, validation and extension API.
- [`THEMES_AND_BACKGROUNDS.md`](THEMES_AND_BACKGROUNDS.md) — curated theme tokens, semantic styling hooks and background-extension lifecycle/export contract.
- [`MARKDOWN.md`](MARKDOWN.md) — readable whole-deck Markdown and structured directives.
- [`SELECTION_EDITING.md`](SELECTION_EDITING.md) — selection-aware editing behavior.
- [`SIDEBAR.md`](SIDEBAR.md) — slide/subslide navigation and Thumbnail/Outline views.
- [`TOOLBAR.md`](TOOLBAR.md) — hand-editable toolbar/topbar configuration.
- [`INTERACTIVE.md`](INTERACTIVE.md) — local iframe-backed interactive content.
- [`PDF_EXPORT.md`](PDF_EXPORT.md) — reveal.js print/PDF flow and limitations.
- [`RELEASE_LIMITATIONS.md`](RELEASE_LIMITATIONS.md) — alpha release limitations and export/deployment caveats.
- [`PWA_DEPLOYMENT.md`](PWA_DEPLOYMENT.md) — GitHub Pages packaging, PWA updates and hosted local-directory workspaces.

## Architecture decisions

Long-lived decisions are in [`decisions/`](decisions/README.md). Read the relevant ADR before changing a subsystem boundary.

## History and upstream material

- `history/` contains old implementation/change notes for reference only; it does not define current architecture.
- `upstream-assets/` preserves non-runtime Small Reveal material used for attribution/history.
