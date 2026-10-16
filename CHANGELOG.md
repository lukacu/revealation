## WYSIWYG geometry / PDF reliability

- Fixed editor theme geometry scaling: slide padding and body font size are now resolved from theme tokens in JavaScript instead of invalid `calc(<length> * <number>)` expressions.
- Fixed interactive-height editing from the media inspector by updating canonical `data-height` as well as the scaled editor projection.
- PDF print mode now restores theme slide padding that reveal.js resets with `padding: 0 !important`, keeping the same authored content box as editor/Present.
- PDF waits for interactive iframe load, same-origin fonts/media, a bounded DOM-quiet period and child/parent paint frames before opening the native print dialog.
- Highlighted code now has explicit inherited font geometry and hard width/wrapping constraints in editor, Present and PDF.

# 0.1.0

- Fixed interactive iframe geometry in the WYSIWYG editor: authored heights now scale with the editor stage while remaining logical Reveal-pixel values in saved content and presentation/export output. This keeps responsive iframe content at the same aspect ratio in Edit and Present.
- Fixed installed theme registration in workspace mode: built-in manifests now load from `/__app__/themes/...`, so the Deck settings theme picker is populated reliably.
- Themes now style Markdown tables and semantic Emphasis, Muted, Callout, and Quote blocks in both WYSIWYG and presentation output.
- Added Classic (warm serif/editorial) and Kinetic (playful/colorful) built-in themes.

## Unreleased
- Added static/PWA deployment support for GitHub Pages, including subdirectory-safe application URLs, generated PWA icons/manifest, offline application-shell caching, explicit save-before-update activation, and a `main` deployment workflow. Hosted mode can use the File System Access API to open a real local presentation directory while preserving the Python workspace mode for local launches.
- Fixed PDF snapshots of interactive content: print mode now forces iframe-backed blocks to load eagerly and waits for their load/font/paint boundary after Reveal `pdf-ready` before invoking the browser print dialog. Also normalized code-block geometry across editor/Present/PDF with a dedicated `--rv-size-code` token, bounded width, consistent padding, and safe wrapping for long highlighted lines.
- Fixed multiline inline LaTeX round-trips: canonical `\(...\)` equations may span source lines, so `cases`/`array` expressions entered through the equation dialog are protected before Markdown parsing instead of being reduced to plain text and collapsed backslashes. Added exact workspace `deck.md` save/reload coverage for the reported equation.
- PDF export now preserves the same relative outer margin as Present instead of forcing zero margin; reveal.js screen-space margin is converted to its print-space equivalent, while theme padding remains unchanged.

- Fixed PDF geometry so reveal.js viewport margin is not converted into extra physical page margin; PDF pages now match the logical slide size and use theme padding as the sole internal margin. PDF printing now waits for reveal.js `pdf-ready` instead of a fixed timeout.
- Fixed Present-mode vertical drift/clipping on tall interactive slides: preview runtime now waits for theme/core CSS and font metrics before `Reveal.initialize()`, normalizes heading/paragraph geometry to match WYSIWYG, and performs a post-paint layout pass. Linked/standalone exports also relayout after fonts settle.
- Fixed complex LaTeX equations (including `cases` with row separators/alignment) losing renderability after WYSIWYG HTML round-trips: `data-tex` is now the single source of truth and KaTeX output is runtime-only. Replaced the calculator toolbar icon with a formula/braces icon.
- Fixed slide-list active/selection drift during keyboard navigation, moved current-layout indication into the Layout picker, made sidebar titles come only from a layout-declared `titleSource` field, and added first-class hidden slides that remain editable but are omitted from Present/PDF/HTML/ZIP presentation output.
- Fixed four WYSIWYG/UI regressions: readable dark-mode form controls, selection-scoped block/media alignment, field-scoped `Ctrl/Cmd+A`, and delayed-media reflow for vertically centered slides. Added focused and application-level Chromium coverage.
- Hardened WYSIWYG editing: deterministic Tab/Shift+Tab nested-list editing, canonical list repair, structure-preserving internal cross-field clipboard, safer external inline paste, and stable destinations for asynchronous pasted media.
- Made layout switching content-preserving: fields transfer by semantic slot id, unmatched content merges into an explicit master field, and slots can declare initial WYSIWYG block semantics such as `h1` headers. Added focused Chromium editor regressions for both areas.
- Refined the main header into logo / centered deck identity / right-side commands, and simplified “Present from here” to text only.
- Added `Ctrl/Cmd+Shift+M` for whole-deck Markdown; Markdown Close now guards dirty source and Apply exits after a successful rebuild.

- Moved deck name editing into Deck settings, added author metadata, replaced the large slide footer with Layout/Background/Notes toolbar actions plus a hideable right notes sidebar, and made `::: notes ... :::` the canonical speaker-notes syntax with no legacy `Note:` parser.
- Marked temporary backwards-compatibility paths with stable `RV-COMPAT(<id>)` tags and added `docs/COMPATIBILITY_DEBT.md` plus a consistency check so internal migration code can be removed systematically before the first public release.
- Reorganized the main toolbar around deck identity/settings on the left and history/Present/application actions on the right; added dedicated Deck settings, Export, and Help dialogs plus a save-state icon.
- Clarified settings UX: Application settings contain editor appearance plus functional presentation behavior (controls, navigation, Present link behavior and playback); theme, transitions and canvas geometry live in Deck settings.
- Removed the standalone top-bar light/dark button and the per-slide transition selector while preserving legacy transition metadata on load/export.
- Renamed the editor's Preview action to Present and made it a full-viewport, banner-free presentation surface that returns to the editor without requiring export.


Initial release of Revealation. This version is a complete rewrite of the original Revealation project, with a focus on modern web technologies and improved performance.
