# UI

Core user-interface components. Files here are **not plugins**.

- `sidebar.js` — slide/subslide navigation, Outline/Thumbnail views, drag/drop mechanics.
- `toolbar.js` — lays out WYSIWYG toolbar controls according to configuration.
- `topbar.js` — lays out deck-level actions according to configuration.

UI components may request mutations through callbacks supplied by core, but should not write project state directly.
