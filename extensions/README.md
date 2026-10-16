# Extensions

This directory contains intentionally small, explicit extension surfaces for Revealation installations.

Extensions are **not** the architecture of the application: core functionality remains under `src/`. An extension uses a documented domain API when a customization genuinely belongs outside the core implementation.

Currently supported:

- `layouts/` — register additional layout templates through `Revealation.layout.register()`.
- `themes/register.js` — install manifest-backed presentation themes from `themes/` (or another app-served location).
- `backgrounds/` — install independent static or animated slide-background extensions.

Keep extension code local, readable and version-controlled. Extensions should not mutate deck state, patch parser functions, or reach into `src/core/application.js` internals. Theme/background authoring is documented in [`docs/THEMES_AND_BACKGUNDS.md`](../docs/THEMES_AND_BACKGROUNDS.md).
