# ADR 009 — Visual appearance uses curated themes and background extensions

## Status
Accepted

## Context
Revealation previously exposed raw reveal.js theme names, arbitrary custom theme controls, and per-slide background implementation details. That made presentation content dependent on editor-generated styling and encouraged PowerPoint-like visual customization. Revealation already has semantic layouts and a no-build extension convention, so visual appearance can be separated from content without a general plugin framework.

## Decision
A presentation has exactly one curated Revealation theme id stored at deck level. Themes are manifest-backed CSS packages and style a stable set of Revealation design tokens and semantic layout classes.

A slide may independently reference one registered background-extension id. Backgrounds provide static CSS and may optionally provide presentation-only JavaScript through a small mount/start/stop/destroy lifecycle. Editor mode loads only their static CSS. Themes may recommend/default background ids but do not own background implementations.

Normal editor UI exposes theme and background choices, not arbitrary font, color, spacing, shadow, CSS-variable, or reveal.js-theme controls. Legacy custom-theme and raw reveal.js background data remains readable/renderable where practical but is not a normal authoring surface.

The static/no-build application uses explicit manifest registration rather than filesystem discovery or a general plugin framework.

## Consequences
- Markdown and semantic layouts remain largely independent of presentation appearance.
- A visual-system author writes CSS/manifests (and optional background JS) instead of adding editor controls.
- The editor can give every choice a designed preview and sensible defaults.
- Export can include only the selected theme and referenced background resources.
- Adding an installed extension requires one catalog registration because a browser-only static app cannot enumerate directories.
- Legacy arbitrary styling is compatibility debt rather than part of the supported design API.
